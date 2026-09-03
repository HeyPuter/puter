/*
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
import {
    encodeCursor,
    decodeCursor,
    normalizeLimit,
    type PageResult,
} from '../../util/pagination.js';
import { PuterStore } from '../types';

/** A workspace: a `group` row with `kind = 'team'`. */
export interface TeamRow {
    id: number;
    uid: string;
    owner_user_id: number;
    kind: string;
    name: string | null;
    handle: string | null;
    deleted_at: string | null;
    created_at: string;
}

export const TEAM_KIND = 'team';

/** A membership row, joined to the member's username. */
/** A seat, joined to the workspace that pays for it. */
export interface OrgSeatRow {
    id: number;
    user_id: number;
    uuid: string;
    username: string;
    team_uid: string;
    owner_user_id: number;
}

export interface TeamMemberRow {
    id: number;
    user_id: number;
    group_id: number;
    username: string;
    org_owned: number;
    created_at: string;
}

/** One entry in the insert-only record of what a workspace did to an account. */
export interface TeamAuditRow {
    id: number;
    user_id_keep: number;
    actor_user_id: number | null;
    action: string;
    reason: string | null;
    created_at: string;
}

/** Default and ceiling for `listMembers`, matching the other paginated stores. */
export const MEMBER_PAGE_SIZE = 50;
export const MEMBER_PAGE_CAP = 200;
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_PAGE_CAP = 200;

/** Longest handle mysql can store — `varchar(64)` in mysql_mig_26. */
export const HANDLE_MAX_LENGTH = 64;
export const HANDLE_MIN_LENGTH = 3;

/** Mysql declares `name varchar(255)`; sqlite and postgres use TEXT. */
export const NAME_MAX_LENGTH = 255;

/** Narrower than the column, so the engines' collations cannot disagree. */
const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A handle reaching users in email makes an impersonation more convincing. */
const RESERVED_HANDLES = new Set([
    'about',
    'account',
    'admin',
    'administrator',
    'api',
    'app',
    'apps',
    'billing',
    'blog',
    'ceo',
    'contact',
    'dashboard',
    'dev',
    'developer',
    'docs',
    'help',
    'internal',
    'legal',
    'login',
    'mail',
    'moderator',
    'official',
    'owner',
    'payment',
    'payments',
    'puter',
    'puter-support',
    'puterteam',
    'root',
    'security',
    'settings',
    'signup',
    'staff',
    'status',
    'support',
    'system',
    'team',
    'teams',
    'trust',
    'trust-safety',
    'verify',
    'workspace',
    'workspaces',
]);

export type HandleRejection =
    'too_short' | 'too_long' | 'malformed' | 'reserved';

/** Trimmed and capped, so the same name is accepted on every engine. */
export const normalizeTeamName = (name: string): string => {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('team name is required');
    if (trimmed.length > NAME_MAX_LENGTH)
        throw new Error('team name is too long');
    return trimmed;
};

/** Why `handle` is unusable, or null when it is fine. */
export const checkHandle = (handle: string): HandleRejection | null => {
    if (handle.length < HANDLE_MIN_LENGTH) return 'too_short';
    if (handle.length > HANDLE_MAX_LENGTH) return 'too_long';
    if (!HANDLE_PATTERN.test(handle)) return 'malformed';
    if (RESERVED_HANDLES.has(handle)) return 'reserved';
    return null;
};

export class TeamStore extends PuterStore {
    /** Postgres indexes lower(handle); the others are already insensitive. */
    #handleMatch(): string {
        return this.clients.db.case({
            postgres: 'lower(`handle`) = lower(?)',
            otherwise: '`handle` = ?',
        });
    }

    /** Makes the seeded `kind IS NULL` groups unreachable, not merely absent. */
    #live(): string {
        return '`kind` = ? AND `deleted_at` IS NULL';
    }

    // -- Reads --------------------------------------------------------

    /** The workspace with this uid, or null. Soft-deleted ones are excluded. */
    async getByUid(uid: string): Promise<TeamRow | null> {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`group\` WHERE \`uid\` = ? AND ${this.#live()}`,
            [uid, TEAM_KIND],
        );
        return (rows[0] as unknown as TeamRow) ?? null;
    }

    /** Includes soft-deleted rows, so an audit survives its workspace. */
    async getByUidIncludingDeleted(uid: string): Promise<TeamRow | null> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `group` WHERE `uid` = ? AND `kind` = ?',
            [uid, TEAM_KIND],
        );
        return (rows[0] as unknown as TeamRow) ?? null;
    }

    /** For availability checks and console resolution; callers address by uid. */
    async getByHandle(handle: string): Promise<TeamRow | null> {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`group\` WHERE ${this.#handleMatch()} AND ${this.#live()}`,
            [handle, TEAM_KIND],
        );
        return (rows[0] as unknown as TeamRow) ?? null;
    }

    /** Whether the handle is free to claim. Does not validate its spelling. */
    async isHandleAvailable(handle: string): Promise<boolean> {
        return (await this.getByHandle(handle)) === null;
    }

    /** Workspaces this user owns, oldest first. */
    async listByOwner(ownerUserId: number): Promise<TeamRow[]> {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`group\` WHERE \`owner_user_id\` = ? AND ${this.#live()} ORDER BY \`id\``,
            [ownerUserId, TEAM_KIND],
        );
        return rows as unknown as TeamRow[];
    }

    // -- Writes -------------------------------------------------------

    /** Throws on an unusable or taken handle; the unique index is the arbiter. */
    async create(input: {
        ownerUserId: number;
        name: string;
        handle?: string | null;
    }): Promise<TeamRow> {
        const name = normalizeTeamName(input.name);
        const handle = input.handle ?? null;
        if (handle !== null) {
            const rejection = checkHandle(handle);
            if (rejection) {
                throw new Error(`unusable team handle: ${rejection}`);
            }
        }

        const uid = uuidv4();
        await this.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `kind`, `name`, `handle`, `extra`, `metadata`) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [uid, input.ownerUserId, TEAM_KIND, name, handle, '{}', '{}'],
        );

        const created = await this.getByUid(uid);
        if (!created)
            throw new Error('team disappeared immediately after insert');
        return created;
    }

    /** Null when no live workspace has that uid. `handle: null` releases it. */
    async update(
        uid: string,
        changes: { name?: string; handle?: string | null },
    ): Promise<TeamRow | null> {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (changes.name !== undefined) {
            sets.push('`name` = ?');
            params.push(normalizeTeamName(changes.name));
        }
        if (changes.handle !== undefined) {
            if (changes.handle !== null) {
                const rejection = checkHandle(changes.handle);
                if (rejection) {
                    throw new Error(`unusable team handle: ${rejection}`);
                }
            }
            sets.push('`handle` = ?');
            params.push(changes.handle);
        }
        if (sets.length === 0) return this.getByUid(uid);

        await this.clients.db.write(
            `UPDATE \`group\` SET ${sets.join(', ')} WHERE \`uid\` = ? AND ${this.#live()}`,
            [...params, uid, TEAM_KIND],
        );
        return this.getByUid(uid);
    }

    /** Releases the handle, since nothing addresses by it; keeps `name`. */
    async softDelete(uid: string): Promise<boolean> {
        const result = await this.clients.db.write(
            `UPDATE \`group\` SET \`deleted_at\` = CURRENT_TIMESTAMP, \`handle\` = NULL ` +
                `WHERE \`uid\` = ? AND ${this.#live()}`,
            [uid, TEAM_KIND],
        );
        return result.anyRowsAffected;
    }

    // -- Membership ---- sole writer of team rows -----------------------

    /** The membership row for this user in this workspace, or null. */
    async getMembership(
        teamUid: string,
        userId: number,
    ): Promise<TeamMemberRow | null> {
        const rows = await this.clients.db.read(
            'SELECT ug.`id`, ug.`user_id`, ug.`group_id`, ug.`org_owned`, ' +
                'ug.`created_at`, u.`username` FROM `jct_user_group` ug ' +
                'JOIN `user` u ON u.`id` = ug.`user_id` ' +
                'JOIN `group` g ON g.`id` = ug.`group_id` ' +
                `WHERE g.\`uid\` = ? AND ug.\`user_id\` = ? AND g.${this.#live()}`,
            [teamUid, userId, TEAM_KIND],
        );
        return (rows[0] as unknown as TeamMemberRow) ?? null;
    }

    /** Whether this user belongs to this workspace. */
    async isMember(teamUid: string, userId: number): Promise<boolean> {
        return (await this.getMembership(teamUid, userId)) !== null;
    }

    /** A workspace's members, keyset-paginated on `id` per doc/pagination.md. */
    async listMembers(
        teamUid: string,
        opts: { limit?: unknown; cursor?: string } = {},
    ): Promise<PageResult<TeamMemberRow>> {
        const limit =
            normalizeLimit(opts.limit, { cap: MEMBER_PAGE_CAP }) ??
            MEMBER_PAGE_SIZE;
        const page = decodeCursor(opts.cursor, 'team member cursor');
        const after = typeof page?.id === 'number' ? page.id : null;

        // One row past the limit is how we know a further page exists.
        const rows = (await this.clients.db.read(
            'SELECT ug.`id`, ug.`user_id`, ug.`group_id`, ug.`org_owned`, ' +
                'ug.`created_at`, u.`username` FROM `jct_user_group` ug ' +
                'JOIN `user` u ON u.`id` = ug.`user_id` ' +
                'JOIN `group` g ON g.`id` = ug.`group_id` ' +
                `WHERE g.\`uid\` = ? AND g.${this.#live()}` +
                (after === null ? '' : ' AND ug.`id` > ?') +
                ' ORDER BY ug.`id` LIMIT ?',
            after === null
                ? [teamUid, TEAM_KIND, limit + 1]
                : [teamUid, TEAM_KIND, after, limit + 1],
        )) as unknown as TeamMemberRow[];

        const items = rows.slice(0, limit);
        const cursor =
            rows.length > limit
                ? encodeCursor({ id: items[items.length - 1].id })
                : undefined;
        return { items, cursor };
    }

    /** Workspaces this user belongs to, oldest first. */
    async listTeamsForUser(userId: number): Promise<TeamRow[]> {
        const rows = await this.clients.db.read(
            'SELECT g.* FROM `group` g ' +
                'JOIN `jct_user_group` ug ON ug.`group_id` = g.`id` ' +
                `WHERE ug.\`user_id\` = ? AND g.${this.#live()} ORDER BY g.\`id\``,
            [userId, TEAM_KIND],
        );
        return rows as unknown as TeamRow[];
    }

    /** `orgOwned` decides who pays: 1 workspace-created, 0 the workspace owner. */
    async addMember(
        teamUid: string,
        userId: number,
        opts: { orgOwned: boolean },
    ): Promise<boolean> {
        // Kind-filtered subquery, so a non-team uid inserts nothing.
        const result = await this.clients.db.write(
            `${this.clients.db.insertIgnoreInto('jct_user_group')} ` +
                '(`user_id`, `group_id`, `org_owned`) ' +
                'SELECT ?, g.`id`, ? FROM `group` g ' +
                `WHERE g.\`uid\` = ? AND g.${this.#live()}` +
                this.clients.db.insertIgnoreSuffix(),
            // Not `booleanValue`: it yields a real boolean on postgres.
            [userId, opts.orgOwned ? 1 : 0, teamUid, TEAM_KIND],
        );
        return result.anyRowsAffected;
    }

    /** How many members pay for themselves; the owner should be the only one. */
    async countPayers(teamId: number): Promise<number> {
        const rows = (await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `jct_user_group` ' +
                'WHERE `group_id` = ? AND `org_owned` = 0',
            [teamId],
        )) as { n: number }[];
        return Number(rows[0]?.n ?? 0);
    }

    // -- Audit ---- insert-only; no update or delete path exists --------

    /** Records something the workspace did to an account. */
    async appendAudit(entry: {
        teamId: number;
        userId: number;
        actorUserId: number;
        action: string;
        reason?: string | null;
    }): Promise<void> {
        await this.clients.db.write(
            'INSERT INTO `audit_team_membership` ' +
                '(`group_id`, `group_id_keep`, `user_id`, `user_id_keep`, ' +
                '`actor_user_id`, `action`, `reason`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                entry.teamId,
                entry.teamId,
                entry.userId,
                entry.userId,
                entry.actorUserId,
                entry.action,
                entry.reason ?? null,
            ],
        );
    }

    /** The whole workspace's audit, newest first, keyset-paginated on `id`. */
    async listAudit(
        teamId: number,
        opts: { limit?: unknown; cursor?: string } = {},
    ): Promise<PageResult<TeamAuditRow>> {
        return this.#pageAudit('`group_id_keep` = ?', [teamId], opts);
    }

    /** One member's own entries. Scoped by user, not by workspace. */
    async listAuditForUser(
        teamId: number,
        userId: number,
        opts: { limit?: unknown; cursor?: string } = {},
    ): Promise<PageResult<TeamAuditRow>> {
        return this.#pageAudit(
            '`group_id_keep` = ? AND `user_id_keep` = ?',
            [teamId, userId],
            opts,
        );
    }

    /** Descending keyset, so older entries are reachable rather than dropped. */
    async #pageAudit(
        where: string,
        params: unknown[],
        opts: { limit?: unknown; cursor?: string },
    ): Promise<PageResult<TeamAuditRow>> {
        const limit =
            normalizeLimit(opts.limit, { cap: AUDIT_PAGE_CAP }) ??
            AUDIT_PAGE_SIZE;
        const page = decodeCursor(opts.cursor, 'team audit cursor');
        const before = typeof page?.id === 'number' ? page.id : null;

        const rows = (await this.clients.db.read(
            'SELECT `id`, `user_id_keep`, `actor_user_id`, `action`, `reason`, `created_at` ' +
                `FROM \`audit_team_membership\` WHERE ${where}` +
                (before === null ? '' : ' AND `id` < ?') +
                ' ORDER BY `id` DESC LIMIT ?',
            before === null
                ? [...params, limit + 1]
                : [...params, before, limit + 1],
        )) as unknown as TeamAuditRow[];

        const items = rows.slice(0, limit);
        const cursor =
            rows.length > limit
                ? encodeCursor({ id: items[items.length - 1].id })
                : undefined;
        return { items, cursor };
    }

    /** Removes a member, returning whether a row was there to remove. */
    async removeMember(teamUid: string, userId: number): Promise<boolean> {
        const result = await this.clients.db.write(
            'DELETE FROM `jct_user_group` WHERE `user_id` = ? AND `group_id` = ' +
                `(SELECT \`id\` FROM \`group\` WHERE \`uid\` = ? AND ${this.#live()})`,
            [userId, teamUid, TEAM_KIND],
        );
        return result.anyRowsAffected;
    }

    /** The workspace seat this user is, if any. Soft-deleted workspaces count. */
    async getOrgSeat(userId: number): Promise<OrgSeatRow | null> {
        const rows = (await this.clients.db.read(
            'SELECT ug.`id`, ug.`user_id`, u.`uuid`, u.`username`, ' +
                'g.`uid` AS `team_uid`, g.`owner_user_id` ' +
                'FROM `jct_user_group` ug ' +
                'JOIN `user` u ON u.`id` = ug.`user_id` ' +
                'JOIN `group` g ON g.`id` = ug.`group_id` ' +
                'WHERE ug.`user_id` = ? AND ug.`org_owned` = 1 ' +
                'AND g.`kind` = ? ORDER BY g.`id` LIMIT 1',
            [userId, TEAM_KIND],
        )) as unknown as OrgSeatRow[];
        return rows[0] ?? null;
    }
}
