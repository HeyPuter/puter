import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * Persistence + cache for the `apps` table.
 *
 * CRUD over app rows with multi-key caching (uid, name, id). No
 * validation or permission logic — those live in AppDriver. Callers
 * that need enforcement should go through the driver; callers that
 * just need data (internal services) can hit the store directly.
 */

const CACHE_KEY_PREFIX = 'apps';
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const FILETYPE_CACHE_KEY_PREFIX = 'apps:by-filetype';
const FILETYPE_CACHE_TTL_SECONDS = 60;
const APP_ID_PROPERTIES = ['id', 'uid', 'name'];
// Cap on placeholders per `IN (?, ?, …)` query. SQLite's default parameter
// limit is 999; staying well under that keeps `getByIds` portable across
// backends without splitting the cap by driver.
const BULK_QUERY_CHUNK_SIZE = 200;

// Top-level all-time open/user counts: hot path, slow to compute, refreshed
// periodically by one instance and read via MGET on every app list/read.
const STATS_CACHE_TTL_SECONDS = 30 * 60;
const STATS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const STATS_REFRESH_LOCK_KEY = 'appStatsLastRefresh';

// Period helpers for detailed/grouped stats. Ported from v1
// AppInformationService — queries go straight to ClickHouse/MySQL on demand
// (no cache) since they're UI-driven and rarely repeated with identical args.
const MYSQL_DATE_FORMATS = {
    hour: '%Y-%m-%d %H:00:00',
    day: '%Y-%m-%d',
    week: '%Y-%U',
    month: '%Y-%m',
    year: '%Y',
};
const CLICKHOUSE_GROUP_BY_FORMATS = {
    hour: 'toStartOfHour(fromUnixTimestamp(ts))',
    day: 'toStartOfDay(fromUnixTimestamp(ts))',
    week: 'toStartOfWeek(fromUnixTimestamp(ts))',
    month: 'toStartOfMonth(fromUnixTimestamp(ts))',
    year: 'toStartOfYear(fromUnixTimestamp(ts))',
};

// Columns that may not be set through `create` / `update` from user input
// or from any patch map forwarded into the store. Defence-in-depth against
// future callers (admin routes, extensions, new REST endpoints) that might
// forward `req.body` straight to `update`: the driver's #validateInput is
// an allow-list upstream, but the store is the last line before SQL.
//
// Categories:
//   - identity: `id`, `uid`
//   - system timestamps / admin review: `timestamp`, `last_review`
//   - admin-only flags: `approved_for_*`, `godmode`
//   - ownership: `owner_user_id`, `app_owner` — set via `create`'s second
//     argument, never from a patch map. Re-assigning via update would
//     hand an app to another user.
//   - access gates: `protected`, `is_private` — flipping these silently
//     bypasses #canReadApp / leaks a private app's index_url via
//     #toClient. If an admin flow ever needs to toggle these it must
//     call a purpose-built method, not a generic patch.
//
// `index_url` is intentionally NOT here — it's legitimately user-editable
// (the whole point of updating an app). XSS-unsafe schemes are rejected
// upstream by validateUrl's scheme allow-list.
const READ_ONLY_COLUMNS = new Set([
    'id',
    'uid',
    'timestamp',
    'last_review',
    'approved_for_listing',
    'approved_for_opening_items',
    'approved_for_incentive_program',
    'godmode',
    'owner_user_id',
    'app_owner',
    'protected',
    'is_private',
]);

export class AppStore extends PuterStore {
    #appStatsInterval;
    // ── Reads ────────────────────────────────────────────────────────

    async getByUid(uid) {
        return this.#getByProperty('uid', uid);
    }
    async getById(id) {
        return this.#getByProperty('id', id);
    }
    async getByName(name) {
        return this.#getByProperty('name', name);
    }

    /**
     * Batched lookup by id. Dedupes input ids, reads cache via a pipelined
     * MGET, and resolves remaining misses with a single
     * `SELECT … WHERE id IN (…)` per chunk. Use this in place of
     * `Promise.all(ids.map(getById))` to avoid one connection per row on
     * large id sets.
     *
     * Missing ids (no DB row) are simply absent from the returned map.
     */
    async getByIds(ids) {
        const result = new Map();
        const uniqueIds = [
            ...new Set(
                (Array.isArray(ids) ? ids : []).filter(
                    (id) => id !== null && id !== undefined,
                ),
            ),
        ];
        if (uniqueIds.length === 0) return result;

        const missingIds = [];
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const id of uniqueIds) {
                pipeline.get(this.#cacheKey('id', id));
            }
            const cacheResults = (await pipeline.exec()) ?? [];
            for (let i = 0; i < uniqueIds.length; i++) {
                const id = uniqueIds[i];
                const raw = cacheResults[i]?.[1];
                if (typeof raw === 'string') {
                    try {
                        result.set(id, JSON.parse(raw));
                        continue;
                    } catch {
                        // Fall through to DB on any parse failure.
                    }
                }
                missingIds.push(id);
            }
        } catch {
            missingIds.push(...uniqueIds);
        }

        for (
            let offset = 0;
            offset < missingIds.length;
            offset += BULK_QUERY_CHUNK_SIZE
        ) {
            const chunk = missingIds.slice(
                offset,
                offset + BULK_QUERY_CHUNK_SIZE,
            );
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = await this.clients.db.read(
                `SELECT * FROM \`apps\` WHERE \`id\` IN (${placeholders})`,
                chunk,
            );
            for (const row of rows) {
                const app = this.#normalizeRow(row);
                if (!app) continue;
                result.set(app.id, app);
                this.#writeCache(app).catch(() => {});
            }
        }

        return result;
    }

    async existsByName(name) {
        const rows = await this.clients.db.read(
            'SELECT `id` FROM `apps` WHERE `name` = ? LIMIT 1',
            [name],
        );
        return rows.length > 0;
    }

    async existsByIndexUrl(indexUrl) {
        const rows = await this.clients.db.read(
            'SELECT `id` FROM `apps` WHERE `index_url` = ? LIMIT 1',
            [indexUrl],
        );
        return rows.length > 0;
    }

    /**
     * List apps with optional filters. Returns raw normalised rows —
     * the driver is responsible for permission filtering + icon URL
     * resolution when serving to clients.
     *
     * @param {object} filters
     * @param {number} [filters.ownerUserId] — only apps owned by this user
     * @param {number} [filters.appOwner] — only apps created by another app
     * @param {string} [filters.name] — exact name match
     * @param {number} [filters.limit=500]
     */
    async list(filters = {}) {
        const where = [];
        const params = [];

        if (filters.ownerUserId !== undefined) {
            where.push('`owner_user_id` = ?');
            params.push(filters.ownerUserId);
        }
        if (filters.appOwner !== undefined) {
            where.push('`app_owner` = ?');
            params.push(filters.appOwner);
        }
        if (filters.name !== undefined) {
            where.push('`name` = ?');
            params.push(filters.name);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = filters.limit ?? 500;

        const rows = await this.clients.db.read(
            `SELECT * FROM \`apps\` ${whereClause} LIMIT ${limit}`,
            params,
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    // ── Writes ───────────────────────────────────────────────────────

    /**
     * Create a new app row.
     *
     * `fields` is the post-validation column map from the driver.
     * `ownerUserId` and `appOwner` come in as a separate arg rather
     * than living on `fields` so user-derived patches can never fake
     * ownership — the store's READ_ONLY_COLUMNS filter would strip
     * them from `fields` anyway; putting them here makes the
     * privileged contract obvious at the call site.
     *
     * Returns the created app row.
     */
    async create(fields, { ownerUserId, appOwner = null } = {}) {
        if (typeof ownerUserId !== 'number') {
            throw new Error('AppStore.create requires a numeric ownerUserId');
        }

        const uid = `app-${uuidv4()}`;
        const allowed = this.#filterEditable(fields);
        allowed.owner_user_id = ownerUserId;
        if (appOwner !== null && appOwner !== undefined) {
            allowed.app_owner = appOwner;
        }

        const columns = ['uid', ...Object.keys(allowed)];
        const values = [uid, ...Object.values(allowed)];

        const placeholders = columns.map(() => '?').join(', ');
        const colList = columns.map((c) => `\`${c}\``).join(', ');

        const result = await this.clients.db.write(
            `INSERT INTO \`apps\` (${colList}) VALUES (${placeholders})`,
            values,
        );
        const insertId = result?.insertId;
        if (!insertId)
            throw new Error('Failed to create app — no insertId returned');

        return this.getById(insertId);
    }

    /** Updates + refreshes cache (local + peers) with the post-update row. */
    async update(appId, patch) {
        const allowed = this.#filterEditable(patch);
        const keys = Object.keys(allowed);
        if (keys.length === 0) return this.getById(appId);

        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => allowed[k]);

        await this.clients.db.write(
            `UPDATE \`apps\` SET ${setClause} WHERE \`id\` = ?`,
            [...values, appId],
        );

        const fresh = await this.#readFromDb('id', appId);
        if (fresh) await this.#refreshCache(fresh);
        return fresh;
    }

    /**
     * Delete an app row. Also deletes its filetype associations.
     * Invalidates cache.
     */
    async delete(appId) {
        const app = await this.getById(appId);
        if (!app) return false;

        await this.clients.db.write(
            'DELETE FROM `app_filetype_association` WHERE `app_id` = ?',
            [appId],
        );
        await this.clients.db.write('DELETE FROM `apps` WHERE `id` = ?', [
            appId,
        ]);
        await this.invalidate(app);
        return true;
    }

    // ── Filetype associations ────────────────────────────────────────

    async getFiletypeAssociations(appId) {
        const rows = await this.clients.db.read(
            'SELECT `type` FROM `app_filetype_association` WHERE `app_id` = ?',
            [appId],
        );
        return rows.map((r) => r.type);
    }

    /**
     * Batch sibling of {@link getFiletypeAssociations} — one query for many
     * app ids, returns `Map<appId, string[]>` (every requested id is
     * present, with `[]` for apps that have no associations).
     */
    async getFiletypeAssociationsByIds(appIds) {
        const ids = Array.isArray(appIds)
            ? Array.from(
                  new Set(
                      appIds.filter((id) => id !== null && id !== undefined),
                  ),
              )
            : [];
        const out = new Map();
        for (const id of ids) out.set(id, []);
        if (ids.length === 0) return out;

        const placeholders = ids.map(() => '?').join(',');
        const rows = await this.clients.db.read(
            `SELECT \`app_id\`, \`type\` FROM \`app_filetype_association\`
             WHERE \`app_id\` IN (${placeholders})`,
            ids,
        );
        for (const row of rows) {
            const list = out.get(row.app_id);
            if (list) list.push(row.type);
        }
        return out;
    }

    async getAppsByFiletype(extension) {
        // Cache-on-read: first request after a miss pays the join, subsequent
        // reads inside the TTL window hit redis. `setFiletypeAssociations`
        // invalidates the affected extension explicitly so changes show up
        // immediately.
        const cacheKey = `${FILETYPE_CACHE_KEY_PREFIX}:${extension}`;
        try {
            const cached = await this.clients.redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // Fall through to DB on any cache failure.
        }

        const rows = await this.clients.db.read(
            `SELECT a.* FROM \`apps\` a
             INNER JOIN \`app_filetype_association\` fa ON fa.\`app_id\` = a.\`id\`
             WHERE fa.\`type\` = ?`,
            [extension],
        );
        const apps = rows.map((r) => this.#normalizeRow(r));

        this.clients.redis
            .set(
                cacheKey,
                JSON.stringify(apps),
                'EX',
                FILETYPE_CACHE_TTL_SECONDS,
            )
            .catch(() => {
                // Best-effort cache write.
            });

        return apps;
    }

    async getRecentAppOpens(userId, { limit = 10 } = {}) {
        const rows = await this.clients.db.read(
            `SELECT DISTINCT \`app_uid\` FROM \`app_opens\`
             WHERE \`user_id\` = ?
             GROUP BY \`app_uid\`
             ORDER BY MAX(\`_id\`) DESC
             LIMIT ${limit}`,
            [userId],
        );
        return rows.map((r) => r.app_uid);
    }

    async setFiletypeAssociations(appId, types) {
        // Replace-all semantics. Capture the previous extension set so we
        // can drop their cached app lists in addition to the new ones.
        const previous = await this.getFiletypeAssociations(appId);
        const newTypes = Array.isArray(types) ? types : [];

        // DELETE + multi-row INSERT in one transactional batch — partial
        // success would otherwise leave the row's filetype set in a state
        // that doesn't match either `previous` or `newTypes`.
        const entries = [
            {
                statement:
                    'DELETE FROM `app_filetype_association` WHERE `app_id` = ?',
                values: [appId],
            },
        ];
        if (newTypes.length > 0) {
            const placeholders = newTypes.map(() => '(?, ?)').join(', ');
            const values = newTypes.flatMap((t) => [appId, t]);
            entries.push({
                statement: `INSERT INTO \`app_filetype_association\` (\`app_id\`, \`type\`) VALUES ${placeholders}`,
                values,
            });
        }
        await this.clients.db.batchWrite(entries);

        const affected = new Set([...previous, ...newTypes]);
        if (affected.size === 0) return;
        const keys = [...affected].map(
            (t) => `${FILETYPE_CACHE_KEY_PREFIX}:${t}`,
        );
        await this.publishCacheKeys({ keys });
    }

    // ── Cache invalidation ───────────────────────────────────────────

    async invalidate(app) {
        const keys = this.#cacheKeysForApp(app);
        await this.publishCacheKeys({ keys });
    }

    async invalidateById(id) {
        const cached = await this.#readCache('id', id);
        if (cached) await this.invalidate(cached);
    }

    async invalidateByUid(uid) {
        const cached = await this.#readCache('uid', uid);
        if (cached) await this.invalidate(cached);
    }

    /** Resolve an app by either uid or name; tries uid first, then name. */
    async resolveApp(identifier) {
        return (
            (await this.getByUid(identifier)) ??
            (await this.getByName(identifier))
        );
    }

    // ── Internals ────────────────────────────────────────────────────

    async #getByProperty(prop, value) {
        if (value === undefined || value === null) return null;

        const cached = await this.#readCache(prop, value);
        if (cached) return cached;

        const normalized = await this.#readFromDb(prop, value);
        if (!normalized) return null;

        this.#writeCache(normalized).catch(() => {});
        return normalized;
    }

    async #readFromDb(prop, value) {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`apps\` WHERE \`${prop}\` = ? LIMIT 1`,
            [value],
        );
        if (rows.length === 0) return null;
        return this.#normalizeRow(rows[0]);
    }

    #cacheKey(prop, value) {
        return `${CACHE_KEY_PREFIX}:${prop}:${value}`;
    }

    #cacheKeysForApp(app) {
        const keys = [];
        for (const prop of APP_ID_PROPERTIES) {
            if (app[prop] !== undefined && app[prop] !== null) {
                keys.push(this.#cacheKey(prop, app[prop]));
            }
        }
        return keys;
    }

    async #readCache(prop, value) {
        try {
            const raw = await this.clients.redis.get(
                this.#cacheKey(prop, value),
            );
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async #writeCache(app) {
        const keys = this.#cacheKeysForApp(app);
        if (keys.length === 0) return;
        const serialized = JSON.stringify(app);
        await Promise.all(
            keys.map((k) =>
                this.clients.redis.set(k, serialized, 'EX', CACHE_TTL_SECONDS),
            ),
        );
    }

    async #refreshCache(app) {
        const keys = this.#cacheKeysForApp(app);
        if (keys.length === 0) return;
        await this.publishCacheKeys({
            keys,
            serializedData: JSON.stringify(app),
            ttlSeconds: CACHE_TTL_SECONDS,
        });
    }

    #filterEditable(fields) {
        const out = {};
        for (const [k, v] of Object.entries(fields)) {
            if (READ_ONLY_COLUMNS.has(k)) continue;
            out[k] = v;
        }
        return out;
    }

    #normalizeRow(row) {
        if (!row) return null;
        // Coerce booleans
        for (const key of [
            'godmode',
            'background',
            'maximize_on_start',
            'protected',
            'is_private',
            'approved_for_listing',
            'approved_for_opening_items',
            'approved_for_incentive_program',
        ]) {
            if (row[key] !== undefined) row[key] = Boolean(row[key]);
        }
        // Parse metadata
        if (typeof row.metadata === 'string') {
            try {
                row.metadata = JSON.parse(row.metadata);
            } catch {
                row.metadata = null;
            }
        }
        // Alias created_at
        if (row.timestamp !== undefined && row.created_at === undefined) {
            row.created_at = row.timestamp;
        }
        return row;
    }

    appStatsCachePrefix = 'appstats:';

    #openCountCacheKey(uid) {
        return `${this.appStatsCachePrefix}open:${uid}`;
    }
    #userCountCacheKey(uid) {
        return `${this.appStatsCachePrefix}user:${uid}`;
    }

    /**
     * Batched, cached all-time { open_count, user_count } for a set of apps.
     *
     * Flow: pipelined redis MGET → on miss, one ClickHouse (or MySQL) query
     * for all misses at once → backfill cache. Apps with no rows in
     * `app_opens` resolve to zero counts. Returns `Map<uid, stats>`.
     */
    async getAppsStats(appUids) {
        const uids = Array.isArray(appUids)
            ? [...new Set(appUids.filter((u) => typeof u === 'string' && u))]
            : [];
        const stats = new Map();
        if (uids.length === 0) return stats;

        let cacheResults = [];
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const uid of uids) {
                pipeline.get(this.#openCountCacheKey(uid));
                pipeline.get(this.#userCountCacheKey(uid));
            }
            cacheResults = (await pipeline.exec()) ?? [];
        } catch {
            // Fall through — treat everything as a miss.
        }

        const missing = [];
        for (let i = 0; i < uids.length; i++) {
            const uid = uids[i];
            const openEntry = cacheResults[i * 2];
            const userEntry = cacheResults[i * 2 + 1];
            const openVal = openEntry?.[1];
            const userVal = userEntry?.[1];
            if (openVal != null && userVal != null) {
                const o = parseInt(openVal, 10);
                const u = parseInt(userVal, 10);
                if (!Number.isNaN(o) && !Number.isNaN(u)) {
                    stats.set(uid, {
                        open_count: o,
                        user_count: u,
                        referral_count: null,
                    });
                    continue;
                }
            }
            missing.push(uid);
        }

        if (missing.length > 0) {
            const fresh = await this.#queryStatsForUids(missing);
            const writePipe = this.clients.redis.pipeline();
            for (const uid of missing) {
                const row = fresh.get(uid) ?? { open_count: 0, user_count: 0 };
                stats.set(uid, { ...row, referral_count: null });
                writePipe.set(
                    this.#openCountCacheKey(uid),
                    String(row.open_count),
                    'EX',
                    STATS_CACHE_TTL_SECONDS,
                );
                writePipe.set(
                    this.#userCountCacheKey(uid),
                    String(row.user_count),
                    'EX',
                    STATS_CACHE_TTL_SECONDS,
                );
            }
            writePipe.exec().catch(() => {});
        }

        return stats;
    }

    /**
     * Detailed / period-filtered / grouped stats for a single app.
     * Deliberately uncached — UI-driven, rarely repeated with the exact same
     * args, and ClickHouse is fast enough at interactive latency.
     *
     * @param {object} [options]
     * @param {string} [options.period='all'] — today, yesterday, 7d, 30d,
     *   this_week, last_week, this_month, last_month, this_year, last_year,
     *   12m, all
     * @param {string} [options.grouping] — hour, day, week, month, year
     * @param {number|string|Date} [options.createdAt] — app creation ts;
     *   used to bound the `all` period
     */
    async getAppStatsDetailed(appUid, options = {}) {
        const period = options.period ?? 'all';
        const grouping = options.grouping;
        const timeRange = this.#computeTimeRange(period, options.createdAt);
        const clickhouse = globalThis.clickhouseClient;

        if (grouping) {
            if (!MYSQL_DATE_FORMATS[grouping]) {
                throw new Error(
                    `Invalid grouping: ${grouping}. Supported: hour, day, week, month, year`,
                );
            }
            return this.#queryGroupedStats(
                appUid,
                timeRange,
                grouping,
                clickhouse,
            );
        }

        return this.#querySingleStats(appUid, timeRange, clickhouse);
    }

    // ── Stats internals ──────────────────────────────────────────────

    async #queryStatsForUids(uids) {
        const out = new Map();
        if (uids.length === 0) return out;

        const clickhouse = globalThis.clickhouseClient;
        if (clickhouse) {
            const res = await clickhouse.query({
                query: `
                    SELECT app_uid,
                           count(_id) AS open_count,
                           count(DISTINCT user_id) AS user_count
                    FROM app_opens
                    WHERE app_uid IN {uids:Array(String)}
                    GROUP BY app_uid
                `,
                query_params: { uids: uids.map((u) => String(u)) },
                format: 'JSONEachRow',
            });
            const rows = await res.json();
            for (const row of rows) {
                out.set(row.app_uid, {
                    open_count: parseInt(row.open_count, 10) || 0,
                    user_count: parseInt(row.user_count, 10) || 0,
                });
            }
            return out;
        }

        const placeholders = uids.map(() => '?').join(',');
        const rows = await this.clients.db.read(
            `SELECT app_uid,
                    COUNT(_id) AS open_count,
                    COUNT(DISTINCT user_id) AS user_count
             FROM app_opens
             WHERE app_uid IN (${placeholders})
             GROUP BY app_uid`,
            uids,
        );
        for (const row of rows) {
            out.set(row.app_uid, {
                open_count: parseInt(row.open_count, 10) || 0,
                user_count: parseInt(row.user_count, 10) || 0,
            });
        }
        return out;
    }

    async #querySingleStats(appUid, timeRange, clickhouse) {
        if (clickhouse) {
            const query_params = { appUid: String(appUid) };
            let timeCond = '';
            if (timeRange) {
                query_params.tsStart = Math.floor(timeRange.start / 1000);
                query_params.tsEnd = Math.floor(timeRange.end / 1000);
                timeCond = 'AND ts >= {tsStart:Int64} AND ts < {tsEnd:Int64}';
            }
            const res = await clickhouse.query({
                query: `
                    SELECT count(_id) AS open_count,
                           count(DISTINCT user_id) AS user_count
                    FROM app_opens
                    WHERE app_uid = {appUid:String}
                    ${timeCond}
                `,
                query_params,
                format: 'JSONEachRow',
            });
            const rows = await res.json();
            const row = rows[0] ?? { open_count: 0, user_count: 0 };
            return {
                open_count: parseInt(row.open_count, 10) || 0,
                user_count: parseInt(row.user_count, 10) || 0,
            };
        }

        // ts is stored as unix seconds; timeRange.start/end are ms.
        const params = timeRange
            ? [appUid, timeRange.start / 1000, timeRange.end / 1000]
            : [appUid];
        const where = timeRange ? 'AND ts >= ? AND ts < ?' : '';
        const rows = await this.clients.db.read(
            `SELECT COUNT(_id) AS open_count,
                    COUNT(DISTINCT user_id) AS user_count
             FROM app_opens
             WHERE app_uid = ? ${where}`,
            params,
        );
        const row = rows[0] ?? { open_count: 0, user_count: 0 };
        return {
            open_count: parseInt(row.open_count, 10) || 0,
            user_count: parseInt(row.user_count, 10) || 0,
            referral_count: null,
        };
    }

    async #queryGroupedStats(appUid, timeRange, grouping, clickhouse) {
        const allPeriods = this.#generateAllPeriods(
            new Date(timeRange.start),
            new Date(timeRange.end),
            grouping,
        );

        if (clickhouse) {
            const groupBy = CLICKHOUSE_GROUP_BY_FORMATS[grouping];
            const res = await clickhouse.query({
                query: `
                    SELECT ${groupBy} AS period,
                           count(_id) AS open_count,
                           count(DISTINCT user_id) AS user_count
                    FROM app_opens
                    WHERE app_uid = {appUid:String}
                    AND ts >= {tsStart:Int64} AND ts < {tsEnd:Int64}
                    GROUP BY period
                    ORDER BY period
                `,
                query_params: {
                    appUid: String(appUid),
                    tsStart: Math.floor(timeRange.start / 1000),
                    tsEnd: Math.floor(timeRange.end / 1000),
                },
                format: 'JSONEachRow',
            });
            const rows = await res.json();
            const processed = rows.map((r) => ({
                period: new Date(r.period),
                open_count: parseInt(r.open_count, 10) || 0,
                user_count: parseInt(r.user_count, 10) || 0,
            }));
            return this.#assembleGroupedResult(processed, allPeriods, grouping);
        }

        const timeFormat = MYSQL_DATE_FORMATS[grouping];
        const params = [appUid, timeRange.start / 1000, timeRange.end / 1000];
        // ts is stored as unix seconds — no /1000 in the date conversion.
        const periodExpr = this.clients.db.case({
            mysql: `DATE_FORMAT(FROM_UNIXTIME(ts), '${timeFormat}')`,
            sqlite: `STRFTIME('${timeFormat}', datetime(ts, 'unixepoch'))`,
            otherwise: `DATE_FORMAT(FROM_UNIXTIME(ts), '${timeFormat}')`,
        });
        const rows = await this.clients.db.read(
            `SELECT ${periodExpr} AS period,
                    COUNT(_id) AS open_count,
                    COUNT(DISTINCT user_id) AS user_count
             FROM app_opens
             WHERE app_uid = ? AND ts >= ? AND ts < ?
             GROUP BY period
             ORDER BY period`,
            params,
        );
        const processed = rows.map((r) => ({
            period: r.period,
            open_count: parseInt(r.open_count, 10) || 0,
            user_count: parseInt(r.user_count, 10) || 0,
        }));
        return this.#assembleGroupedResult(processed, allPeriods, grouping);
    }

    #assembleGroupedResult(rows, allPeriods, grouping) {
        // Totals come from raw rows so they survive even if a row's
        // period key fails to match an `allPeriods` entry (e.g. week
        // grouping format mismatches, timezone edge cases). Matches v1
        // AppInformationService.get_stats behaviour.
        let totalOpen = 0;
        let totalUser = 0;
        for (const r of rows) {
            totalOpen += r.open_count;
            totalUser += r.user_count;
        }
        const dataMap = new Map(
            rows.map((r) => [this.#normalizePeriodKey(r.period, grouping), r]),
        );
        const open = [];
        const user = [];
        for (const p of allPeriods) {
            const match = dataMap.get(p.period);
            open.push({ period: p.period, count: match?.open_count ?? 0 });
            user.push({ period: p.period, count: match?.user_count ?? 0 });
        }
        return {
            open_count: totalOpen,
            user_count: totalUser,
            grouped_stats: { open_count: open, user_count: user },
            referral_count: null,
        };
    }

    #normalizePeriodKey(period, grouping) {
        if (!(period instanceof Date)) return period;
        switch (grouping) {
            case 'hour':
                return `${period.toISOString().slice(0, 13)}:00:00`;
            case 'day':
                return period.toISOString().slice(0, 10);
            case 'week': {
                const wn = String(this.#getWeekNumber(period)).padStart(2, '0');
                return `${period.getFullYear()}-${wn}`;
            }
            case 'month':
                return period.toISOString().slice(0, 7);
            case 'year':
                return period.getFullYear().toString();
            default:
                return period.toISOString();
        }
    }

    #computeTimeRange(period, createdAt) {
        const now = new Date();
        const today = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
        );
        switch (period) {
            case 'today':
                return { start: today.getTime(), end: now.getTime() };
            case 'yesterday': {
                const y = new Date(today);
                y.setDate(y.getDate() - 1);
                return { start: y.getTime(), end: today.getTime() - 1 };
            }
            case '7d': {
                const s = new Date(now);
                s.setDate(s.getDate() - 7);
                return { start: s.getTime(), end: now.getTime() };
            }
            case '30d': {
                const s = new Date(now);
                s.setDate(s.getDate() - 30);
                return { start: s.getTime(), end: now.getTime() };
            }
            case 'this_week': {
                const s = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() - now.getDay(),
                );
                return { start: s.getTime(), end: now.getTime() };
            }
            case 'last_week': {
                const s = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() - now.getDay() - 7,
                );
                const e = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() - now.getDay(),
                );
                return { start: s.getTime(), end: e.getTime() - 1 };
            }
            case 'this_month': {
                const s = new Date(now.getFullYear(), now.getMonth(), 1);
                return { start: s.getTime(), end: now.getTime() };
            }
            case 'last_month': {
                const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const e = new Date(now.getFullYear(), now.getMonth(), 1);
                return { start: s.getTime(), end: e.getTime() - 1 };
            }
            case 'this_year': {
                const s = new Date(now.getFullYear(), 0, 1);
                return { start: s.getTime(), end: now.getTime() };
            }
            case 'last_year': {
                const s = new Date(now.getFullYear() - 1, 0, 1);
                const e = new Date(now.getFullYear(), 0, 1);
                return { start: s.getTime(), end: e.getTime() - 1 };
            }
            case '12m': {
                const s = new Date(now);
                s.setMonth(s.getMonth() - 12);
                return { start: s.getTime(), end: now.getTime() };
            }
            case 'all': {
                const start = createdAt ? new Date(createdAt).getTime() : 0;
                return { start, end: now.getTime() };
            }
            default:
                return { start: 0, end: now.getTime() };
        }
    }

    #generateAllPeriods(startDate, endDate, grouping) {
        const out = [];
        const cur = new Date(startDate);
        if (Number.isNaN(cur.getTime())) return out;
        while (cur <= endDate) {
            let period;
            switch (grouping) {
                case 'hour':
                    period = `${cur.toISOString().slice(0, 13)}:00:00`;
                    cur.setHours(cur.getHours() + 1);
                    break;
                case 'day':
                    period = cur.toISOString().slice(0, 10);
                    cur.setDate(cur.getDate() + 1);
                    break;
                case 'week': {
                    const wn = String(this.#getWeekNumber(cur)).padStart(
                        2,
                        '0',
                    );
                    period = `${cur.getFullYear()}-${wn}`;
                    cur.setDate(cur.getDate() + 7);
                    break;
                }
                case 'month':
                    period = cur.toISOString().slice(0, 7);
                    cur.setMonth(cur.getMonth() + 1);
                    break;
                case 'year':
                    period = cur.getFullYear().toString();
                    cur.setFullYear(cur.getFullYear() + 1);
                    break;
                default:
                    return out;
            }
            out.push({ period, count: 0 });
        }
        return out;
    }

    #getWeekNumber(date) {
        const target = new Date(date.valueOf());
        const dayNumber = (date.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNumber + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }

    // ── Refresh loop ─────────────────────────────────────────────────

    async #refreshAppStats() {
        // Cross-instance lock: if another node refreshed within the window,
        // skip. TTL slightly longer than the interval so the guard survives
        // jitter in the setInterval drift.
        try {
            const last = parseInt(
                (await this.clients.redis.get(STATS_REFRESH_LOCK_KEY)) || '0',
                10,
            );
            const now = Date.now();
            if (now - last < STATS_REFRESH_INTERVAL_MS) return;
            await this.clients.redis.set(
                STATS_REFRESH_LOCK_KEY,
                String(now),
                'EX',
                Math.floor(STATS_REFRESH_INTERVAL_MS / 1000) + 60,
            );
        } catch {
            // Keep going — better to over-refresh than miss updates entirely.
        }

        const clickhouse = globalThis.clickhouseClient;
        let rows;
        try {
            if (clickhouse) {
                const res = await clickhouse.query({
                    query: `
                        SELECT app_uid,
                               count(_id) AS open_count,
                               count(DISTINCT user_id) AS user_count
                        FROM app_opens
                        GROUP BY app_uid
                    `,
                    format: 'JSONEachRow',
                });
                rows = await res.json();
            } else {
                rows = await this.clients.db.read(
                    `SELECT app_uid,
                            COUNT(_id) AS open_count,
                            COUNT(DISTINCT user_id) AS user_count
                     FROM app_opens
                     GROUP BY app_uid`,
                );
            }
        } catch (e) {
            console.warn('[AppStore] refresh app stats failed:', e);
            return;
        }

        if (!rows?.length) return;

        try {
            const pipeline = this.clients.redis.pipeline();
            for (const row of rows) {
                if (!row.app_uid) continue;
                pipeline.set(
                    this.#openCountCacheKey(row.app_uid),
                    String(parseInt(row.open_count, 10) || 0),
                    'EX',
                    STATS_CACHE_TTL_SECONDS,
                );
                pipeline.set(
                    this.#userCountCacheKey(row.app_uid),
                    String(parseInt(row.user_count, 10) || 0),
                    'EX',
                    STATS_CACHE_TTL_SECONDS,
                );
            }
            await pipeline.exec();
        } catch (e) {
            console.warn('[AppStore] refresh app stats cache write failed:', e);
        }
    }

    onServerStart() {
        // Kick off one refresh immediately so the cache is warm before the
        // first client request (failing silently is fine — getAppsStats
        // falls back to an on-demand query).
        this.#refreshAppStats().catch(() => {});
        // Jitter prevents every node refreshing on the same tick when a
        // cluster boots together.
        this.#appStatsInterval = setInterval(
            () => {
                this.#refreshAppStats().catch(() => {});
            },
            STATS_REFRESH_INTERVAL_MS + Math.floor(Math.random() * 500),
        );
    }

    onServerShutdown() {
        if (this.#appStatsInterval) {
            clearInterval(this.#appStatsInterval);
            this.#appStatsInterval = undefined;
        }
    }
}
