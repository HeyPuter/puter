/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';
import { HttpError } from '../../core/http/HttpError.js';

// ── Types ────────────────────────────────────────────────────────────

export interface GroupRow {
    id: number;
    uid: string;
    owner_user_id: number;
    extra: Record<string, unknown>;
    metadata: Record<string, unknown>;
    [k: string]: unknown;
}

// ── Constants ────────────────────────────────────────────────────────

const CREATE_RATE_LIMIT_PER_HOUR = 20;
const PUBLIC_GROUPS_CACHE_TTL_SECONDS = 10 * 60;

// ── GroupStore ───────────────────────────────────────────────────────

/**
 * Persistence layer for persistent user groups.
 *
 * Owns CRUD over the `group` table and the `jct_user_group` junction table,
 * plus a per-process redis cache for the (small, frequently-read) set of
 * public groups (the hardcoded default user + temp groups from config).
 *
 * Returns plain rows. Callers that need the members of a group can call
 * `listMemberUsernames(uid)` explicitly.
 */
export class GroupStore extends PuterStore {
    /**
     * Random per-process cache namespace so restart-staleness can't cross
     * processes. Populated in `onServerStart`.
     */
    private redisNamespace: string = '';

    override onServerStart(): void {
        this.redisNamespace = uuidv4();
    }

    // ── Reads ────────────────────────────────────────────────────────

    async getByUid(uid: string): Promise<GroupRow | null> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `group` WHERE `uid` = ? LIMIT 1',
            [uid],
        );
        return rows[0] ? this.#decodeGroup(rows[0]) : null;
    }

    async listGroupsWithOwner(ownerUserId: number): Promise<GroupRow[]> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `group` WHERE `owner_user_id` = ?',
            [ownerUserId],
        );
        return rows.map((r) => this.#decodeGroup(r));
    }

    async listGroupsWithMember(userId: number): Promise<GroupRow[]> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `group` WHERE `id` IN (' +
                'SELECT `group_id` FROM `jct_user_group` WHERE `user_id` = ?)',
            [userId],
        );
        return rows.map((r) => this.#decodeGroup(r));
    }

    /**
     * Lists the two default public groups (user + temp). Redis-cached for
     * 60s per-process. Falls back to DB on cache miss or decode failure.
     */
    async listPublicGroups(): Promise<GroupRow[]> {
        const userGroupUid = this.config.default_user_group;
        const tempGroupUid = this.config.default_temp_group;
        const publicUids = [userGroupUid, tempGroupUid].filter(
            (v): v is string => typeof v === 'string' && v.length > 0,
        );
        if (publicUids.length === 0) return [];

        const cacheKey = this.#publicGroupsCacheKey();
        try {
            const cached = await this.clients.redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached) as GroupRow[];
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // fall through to DB read
        }

        const placeholders = publicUids.map(() => '?').join(', ');
        const rows = await this.clients.db.read(
            `SELECT * FROM \`group\` WHERE \`uid\` IN (${placeholders})`,
            publicUids,
        );
        const decoded = rows.map((r) => this.#decodeGroup(r));

        try {
            await this.clients.redis.set(
                cacheKey,
                JSON.stringify(decoded),
                'EX',
                PUBLIC_GROUPS_CACHE_TTL_SECONDS,
            );
        } catch {
            // cache writes are best-effort
        }
        return decoded;
    }

    /** Usernames of the group's members. */
    async listMemberUsernames(uid: string): Promise<string[]> {
        const rows = await this.clients.db.read(
            'SELECT u.username FROM `user` u ' +
                'JOIN (SELECT user_id FROM `jct_user_group` WHERE group_id = ' +
                '(SELECT id FROM `group` WHERE uid = ?)) ug ' +
                'ON u.id = ug.user_id',
            [uid],
        );
        return rows.map((r) => String(r.username));
    }

    // ── Writes ───────────────────────────────────────────────────────

    /**
     * Creates a new group owned by `ownerUserId`. Enforces a 20/hour per-owner
     * rate limit (throws `Error('too_many_requests')` if exceeded).
     */
    async create({
        ownerUserId,
        extra = {},
        metadata = {},
    }: {
        ownerUserId: number;
        extra?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }): Promise<string> {
        const windowClause = this.clients.db.case<string>({
            sqlite: "datetime('now', '-1 hour')",
            otherwise: 'NOW() - INTERVAL 1 HOUR',
        });
        const [countRow] = await this.clients.db.read(
            `SELECT COUNT(*) AS n_groups FROM \`group\` WHERE \`owner_user_id\` = ? AND \`created_at\` >= ${windowClause}`,
            [ownerUserId],
        );
        if (Number(countRow?.n_groups ?? 0) >= CREATE_RATE_LIMIT_PER_HOUR) {
            throw new HttpError(
                429,
                'Too many groups created in the last hour',
                {
                    legacyCode: 'too_many_requests',
                },
            );
        }

        const uid = uuidv4();
        await this.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) VALUES (?, ?, ?, ?)',
            [uid, ownerUserId, JSON.stringify(extra), JSON.stringify(metadata)],
        );
        return uid;
    }

    /** Adds users (by username) to the group identified by `uid`. No-op if `usernames` is empty. */
    async addUsers(uid: string, usernames: string[]): Promise<void> {
        if (usernames.length === 0) return;
        const placeholders = `(${usernames.map(() => '?').join(', ')})`;
        await this.clients.db.write(
            'INSERT INTO `jct_user_group` (`user_id`, `group_id`) ' +
                'SELECT u.id, g.id FROM `user` u ' +
                'JOIN (SELECT id FROM `group` WHERE uid = ?) g ON 1 = 1 ' +
                `WHERE u.username IN ${placeholders}`,
            [uid, ...usernames],
        );
    }

    /** Removes users (by username) from the group identified by `uid`. No-op if `usernames` is empty. */
    async removeUsers(uid: string, usernames: string[]): Promise<void> {
        if (usernames.length === 0) return;
        const placeholders = `(${usernames.map(() => '?').join(', ')})`;
        await this.clients.db.write(
            'DELETE FROM `jct_user_group` ' +
                'WHERE `group_id` = (SELECT id FROM `group` WHERE uid = ?) ' +
                'AND `user_id` IN (' +
                'SELECT u.id FROM `user` u ' +
                `WHERE u.username IN ${placeholders})`,
            [uid, ...usernames],
        );
    }

    // ── Internals ────────────────────────────────────────────────────

    #publicGroupsCacheKey(): string {
        return `${this.redisNamespace}:group:public-groups`;
    }

    #decodeGroup(row: Record<string, unknown>): GroupRow {
        const parse = (v: unknown): Record<string, unknown> => {
            if (v == null) return {};
            if (typeof v === 'object') return v as Record<string, unknown>;
            try {
                return JSON.parse(String(v));
            } catch {
                return {};
            }
        };
        const extra = this.clients.db.case<() => Record<string, unknown>>({
            mysql: () => (row.extra as Record<string, unknown>) ?? {},
            otherwise: () => parse(row.extra),
        })();
        const metadata = this.clients.db.case<() => Record<string, unknown>>({
            mysql: () => (row.metadata as Record<string, unknown>) ?? {},
            otherwise: () => parse(row.metadata),
        })();
        return { ...row, extra, metadata } as unknown as GroupRow;
    }
}
