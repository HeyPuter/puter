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

const sqlTimestamp = (ms) =>
    new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export class SessionStore extends PuterStore {
    #lastSessionTouchMs = new Map();
    #lastUserTouchMs = new Map();

    /**
     * Look up an active session by its uuid. Returns `null` if not
     * found or soft-revoked.
     */
    async getByUuid(uuid) {
        if (!uuid) return null;

        const cached = await this.#readCache(uuid);
        if (cached) {
            if (cached.revoked_at != null) return null;
            return cached;
        }

        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? AND `revoked_at` IS NULL LIMIT 1',
            [uuid],
        );
        const normalized = this.#normalizeRow(rows[0]);
        if (!normalized) return null;

        this.#writeCache(normalized).catch(() => {
            // Best-effort backfill — local only.
        });
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
     *   JWT `exp` is the sole truth. AUTH-4 slides this forward on activity.
     * @returns The created session row.
     */
    async create(
        userId,
        {
            meta = {},
            kind = 'web',
            label = null,
            parent_session_id = null,
            last_ip = null,
            last_user_agent = null,
            expires_at = null,
        } = {},
    ) {
        const uuid = uuidv4();
        const now = Math.floor(Date.now() / 1000);

        meta.created = new Date().toISOString();
        meta.created_unix = now;

        await this.clients.db.write(
            'INSERT INTO `sessions` (`uuid`, `user_id`, `meta`, `last_activity`, `created_at`, `kind`, `label`, `parent_session_id`, `last_ip`, `last_user_agent`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
            ],
        );

        return {
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
        };
    }

    /**
     * Soft-revoke a session by uuid. The row remains in the table
     * with `revoked_at` set; subsequent `getByUuid` calls treat it
     * as not found. Invalidates cache on this node + peers.
     */
    async removeByUuid(uuid) {
        const now = Math.floor(Date.now() / 1000);
        await this.clients.db.write(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE `uuid` = ? AND `revoked_at` IS NULL',
            [now, uuid],
        );
        await this.publishCacheKeys({
            keys: [this.#cacheKey(uuid)],
            broadcast: true,
        });
    }

    /**
     * Soft-revoke a root session and every derived session that
     * points back to it via `parent_session_id`. Broadcasts cache
     * invalidation for each affected row.
     */
    async revokeCascade(rootUuid) {
        if (!rootUuid) return;

        // Collect affected uuids first so we can broadcast cache
        // invalidation for each row. A single UPDATE ... RETURNING
        // would be cleaner but isn't portable between sqlite/mysql.
        const rows = await this.clients.db.read(
            'SELECT `uuid` FROM `sessions` WHERE (`uuid` = ? OR `parent_session_id` = ?) AND `revoked_at` IS NULL',
            [rootUuid, rootUuid],
        );
        if (rows.length === 0) return;

        const now = Math.floor(Date.now() / 1000);
        await this.clients.db.write(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE (`uuid` = ? OR `parent_session_id` = ?) AND `revoked_at` IS NULL',
            [now, rootUuid, rootUuid],
        );

        await this.publishCacheKeys({
            keys: rows.map((r) => this.#cacheKey(r.uuid)),
            broadcast: true,
        });
    }

    /** Update session activity timestamp. */
    async updateActivity(uuid, lastActivity) {
        await this.clients.db.write(
            'UPDATE `sessions` SET `last_activity` = ? WHERE `uuid` = ? AND (`last_activity` IS NULL OR `last_activity` < ?)',
            [lastActivity, uuid, lastActivity],
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

    async #readCache(uuid) {
        try {
            const raw = await this.clients.redis.get(this.#cacheKey(uuid));
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async #writeCache(session) {
        if (!session?.uuid) return;
        try {
            await this.clients.redis.set(
                this.#cacheKey(session.uuid),
                JSON.stringify(session),
                'EX',
                CACHE_TTL_SECONDS,
            );
        } catch {
            // Best-effort local backfill.
        }
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
