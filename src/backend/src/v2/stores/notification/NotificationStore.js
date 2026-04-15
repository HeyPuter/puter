import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * CRUD over the `notification` table.
 *
 * Columns: id, user_id, uid (unique), value (JSON), acknowledged
 * (timestamp), shown (timestamp), created_at (timestamp).
 *
 * Notifications are per-user. No cross-user reads.
 */

export class NotificationStore extends PuterStore {

    // ── Reads ────────────────────────────────────────────────────────

    async getByUid (uid, { userId } = {}) {
        const where = userId !== undefined
            ? 'WHERE `uid` = ? AND `user_id` = ?'
            : 'WHERE `uid` = ?';
        const params = userId !== undefined ? [uid, userId] : [uid];
        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\` ${where} LIMIT 1`,
            params,
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    async listByUserId (userId, { limit = 200, onlyUnacknowledged = false } = {}) {
        const extraWhere = onlyUnacknowledged ? 'AND `acknowledged` IS NULL' : '';
        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\`
             WHERE \`user_id\` = ? ${extraWhere}
             ORDER BY \`created_at\` DESC
             LIMIT ${limit}`,
            [userId],
        );
        return rows.map(r => this.#normalizeRow(r));
    }

    async countUnacknowledged (userId) {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `notification` WHERE `user_id` = ? AND `acknowledged` IS NULL',
            [userId],
        );
        return rows[0]?.n ?? 0;
    }

    // ── Writes ───────────────────────────────────────────────────────

    async create ({ userId, value }) {
        if ( ! userId ) throw new Error('create: userId is required');
        const uid = uuidv4();
        const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? {});
        await this.clients.db.write(
            'INSERT INTO `notification` (`uid`, `user_id`, `value`) VALUES (?, ?, ?)',
            [uid, userId, serialized],
        );
        return this.getByUid(uid, { userId });
    }

    async markAcknowledged (uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `acknowledged` = ? WHERE `uid` = ? AND `user_id` = ? AND `acknowledged` IS NULL',
            [now, uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    async markShown (uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `shown` = ? WHERE `uid` = ? AND `user_id` = ? AND `shown` IS NULL',
            [now, uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    async deleteByUid (uid, userId) {
        const result = await this.clients.db.write(
            'DELETE FROM `notification` WHERE `uid` = ? AND `user_id` = ?',
            [uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    // ── Internals ────────────────────────────────────────────────────

    #normalizeRow (row) {
        if ( ! row ) return null;
        if ( typeof row.value === 'string' ) {
            try { row.value = JSON.parse(row.value); } catch { /* keep string */ }
        }
        return row;
    }
}
