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

/**
 * A row from the `subdomains` table (the shape `getBySubdomain` / `getByUuid`
 * resolve to). Kept alongside the store so callers share one definition instead
 * of redeclaring it locally.
 */
export interface SubdomainRow {
    id: number;
    uuid: string;
    ts: number | string; // system timestamp
    subdomain: string; // immutable name
    user_id: number; // owner
    app_owner: number | null; // owning app, if any
    protected: 0 | 1; // access gate
    database_id: string | null; // Cloudflare D1 binding
    root_dir_id: number | null; // editable
    associated_app_id: string | null; // editable
    domain: string | null; // custom domain, editable
    // `SELECT *` may surface columns not modelled above (and callers still
    // treat rows as `Record<string, unknown>` in places). The index signature
    // keeps the named fields strongly typed while staying Record-compatible.
    [key: string]: unknown;
}

// Columns that may not be set through an `update` patch map. Defence-in-depth
// against future callers (admin routes, extensions, new REST handlers) that
// might forward `req.body` straight into the store: the driver's update
// builds its patch from a strict allow-list upstream, but the store is the
// last line before SQL.
//
// Categories:
//   - identity: `id`, `uuid`
//   - system timestamps: `ts`
//   - name / identity: `subdomain` — v1 marks this `immutable: true`; rename
//     would orphan DNS + ACL wiring tied to the old name.
//   - ownership: `user_id`, `app_owner` — set via `create`, never via patch.
//     Flipping either hands the site to another user / app.
//   - access gate: `protected` — clearing this lets a future caller delete
//     or rename a protected site (e.g. `puter-app-icons`). The driver itself
//     honours the flag only via a read check in `delete`.
//   - external resource link: `database_id` — repointing a Cloudflare D1
//     binding could route another site's traffic / writes to attacker DB.
//
// `root_dir_id`, `associated_app_id`, and `domain` are intentionally NOT
// here — they're legitimately editable through the driver with their own
// access checks (FS permission, app ownership, custom-domain validation).
/**
 * Worker deployments are stored as subdomain rows under this prefix.
 * Site-facing listings (the `puter-subdomains` driver) exclude them.
 */
export const WORKER_SUBDOMAIN_PREFIX = 'workers.puter.';

const READ_ONLY_COLUMNS = new Set([
    'id',
    'uuid',
    'ts',
    'subdomain',
    'user_id',
    'app_owner',
    'protected',
    'database_id',
]);

const CACHE_KEY_PREFIX = 'subdomains';
const CACHE_TTL_SECONDS = 60 * 60;
// Sentinel so 404s on the same public subdomain don't hit the DB repeatedly.
const NEGATIVE_CACHE_MARKER = '__none__';
const NEGATIVE_CACHE_TTL_SECONDS = 10;

export class SubdomainStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    async getByUuid(
        uuid: string,
        {
            userId,
            primary = false,
        }: {
            userId?: number | undefined;
            primary?: boolean;
        } = {},
    ): Promise<SubdomainRow | null> {
        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const params = userId !== undefined ? [uuid, userId] : [uuid];
        const sql = `SELECT * FROM \`subdomains\` ${where} LIMIT 1`;
        const rows = primary
            ? await this.clients.db.pread(sql, params)
            : await this.clients.db.read(sql, params);
        return (rows[0] as unknown as SubdomainRow) ?? null;
    }

    /**
     * Pass `primary: true` for read-after-write lookups (e.g. checking a
     * subdomain that may have been created moments ago): it skips the
     * cache — which may hold a stale negative marker — and reads the
     * primary instead of a possibly-lagging replica. The result still
     * refreshes the cache, healing any stale marker.
     */
    async getBySubdomain(
        subdomain: string,
        { primary = false }: { primary?: boolean } = {},
    ): Promise<SubdomainRow | null> {
        if (!subdomain) return null;

        const cacheKey = this.#cacheKey(subdomain);
        if (!primary) {
            try {
                const raw = await this.clients.redis.get(cacheKey);
                if (raw === NEGATIVE_CACHE_MARKER) return null;
                if (raw) {
                    const parsed = JSON.parse(raw) as SubdomainRow | null;
                    if (parsed) return parsed;
                }
            } catch {
                /* fall through */
            }
        }

        const sql = 'SELECT * FROM `subdomains` WHERE `subdomain` = ? LIMIT 1';
        const rows = primary
            ? await this.clients.db.pread(sql, [subdomain])
            : await this.clients.db.read(sql, [subdomain]);
        const row = (rows[0] as unknown as SubdomainRow | undefined) ?? null;

        if (row) {
            this.clients.redis
                .set(cacheKey, JSON.stringify(row), 'EX', CACHE_TTL_SECONDS)
                .catch(() => {});
        } else {
            this.clients.redis
                .set(
                    cacheKey,
                    NEGATIVE_CACHE_MARKER,
                    'EX',
                    NEGATIVE_CACHE_TTL_SECONDS,
                )
                .catch(() => {});
        }
        return row;
    }

    async listByUserId(
        userId: number,
        {
            limit = 500,
            offset,
            afterId,
            appOwner,
            excludePrefix,
        }: {
            limit?: number;
            offset?: number;
            afterId?: number;
            appOwner?: number | null;
            excludePrefix?: string;
        } = {},
    ) {
        return this.#listWhere(['`user_id` = ?'], [userId], {
            limit,
            offset,
            afterId,
            appOwner,
            excludePrefix,
        });
    }

    async listAll({
        limit = 5000,
        offset,
        afterId,
        appOwner,
        excludePrefix,
    }: {
        limit?: number;
        offset?: number;
        afterId?: number;
        appOwner?: number | null;
        excludePrefix?: string;
    } = {}) {
        return this.#listWhere([], [], {
            limit,
            offset,
            afterId,
            appOwner,
            excludePrefix,
        });
    }

    async #listWhere(
        where: string[],
        params: unknown[],
        {
            limit,
            offset,
            afterId,
            appOwner,
            excludePrefix,
        }: {
            limit: number;
            offset?: number;
            afterId?: number;
            appOwner?: number | null;
            excludePrefix?: string;
        },
    ) {
        const conditions = [...where];
        const values = [...params];
        if (appOwner !== undefined && appOwner !== null) {
            conditions.push('`app_owner` = ?');
            values.push(appOwner);
        }
        if (afterId !== undefined) {
            conditions.push('`id` > ?');
            values.push(afterId);
        }
        if (excludePrefix) {
            conditions.push('`subdomain` NOT LIKE ?');
            values.push(`${excludePrefix}%`);
        }
        const whereClause = conditions.length
            ? `WHERE ${conditions.join(' AND ')}`
            : '';
        let sql = `SELECT * FROM \`subdomains\` ${whereClause} ORDER BY \`id\` ASC LIMIT ?`;
        values.push(limit);
        if (offset !== undefined && offset > 0) {
            sql += ' OFFSET ?';
            values.push(offset);
        }
        return this.clients.db.read(sql, values);
    }

    async count({
        userId,
        appOwner,
        excludePrefix,
    }: {
        userId?: number;
        appOwner?: number | null;
        excludePrefix?: string;
    } = {}) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (userId !== undefined) {
            conditions.push('`user_id` = ?');
            values.push(userId);
        }
        if (appOwner !== undefined && appOwner !== null) {
            conditions.push('`app_owner` = ?');
            values.push(appOwner);
        }
        if (excludePrefix) {
            conditions.push('`subdomain` NOT LIKE ?');
            values.push(`${excludePrefix}%`);
        }
        const whereClause = conditions.length
            ? `WHERE ${conditions.join(' AND ')}`
            : '';
        const rows = await this.clients.db.read(
            `SELECT COUNT(*) AS n FROM \`subdomains\` ${whereClause}`,
            values,
        );
        return Number(rows[0]?.n ?? 0);
    }

    async existsBySubdomain(subdomain: string) {
        // Reuse the positive/negative cache populated by getBySubdomain —
        // creation uniqueness checks and the Workers quota path would
        // otherwise punch through to the DB on every call.
        const row = await this.getBySubdomain(subdomain);
        return row != null;
    }

    async countByUserId(userId: number) {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `subdomains` WHERE `user_id` = ?',
            [userId],
        );
        return rows[0]?.n ?? 0;
    }

    async getByDomain(domain: string) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `domain` = ? LIMIT 1',
            [domain],
        );
        return rows[0] ?? null;
    }

    async listByDomain(domain: string) {
        return this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `domain` = ?',
            [domain],
        );
    }

    async listByUserIdAndPrefix(
        userId: number,
        prefix: string,
        extra: {
            appId?: number;
            limit?: number;
            offset?: number;
            afterId?: number;
        } = {},
    ): Promise<SubdomainRow[]> {
        if (!userId || prefix == null) return [];

        const conditions = ['`user_id` = ?', '`subdomain` LIKE ?'];
        const values: unknown[] = [userId, `${prefix}%`];
        if (extra.appId) {
            conditions.push('`app_owner` = ?');
            values.push(extra.appId);
        }
        if (extra.afterId !== undefined) {
            conditions.push('`id` > ?');
            values.push(extra.afterId);
        }
        let sql = `SELECT * FROM \`subdomains\` WHERE ${conditions.join(' AND ')} ORDER BY \`id\` ASC`;
        if (extra.limit !== undefined) {
            sql += ' LIMIT ?';
            values.push(extra.limit);
            if (extra.offset !== undefined && extra.offset > 0) {
                sql += ' OFFSET ?';
                values.push(extra.offset);
            }
        }

        const rows = await this.clients.db.read(sql, values);
        return rows as unknown as SubdomainRow[];
    }

    async countByUserIdAndPrefix(
        userId: number,
        prefix: string,
        extra: { appId?: number } = {},
    ): Promise<number> {
        if (!userId || prefix == null) return 0;

        const conditions = ['`user_id` = ?', '`subdomain` LIKE ?'];
        const values: unknown[] = [userId, `${prefix}%`];
        if (extra.appId) {
            conditions.push('`app_owner` = ?');
            values.push(extra.appId);
        }
        const rows = await this.clients.db.read(
            `SELECT COUNT(*) AS n FROM \`subdomains\` WHERE ${conditions.join(' AND ')}`,
            values,
        );
        return Number((rows[0] as { n?: number | string } | undefined)?.n ?? 0);
    }

    // -- Writes -------------------------------------------------------

    /** @param {{ userId: number, subdomain: string, rootDirId?: number|null, associatedAppId?: number|null, appOwner?: number|null, preambleVersion?: string|null }} opts */
    async create({
        userId,
        subdomain,
        rootDirId = null,
        associatedAppId = null,
        appOwner = null,
        preambleVersion = null,
    }: {
        userId: number;
        subdomain: string;
        rootDirId?: number | null;
        associatedAppId?: number | null;
        appOwner?: number | null;
        preambleVersion?: string | null;
    }) {
        if (!userId || !subdomain) {
            throw new Error('create: userId and subdomain are required');
        }
        const uuid = uuidv4();
        await this.clients.db.write(
            `INSERT INTO \`subdomains\`
                (\`uuid\`, \`subdomain\`, \`user_id\`, \`root_dir_id\`, \`associated_app_id\`, \`app_owner\`, \`preamble_version\`)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                uuid,
                subdomain,
                userId,
                rootDirId ?? null,
                associatedAppId,
                appOwner,
                preambleVersion,
            ],
        );

        const row = {
            uuid,
            subdomain,
            user_id: userId,
            root_dir_id: rootDirId ?? null,
            associated_app_id: associatedAppId,
            app_owner: appOwner,
            preamble_version: preambleVersion,
        };
        await this.#refreshCache(row);
        await this.#invalidatePrefixListsForUser(userId);
        await this.#invalidateRootDirEntry(row.root_dir_id);

        return row;
    }

    async update(
        uuid: string,
        patch: Record<string, unknown>,
        {
            userId,
        }: {
            userId?: number | undefined;
        } = {},
    ) {
        const allowed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
            if (READ_ONLY_COLUMNS.has(k)) continue;
            allowed[k] = v;
        }
        const keys = Object.keys(allowed);
        if (keys.length === 0) return this.getByUuid(uuid, { userId });

        // Rename drops the old cache key.
        const before = await this.getByUuid(uuid, { userId });

        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => allowed[k]);

        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const whereParams = userId !== undefined ? [uuid, userId] : [uuid];

        await this.clients.db.write(
            `UPDATE \`subdomains\` SET ${setClause} ${where}`,
            [...values, ...whereParams],
        );

        const after = await this.getByUuid(uuid, { userId });
        if (before?.subdomain && before.subdomain !== after?.subdomain) {
            await this.publishCacheKeys({
                keys: [this.#cacheKey(before.subdomain)],
                broadcast: true,
            });
        }
        if (after) {
            await this.#refreshCache({ ...after, ...allowed });
        }
        // A patched root_dir_id / associated_app_id / domain changes the rows
        // the prefix-list cache would return, so drop those caches for the
        // owning user(s). Covers pre- and post-rename owners in case the
        // caller ever allowed re-assignment (currently we don't, but cheap).
        const affectedUsers = new Set(
            [before?.user_id, after?.user_id].filter((v) => v != null),
        );
        for (const uid of affectedUsers) {
            await this.#invalidatePrefixListsForUser(uid);
        }
        // FSEntry rows embed a `subdomains_agg` JSON of associated subdomains,
        // so any rename / root_dir reassignment must drop the stale entry
        // caches on both the old and new root_dir_id.
        const affectedRootDirIds = new Set(
            [before?.root_dir_id, after?.root_dir_id].filter((v) => v != null),
        );
        for (const id of affectedRootDirIds) {
            await this.#invalidateRootDirEntry(id);
        }
        return after;
    }

    async deleteByUuid(
        uuid: string,
        {
            userId,
        }: {
            userId?: number | undefined;
        } = {},
    ) {
        const row = await this.getByUuid(uuid, { userId });

        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const params = userId !== undefined ? [uuid, userId] : [uuid];

        await this.clients.db.write(
            `DELETE FROM \`subdomains\` ${where}`,
            params,
        );
        if (row?.subdomain) {
            await this.publishCacheKeys({
                keys: [this.#cacheKey(row.subdomain)],
                serializedData: NEGATIVE_CACHE_MARKER,
                ttlSeconds: NEGATIVE_CACHE_TTL_SECONDS,
                broadcast: true,
            });
            if (row.user_id != null) {
                await this.#invalidatePrefixListsForUser(row.user_id);
            }
            await this.#invalidateRootDirEntry(row.root_dir_id);
        }
    }

    // -- Internals ----------------------------------------------------

    #cacheKey(subdomain: string) {
        return `${CACHE_KEY_PREFIX}:name:${subdomain}`;
    }

    #prefixListTrackerKey(userId: number) {
        return `${CACHE_KEY_PREFIX}:listByUserPrefixKeys:${userId}`;
    }

    async #refreshCache(row: { subdomain?: string }) {
        if (!row?.subdomain) return;
        await this.publishCacheKeys({
            keys: [this.#cacheKey(row.subdomain)],
            serializedData: JSON.stringify(row),
            ttlSeconds: CACHE_TTL_SECONDS,
            broadcast: true,
        });
    }

    // FSEntryStore caches each row with an embedded `subdomains_agg` JSON
    // (uuid + subdomain) keyed on `root_dir_id`. Without this, a deleted or
    // renamed subdomain keeps showing up under its old folder in the GUI
    // (website badge, "associated websites" popover) until the entry's
    // independent TTL expires.
    async #invalidateRootDirEntry(rootDirId: number | null | undefined) {
        if (rootDirId == null) return;
        const id =
            typeof rootDirId === 'number' ? rootDirId : Number(rootDirId);
        if (!Number.isFinite(id)) return;
        const fsEntry = this.stores?.fsEntry;
        if (!fsEntry?.invalidateEntryCacheById) return;
        try {
            await fsEntry.invalidateEntryCacheById(id);
        } catch {
            /* best-effort */
        }
    }

    async #invalidatePrefixListsForUser(userId: number) {
        if (userId == null) return;
        const trackerKey = this.#prefixListTrackerKey(userId);
        let cacheKeys = [];
        try {
            cacheKeys = await this.clients.redis.smembers(trackerKey);
        } catch {
            return;
        }
        const keysToInvalidate = [...cacheKeys, trackerKey];
        if (keysToInvalidate.length === 0) return;
        await this.publishCacheKeys({
            keys: keysToInvalidate,
            broadcast: true,
        });
    }
}
