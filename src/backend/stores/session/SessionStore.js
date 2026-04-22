import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

// `updateActivity` intentionally skips cache invalidation — it's a
// throttled UPDATE, stale `last_activity` in the cached row doesn't
// gate anything, and eating a Redis write per request isn't worth it.

const CACHE_KEY_PREFIX = 'sessions';
const CACHE_TTL_SECONDS = 15 * 60;

export class SessionStore extends PuterStore {
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
        await this.publishCacheKeys({ keys: [this.#cacheKey(uuid)] });
    }

    /** Update session activity timestamp and meta. */
    async updateActivity(uuid, meta, lastActivity) {
        await this.clients.db.write(
            'UPDATE `sessions` SET `meta` = ?, `last_activity` = ? WHERE `uuid` = ? AND (`last_activity` IS NULL OR `last_activity` < ?)',
            [JSON.stringify(meta), lastActivity, uuid, lastActivity],
        );
    }

    /** Update user-level last activity timestamp. */
    async updateUserActivity(userId, lastActivityTs) {
        await this.clients.db.write(
            'UPDATE `user` SET `last_activity_ts` = ? WHERE `id` = ? AND (`last_activity_ts` IS NULL OR `last_activity_ts` < ?) LIMIT 1',
            [lastActivityTs, userId, lastActivityTs],
        );
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
