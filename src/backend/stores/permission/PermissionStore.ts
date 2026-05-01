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

import { PuterStore } from '../types';
import type { LayerInstances } from '../../types';
import type { puterStores } from '../index';
import { PermissionUtil } from '../../services/permission/permissionUtil';
import {
    PERM_KEY_PREFIX,
    PERMISSION_SCAN_CACHE_TTL_SECONDS,
} from '../../services/permission/consts';
import type { UserRow } from '../user/UserStore';

// Short TTLs: FK CASCADE on user/app delete + PermissionService rewriters
// can touch rows this store's mutators never see.
const U2A_CACHE_TTL_SECONDS = 5 * 60;
const U2U_CACHE_TTL_SECONDS = 5 * 60;
const TOKEN_CACHE_TTL_SECONDS = 10 * 60;

// Re-export for back-compat — PermissionService et al. import `UserRow` from here.
// The canonical definition lives in `UserStore`, which owns the user table.
export type { UserRow };

// ── Types ────────────────────────────────────────────────────────────

export interface FlatPermValue {
    permission?: string;
    issuer_user_id?: number;
    deleted?: boolean;
    [k: string]: unknown;
}

export interface LinkedUserUserPermRow {
    holder_user_id: number;
    issuer_user_id: number;
    permission: string;
    extra: Record<string, unknown>;
    [k: string]: unknown;
}

export interface LinkedUserAppPermRow {
    user_id: number;
    app_id: number;
    permission: string;
    extra: Record<string, unknown>;
    [k: string]: unknown;
}

export interface LinkedUserGroupPermRow {
    user_id: number;
    group_id: number;
    permission: string;
    extra: Record<string, unknown>;
    [k: string]: unknown;
}

export interface AccessTokenPermRow {
    token_uid: string;
    permission: string;
    [k: string]: unknown;
}

export interface AuditEntry {
    action: 'grant' | 'revoke';
    reason: string;
    [k: string]: unknown;
}

/**
 * PermissionStore owns the *persistence* side of permissions:
 * - SQL CRUD + audit inserts for all permission tables
 * - Flat KV reads/writes under `PERM_KEY_PREFIX` (system namespace)
 * - Redis scan-cache get/set/invalidate
 *
 * It does NOT own semantics — rewriters, implicators, exploders, and the
 * `scan()` algorithm all live on PermissionService. This store is just I/O.
 */
export class PermissionStore extends PuterStore {
    declare protected stores: LayerInstances<typeof puterStores>;

    // ── Flat view (KV under system namespace) ────────────────────────

    /**
     * Read the flat user-to-user permissions for a holder across a set of
     * permission strings. Returns the KV values that exist; missing keys are
     * filtered out.
     */
    async getFlatUserPerms(
        holderUserId: number,
        permissions: string[],
    ): Promise<FlatPermValue[]> {
        if (permissions.length === 0) return [];
        const keys = [
            ...new Set(
                permissions.map((p) =>
                    PermissionUtil.join(
                        PERM_KEY_PREFIX,
                        String(holderUserId),
                        p,
                    ),
                ),
            ),
        ];
        const { res } = await this.stores.kv.get({ key: keys });
        const values = Array.isArray(res) ? res : [res];
        return values.filter(
            (v): v is FlatPermValue => v !== null && typeof v === 'object',
        );
    }

    /** Write a single flat user-to-user permission entry to KV. */
    async setFlatUserPerm(
        holderUserId: number,
        permission: string,
        value: FlatPermValue,
    ): Promise<void> {
        const key = PermissionUtil.join(
            PERM_KEY_PREFIX,
            String(holderUserId),
            permission,
        );
        await this.stores.kv.set({ key, value });
    }

    /** Delete a single flat user-to-user permission entry from KV. */
    async delFlatUserPerm(
        holderUserId: number,
        permission: string,
    ): Promise<void> {
        const key = PermissionUtil.join(
            PERM_KEY_PREFIX,
            String(holderUserId),
            permission,
        );
        await this.stores.kv.del({ key });
    }

    // ── SQL: user-to-user permissions ───────────────────────────────

    async readLinkedUserUserPerms(
        holderUserId: number,
        permissions: string[],
    ): Promise<LinkedUserUserPermRow[]> {
        if (permissions.length === 0) return [];
        const all = await this.#readAllUserUserPermsForHolder(holderUserId);
        const wanted = new Set(permissions);
        return all.filter((row) => wanted.has(row.permission));
    }

    async upsertUserUserPerm(
        holderUserId: number,
        issuerUserId: number,
        permission: string,
        extra: Record<string, unknown>,
    ): Promise<void> {
        const upsertClause = this.clients.db.case<string>({
            mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
            otherwise:
                'ON CONFLICT(`holder_user_id`, `issuer_user_id`, `permission`) DO UPDATE SET `extra` = ?',
        });
        await this.clients.db.write(
            'INSERT INTO `user_to_user_permissions` (`holder_user_id`, `issuer_user_id`, `permission`, `extra`) ' +
                `VALUES (?, ?, ?, ?) ${upsertClause}`,
            [
                holderUserId,
                issuerUserId,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ],
        );
        await this.publishCacheKeys({
            keys: [this.#u2uCacheKey(holderUserId)],
        });
    }

    async deleteUserUserPermByHolder(
        holderUserId: number,
        permission: string,
    ): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `user_to_user_permissions` WHERE `holder_user_id` = ? AND `permission` = ?',
            [holderUserId, permission],
        );
        await this.publishCacheKeys({
            keys: [this.#u2uCacheKey(holderUserId)],
        });
    }

    async auditUserUserPerm(
        entry: AuditEntry & {
            holder_user_id: number;
            issuer_user_id: number;
            permission: string;
        },
    ): Promise<void> {
        await this.clients.db.write(
            'INSERT INTO `audit_user_to_user_permissions` (' +
                '`holder_user_id`, `holder_user_id_keep`, `issuer_user_id`, `issuer_user_id_keep`, ' +
                '`permission`, `action`, `reason`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                entry.holder_user_id,
                entry.holder_user_id,
                entry.issuer_user_id,
                entry.issuer_user_id,
                entry.permission,
                entry.action,
                entry.reason,
            ],
        );
    }

    async listUserPermissionIssuerIds(holderUserId: number): Promise<number[]> {
        const rows = await this.clients.db.read(
            'SELECT DISTINCT issuer_user_id FROM `user_to_user_permissions` WHERE `holder_user_id` = ?',
            [holderUserId],
        );
        return rows.map((r) => Number(r.issuer_user_id));
    }

    // ── SQL: user-to-app permissions ────────────────────────────────

    async readUserAppPerms(
        userId: number,
        appId: number,
        permissions: string[],
    ): Promise<LinkedUserAppPermRow[]> {
        if (permissions.length === 0) return [];
        const all = await this.#readAllUserAppPerms(userId, appId);
        const wanted = new Set(permissions);
        return all.filter((row) => wanted.has(row.permission));
    }

    async hasUserAppPerm(
        userId: number,
        appId: number,
        permission: string,
    ): Promise<boolean> {
        const all = await this.#readAllUserAppPerms(userId, appId);
        return all.some((row) => row.permission === permission);
    }

    async upsertUserAppPerm(
        userId: number,
        appId: number,
        permission: string,
        extra: Record<string, unknown>,
    ): Promise<void> {
        const upsertClause = this.clients.db.case<string>({
            mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
            otherwise:
                'ON CONFLICT(`user_id`, `app_id`, `permission`) DO UPDATE SET `extra` = ?',
        });
        await this.clients.db.write(
            'INSERT INTO `user_to_app_permissions` (`user_id`, `app_id`, `permission`, `extra`) ' +
                `VALUES (?, ?, ?, ?) ${upsertClause}`,
            [
                userId,
                appId,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ],
        );
        await this.publishCacheKeys({
            keys: [this.#u2aCacheKey(userId, appId)],
        });
    }

    async deleteUserAppPerm(
        userId: number,
        appId: number,
        permission: string,
    ): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `user_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ? AND `permission` = ?',
            [userId, appId, permission],
        );
        await this.publishCacheKeys({
            keys: [this.#u2aCacheKey(userId, appId)],
        });
    }

    async deleteUserAppAll(userId: number, appId: number): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `user_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ?',
            [userId, appId],
        );
        await this.publishCacheKeys({
            keys: [this.#u2aCacheKey(userId, appId)],
        });
    }

    async auditUserAppPerm(
        entry: AuditEntry & {
            user_id: number;
            app_id: number;
            permission: string;
        },
    ): Promise<void> {
        await this.clients.db.write(
            'INSERT INTO `audit_user_to_app_permissions` (' +
                '`user_id`, `user_id_keep`, `app_id`, `app_id_keep`, ' +
                '`permission`, `action`, `reason`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                entry.user_id,
                entry.user_id,
                entry.app_id,
                entry.app_id,
                entry.permission,
                entry.action,
                entry.reason,
            ],
        );
    }

    // ── SQL: dev-to-app permissions ─────────────────────────────────

    async readDevAppPerms(
        appId: number,
        permissions: string[],
    ): Promise<LinkedUserAppPermRow[]> {
        if (permissions.length === 0) return [];
        let permClause = permissions.map(() => '`permission` = ?').join(' OR ');
        if (permissions.length > 1) permClause = `(${permClause})`;
        const rows = await this.clients.db.read(
            'SELECT * FROM `dev_to_app_permissions` ' +
                `WHERE \`app_id\` = ? AND ${permClause}`,
            [appId, ...permissions],
        );
        return rows.map((row) => this.#decodeExtra<LinkedUserAppPermRow>(row));
    }

    async upsertDevAppPerm(
        userId: number,
        appId: number,
        permission: string,
        extra: Record<string, unknown>,
    ): Promise<void> {
        const upsertClause = this.clients.db.case<string>({
            mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
            otherwise:
                'ON CONFLICT(`user_id`, `app_id`, `permission`) DO UPDATE SET `extra` = ?',
        });
        await this.clients.db.write(
            'INSERT INTO `dev_to_app_permissions` (`user_id`, `app_id`, `permission`, `extra`) ' +
                `VALUES (?, ?, ?, ?) ${upsertClause}`,
            [
                userId,
                appId,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ],
        );
    }

    async deleteDevAppPerm(
        userId: number,
        appId: number,
        permission: string,
    ): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `dev_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ? AND `permission` = ?',
            [userId, appId, permission],
        );
    }

    async deleteDevAppAll(userId: number, appId: number): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `dev_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ?',
            [userId, appId],
        );
    }

    async auditDevAppPerm(
        entry: AuditEntry & {
            user_id: number;
            app_id: number;
            permission: string;
        },
    ): Promise<void> {
        await this.clients.db.write(
            'INSERT INTO `audit_dev_to_app_permissions` (' +
                '`user_id`, `user_id_keep`, `app_id`, `app_id_keep`, ' +
                '`permission`, `action`, `reason`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                entry.user_id,
                entry.user_id,
                entry.app_id,
                entry.app_id,
                entry.permission,
                entry.action,
                entry.reason,
            ],
        );
    }

    // ── SQL: user-to-group permissions ──────────────────────────────

    /**
     * Reads group permissions granted to groups the user is a member of, for
     * a given set of permission strings. Result already joined against
     * `jct_user_group` so callers don't need group membership resolution.
     */
    async readUserGroupPerms(
        userId: number,
        permissions: string[],
    ): Promise<LinkedUserGroupPermRow[]> {
        if (permissions.length === 0) return [];
        let permClause = permissions.map(() => 'p.permission = ?').join(' OR ');
        if (permissions.length > 1) permClause = `(${permClause})`;
        const rows = await this.clients.db.read(
            'SELECT p.permission, p.user_id, p.group_id, p.extra FROM `user_to_group_permissions` p ' +
                'JOIN `jct_user_group` ug ON p.group_id = ug.group_id ' +
                `WHERE ug.user_id = ? AND ${permClause}`,
            [userId, ...permissions],
        );
        return rows.map((row) =>
            this.#decodeExtra<LinkedUserGroupPermRow>(row),
        );
    }

    async upsertUserGroupPerm(
        userId: number,
        groupId: number,
        permission: string,
        extra: Record<string, unknown>,
    ): Promise<void> {
        const upsertClause = this.clients.db.case<string>({
            mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
            otherwise:
                'ON CONFLICT(`user_id`, `group_id`, `permission`) DO UPDATE SET `extra` = ?',
        });
        await this.clients.db.write(
            'INSERT INTO `user_to_group_permissions` (`user_id`, `group_id`, `permission`, `extra`) ' +
                `VALUES (?, ?, ?, ?) ${upsertClause}`,
            [
                userId,
                groupId,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ],
        );
    }

    async deleteUserGroupPerm(
        userId: number,
        groupId: number,
        permission: string,
    ): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `user_to_group_permissions` WHERE `user_id` = ? AND `group_id` = ? AND `permission` = ?',
            [userId, groupId, permission],
        );
    }

    async auditUserGroupPerm(
        entry: AuditEntry & {
            user_id: number;
            group_id: number;
            permission: string;
        },
    ): Promise<void> {
        await this.clients.db.write(
            'INSERT INTO `audit_user_to_group_permissions` (' +
                '`user_id`, `user_id_keep`, `group_id`, `group_id_keep`, ' +
                '`permission`, `action`, `reason`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                entry.user_id,
                entry.user_id,
                entry.group_id,
                entry.group_id,
                entry.permission,
                entry.action,
                entry.reason,
            ],
        );
    }

    // ── SQL: access token permissions ───────────────────────────────

    async hasAccessTokenPerm(
        tokenUid: string,
        permission: string,
    ): Promise<boolean> {
        const all = await this.#readAccessTokenPerms(tokenUid);
        return all.includes(permission);
    }

    /** Call from AuthService after it mutates `access_token_permissions`. */
    async invalidateAccessTokenPerms(tokenUid: string): Promise<void> {
        await this.publishCacheKeys({
            keys: [this.#tokenCacheKey(tokenUid)],
        });
    }

    // ── SQL: issuer-prefix queries (share discovery, etc.) ──────────

    async queryIssuerUserPermsByPrefix(
        issuerUserId: number,
        prefix: string,
    ): Promise<Array<{ holder_user_id: number; permission: string }>> {
        const rows = await this.clients.db.read(
            'SELECT DISTINCT holder_user_id, permission FROM `user_to_user_permissions` ' +
                'WHERE issuer_user_id = ? AND permission LIKE ?',
            [issuerUserId, `${prefix}%`],
        );
        return rows.map((r) => ({
            holder_user_id: Number(r.holder_user_id),
            permission: String(r.permission),
        }));
    }

    async queryIssuerAppPermsByPrefix(
        issuerUserId: number,
        prefix: string,
    ): Promise<Array<{ app_id: number; permission: string }>> {
        const rows = await this.clients.db.read(
            'SELECT DISTINCT app_id, permission FROM `user_to_app_permissions` ' +
                'WHERE user_id = ? AND permission LIKE ?',
            [issuerUserId, `${prefix}%`],
        );
        return rows.map((r) => ({
            app_id: Number(r.app_id),
            permission: String(r.permission),
        }));
    }

    async queryIssuerHolderPermsByPrefix(
        issuerUserId: number,
        holderUserId: number,
        prefix: string,
    ): Promise<string[]> {
        const rows = await this.clients.db.read(
            'SELECT permission FROM `user_to_user_permissions` ' +
                'WHERE issuer_user_id = ? AND holder_user_id = ? AND permission LIKE ?',
            [issuerUserId, holderUserId, `${prefix}%`],
        );
        return rows.map((r) => String(r.permission));
    }

    // ── Scan cache (redis) ──────────────────────────────────────────

    buildScanCacheKey(actorUid: string, permissionOptions: string[]): string {
        return PermissionUtil.join(
            'permission-scan',
            actorUid,
            'options-list',
            ...permissionOptions,
        );
    }

    async getScanCache(cacheKey: string): Promise<unknown | null> {
        const raw = await this.clients.redis.get(cacheKey);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    async setScanCache(
        cacheKey: string,
        value: unknown,
        ttlSeconds: number = PERMISSION_SCAN_CACHE_TTL_SECONDS,
    ): Promise<void> {
        await this.clients.redis.set(
            cacheKey,
            JSON.stringify(value),
            'EX',
            ttlSeconds,
        );
    }

    async invalidateScanCache(cacheKey: string): Promise<void> {
        await this.publishCacheKeys({ keys: [cacheKey] });
    }

    // ── Per-permission check cache (for `checkMany`) ─────────────────
    //
    // Cached as `1`/`0` per (actor, permission) pair so a batch lookup
    // reduces to a single MGET. Same TTL as the scan cache — the
    // underlying perm tables already publish invalidations via
    // `publishCacheKeys` for grant/revoke writes, but those don't reach
    // these keys, so we keep the TTL short and rely on it for staleness.
    #checkCacheKey(actorUid: string, permission: string): string {
        return PermissionUtil.join(
            'permission-check',
            actorUid,
            'p',
            permission,
        );
    }

    async getMultiCheckCache(
        actorUid: string,
        permissions: string[],
    ): Promise<Map<string, boolean>> {
        const out = new Map<string, boolean>();
        if (permissions.length === 0) return out;
        const keys = permissions.map((p) => this.#checkCacheKey(actorUid, p));
        let raw: Array<string | null> = [];
        try {
            raw = (await this.clients.redis.mget(...keys)) as Array<
                string | null
            >;
        } catch {
            return out;
        }
        for (let i = 0; i < permissions.length; i++) {
            const v = raw[i];
            if (v === '1') out.set(permissions[i], true);
            else if (v === '0') out.set(permissions[i], false);
        }
        return out;
    }

    async setMultiCheckCache(
        actorUid: string,
        entries: Array<{ permission: string; granted: boolean }>,
        ttlSeconds: number = PERMISSION_SCAN_CACHE_TTL_SECONDS,
    ): Promise<void> {
        if (entries.length === 0) return;
        const pipeline = this.clients.redis.pipeline();
        for (const { permission, granted } of entries) {
            pipeline.set(
                this.#checkCacheKey(actorUid, permission),
                granted ? '1' : '0',
                'EX',
                ttlSeconds,
            );
        }
        try {
            await pipeline.exec();
        } catch {
            // Best-effort cache write.
        }
    }

    // ── Internals ───────────────────────────────────────────────────

    #u2uCacheKey(holderUserId: number): string {
        return `perms:u2u:holder:${holderUserId}`;
    }

    #u2aCacheKey(userId: number, appId: number): string {
        return `perms:u2a:${userId}:${appId}`;
    }

    #tokenCacheKey(tokenUid: string): string {
        return `perms:token:${tokenUid}`;
    }

    async #readAllUserUserPermsForHolder(
        holderUserId: number,
    ): Promise<LinkedUserUserPermRow[]> {
        const cacheKey = this.#u2uCacheKey(holderUserId);
        try {
            const raw = await this.clients.redis.get(cacheKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // Fall through to DB.
        }

        const rows = await this.clients.db.read(
            'SELECT * FROM `user_to_user_permissions` WHERE `holder_user_id` = ?',
            [holderUserId],
        );
        const decoded = rows.map((row) =>
            this.#decodeExtra<LinkedUserUserPermRow>(row),
        );

        this.clients.redis
            .set(cacheKey, JSON.stringify(decoded), 'EX', U2U_CACHE_TTL_SECONDS)
            .catch(() => {});
        return decoded;
    }

    async #readAllUserAppPerms(
        userId: number,
        appId: number,
    ): Promise<LinkedUserAppPermRow[]> {
        const cacheKey = this.#u2aCacheKey(userId, appId);
        try {
            const raw = await this.clients.redis.get(cacheKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // Fall through to DB.
        }

        const rows = await this.clients.db.read(
            'SELECT * FROM `user_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ?',
            [userId, appId],
        );
        const decoded = rows.map((row) =>
            this.#decodeExtra<LinkedUserAppPermRow>(row),
        );

        this.clients.redis
            .set(cacheKey, JSON.stringify(decoded), 'EX', U2A_CACHE_TTL_SECONDS)
            .catch(() => {});
        return decoded;
    }

    async #readAccessTokenPerms(tokenUid: string): Promise<string[]> {
        const cacheKey = this.#tokenCacheKey(tokenUid);
        try {
            const raw = await this.clients.redis.get(cacheKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // Fall through to DB.
        }

        const rows = await this.clients.db.read(
            'SELECT `permission` FROM `access_token_permissions` WHERE `token_uid` = ?',
            [tokenUid],
        );
        const perms = rows.map((r) => String(r.permission));

        this.clients.redis
            .set(cacheKey, JSON.stringify(perms), 'EX', TOKEN_CACHE_TTL_SECONDS)
            .catch(() => {});
        return perms;
    }

    /** Parse the JSON `extra` column into an object. */
    #decodeExtra<T extends Record<string, unknown>>(
        row: Record<string, unknown>,
    ): T {
        const extra = this.clients.db.case<() => unknown>({
            mysql: () => row.extra,
            otherwise: () => {
                if (row.extra == null) return {};
                if (typeof row.extra === 'object') return row.extra;
                try {
                    return JSON.parse(String(row.extra));
                } catch {
                    return {};
                }
            },
        })();
        return {
            ...row,
            extra: (extra ?? {}) as Record<string, unknown>,
        } as unknown as T;
    }
}
