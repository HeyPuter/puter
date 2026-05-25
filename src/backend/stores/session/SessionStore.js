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
export const WEB_WINDOW_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const APP_WINDOW_SECONDS = 90 * 24 * 60 * 60; // 90 days
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
     * `getOrCreate*` paths. `ignoreConflict: true` switches to engine-
     * specific INSERT-IGNORE so partial-unique-index collisions silently
     * no-op rather than throw — the idempotent callers handle the "row
     * already existed" path via a re-SELECT.
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
            created_via = null,
            auth_id = null,
        } = {},
        { ignoreConflict = false } = {},
    ) {
        const uuid = uuidv4();
        const now = nowSeconds();

        meta.created = new Date().toISOString();
        meta.created_unix = now;

        const insertVerb = ignoreConflict
            ? this.clients.db.case({
                  sqlite: 'INSERT OR IGNORE INTO',
                  otherwise: 'INSERT IGNORE INTO',
              })
            : 'INSERT INTO';

        await this.clients.db.write(
            `${insertVerb} \`sessions\` (\`uuid\`, \`user_id\`, \`meta\`, \`last_activity\`, \`created_at\`, \`kind\`, \`label\`, \`parent_session_id\`, \`last_ip\`, \`last_user_agent\`, \`expires_at\`, \`app_uid\`, \`legacy_token_uid\`, \`created_via\`, \`auth_id\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                created_via,
                auth_id,
            ],
        );

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
        const rows = await this.clients.db.read(
            'SELECT `uuid`, `user_id`, `kind`, `app_uid`, `legacy_token_uid` FROM `sessions` WHERE `uuid` = ? AND `revoked_at` IS NULL LIMIT 1',
            [uuid],
        );
        if (rows.length === 0) return;

        const now = nowSeconds();
        await this.clients.db.write(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE `uuid` = ? AND `revoked_at` IS NULL',
            [now, uuid],
        );
        await this.publishCacheKeys({
            keys: this.#allCacheKeysForRow(rows[0]),
            broadcast: true,
        });
    }

    /**
     * Soft-revoke a root session and every derived session that
     * points back to it via `parent_session_id`. Broadcasts cache
     * invalidation for each affected row's uuid + composite keys.
     */
    async revokeCascade(rootUuid) {
        if (!rootUuid) return;

        // Read each affected row's identity columns up-front — every
        // composite cache mapping (app, legacy-token) must be invalidated
        // alongside the uuid key, otherwise a follow-up `getOrCreateApp`
        // would short-circuit to the freshly-revoked row.
        const rows = await this.clients.db.read(
            'SELECT `uuid`, `user_id`, `kind`, `app_uid`, `legacy_token_uid` FROM `sessions` WHERE (`uuid` = ? OR `parent_session_id` = ?) AND `revoked_at` IS NULL',
            [rootUuid, rootUuid],
        );
        if (rows.length === 0) return;

        const now = nowSeconds();
        await this.clients.db.write(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE (`uuid` = ? OR `parent_session_id` = ?) AND `revoked_at` IS NULL',
            [now, rootUuid, rootUuid],
        );

        const keys = [];
        for (const r of rows) keys.push(...this.#allCacheKeysForRow(r));
        await this.publishCacheKeys({ keys, broadcast: true });
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
     * @param opts.auth_id - Stable per-user identity (PUT-1010).
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
     * is `(user_id, last_ip, last_user_agent)` — a UA/IP shift on a roaming
     * client produces a fresh row, which is the spec's accepted trade-off.
     * No partial unique index here; collisions are tolerated.
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

        const rows = await this.clients.db.read(
            "SELECT * FROM `sessions` WHERE `kind` = 'web' AND `user_id` = ? AND `created_via` = 'legacy_backfill' AND IFNULL(`last_ip`, '') = IFNULL(?, '') AND IFNULL(`last_user_agent`, '') = IFNULL(?, '') AND `revoked_at` IS NULL AND (`expires_at` IS NULL OR `expires_at` > ?) ORDER BY `id` ASC LIMIT 1",
            [opts.userId, ip, ua, now],
        );
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
     */
    async updateActivity(uuid, lastActivity) {
        const webExpires = lastActivity + WEB_WINDOW_SECONDS;
        const appExpires = lastActivity + APP_WINDOW_SECONDS;
        const assetExpires = lastActivity + ASSET_WINDOW_SECONDS;
        await this.clients.db.write(
            'UPDATE `sessions` SET `last_activity` = ?, `expires_at` = CASE `kind` ' +
                "WHEN 'web' THEN ? " +
                "WHEN 'app' THEN ? " +
                "WHEN 'asset' THEN ? " +
                'ELSE `expires_at` ' +
                'END ' +
                'WHERE `uuid` = ? AND (`last_activity` IS NULL OR `last_activity` < ?)',
            [
                lastActivity,
                webExpires,
                appExpires,
                assetExpires,
                uuid,
                lastActivity,
            ],
        );
    }

    /** Update user-level last activity timestamp. */
    async updateUserActivity(userId, lastActivityTs) {
        await this.clients.db.write(
            'UPDATE `user` SET `last_activity_ts` = ? WHERE `id` = ? AND (`last_activity_ts` IS NULL OR `last_activity_ts` < ?) LIMIT 1',
            [lastActivityTs, userId, lastActivityTs],
        );
    }

    /**
     * Best-effort throttled activity touch. Updates the session row's
     * `last_activity` column and the owning user's `user.last_activity_ts`
     * if either hasn't been touched within `TOUCH_THROTTLE_MS`.
     *
     * Callers fire-and-forget — failures are swallowed.
     */
    async touch({ uuid, userId } = {}) {
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
                this.updateActivity(uuid, Math.floor(nowMs / 1000)).catch(
                    () => {},
                ),
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

    // ── Internals ───────────────────────────────────────────────────

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
