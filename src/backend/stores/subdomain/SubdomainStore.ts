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
import { escapeLike } from '../../util/sqlLike';
import { runWithConcurrencyLimit } from '../../util/concurrency';
import { CACHE_TOMBSTONE_TTL_SECONDS, PuterStore } from '../types';

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
//   - ownership: `user_id`, `app_owner` — set via `create` (or reclaimed in
//     place by `reclaimByUuid`), never via patch.
//     Flipping either hands the site to another user / app.
//   - access gate: `protected` — clearing this lets a future caller delete
//     or rename a protected site (e.g. `puter-app-icons`). The driver itself
//     honours the flag only via a read check in `delete`.
//   - external resource link: `database_id` — repointing a Cloudflare D1
//     binding could route another site's traffic / writes to attacker DB.
//
// `root_dir_id` and `associated_app_id` are intentionally NOT here — they're
// legitimately editable through the driver with their own access checks
// (FS permission, app ownership). `domain` isn't either, but the driver does
// not accept it: nothing validates a custom domain's ownership yet.
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

/**
 * Build the `app_owner` predicate shared by the prefix list/count queries.
 * `appIds` is the multi-app form (an app plus the apps it created); an empty
 * array means "no app may own these rows", which must match nothing rather than
 * degrade to an unfiltered query.
 */
const appOwnerCondition = ({
    appId,
    appIds,
}: {
    appId?: number;
    appIds?: number[];
}): { condition: string; values: unknown[] } | null => {
    if (appIds) {
        if (appIds.length === 0) return { condition: '1 = 0', values: [] };
        return {
            condition: `\`app_owner\` IN (${appIds.map(() => '?').join(', ')})`,
            values: appIds,
        };
    }
    if (appId) return { condition: '`app_owner` = ?', values: [appId] };
    return null;
};

const CACHE_KEY_PREFIX = 'subdomains';
const CACHE_TTL_SECONDS = 60 * 60;
// Sentinel so 404s on the same public subdomain don't hit the DB repeatedly.
const NEGATIVE_CACHE_MARKER = '__none__';
const NEGATIVE_CACHE_TTL_SECONDS = 10;
// Cap on placeholders per `IN (?, ?, …)` chunk — mirrors AppStore/UserStore.
const BULK_QUERY_CHUNK_SIZE = 200;

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
     * subdomain that may have been created moments ago): it skips the cache —
     * which may hold a stale negative marker — and reads the primary instead of
     * a possibly-lagging replica. The result still refreshes the cache, healing
     * any stale marker.
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

        // Changed moments ago: a replica may still have the old row.
        const tombstoned =
            !primary && (await this.isCacheKeyTombstoned([cacheKey]));
        const fromPrimary = primary || tombstoned;
        const sql = 'SELECT * FROM `subdomains` WHERE `subdomain` = ? LIMIT 1';
        const rows = fromPrimary
            ? await this.clients.db.pread(sql, [subdomain])
            : await this.clients.db.read(sql, [subdomain]);
        const row = (rows[0] as unknown as SubdomainRow | undefined) ?? null;

        const populate = () =>
            this.#populateCache(
                cacheKey,
                row ? JSON.stringify(row) : NEGATIVE_CACHE_MARKER,
                row
                    ? this.#rowTtlSeconds(tombstoned)
                    : NEGATIVE_CACHE_TTL_SECONDS,
                fromPrimary,
            );
        void (fromPrimary
            ? populate()
            : this.writeCacheUnlessDeleted([cacheKey], populate));
        return row;
    }

    /**
     * Batched sibling of {@link getBySubdomain} — one cache pipeline plus one
     * chunked `IN (…)` query for the misses, instead of one lookup per name.
     * Keyed by the requested names; a name with no row (negative-cached or
     * genuinely absent) is simply missing from the returned map.
     */
    async getBySubdomains(
        names: string[],
        { primary = false }: { primary?: boolean } = {},
    ): Promise<Map<string, SubdomainRow>> {
        const result = new Map<string, SubdomainRow>();
        const uniqueNames = [
            ...new Set(
                (Array.isArray(names) ? names : []).filter(
                    (n): n is string => typeof n === 'string' && n.length > 0,
                ),
            ),
        ];
        if (uniqueNames.length === 0) return result;

        let missingNames = uniqueNames;
        if (!primary) {
            missingNames = [];
            try {
                const pipeline = this.clients.redis.pipeline();
                for (const name of uniqueNames) {
                    pipeline.get(this.#cacheKey(name));
                }
                const cacheResults = (await pipeline.exec()) ?? [];
                for (let i = 0; i < uniqueNames.length; i++) {
                    const name = uniqueNames[i]!;
                    const raw = cacheResults[i]?.[1];
                    if (raw === NEGATIVE_CACHE_MARKER) continue; // cached miss
                    if (typeof raw === 'string') {
                        try {
                            const parsed = JSON.parse(
                                raw,
                            ) as SubdomainRow | null;
                            if (parsed) {
                                result.set(name, parsed);
                                continue;
                            }
                        } catch {
                            // Fall through to DB on any parse failure.
                        }
                    }
                    missingNames.push(name);
                }
            } catch {
                missingNames = uniqueNames;
            }
        }
        if (missingNames.length === 0) return result;

        // Names changed moments ago go to the primary; see `getBySubdomain`.
        const tombstoned = primary
            ? new Set<string>()
            : await this.tombstonedCacheKeys(
                  missingNames.map((name) => this.#cacheKey(name)),
              );
        const isChanged = (name: string) =>
            primary || tombstoned.has(this.#cacheKey(name));
        const primaryNames = missingNames.filter(isChanged);
        const replicaNames = missingNames.filter((name) => !isChanged(name));
        for (const [names, fromPrimary] of [
            [primaryNames, true],
            [replicaNames, false],
        ] as const) {
            if (names.length === 0) continue;
            const rowsByName = await this.#readByNames(names, fromPrimary);
            for (const name of names) {
                const row = rowsByName.get(name.toLowerCase());
                if (row) result.set(name, row);
            }
            const populate = () =>
                this.#populateCacheForNames(
                    names,
                    result,
                    fromPrimary,
                    this.#rowTtlSeconds(fromPrimary && !primary),
                );
            void (fromPrimary
                ? populate()
                : this.writeCacheUnlessDeleted(
                      names.map((name) => this.#cacheKey(name)),
                      populate,
                  ));
        }

        return result;
    }

    /** Rows for `names`, keyed by lowercased name. */
    async #readByNames(
        names: string[],
        primary: boolean,
    ): Promise<Map<string, SubdomainRow>> {
        const rowsByName = new Map<string, SubdomainRow>();
        for (
            let offset = 0;
            offset < names.length;
            offset += BULK_QUERY_CHUNK_SIZE
        ) {
            const chunk = names.slice(offset, offset + BULK_QUERY_CHUNK_SIZE);
            const placeholders = chunk.map(() => '?').join(', ');
            const sql = `SELECT * FROM \`subdomains\` WHERE \`subdomain\` IN (${placeholders})`;
            const rows = (primary
                ? await this.clients.db.pread(sql, chunk)
                : await this.clients.db.read(
                      sql,
                      chunk,
                  )) as unknown as SubdomainRow[];
            // Keyed lowercase: a case-insensitive collation can return a row
            // cased differently from the name, which `getBySubdomain` accepts.
            for (const row of rows) {
                if (typeof row.subdomain !== 'string') continue;
                const key = row.subdomain.toLowerCase();
                if (!rowsByName.has(key)) rowsByName.set(key, row);
            }
        }
        return rowsByName;
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
            conditions.push("`subdomain` NOT LIKE ? ESCAPE '!'");
            values.push(`${escapeLike(excludePrefix)}%`);
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
            conditions.push("`subdomain` NOT LIKE ? ESCAPE '!'");
            values.push(`${escapeLike(excludePrefix)}%`);
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

    async listByUserIdAndPrefix(
        userId: number,
        prefix: string,
        extra: {
            appId?: number;
            appIds?: number[];
            limit?: number;
            offset?: number;
            afterId?: number;
        } = {},
    ): Promise<SubdomainRow[]> {
        if (!userId || prefix == null) return [];

        const conditions = ['`user_id` = ?', "`subdomain` LIKE ? ESCAPE '!'"];
        const values: unknown[] = [userId, `${escapeLike(prefix)}%`];
        const appOwnerFilter = appOwnerCondition(extra);
        if (appOwnerFilter) {
            conditions.push(appOwnerFilter.condition);
            values.push(...appOwnerFilter.values);
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
        extra: {
            appId?: number;
            appIds?: number[];
            /**
             * `YYYY-MM-DD HH:MM:SS`, matching rows strictly older than it.
             * Compared in SQL because `ts` reaches JS as a string on one
             * backend and a Date on another, and the string form parses as
             * local time — a boundary computed here would drift by the server's
             * offset.
             */
            createdBefore?: string;
        } = {},
    ): Promise<number> {
        if (!userId || prefix == null) return 0;

        const conditions = ['`user_id` = ?', "`subdomain` LIKE ? ESCAPE '!'"];
        const values: unknown[] = [userId, `${escapeLike(prefix)}%`];
        const appOwnerFilter = appOwnerCondition(extra);
        if (appOwnerFilter) {
            conditions.push(appOwnerFilter.condition);
            values.push(...appOwnerFilter.values);
        }
        if (extra.createdBefore !== undefined) {
            conditions.push('`ts` < ?');
            values.push(extra.createdBefore);
        }
        const rows = await this.clients.db.read(
            `SELECT COUNT(*) AS n FROM \`subdomains\` WHERE ${conditions.join(' AND ')}`,
            values,
        );
        return Number((rows[0] as { n?: number | string } | undefined)?.n ?? 0);
    }

    // -- Writes -------------------------------------------------------

    /**
     * @param {{
     *     userId: number;
     *     subdomain: string;
     *     rootDirId?: number | null;
     *     associatedAppId?: number | null;
     *     appOwner?: number | null;
     *     preambleVersion?: string | null;
     * }} opts
     */
    async create({
        uuid = uuidv4(),
        userId,
        subdomain,
        rootDirId = null,
        associatedAppId = null,
        appOwner = null,
        preambleVersion = null,
        isProtected = false,
    }: {
        /** Pre-generated by a caller that has to hand the uuid out first. */
        uuid?: string;
        userId: number;
        subdomain: string;
        rootDirId?: number | null;
        associatedAppId?: number | null;
        appOwner?: number | null;
        preambleVersion?: string | null;
        /** A system site nobody may delete or rename; see `protected` above. */
        isProtected?: boolean;
    }) {
        if (!userId || !subdomain) {
            throw new Error('create: userId and subdomain are required');
        }
        await this.clients.db.write(
            `INSERT INTO \`subdomains\`
                (\`uuid\`, \`subdomain\`, \`user_id\`, \`root_dir_id\`, \`associated_app_id\`, \`app_owner\`, \`preamble_version\`, \`protected\`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uuid,
                subdomain,
                userId,
                rootDirId ?? null,
                associatedAppId,
                appOwner,
                preambleVersion,
                this.clients.db.booleanValue(isProtected),
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
            protected: isProtected ? 1 : 0,
        };
        await this.#refreshCache(row);
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

        // Not `{ ...before, ...allowed }`: `before` is the replica's, and a
        // column it has stale would go into the cache.
        const after = await this.getByUuid(uuid, { userId, primary: true });
        await this.#publishChanged(after ? [{ ...after, ...allowed }] : [], [
            before?.subdomain,
        ]);
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
        // Primary: a row created within replica lag would otherwise be missed
        // and stay cached.
        const row = await this.getByUuid(uuid, { userId, primary: true });

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
            const key = this.#cacheKey(row.subdomain);
            await this.tombstoneCacheKeys([key]);
            await this.publishCacheKeys({
                keys: [key],
                serializedData: NEGATIVE_CACHE_MARKER,
                ttlSeconds: NEGATIVE_CACHE_TTL_SECONDS,
            });
            await this.#invalidateRootDirEntry(row.root_dir_id);
        }
    }

    /**
     * Move a row to a new owner and root in place, keeping its id and uuid and
     * dropping the previous holder's bindings. `protect` only turns `protected`
     * on.
     */
    async reclaimByUuid(
        uuid: string,
        {
            userId,
            rootDirId,
            protect = false,
        }: {
            userId: number;
            rootDirId: number | null;
            protect?: boolean;
        },
    ): Promise<SubdomainRow | null> {
        const before = await this.getByUuid(uuid, { primary: true });
        if (!before) return null;

        // No `database_id` here: the MySQL schema has no such column.
        await this.clients.db.write(
            `UPDATE \`subdomains\`
                SET \`user_id\` = ?, \`root_dir_id\` = ?, \`protected\` = \`protected\` OR ?,
                    \`app_owner\` = NULL, \`associated_app_id\` = NULL,
                    \`domain\` = NULL
              WHERE \`uuid\` = ?`,
            [userId, rootDirId, this.clients.db.booleanValue(protect), uuid],
        );

        const after = await this.getByUuid(uuid, { primary: true });
        await this.#publishChanged(after ? [after] : [], [before.subdomain]);

        const affectedRootDirIds = new Set(
            [before.root_dir_id, after?.root_dir_id].filter((v) => v != null),
        );
        for (const id of affectedRootDirIds) {
            await this.#invalidateRootDirEntry(id as number);
        }
        return after;
    }

    /**
     * Hand every row `fromAppId` owns to `toAppId`. For merging one app row
     * into another: `app_owner` cascades on app delete, so the rows have to
     * change hands before the source app row goes. Returns the moved rows.
     */
    async reassignAppOwner(
        fromAppId: number,
        toAppId: number,
    ): Promise<SubdomainRow[]> {
        const rows = (await this.listAll({
            appOwner: fromAppId,
        })) as unknown as SubdomainRow[];
        if (rows.length === 0) return rows;

        await this.clients.db.write(
            'UPDATE `subdomains` SET `app_owner` = ? WHERE `app_owner` = ?',
            [toAppId, fromAppId],
        );

        for (const row of rows) row.app_owner = toAppId;
        await this.#publishChanged(rows);
        return rows;
    }

    /**
     * Rows the database deletes along with an app (`app_owner` and
     * `associated_app_id` cascade), or with every app `ownerUserId` owns. Read
     * from the primary before the delete; pass them to
     * {@link forgetCascadeDeleted} after it.
     */
    async listAppCascade(
        apps: { appId: number } | { ownerUserId: number },
    ): Promise<Array<Pick<SubdomainRow, 'subdomain' | 'root_dir_id'>>> {
        const [match, param] =
            'appId' in apps
                ? ['= ?', apps.appId]
                : [
                      'IN (SELECT `id` FROM `apps` WHERE `owner_user_id` = ?)',
                      apps.ownerUserId,
                  ];
        const out: Array<Pick<SubdomainRow, 'subdomain' | 'root_dir_id'>> = [];
        let afterId = 0;
        for (;;) {
            const rows = (await this.clients.db.pread(
                `SELECT \`id\`, \`subdomain\`, \`root_dir_id\` FROM \`subdomains\`
                  WHERE (\`app_owner\` ${match} OR \`associated_app_id\` ${match})
                    AND \`id\` > ? ORDER BY \`id\` LIMIT ?`,
                [param, param, afterId, BULK_QUERY_CHUNK_SIZE],
            )) as Array<Pick<SubdomainRow, 'id' | 'subdomain' | 'root_dir_id'>>;
            for (const { subdomain, root_dir_id } of rows) {
                out.push({ subdomain, root_dir_id });
            }
            if (rows.length < BULK_QUERY_CHUNK_SIZE) return out;
            afterId = Number(rows[rows.length - 1].id);
        }
    }

    /**
     * Drop cached state, here and on peers, for rows deleted outside this
     * store.
     */
    async forgetCascadeDeleted(
        rows: Array<Pick<SubdomainRow, 'subdomain' | 'root_dir_id'>>,
    ): Promise<void> {
        if (rows.length === 0) return;
        await this.#publishChanged(
            [],
            rows.map((row) => row.subdomain),
        );
        const rootDirIds = [
            ...new Set(
                rows.map((row) => row.root_dir_id).filter((id) => id != null),
            ),
        ];
        await runWithConcurrencyLimit(rootDirIds, 8, (id) =>
            this.#invalidateRootDirEntry(id),
        );
    }

    // -- Internals ----------------------------------------------------

    #cacheKey(subdomain: string) {
        return `${CACHE_KEY_PREFIX}:name:${subdomain}`;
    }

    /**
     * A row read inside a tombstone window lives only as long as the window: a
     * second change can commit between that read and its cache write.
     */
    #rowTtlSeconds(tombstoned: boolean) {
        return tombstoned ? CACHE_TOMBSTONE_TTL_SECONDS : CACHE_TTL_SECONDS;
    }

    /**
     * Write-through on a primary read (heals a stale negative marker); `NX` on
     * a replica read so an in-flight fresher write can't be clobbered by a
     * stale value landing after it.
     */
    async #populateCache(
        cacheKey: string,
        value: string,
        ttlSeconds: number,
        primary: boolean,
    ): Promise<void> {
        try {
            if (primary) {
                await this.clients.redis.set(cacheKey, value, 'EX', ttlSeconds);
            } else {
                await this.clients.redis.set(
                    cacheKey,
                    value,
                    'EX',
                    ttlSeconds,
                    'NX',
                );
            }
        } catch {
            /* best-effort */
        }
    }

    /** Pipelined sibling of {@link #populateCache} for `getBySubdomains`. */
    async #populateCacheForNames(
        names: string[],
        rowsByName: Map<string, SubdomainRow>,
        primary: boolean,
        rowTtlSeconds: number,
    ): Promise<void> {
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const name of names) {
                const row = rowsByName.get(name);
                const cacheKey = this.#cacheKey(name);
                const value = row ? JSON.stringify(row) : NEGATIVE_CACHE_MARKER;
                const ttl = row ? rowTtlSeconds : NEGATIVE_CACHE_TTL_SECONDS;
                if (primary) {
                    pipeline.set(cacheKey, value, 'EX', ttl);
                } else {
                    pipeline.set(cacheKey, value, 'EX', ttl, 'NX');
                }
            }
            await pipeline.exec();
        } catch {
            /* best-effort */
        }
    }

    /**
     * Cache rows just changed on the primary, here only. Their names (and
     * `staleNames`) are tombstoned here and on peers, whose misses then read
     * the primary until replicas catch up.
     */
    async #publishChanged(
        rows: SubdomainRow[],
        staleNames: Array<string | undefined> = [],
    ) {
        const names = new Set(
            [...staleNames, ...rows.map((row) => row.subdomain)].filter(
                (name): name is string => !!name,
            ),
        );
        await this.tombstoneCacheKeys(
            [...names].map((name) => this.#cacheKey(name)),
        );
        if (rows.length === 0) return;
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const row of rows) {
                pipeline.set(
                    this.#cacheKey(row.subdomain),
                    JSON.stringify(row),
                    'EX',
                    CACHE_TTL_SECONDS,
                );
            }
            await pipeline.exec();
        } catch {
            // The next read fills it from the primary.
        }
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
}
