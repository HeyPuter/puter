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

import {
    KV_SHARE_ACCESS_LEVELS,
    kvShareRoot,
    mintKvHandleId,
    type KvShareAccess,
} from '../../services/kvShare/kvShares.js';
import { BoundedTtlMap } from '../../util/boundedTtlMap.js';
import {
    keysetPage,
    openIdCursor,
    type PageResult,
} from '../../util/pagination.js';
import { PuterStore } from '../types.js';
import { assertColumnWidths, KV_SHARE_HANDLE_WIDTHS } from './columnWidths.js';

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

/** Who retired a handle: its owner, its holder, or the platform. */
export type KvShareRevokedBy = 'owner' | 'holder' | 'system';

const REVOKED_BY: readonly KvShareRevokedBy[] = ['owner', 'holder', 'system'];

export interface KvShareHandle {
    handle: string;
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    /** The granted root, ending on the key delimiter. */
    keyPrefix: string;
    /** The user-to-user grant this handle mirrors; its root is the level. */
    permission: string;
    /** Owner-set text the holder is shown, or `null`. */
    label: string | null;
    createdAt: number;
    revokedAt: number | null;
    /** `null` while live, and on rows retired before this was recorded. */
    revokedBy: KvShareRevokedBy | null;
}

/** A live handle as the hot path needs it: the row and its owner's state. */
export interface LiveKvShareHandle {
    row: Omit<KvShareHandle, 'label'>;
    ownerUuid: string;
    ownerSuspended: boolean;
}

/**
 * A handle as its holder may know it. Selected without the owner, the prefix or
 * the grant string, so none of them can reach a holder-facing response.
 */
export interface HeldKvShareHandle {
    handle: string;
    appUid: string;
    access: KvShareAccess;
    label: string | null;
    createdAt: number;
}

/** What a level or label change writes; an absent field is left alone. */
export interface KvShareHandleUpdate {
    permission?: string;
    label?: string | null;
}

export interface KvShareHandleListOptions {
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
    /** Narrow to one namespace — what an app acting for the owner may see. */
    appUid?: string | null;
}

export interface MintKvShareHandleInput {
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    keyPrefix: string;
    permission: string;
    label?: string | null;
}

export interface FindLiveKvShareHandleInput {
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    keyPrefix: string;
}

/** Handle cache bounds: live rows, and recently missed names. */
const LIVE_CACHE_TTL_MS = 60_000;
const MISS_CACHE_TTL_MS = 5_000;
const LIVE_CACHE_MAX_ENTRIES = 10_000;

/** Rows one app-deletion retire pass takes. */
export const KV_HANDLE_RETIRE_BATCH = 500;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const toRevokedBy = (value: unknown): KvShareRevokedBy | null =>
    REVOKED_BY.includes(value as KvShareRevokedBy)
        ? (value as KvShareRevokedBy)
        : null;

const toRow = (row: Record<string, unknown>): KvShareHandle => ({
    handle: String(row.handle),
    ownerUserId: Number(row.owner_user_id),
    granteeUserId: Number(row.grantee_user_id),
    appUid: String(row.app_uid),
    keyPrefix: String(row.key_prefix),
    permission: String(row.permission),
    label:
        row.label === null || row.label === undefined
            ? null
            : String(row.label),
    createdAt: Number(row.created_at) || 0,
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    revokedBy: toRevokedBy(row.revoked_by),
});

const SELECT_COLUMNS =
    '`handle`, `owner_user_id`, `grantee_user_id`, `app_uid`, ' +
    '`key_prefix`, `permission`, `label`, `created_at`, `revoked_at`, ' +
    '`revoked_by`';

/**
 * The level as SQL reads it off the grant's root, so the holder listing can
 * report it without selecting the grant string itself.
 */
const ACCESS_COLUMN =
    `CASE WHEN \`permission\` LIKE '${kvShareRoot('write')}:%' THEN 'write' ` +
    `WHEN \`permission\` LIKE '${kvShareRoot('read')}:%' THEN 'read' ` +
    "ELSE 'watch' END AS `access`";

const toAccess = (value: unknown): KvShareAccess =>
    KV_SHARE_ACCESS_LEVELS.includes(value as KvShareAccess)
        ? (value as KvShareAccess)
        : 'watch';

const clampLimit = (limit: number | undefined): number =>
    Math.min(
        Math.max(1, Math.floor(limit ?? KV_HANDLE_LIST_DEFAULT_LIMIT)),
        KV_HANDLE_LIST_LIMIT_CAP,
    );

export class KvShareHandleStore extends PuterStore {
    readonly #live = new BoundedTtlMap<string, LiveKvShareHandle>({
        maxEntries: LIVE_CACHE_MAX_ENTRIES,
        ttlMs: LIVE_CACHE_TTL_MS,
    });
    readonly #missing = new BoundedTtlMap<string, true>({
        maxEntries: LIVE_CACHE_MAX_ENTRIES,
        ttlMs: MISS_CACHE_TTL_MS,
    });

    async mint(input: MintKvShareHandleInput): Promise<KvShareHandle> {
        const row: KvShareHandle = {
            handle: mintKvHandleId(),
            ownerUserId: input.ownerUserId,
            granteeUserId: input.granteeUserId,
            appUid: input.appUid,
            keyPrefix: input.keyPrefix,
            permission: input.permission,
            label: input.label ?? null,
            createdAt: nowSeconds(),
            revokedAt: null,
            revokedBy: null,
        };
        assertColumnWidths(KV_SHARE_HANDLE_WIDTHS, {
            handle: row.handle,
            appUid: row.appUid,
            keyPrefix: row.keyPrefix,
            permission: row.permission,
        });

        await this.clients.db.insert(TABLE, {
            handle: row.handle,
            owner_user_id: row.ownerUserId,
            grantee_user_id: row.granteeUserId,
            app_uid: row.appUid,
            key_prefix: row.keyPrefix,
            permission: row.permission,
            label: row.label,
            created_at: row.createdAt,
            revoked_at: null,
        });
        this.#forget(row.handle);
        return row;
    }

    /**
     * A live handle and its owner's state, cached in-process (hits up to 60 s,
     * misses 5 s). Authority is the grant, checked on every call, so a stale
     * row only keeps an address alive a little longer, never widens it.
     */
    async getLive(handle: string): Promise<LiveKvShareHandle | null> {
        const cached = this.#live.get(handle);
        if (cached) return cached;
        if (this.#missing.has(handle)) return null;

        const query =
            'SELECT h.`handle`, h.`owner_user_id`, h.`grantee_user_id`, ' +
            'h.`app_uid`, h.`key_prefix`, h.`permission`, h.`created_at`, ' +
            'h.`revoked_at`, h.`revoked_by`, ' +
            'u.`uuid` AS `owner_uuid`, u.`suspended` AS `owner_suspended` ' +
            `FROM \`${TABLE}\` h JOIN \`user\` u ON u.\`id\` = h.\`owner_user_id\` ` +
            'WHERE h.`handle` = ?';
        let rows = await this.clients.db.read(query, [handle]);
        if (rows.length === 0)
            rows = await this.clients.db.pread(query, [handle]);

        const found = rows[0];
        if (!found || found.revoked_at !== null || !found.owner_uuid) {
            this.#missing.set(handle, true);
            return null;
        }
        const { label: _label, ...row } = toRow({ ...found, label: null });
        const live: LiveKvShareHandle = {
            row,
            ownerUuid: String(found.owner_uuid),
            ownerSuspended: Boolean(Number(found.owner_suspended ?? 0)),
        };
        this.#live.set(handle, live);
        return live;
    }

    /** Drops this node's cached copy; other nodes converge within the TTL. */
    #forget(handle: string): void {
        this.#live.delete(handle);
        this.#missing.delete(handle);
    }

    /**
     * Live handles this owner is holding out — in total, and in the namespace a
     * mint is naming. Both ceilings read off one count, over the owner index.
     */
    async countLiveForOwner(
        ownerUserId: number,
        appUid: string | null = null,
    ): Promise<{ total: number; forApp: number }> {
        const [row] = await this.clients.db.pread(
            'SELECT COUNT(*) AS `total`, ' +
                'SUM(CASE WHEN `app_uid` = ? THEN 1 ELSE 0 END) AS `for_app` ' +
                `FROM \`${TABLE}\` ` +
                'WHERE `owner_user_id` = ? AND `revoked_at` IS NULL',
            [appUid, ownerUserId],
        );
        return {
            total: Number(row?.total ?? 0),
            forApp: Number(row?.for_app ?? 0),
        };
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
        // Byte-exact, so `Notes:` and `notes:` are two regions everywhere. The
        // collation goes on the utf8mb4 column, so the connection's charset
        // doesn't matter.
        const exactPrefix = this.clients.db.case({
            mysql: '`key_prefix` COLLATE utf8mb4_bin = ?',
            otherwise: '`key_prefix` = ?',
        });
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` WHERE ` +
                '`owner_user_id` = ? AND `grantee_user_id` = ? AND ' +
                `\`app_uid\` = ? AND ${exactPrefix} AND \`revoked_at\` IS NULL ` +
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
     * Whether a live handle for the same owner, grantee and app has a prefix
     * equal to this one ignoring case but not byte-equal: a grant on it would
     * collide with this one's where the database compares case-insensitively.
     */
    async hasLiveCaseVariant(
        input: FindLiveKvShareHandleInput,
    ): Promise<boolean> {
        const rows = await this.clients.db.pread(
            `SELECT \`key_prefix\` FROM \`${TABLE}\` WHERE ` +
                '`owner_user_id` = ? AND `grantee_user_id` = ? AND ' +
                '`app_uid` = ? AND LOWER(`key_prefix`) = LOWER(?) AND ' +
                // At most one live row is byte-exact, so two find a variant.
                '`revoked_at` IS NULL LIMIT 2',
            [
                input.ownerUserId,
                input.granteeUserId,
                input.appUid,
                input.keyPrefix,
            ],
        );
        return rows.some((row) => String(row.key_prefix) !== input.keyPrefix);
    }

    /**
     * Every live handle this owner holds out to one grantee, across every
     * region — what a revoke or an unshare walks to find the narrower handles
     * that go with a wider one. Bounded by the per-account handle cap.
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
     * Idempotent: an already-retired handle keeps the timestamp it has, so a
     * retry after a failed step is safe.
     */
    async retire(
        handle: string,
        ownerUserId: number,
        revokedBy: 'owner' | 'system' = 'owner',
    ): Promise<KvShareHandle | null> {
        await this.retireMany([handle], revokedBy, { ownerUserId });
        const row = await this.getByHandle(handle);
        return row?.ownerUserId === ownerUserId ? row : null;
    }

    /** {@link retire}, scoped to the holder instead, recorded as theirs. */
    async retireAsHolder(
        handle: string,
        granteeUserId: number,
    ): Promise<KvShareHandle | null> {
        await this.retireMany([handle], 'holder', { granteeUserId });
        const row = await this.getByHandle(handle);
        return row?.granteeUserId === granteeUserId ? row : null;
    }

    /**
     * Retire several handles in one statement, optionally scoped to their owner
     * or holder. A compare-and-set on `revoked_at IS NULL`, so a handle already
     * retired keeps its timestamp and who retired it.
     */
    async retireMany(
        handles: readonly string[],
        revokedBy: KvShareRevokedBy,
        scope: { ownerUserId?: number; granteeUserId?: number } = {},
    ): Promise<void> {
        const unique = [...new Set(handles)];
        if (unique.length === 0) return;
        const where = [
            `\`handle\` IN (${unique.map(() => '?').join(', ')})`,
            '`revoked_at` IS NULL',
        ];
        const params: unknown[] = [nowSeconds(), revokedBy, ...unique];
        if (scope.ownerUserId !== undefined) {
            where.push('`owner_user_id` = ?');
            params.push(scope.ownerUserId);
        }
        if (scope.granteeUserId !== undefined) {
            where.push('`grantee_user_id` = ?');
            params.push(scope.granteeUserId);
        }
        await this.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`revoked_at\` = ?, \`revoked_by\` = ? ` +
                `WHERE ${where.join(' AND ')}`,
            params,
        );
        for (const handle of unique) this.#forget(handle);
    }

    /**
     * One batch of live handles in these apps' namespaces, oldest first. A
     * deleted app's handles are retired off this; the caller repeats until a
     * batch comes back short.
     */
    async listLiveForApps(
        appUids: readonly string[],
        limit = KV_HANDLE_RETIRE_BATCH,
    ): Promise<KvShareHandle[]> {
        const unique = [...new Set(appUids)];
        if (unique.length === 0) return [];
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE \`app_uid\` IN (${unique.map(() => '?').join(', ')}) ` +
                'AND `revoked_at` IS NULL ORDER BY `id` LIMIT ?',
            [...unique, limit],
        );
        return rows.map(toRow);
    }

    /**
     * Change a live handle's level or label in place, scoped to its owner. A
     * compare-and-set on `revoked_at IS NULL`, so a handle retired meanwhile
     * stays retired; returns the row as it now stands, or `null` for none.
     */
    async update(
        handle: string,
        ownerUserId: number,
        changes: KvShareHandleUpdate,
    ): Promise<KvShareHandle | null> {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (changes.permission !== undefined) {
            assertColumnWidths(KV_SHARE_HANDLE_WIDTHS, {
                permission: changes.permission,
            });
            sets.push('`permission` = ?');
            params.push(changes.permission);
        }
        if (changes.label !== undefined) {
            sets.push('`label` = ?');
            params.push(changes.label);
        }
        if (sets.length > 0) {
            await this.clients.db.write(
                `UPDATE \`${TABLE}\` SET ${sets.join(', ')} ` +
                    'WHERE `handle` = ? AND `owner_user_id` = ? ' +
                    'AND `revoked_at` IS NULL',
                [...params, handle, ownerUserId],
            );
        }
        this.#forget(handle);
        const row = await this.getByHandle(handle);
        return row && row.ownerUserId === ownerUserId ? row : null;
    }

    /**
     * Live handles held by one user, newest grants last, keyset-paginated on
     * the grantee index. Selected without the owner, prefix or grant string:
     * this is the holder's listing, and none of those are theirs to see.
     */
    async listLiveForGrantee(
        granteeUserId: number,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<HeldKvShareHandle>> {
        const limit = clampLimit(options.limit);
        const after = openIdCursor(options.cursor, this.config.jwt_secret_v2);

        const filter = ['`grantee_user_id` = ?', '`revoked_at` IS NULL'];
        const filterParams: unknown[] = [granteeUserId];
        if (options.appUid !== undefined && options.appUid !== null) {
            filter.push('`app_uid` = ?');
            filterParams.push(options.appUid);
        }
        const where = [...filter];
        const params = [...filterParams];
        if (after !== null) {
            where.push('`id` > ?');
            params.push(after);
        }

        const rows = await this.clients.db.read(
            'SELECT `id`, `handle`, `app_uid`, `label`, `created_at`, ' +
                `${ACCESS_COLUMN} FROM \`${TABLE}\` ` +
                `WHERE ${where.join(' AND ')} ORDER BY \`id\` LIMIT ?`,
            [...params, limit + 1],
        );
        const page = keysetPage(rows, limit, this.config.jwt_secret_v2);
        const result: PageResult<HeldKvShareHandle> = {
            items: page.rows.map((row) => ({
                handle: String(row.handle),
                appUid: String(row.app_uid),
                access: toAccess(row.access),
                label:
                    row.label === null || row.label === undefined
                        ? null
                        : String(row.label),
                createdAt: Number(row.created_at) || 0,
            })),
        };
        if (page.cursor) result.cursor = page.cursor;

        if (options.includeTotal) {
            const [count] = await this.clients.db.read(
                `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                    `WHERE ${filter.join(' AND ')}`,
                filterParams,
            );
            result.total = Number(count?.total ?? 0);
        }
        return result;
    }

    /**
     * What one owner has minted, revoked handles included — they are the record
     * of what was shared and when it stopped. Keyset-paginated on `id`.
     */
    async listForOwner(
        ownerUserId: number,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<KvShareHandle>> {
        const limit = clampLimit(options.limit);
        const after = openIdCursor(options.cursor, this.config.jwt_secret_v2);

        const filter = ['`owner_user_id` = ?'];
        const filterParams: unknown[] = [ownerUserId];
        if (options.appUid !== undefined && options.appUid !== null) {
            filter.push('`app_uid` = ?');
            filterParams.push(options.appUid);
        }

        const where = [...filter];
        const params = [...filterParams];
        if (after !== null) {
            where.push('`id` > ?');
            params.push(after);
        }

        const rows = await this.clients.db.read(
            `SELECT \`id\`, ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE ${where.join(' AND ')} ORDER BY \`id\` LIMIT ?`,
            [...params, limit + 1],
        );

        const page = keysetPage(rows, limit, this.config.jwt_secret_v2);
        const result: PageResult<KvShareHandle> = {
            items: page.rows.map(toRow),
        };
        if (page.cursor) result.cursor = page.cursor;

        if (options.includeTotal) {
            const [count] = await this.clients.db.read(
                `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                    `WHERE ${filter.join(' AND ')}`,
                filterParams,
            );
            result.total = Number(count?.total ?? 0);
        }
        return result;
    }
}
