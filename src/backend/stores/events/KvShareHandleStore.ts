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

import { mintKvHandleId } from '../../services/events/kvShares.js';
import {
    decodeCursor,
    encodeCursor,
    type PageResult,
} from '../../util/pagination.js';
import { PuterStore } from '../types.js';

/**
 * Opaque names for shared regions of a user's key-value namespace.
 *
 * A handle is an addressing alias, not an authorization: the user-to-user grant
 * it mirrors is what any check actually reads. What the row adds is a name the
 * grantee can use that says nothing about who the owner is, and a record the
 * owner can audit — which is why revoking marks rather than deletes.
 */

const TABLE = 'kv_share_handles';

export const KV_HANDLE_LIST_DEFAULT_LIMIT = 50;
export const KV_HANDLE_LIST_LIMIT_CAP = 200;

export interface KvShareHandle {
    handle: string;
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    /** The granted root, ending on the key delimiter. */
    keyPrefix: string;
    /** The user-to-user grant this handle mirrors. */
    permission: string;
    createdAt: number;
    revokedAt: number | null;
}

export interface KvShareHandleListOptions {
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}

export interface MintKvShareHandleInput {
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    keyPrefix: string;
    permission: string;
}

export interface FindLiveKvShareHandleInput {
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    keyPrefix: string;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const asNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toRow = (row: Record<string, unknown>): KvShareHandle => ({
    handle: String(row.handle),
    ownerUserId: Number(row.owner_user_id),
    granteeUserId: Number(row.grantee_user_id),
    appUid: String(row.app_uid),
    keyPrefix: String(row.key_prefix),
    permission: String(row.permission),
    createdAt: Number(row.created_at) || 0,
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
});

const SELECT_COLUMNS =
    '`handle`, `owner_user_id`, `grantee_user_id`, `app_uid`, ' +
    '`key_prefix`, `permission`, `created_at`, `revoked_at`';

export class KvShareHandleStore extends PuterStore {
    async mint(input: MintKvShareHandleInput): Promise<KvShareHandle> {
        const row: KvShareHandle = {
            handle: mintKvHandleId(),
            ownerUserId: input.ownerUserId,
            granteeUserId: input.granteeUserId,
            appUid: input.appUid,
            keyPrefix: input.keyPrefix,
            permission: input.permission,
            createdAt: nowSeconds(),
            revokedAt: null,
        };
        await this.clients.db.insert(TABLE, {
            handle: row.handle,
            owner_user_id: row.ownerUserId,
            grantee_user_id: row.granteeUserId,
            app_uid: row.appUid,
            key_prefix: row.keyPrefix,
            permission: row.permission,
            created_at: row.createdAt,
            revoked_at: null,
        });
        return row;
    }

    /** Live handles this owner is holding out, for the per-account ceiling. */
    async countLiveForOwner(ownerUserId: number): Promise<number> {
        const [row] = await this.clients.db.pread(
            `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                'WHERE `owner_user_id` = ? AND `revoked_at` IS NULL',
            [ownerUserId],
        );
        return Number(row?.total ?? 0);
    }

    /**
     * The live handle already minted over this exact region, if one exists —
     * what makes minting the same `(grantee, appUid, keyPrefix)` twice hand
     * back the one capability rather than a second row over the same
     * permission.
     */
    async findLive(
        input: FindLiveKvShareHandleInput,
    ): Promise<KvShareHandle | null> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` WHERE ` +
                '`owner_user_id` = ? AND `grantee_user_id` = ? AND ' +
                '`app_uid` = ? AND `key_prefix` = ? AND `revoked_at` IS NULL ' +
                'LIMIT 1',
            [
                input.ownerUserId,
                input.granteeUserId,
                input.appUid,
                input.keyPrefix,
            ],
        );
        return rows.length > 0 ? toRow(rows[0]) : null;
    }

    /**
     * Every live handle this owner holds out to one grantee, across every
     * region — what a revoke walks to find a narrower handle whose grant just
     * died as a side effect of a wider one being withdrawn.
     */
    async listLiveForOwnerAndGrantee(
        ownerUserId: number,
        granteeUserId: number,
    ): Promise<KvShareHandle[]> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` WHERE ` +
                '`owner_user_id` = ? AND `grantee_user_id` = ? AND `revoked_at` IS NULL',
            [ownerUserId, granteeUserId],
        );
        return rows.map(toRow);
    }

    /**
     * One handle by name. Primary: this is what a subscribe resolves against,
     * and a replica a moment behind would report a handle that was just minted
     * as absent, or a revoked one as live.
     */
    async getByHandle(handle: string): Promise<KvShareHandle | null> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` WHERE \`handle\` = ?`,
            [handle],
        );
        return rows.length > 0 ? toRow(rows[0]) : null;
    }

    /**
     * Retire one handle, scoped to its owner. Returns the row as it now stands,
     * or `null` when this owner has no handle by that name — the one answer an
     * unknown handle and somebody else's both get, so retiring cannot be used
     * to find out that a handle exists.
     *
     * Idempotent: an already-retired handle keeps the timestamp it has. The
     * caller withdraws the grant first and that step can fail, so this one has
     * to be safe to reach twice.
     *
     * The `revoked_at IS NULL` predicate makes the read-then-write a
     * compare-and-set: two callers racing means one stamps the row and the
     * other reports the stamp it found, rather than both writing.
     */
    async retire(
        handle: string,
        ownerUserId: number,
    ): Promise<KvShareHandle | null> {
        const existing = await this.getByHandle(handle);
        if (!existing || existing.ownerUserId !== ownerUserId) return null;
        if (existing.revokedAt !== null) return existing;

        const at = nowSeconds();
        const result = await this.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`revoked_at\` = ? ` +
                'WHERE `handle` = ? AND `owner_user_id` = ? ' +
                'AND `revoked_at` IS NULL',
            [at, handle, ownerUserId],
        );
        if (result?.anyRowsAffected === false)
            return await this.getByHandle(handle);
        return { ...existing, revokedAt: at };
    }

    /**
     * What one owner has minted, revoked handles included — they are the record
     * of what was shared and when it stopped. Keyset-paginated on `id`.
     */
    async listForOwner(
        ownerUserId: number,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<KvShareHandle>> {
        const limit = Math.min(
            Math.max(
                1,
                Math.floor(options.limit ?? KV_HANDLE_LIST_DEFAULT_LIMIT),
            ),
            KV_HANDLE_LIST_LIMIT_CAP,
        );
        const after = asNumber(decodeCursor(options.cursor)?.id);

        const where = ['`owner_user_id` = ?'];
        const params: unknown[] = [ownerUserId];
        if (after !== null) {
            where.push('`id` > ?');
            params.push(after);
        }

        const rows = await this.clients.db.read(
            `SELECT \`id\`, ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE ${where.join(' AND ')} ORDER BY \`id\` LIMIT ?`,
            [...params, limit + 1],
        );

        const page = rows.slice(0, limit);
        const result: PageResult<KvShareHandle> = { items: page.map(toRow) };
        if (rows.length > limit)
            result.cursor = encodeCursor({
                id: Number(page[page.length - 1].id),
            });

        if (options.includeTotal) {
            const [count] = await this.clients.db.read(
                `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                    'WHERE `owner_user_id` = ?',
                [ownerUserId],
            );
            result.total = Number(count?.total ?? 0);
        }
        return result;
    }
}
