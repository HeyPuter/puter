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

const CACHE_KEY_PREFIX = 'sessions';
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

    /** Look up a session by its uuid. Returns `null` if not found. */
    async getByUuid(uuid) {
        if (!uuid) return null;

        const cached = await this.#readCache(uuid);
        if (cached) return cached;

        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [uuid],
        );
        const normalized = this.#normalizeRow(rows[0]);
        if (!normalized) return null;

        this.#writeCache(normalized).catch(() => {
            // Best-effort backfill — local only.
        });
        return normalized;
    }

    /** Get all sessions for a user. */
    async getByUserId(userId) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `user_id` = ?',
            [userId],
        );
        return rows.map((r) => this.#normalizeRow(r)).filter(Boolean);
    }

    /**
     * Create a new session.
     *
     * @param userId - User ID (numeric)
     * @param meta - Metadata object (IP, user-agent, etc.)
     * @returns The created session row
     */
    async create(userId, meta = {}) {
        const uuid = uuidv4();
        const now = Math.floor(Date.now() / 1000);

        meta.created = new Date().toISOString();
        meta.created_unix = now;

        await this.clients.db.write(
            'INSERT INTO `sessions` (`uuid`, `user_id`, `meta`, `last_activity`, `created_at`) VALUES (?, ?, ?, ?, ?)',
            [uuid, userId, JSON.stringify(meta), now, now],
        );

        return {
            uuid,
            user_id: userId,
            meta,
            created_at: now,
            last_activity: now,
        };
    }

    /** Delete a session by uuid. Invalidates cache on this node + peers. */
    async removeByUuid(uuid) {
        await this.clients.db.write('DELETE FROM `sessions` WHERE `uuid` = ?', [
            uuid,
        ]);
        await this.publishCacheKeys({
            keys: [this.#cacheKey(uuid)],
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
