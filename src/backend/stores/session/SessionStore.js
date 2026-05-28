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

// `updateActivity` / `updateUserActivity` intentionally skip cache
// invalidation — they're throttled UPDATEs, stale `last_activity` in
// the cached row doesn't gate anything, and eating a Redis write per
// request isn't worth it.

// Prefix is versioned so a schema change (new columns added to the
// row shape) doesn't leak stale cached rows through Redis on a
// rolling deploy. Bump the suffix on the next schema change.
const CACHE_KEY_PREFIX = 'sessions:v2';
const CACHE_TTL_SECONDS = 15 * 60;
// Min interval between successive activity flushes per session/user.
// In-memory throttle keeps DB writes bounded; multi-node duplicates
// are harmless because the SQL guard `last_activity < ?` makes the
// UPDATE idempotent.
const TOUCH_THROTTLE_MS = 60 * 1000;
// Hard cap to keep the throttle map from growing unbounded for
// long-lived processes. Clearing only loses throttling — at worst a
// brief burst of redundant UPDATEs.
const TOUCH_THROTTLE_MAX_ENTRIES = 10000;

// Per-kind sliding-expiry windows. The `touch` path bumps `expires_at`
// to `now + window` for the session's kind on activity, so an active
// session never expires. `access_token` rows are *not* slid — their
// `expires_at` is hard-set at mint to the caller-specified value.
// Exported so AuthService can use the same values when seeding new rows.
export const WEB_WINDOW_SECONDS = 365 * 24 * 60 * 60; // 1y
export const APP_WINDOW_SECONDS = 365 * 24 * 60 * 60; // 1y
export const WORKER_WINDOW_SECONDS = 99 * 365 * 24 * 60 * 60; // 99y (virtually infinite);

// Duplicate-key error codes used by the `getOrCreate*` paths to detect
// "another caller won the partial-unique-index race" — the only error
// category they're prepared to silently no-op through. CHECK / NOT NULL /
// FK / type violations must bubble up; otherwise the caller caches a
// row that was never inserted.
//   better-sqlite3 surfaces SqliteError.code; mysql2 surfaces .code and
//   .errno (1062 = ER_DUP_ENTRY); pg surfaces SQLSTATE 23505.
function isUniqueViolation(err) {
    if (!err) return false;
    const code = err.code;
    if (
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === 'ER_DUP_ENTRY' ||
        code === '23505'
    ) {
        return true;
    }
    return err.errno === 1062;
}
export const ASSET_WINDOW_SECONDS = 7 * 24 * 60 * 60; // 7 days

const sqlTimestamp = (ms) =>
    new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** True when a row's `expires_at` has passed. NULL == no row-level expiry. */
const isExpired = (row, now = nowSeconds()) =>
    row?.expires_at != null && row.expires_at <= now;

export class SessionStore extends PuterStore {
    #lastSessionTouchMs = new Map();
    #lastUserTouchMs = new Map();

    /**
     * Look up an active session by its uuid. Returns `null` if not
     * found, soft-revoked, or past its `expires_at`. The cached row is
     * gated by both `revoked_at` and `expires_at` so a stale-but-
     * expired row in cache doesn't grant access.
     */
    async getByUuid(uuid) {
        const row = await this.getByUuidAny(uuid);
        if (!row) return null;
        if (row.revoked_at != null) return null;
        if (isExpired(row, nowSeconds())) return null;
        return row;
    }

    async getByUuidAny(uuid) {
        if (!uuid) return null;

        const cached = await this.#readCache(uuid);
        if (cached) return cached;

        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [uuid],
        );
        const normalized = this.#normalizeRow(rows[0]);
        if (!normalized) return null;

        this.#writeCache(normalized).catch(() => {});
        return normalized;
    }

    /**
     * Get sessions for a user. By default returns only active rows;
     * pass `{ includeRevoked: true }` to include soft-revoked rows.
     */
    async getByUserId(userId, { includeRevoked = false } = {}) {
        const sql = includeRevoked
            ? 'SELECT * FROM `sessions` WHERE `user_id` = ?'
            : 'SELECT * FROM `sessions` WHERE `user_id` = ? AND `revoked_at` IS NULL';
        const rows = await this.clients.db.read(sql, [userId]);
        return rows.map((r) => this.#normalizeRow(r)).filter(Boolean);
    }

    /**
     * Create a new session row.
     *
     * @param userId - User ID (numeric)
     * @param opts.meta - Request-context metadata (IP, UA, etc.) stored as JSON.
     * @param opts.kind - 'web' (default), 'app', 'access_token', 'asset'.
     * @param opts.label - User-editable label for manage-sessions UI.
     * @param opts.parent_session_id - uuid of root session, for derived kinds.
     * @param opts.last_ip - Request IP at creation.
     * @param opts.last_user_agent - Request User-Agent at creation.
     * @param opts.expires_at - Row-level expiry (unix seconds). NULL means
     *   no row-level expiry (used for `access_token` rows whose JWT `exp`
     *   is the truth). Sliding kinds (web/app/asset) get this populated by
     *   the caller per the lifetime table; `touch()` then slides it.
     * @param opts.app_uid - App UID this row authorizes. Only set for
     *   `kind='app'`; participates in the (user_id, app_uid) idempotency
     *   index.
     * @param opts.legacy_token_uid - v1 token_uid this row backfills.
     *   Only set for `created_via='legacy_backfill'`.
     * @param opts.access_token_uid - For `kind='access_token'` v2 rows: the
     *   `token_uid` claim that lives in `access_token_permissions`. Lets
     *   raw-uuid revoke reverse-find the session row when no JWT was
     *   presented.
     * @param opts.created_via - Audit sentinel (e.g. 'legacy_backfill').
     * @param opts.auth_id - Stable per-user identity (survives re-login);
     *   carried on every v2 JWT so manage-sessions can group by identity.
     * @returns The created session row.
     */
    async create(userId, opts = {}) {
        return this.#insertSession(userId, opts, { ignoreConflict: false });
    }

    /**
     * Shared INSERT implementation for `create()` and the idempotent
     * `getOrCreate*` paths. With `ignoreConflict: true`, only a duplicate-
     * key error from the partial unique indexes is swallowed (concurrent
     * caller won the race); every other failure — CHECK, NOT NULL, FK,
     * type — throws. The caller then re-SELECTs to find the winning row.
     */
    async #insertSession(
        userId,
        {
            meta = {},
            kind = 'web',
            label = null,
            parent_session_id = null,
            last_ip = null,
            last_user_agent = null,
            expires_at = null,
            app_uid = null,
            legacy_token_uid = null,
            access_token_uid = null,
            created_via = null,
            auth_id = null,
        } = {},
        { ignoreConflict = false } = {},
    ) {
        const uuid = uuidv4();
        const now = nowSeconds();

        meta.created = new Date().toISOString();
        meta.created_unix = now;

        // Always issue a plain INSERT. The `getOrCreate*` paths set
        // ignoreConflict=true so the partial-unique-index race against a
        // concurrent caller can no-op, but only that specific error class
        // is swallowed — every other failure (CHECK, NOT NULL, FK, type)
        // bubbles up. Engine-specific INSERT-IGNORE swallowed all
        // constraint violations, which masked schema bugs as "row didn't
        // appear in the DB but the caller cached a synthetic row anyway".
        try {
            await this.clients.db.write(
                `INSERT INTO \`sessions\` (\`uuid\`, \`user_id\`, \`meta\`, \`last_activity\`, \`created_at\`, \`kind\`, \`label\`, \`parent_session_id\`, \`last_ip\`, \`last_user_agent\`, \`expires_at\`, \`app_uid\`, \`legacy_token_uid\`, \`access_token_uid\`, \`created_via\`, \`auth_id\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    uuid,
                    userId,
                    JSON.stringify(meta),
                    now,
                    now,
                    kind,
                    label,
                    parent_session_id,
                    last_ip,
                    last_user_agent,
                    expires_at,
                    app_uid,
                    legacy_token_uid,
                    access_token_uid,
                    created_via,
                    auth_id,
                ],
            );
        } catch (err) {
            if (!ignoreConflict || !isUniqueViolation(err)) {
                throw err;
            }
            // Concurrent caller won the partial-unique-index race. The
            // caller's re-SELECT will return that winning row; the local
            // `row` object below is a placeholder for the caller's
            // `winner ?? created` fallback shape and is never cached on
            // the ignoreConflict path.
        }

        const row = {
            uuid,
            user_id: userId,
            meta,
            created_at: now,
            last_activity: now,
            kind,
            label,
            parent_session_id,
            last_ip,
            last_user_agent,
            revoked_at: null,
            expires_at,
            app_uid,
            legacy_token_uid,
            access_token_uid,
            created_via,
            auth_id,
        };

        // Warm the uuid cache so the immediately-following verify hits
        // Redis instead of the DB. Note: in the ignoreConflict path this
        // may warm a row that wasn't actually inserted (concurrent racer
        // won). That's harmless — the idempotent caller re-SELECTs and
        // overwrites the cache with the winning row.
        if (!ignoreConflict) {
            this.#writeCache(row).catch(() => {});
        }

        return row;
    }

    /**
     * Rename a session's label. Ownership is enforced via the user_id
     * filter — a label edit by user A can't touch a row owned by user B
     * even if A guesses B's session uuid.
     *
     * Returns `true` when a row was updated, `false` when no row matched
     * the (uuid, user_id) pair (either the uuid doesn't exist, the row
     * belongs to another user, or it's already soft-revoked).
     */
    async setLabel(uuid, userId, label) {
        if (!uuid || !userId) return false;
        const result = await this.clients.db.write(
            'UPDATE `sessions` SET `label` = ? WHERE `uuid` = ? AND `user_id` = ? AND `revoked_at` IS NULL',
            [label, uuid, userId],
        );
        const affected = result?.affectedRows ?? 0;
        if (affected > 0) {
            // Invalidate every cached view onto the row so the next read
            // (manage-sessions reload, /whoami, etc.) sees the new label.
            const rows = await this.clients.db.read(
                'SELECT `uuid`, `user_id`, `kind`, `app_uid`, `legacy_token_uid`, `meta`, `created_via`, `last_ip`, `last_user_agent` FROM `sessions` WHERE `uuid` = ? LIMIT 1',
                [uuid],
            );
            if (rows[0]) {
                await this.publishCacheKeys({
                    keys: this.#allCacheKeysForRow(rows[0]),
                    broadcast: true,
                });
            }
        }
        return affected > 0;
    }

    /**
     * Soft-revoke a session by uuid. The row remains in the table
     * with `revoked_at` set; subsequent `getByUuid` calls treat it
     * as not found. Invalidates the uuid cache and every composite
     * cache key that pointed at this row (app / legacy-token), so a
     * subsequent re-auth doesn't get a stale "already authorized"
     * mapping.
     */
    async removeByUuid(uuid) {
        if (!uuid) return;

        // SELECT first so we know which composite cache keys point at
        // this row. A single UPDATE ... RETURNING would be cleaner but
        // isn't portable between sqlite/mysql.
        // `meta` included so #allCacheKeysForRow can read
        // meta.worker_name for the worker cache key; without it the
        // composite worker cache entry would survive revocation and
        // getOrCreateWorker would serve the stale (revoked) row for
        // up to CACHE_TTL_SECONDS. `created_via` + `last_ip` +
        // `last_user_agent` ride along for the symmetric legacy-web
        // key derivation.
        const rows = await this.clients.db.read(
            'SELECT `uuid`, `user_id`, `kind`, `app_uid`, `legacy_token_uid`, `meta`, `created_via`, `last_ip`, `last_user_agent` FROM `sessions` WHERE `uuid` = ? AND `revoked_at` IS NULL LIMIT 1',
            [uuid],
        );
        if (rows.length === 0) return;

        // Double-delete pattern: invalidate the cache BEFORE the SQL
        // UPDATE, then again after. The pre-DEL drops any cached
        // active-row view so a concurrent reader between the DEL and the
        // UPDATE goes to the DB (seeing the still-active row is fine —
        // that's the truth at that instant). The post-DEL clears any
        // entry a racer might have re-cached during the window. Pays
        // one extra pipelined DEL per revoke; revokes are rare so the
        // cost is negligible.
        const keys = this.#allCacheKeysForRow(rows[0]);
        await this.publishCacheKeys({ keys, broadcast: true });

        const now = nowSeconds();
        await this.clients.db.write(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE `uuid` = ? AND `revoked_at` IS NULL',
            [now, uuid],
        );
        await this.publishCacheKeys({ keys, broadcast: true });
    }

    /**
     * Soft-revoke a root session and every derived session that
     * points back to it via `parent_session_id`. Broadcasts cache
     * invalidation for each affected row's uuid + composite keys.
     */
    async revokeCascade(rootUuid) {
        if (!rootUuid) return;

        // Read each affected row's identity columns up-front — every
        // composite cache mapping (app, legacy-token, legacy-web) must
        // be invalidated alongside the uuid key, otherwise a follow-up
        // `getOrCreateApp` / `findOrCreateLegacyWeb` would short-circuit
        // to the freshly-revoked row.
        const rows = await this.clients.db.read(
            'SELECT `uuid`, `user_id`, `kind`, `app_uid`, `legacy_token_uid`, `meta`, `created_via`, `last_ip`, `last_user_agent` FROM `sessions` WHERE (`uuid` = ? OR `parent_session_id` = ?) AND `revoked_at` IS NULL',
            [rootUuid, rootUuid],
        );
        if (rows.length === 0) return;

        // Double-delete: see `removeByUuid` for rationale.
        const keys = [];
        for (const r of rows) keys.push(...this.#allCacheKeysForRow(r));
        await this.publishCacheKeys({ keys, broadcast: true });

        const now = nowSeconds();
        await this.clients.db.write(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE (`uuid` = ? OR `parent_session_id` = ?) AND `revoked_at` IS NULL',
            [now, rootUuid, rootUuid],
        );

        await this.publishCacheKeys({ keys, broadcast: true });
    }

    /**
     * Active session row whose access-token identity matches `tokenUid`.
     * Covers both v2 (`access_token_uid` set at mint) and v1 lazy-backfill
     * (`legacy_token_uid` set on first verify) rows so raw-uuid revoke can
     * find the row regardless of whether the token was originally v1 or v2.
     * Returns `null` if no active row matches.
     */
    async findActiveByAccessTokenUid(tokenUid) {
        if (!tokenUid) return null;
        const now = nowSeconds();
        const rows = await this.clients.db.read(
            "SELECT * FROM `sessions` WHERE `kind` = 'access_token' AND (`access_token_uid` = ? OR `legacy_token_uid` = ?) AND `revoked_at` IS NULL AND (`expires_at` IS NULL OR `expires_at` > ?) ORDER BY `id` DESC LIMIT 1",
            [tokenUid, tokenUid, now],
        );
        return this.#normalizeRow(rows[0]);
    }

    /**
     * Idempotent "give me the app session for this (user, app)" lookup.
     * Returns the existing active app session if one exists, or creates
     * a new one. Concurrent callers converge on a single row via the
     * partial unique index `idx_sessions_user_app_active`.
     *
     * Cache flow:
     *   1. Try `sessions:v2:app:<userId>:<appUid>` (full row).
     *   2. If miss, SELECT; on hit, warm both composite + uuid cache.
     *   3. If still nothing, INSERT (idempotent under concurrency); the
     *      losing racer falls through to SELECT and finds the winner's
     *      row.
     *
     * @param userId - User row id (numeric).
     * @param appUid - App UID (string).
     * @param opts.last_ip / opts.last_user_agent - Request context for
     *   first-time creation. Ignored when a row already exists.
     * @param opts.auth_id - Stable per-user identity (survives re-login);
     *   carried on every v2 JWT so manage-sessions can group by identity.
     */
    async getOrCreateApp(userId, appUid, opts = {}) {
        if (!userId || !appUid) return null;

        const cacheKey = this.#cacheKeyApp(userId, appUid);
        const now = nowSeconds();

        const cached = await this.#readCacheKey(cacheKey);
        if (cached && cached.revoked_at == null && !isExpired(cached, now)) {
            return cached;
        }

        const existing = await this.#selectAppRow(userId, appUid);
        if (existing) {
            await this.#writeCacheKey(cacheKey, existing);
            this.#writeCache(existing).catch(() => {});
            return existing;
        }

        // INSERT-or-IGNORE so concurrent racers don't throw on the
        // partial unique index; we re-SELECT below to find the row
        // that actually won.
        const created = await this.#insertSession(
            userId,
            {
                kind: 'app',
                app_uid: appUid,
                parent_session_id: null,
                last_ip: opts.last_ip ?? null,
                last_user_agent: opts.last_user_agent ?? null,
                expires_at: now + APP_WINDOW_SECONDS,
                auth_id: opts.auth_id ?? null,
                created_via: opts.created_via ?? null,
                meta: opts.meta ?? {},
            },
            { ignoreConflict: true },
        );

        const winner = await this.#selectAppRow(userId, appUid);
        const row = winner ?? created;
        await this.#writeCacheKey(cacheKey, row);
        this.#writeCache(row).catch(() => {});
        return row;
    }

    /**
     * Idempotent "give me the worker session for this (user, app,
     * worker_name)" lookup. Same shape as `getOrCreateApp` but keyed on
     * a triple so multiple workers can sit under the same app (each
     * with its own `worker_name`) and each gets its own session row.
     *
     * `appUid` is allowed null for user-scoped workers — the partial
     * unique index treats those distinctly (SQLite via NULL-distinct
     * semantics, MySQL/Postgres via COALESCE in the generated key).
     *
     * @param userId - User row id (numeric).
     * @param opts.appUid - App UID or null for user-scoped workers.
     * @param opts.workerName - Per-worker discriminator. Required.
     * @param opts.meta - Additional metadata merged into the row's
     *   `meta` blob alongside the canonical `worker: true` and
     *   `worker_name` markers.
     * @param opts.last_ip / opts.last_user_agent - Request context for
     *   first-time creation. Ignored when a row already exists.
     * @param opts.auth_id - Stable per-user identity (survives re-login).
     */
    async getOrCreateWorker(userId, opts = {}) {
        if (!userId || !opts.workerName) return null;
        const appUid = opts.appUid ?? null;
        const workerName = String(opts.workerName);

        const cacheKey = this.#cacheKeyWorker(userId, appUid, workerName);
        const now = nowSeconds();

        const cached = await this.#readCacheKey(cacheKey);
        if (cached && cached.revoked_at == null && !isExpired(cached, now)) {
            return cached;
        }

        const existing = await this.#selectWorkerRow(
            userId,
            appUid,
            workerName,
        );
        if (existing) {
            await this.#writeCacheKey(cacheKey, existing);
            this.#writeCache(existing).catch(() => {});
            return existing;
        }

        const created = await this.#insertSession(
            userId,
            {
                kind: 'worker',
                app_uid: appUid,
                parent_session_id: null,
                last_ip: opts.last_ip ?? null,
                last_user_agent: opts.last_user_agent ?? null,
                expires_at: now + WORKER_WINDOW_SECONDS,
                auth_id: opts.auth_id ?? null,
                meta: {
                    ...(opts.meta ?? {}),
                    worker: true,
                    worker_name: workerName,
                },
            },
            { ignoreConflict: true },
        );

        // INSERT-IGNORE may have lost the race against another caller;
        // re-SELECT under the partial unique index to find whichever
        // row actually won.
        const winner = await this.#selectWorkerRow(userId, appUid, workerName);
        const row = winner ?? created;
        await this.#writeCacheKey(cacheKey, row);
        this.#writeCache(row).catch(() => {});
        return row;
    }

    /**
     * Idempotent "give me the lazy-backfill row for this v1 token_uid"
     * lookup. Mirrors `getOrCreateApp` but keys on `legacy_token_uid`.
     */
    async findOrCreateLegacyAccessToken(tokenUid, opts = {}) {
        if (!tokenUid || !opts.userId) return null;

        const cacheKey = this.#cacheKeyLegacyAt(tokenUid);
        const now = nowSeconds();

        const cached = await this.#readCacheKey(cacheKey);
        if (cached && cached.revoked_at == null && !isExpired(cached, now)) {
            return cached;
        }

        const existing = await this.#selectLegacyAccessTokenRow(tokenUid);
        if (existing) {
            await this.#writeCacheKey(cacheKey, existing);
            this.#writeCache(existing).catch(() => {});
            return existing;
        }

        const created = await this.#insertSession(
            opts.userId,
            {
                kind: 'access_token',
                parent_session_id: opts.parent_session_id ?? null,
                last_ip: opts.last_ip ?? null,
                last_user_agent: opts.last_user_agent ?? null,
                expires_at: opts.expires_at ?? null,
                legacy_token_uid: tokenUid,
                created_via: 'legacy_backfill',
                auth_id: opts.auth_id ?? null,
            },
            { ignoreConflict: true },
        );

        const winner = await this.#selectLegacyAccessTokenRow(tokenUid);
        const row = winner ?? created;
        await this.#writeCacheKey(cacheKey, row);
        this.#writeCache(row).catch(() => {});
        return row;
    }

    /**
     * Best-effort lazy-backfill row for a v1 web session. The keying tuple
     * is `(user_id, last_ip, last_user_agent)` — a UA/IP shift on a
     * roaming client produces a fresh row, which is the spec's accepted
     * trade-off.
     *
     * No partial unique index exists for this tuple (a UA string is too
     * variable to index), so concurrent racers can both INSERT. We
     * resolve via an optimistic-lock pass: after our INSERT we re-SELECT
     * the oldest matching row; if we lost the race, soft-revoke our own
     * row and return the winner so every caller converges on a single
     * `session_uuid`. Cheap (one extra SELECT per legacy-backfill mint,
     * which only runs on the first contact from a stale v1 client).
     */
    async findOrCreateLegacyWeb(opts = {}) {
        if (!opts.userId) return null;

        const ip = opts.last_ip ?? null;
        const ua = opts.last_user_agent ?? null;
        const cacheKey = this.#cacheKeyLegacyWeb(opts.userId, ip, ua);
        const now = nowSeconds();

        const cached = await this.#readCacheKey(cacheKey);
        if (cached && cached.revoked_at == null && !isExpired(cached, now)) {
            return cached;
        }

        const coalesceLastIp = this.clients.db.nullCoalesce('`last_ip`', "''");
        const coalesceBoundIp = this.clients.db.nullCoalesce('?', "''");
        const coalesceLastUserAgent = this.clients.db.nullCoalesce(
            '`last_user_agent`',
            "''",
        );
        const coalesceBoundUserAgent = this.clients.db.nullCoalesce('?', "''");
        const selectOldest = () =>
            this.clients.db.read(
                `SELECT * FROM \`sessions\` WHERE \`kind\` = 'web' AND \`user_id\` = ? AND \`created_via\` = 'legacy_backfill' AND ${coalesceLastIp} = ${coalesceBoundIp} AND ${coalesceLastUserAgent} = ${coalesceBoundUserAgent} AND \`revoked_at\` IS NULL AND (\`expires_at\` IS NULL OR \`expires_at\` > ?) ORDER BY \`id\` ASC LIMIT 1`,
                [opts.userId, ip, ua, now],
            );

        const rows = await selectOldest();
        const existing = this.#normalizeRow(rows[0]);
        if (existing) {
            await this.#writeCacheKey(cacheKey, existing);
            this.#writeCache(existing).catch(() => {});
            return existing;
        }

        const created = await this.create(opts.userId, {
            kind: 'web',
            last_ip: ip,
            last_user_agent: ua,
            expires_at: now + WEB_WINDOW_SECONDS,
            created_via: 'legacy_backfill',
            auth_id: opts.auth_id ?? null,
        });

        // Optimistic conflict resolution: re-SELECT the oldest row that
        // matches the same tuple. If a concurrent racer beat us to the
        // INSERT, fold to their row and revoke ours so the (rare) pair
        // doesn't both linger for a year. `removeByUuid` is a no-op when
        // the row was already revoked by a third party.
        const winnerRows = await selectOldest();
        const winner = this.#normalizeRow(winnerRows[0]);
        if (winner && winner.uuid !== created.uuid) {
            await this.removeByUuid(created.uuid);
            await this.#writeCacheKey(cacheKey, winner);
            this.#writeCache(winner).catch(() => {});
            return winner;
        }

        await this.#writeCacheKey(cacheKey, created);
        // uuid cache already warmed by create()
        return created;
    }

    /**
     * Bump `last_activity` and slide `expires_at` per the row's kind in a
     * single UPDATE. Sliding kinds (web/app/asset) get their `expires_at`
     * extended to `now + window`; `access_token` (and unknown kinds) keep
     * their existing `expires_at` (hard expiry). The `last_activity < ?`
     * guard makes the UPDATE idempotent across nodes so concurrent touches
     * don't fight.
     *
     * When `ip` / `userAgent` are provided and differ from the stored
     * values, they are written into `last_ip` / `last_user_agent` in the
     * same UPDATE — and the uuid cache is invalidated so the next read
     * doesn't serve the pre-roam values. Unchanged values are no-ops at
     * the SQL level (the CASE guards keep the column write conditional)
     * and skip the cache invalidate.
     */
    async updateActivity(
        uuid,
        lastActivity,
        { ip = null, userAgent = null } = {},
    ) {
        const webExpires = lastActivity + WEB_WINDOW_SECONDS;
        const appExpires = lastActivity + APP_WINDOW_SECONDS;
        const assetExpires = lastActivity + ASSET_WINDOW_SECONDS;
        await this.clients.db.write(
            'UPDATE `sessions` SET `last_activity` = ?, `expires_at` = CASE `kind` ' +
                "WHEN 'web' THEN ? " +
                "WHEN 'app' THEN ? " +
                "WHEN 'asset' THEN ? " +
                'ELSE `expires_at` ' +
                'END, ' +
                '`last_ip` = CASE WHEN ? IS NOT NULL AND (`last_ip` IS NULL OR `last_ip` <> ?) THEN ? ELSE `last_ip` END, ' +
                '`last_user_agent` = CASE WHEN ? IS NOT NULL AND (`last_user_agent` IS NULL OR `last_user_agent` <> ?) THEN ? ELSE `last_user_agent` END ' +
                'WHERE `uuid` = ? AND (`last_activity` IS NULL OR `last_activity` < ?)',
            [
                lastActivity,
                webExpires,
                appExpires,
                assetExpires,
                ip,
                ip,
                ip,
                userAgent,
                userAgent,
                userAgent,
                uuid,
                lastActivity,
            ],
        );

        // When IP or UA actually changed, the cached row at
        // `sessions:v2:uuid:<uuid>` is now stale (it carries the old
        // `last_ip` / `last_user_agent`). Manage-sessions reads off the
        // cached row, so without this invalidate the UI keeps showing the
        // pre-roam values until the 15-minute TTL expires.
        if (ip != null || userAgent != null) {
            const cached = await this.#readCache(uuid);
            if (cached) {
                const ipChanged = ip != null && cached.last_ip !== ip;
                const uaChanged =
                    userAgent != null && cached.last_user_agent !== userAgent;
                if (ipChanged || uaChanged) {
                    await this.publishCacheKeys({
                        keys: [this.#cacheKey(uuid)],
                        broadcast: true,
                    });
                }
            }
        }
    }

    /** Update user-level last activity timestamp. */
    async updateUserActivity(userId, lastActivityTs) {
        await this.clients.db.write(
            'UPDATE `user` SET `last_activity_ts` = ? WHERE `id` = ? AND (`last_activity_ts` IS NULL OR `last_activity_ts` < ?)',
            [lastActivityTs, userId, lastActivityTs],
        );
    }

    /**
     * Best-effort throttled activity touch. Updates the session row's
     * `last_activity` column and the owning user's `user.last_activity_ts`
     * if either hasn't been touched within `TOUCH_THROTTLE_MS`.
     *
     * When `ip` / `userAgent` are passed, they ride along into
     * `updateActivity` so a roaming session also refreshes its
     * `last_ip` / `last_user_agent`. Throttle still applies — the IP/UA
     * fields only get a chance to update once per `TOUCH_THROTTLE_MS`.
     *
     * Callers fire-and-forget — failures are swallowed.
     *
     * @param {{uuid?: string, userId?: number, ip?: string|null, userAgent?: string|null}} [args]
     */
    async touch({ uuid, userId, ip = null, userAgent = null } = {}) {
        const nowMs = Date.now();

        const sessionDue =
            uuid &&
            nowMs - (this.#lastSessionTouchMs.get(uuid) ?? 0) >=
                TOUCH_THROTTLE_MS;
        const userDue =
            userId &&
            nowMs - (this.#lastUserTouchMs.get(userId) ?? 0) >=
                TOUCH_THROTTLE_MS;

        if (!sessionDue && !userDue) return;

        // Reserve the throttle slot before awaiting so concurrent
        // callers on the same node coalesce.
        if (sessionDue) {
            if (this.#lastSessionTouchMs.size >= TOUCH_THROTTLE_MAX_ENTRIES) {
                this.#lastSessionTouchMs.clear();
            }
            this.#lastSessionTouchMs.set(uuid, nowMs);
        }
        if (userDue) {
            if (this.#lastUserTouchMs.size >= TOUCH_THROTTLE_MAX_ENTRIES) {
                this.#lastUserTouchMs.clear();
            }
            this.#lastUserTouchMs.set(userId, nowMs);
        }

        const tasks = [];
        if (sessionDue) {
            tasks.push(
                this.updateActivity(uuid, Math.floor(nowMs / 1000), {
                    ip,
                    userAgent,
                }).catch(() => {}),
            );
        }
        if (userDue) {
            tasks.push(
                this.updateUserActivity(userId, sqlTimestamp(nowMs)).catch(
                    () => {},
                ),
            );
        }
        await Promise.all(tasks);
    }

    // -- Internals ---------------------------------------------------

    #cacheKey(uuid) {
        return `${CACHE_KEY_PREFIX}:uuid:${uuid}`;
    }

    #cacheKeyApp(userId, appUid) {
        return `${CACHE_KEY_PREFIX}:app:${userId}:${appUid}`;
    }

    #cacheKeyLegacyAt(tokenUid) {
        return `${CACHE_KEY_PREFIX}:legacy-at:${tokenUid}`;
    }

    /**
     * Cache key for the (user, app, worker_name) worker-session triple.
     * `app_uid` is encoded as empty-string for user-scoped workers so
     * the namespace doesn't fracture on NULL.
     */
    #cacheKeyWorker(userId, appUid, workerName) {
        return `${CACHE_KEY_PREFIX}:worker:${userId}:${appUid ?? ''}:${workerName}`;
    }

    /**
     * Cache key for the (legacy-web) backfill lookup. IP and UA are
     * percent-encoded into a single key segment so a UA containing `:`
     * doesn't fracture the namespace.
     */
    #cacheKeyLegacyWeb(userId, ip, ua) {
        const tag = encodeURIComponent(`${ip ?? ''}|${ua ?? ''}`);
        return `${CACHE_KEY_PREFIX}:legacy-web:${userId}:${tag}`;
    }

    /**
     * Every cache key currently mapped to a given row. Used by revoke
     * paths so a single revocation invalidates every cached view onto
     * the same row in lockstep.
     */
    #allCacheKeysForRow(row) {
        if (!row?.uuid) return [];
        const keys = [this.#cacheKey(row.uuid)];
        if (row.kind === 'app' && row.user_id && row.app_uid) {
            keys.push(this.#cacheKeyApp(row.user_id, row.app_uid));
        }
        if (row.kind === 'worker' && row.user_id) {
            const meta =
                typeof row.meta === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(row.meta);
                          } catch {
                              return null;
                          }
                      })()
                    : row.meta;
            const workerName = meta?.worker_name;
            if (typeof workerName === 'string' && workerName) {
                keys.push(
                    this.#cacheKeyWorker(
                        row.user_id,
                        row.app_uid ?? null,
                        workerName,
                    ),
                );
            }
        }
        // Legacy-web backfill rows are cached by (user_id, last_ip,
        // last_user_agent) inside `findOrCreateLegacyWeb`. Without this
        // branch, revoke would clear the uuid key but leave the composite
        // key serving the stale revoked row for up to CACHE_TTL_SECONDS,
        // letting a same-IP/UA replay re-authenticate.
        if (row.kind === 'web' && row.created_via === 'legacy_backfill') {
            keys.push(
                this.#cacheKeyLegacyWeb(
                    row.user_id,
                    row.last_ip ?? null,
                    row.last_user_agent ?? null,
                ),
            );
        }
        if (row.legacy_token_uid) {
            keys.push(this.#cacheKeyLegacyAt(row.legacy_token_uid));
        }
        return keys;
    }

    async #readCache(uuid) {
        return this.#readCacheKey(this.#cacheKey(uuid));
    }

    async #readCacheKey(key) {
        try {
            const raw = await this.clients.redis.get(key);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async #writeCache(session) {
        if (!session?.uuid) return;
        await this.#writeCacheKey(this.#cacheKey(session.uuid), session);
    }

    async #writeCacheKey(key, value) {
        try {
            await this.clients.redis.set(
                key,
                JSON.stringify(value),
                'EX',
                CACHE_TTL_SECONDS,
            );
        } catch {
            // Best-effort local backfill.
        }
    }

    /**
     * Active app session for (userId, appUid). Matches the partial unique
     * index `idx_sessions_user_app_active`. Kept private — public callers
     * should go through `getOrCreateApp` so cache and idempotency stay in
     * sync.
     */
    async #selectAppRow(userId, appUid) {
        const now = nowSeconds();
        const rows = await this.clients.db.read(
            "SELECT * FROM `sessions` WHERE `kind` = 'app' AND `user_id` = ? AND `app_uid` = ? AND `revoked_at` IS NULL AND (`expires_at` IS NULL OR `expires_at` > ?) LIMIT 1",
            [userId, appUid, now],
        );
        return this.#normalizeRow(rows[0]);
    }

    /**
     * Active worker session for (userId, appUid, workerName). Matches
     * the partial unique index `idx_sessions_user_worker_active`.
     * `appUid` is allowed null for user-scoped workers; COALESCE keeps
     * the comparison correct since SQL `= NULL` doesn't match.
     */
    async #selectWorkerRow(userId, appUid, workerName) {
        const now = nowSeconds();
        const workerNameExpr = this.clients.db.jsonTextExtract('`meta`', [
            'worker_name',
        ]);
        const appUidExpr = this.clients.db.nullCoalesce('`app_uid`', "''");
        const appUidBound = this.clients.db.nullCoalesce('?', "''");
        const rows = await this.clients.db.read(
            `SELECT * FROM \`sessions\` WHERE \`kind\` = 'worker' AND \`user_id\` = ? AND ${appUidExpr} = ${appUidBound} AND ${workerNameExpr} = ? AND \`revoked_at\` IS NULL AND (\`expires_at\` IS NULL OR \`expires_at\` > ?) LIMIT 1`,
            [userId, appUid ?? null, workerName, now],
        );
        return this.#normalizeRow(rows[0]);
    }

    async #selectLegacyAccessTokenRow(tokenUid) {
        const now = nowSeconds();
        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `legacy_token_uid` = ? AND `revoked_at` IS NULL AND (`expires_at` IS NULL OR `expires_at` > ?) LIMIT 1',
            [tokenUid, now],
        );
        return this.#normalizeRow(rows[0]);
    }

    #normalizeRow(row) {
        if (!row) return null;
        // Meta may be stored as JSON string (SQLite) or already parsed
        if (typeof row.meta === 'string') {
            try {
                row.meta = JSON.parse(row.meta);
            } catch {
                row.meta = {};
            }
        }
        return row;
    }
}
