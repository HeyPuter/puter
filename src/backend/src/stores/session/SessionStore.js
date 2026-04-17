import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * Session persistence for auth.
 *
 * Provides CRUD operations on the `sessions` table. Activity tracking
 * is done via direct DB writes for now — a Redis batching optimization
 * can be layered on later without changing the interface.
 */
export class SessionStore extends PuterStore {

    /** Look up a session by its uuid. Returns `null` if not found. */
    async getByUuid (uuid) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [uuid],
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /** Get all sessions for a user. */
    async getByUserId (userId) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `sessions` WHERE `user_id` = ?',
            [userId],
        );
        return rows.map(r => this.#normalizeRow(r)).filter(Boolean);
    }

    /**
     * Create a new session.
     *
     * @param userId - User ID (numeric)
     * @param meta - Metadata object (IP, user-agent, etc.)
     * @returns The created session row
     */
    async create (userId, meta = {}) {
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

    /** Delete a session by uuid. */
    async removeByUuid (uuid) {
        await this.clients.db.write(
            'DELETE FROM `sessions` WHERE `uuid` = ?',
            [uuid],
        );
    }

    /** Update session activity timestamp and meta. */
    async updateActivity (uuid, meta, lastActivity) {
        await this.clients.db.write(
            'UPDATE `sessions` SET `meta` = ?, `last_activity` = ? WHERE `uuid` = ? AND (`last_activity` IS NULL OR `last_activity` < ?)',
            [JSON.stringify(meta), lastActivity, uuid, lastActivity],
        );
    }

    /** Update user-level last activity timestamp. */
    async updateUserActivity (userId, lastActivityTs) {
        await this.clients.db.write(
            'UPDATE `user` SET `last_activity_ts` = ? WHERE `id` = ? AND (`last_activity_ts` IS NULL OR `last_activity_ts` < ?) LIMIT 1',
            [lastActivityTs, userId, lastActivityTs],
        );
    }

    // ── Internals ───────────────────────────────────────────────────

    #normalizeRow (row) {
        if ( ! row ) return null;
        // Meta may be stored as JSON string (SQLite) or already parsed
        if ( typeof row.meta === 'string' ) {
            try { row.meta = JSON.parse(row.meta); } catch { row.meta = {}; }
        }
        return row;
    }
}
