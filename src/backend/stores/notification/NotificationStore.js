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

// `markShown` intentionally doesn't invalidate unack count — it doesn't move it.

const UNACK_CACHE_KEY_PREFIX = 'notifications:unack';
const UNACK_CACHE_TTL_SECONDS = 5 * 60;

export class NotificationStore extends PuterStore {
    // ── Reads ────────────────────────────────────────────────────────

    async getByUid(uid, { userId } = {}) {
        const where =
            userId !== undefined
                ? 'WHERE `uid` = ? AND `user_id` = ?'
                : 'WHERE `uid` = ?';
        const params = userId !== undefined ? [uid, userId] : [uid];
        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\` ${where} LIMIT 1`,
            params,
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /** @param {number} userId @param {{ limit?: number, onlyUnacknowledged?: boolean, filter?: string }} [opts] */
    async listByUserId(
        userId,
        { limit = 200, onlyUnacknowledged = false, filter = undefined } = {},
    ) {
        let extraWhere = '';
        if (onlyUnacknowledged || filter === 'unacknowledged') {
            extraWhere = 'AND `acknowledged` IS NULL';
        } else if (filter === 'unseen') {
            extraWhere = 'AND `shown` IS NULL AND `acknowledged` IS NULL';
        } else if (filter === 'acknowledged') {
            extraWhere = 'AND `acknowledged` IS NOT NULL';
        }
        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\`
             WHERE \`user_id\` = ? ${extraWhere}
             ORDER BY \`created_at\` DESC
             LIMIT ${limit}`,
            [userId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    async countUnacknowledged(userId) {
        if (!userId) return 0;

        const cacheKey = this.#unackCacheKey(userId);
        try {
            const raw = await this.clients.redis.get(cacheKey);
            if (raw !== null && raw !== undefined) {
                const parsed = Number(raw);
                if (Number.isFinite(parsed)) return parsed;
            }
        } catch {
            // Fall through to DB.
        }

        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `notification` WHERE `user_id` = ? AND `acknowledged` IS NULL',
            [userId],
        );
        const count = Number(rows[0]?.n ?? 0);

        this.clients.redis
            .set(cacheKey, String(count), 'EX', UNACK_CACHE_TTL_SECONDS)
            .catch(() => {});
        return count;
    }

    // ── Writes ───────────────────────────────────────────────────────

    async create({ userId, value }) {
        if (!userId) throw new Error('create: userId is required');
        const uid = uuidv4();
        const serialized =
            typeof value === 'string' ? value : JSON.stringify(value ?? {});
        await this.clients.db.write(
            'INSERT INTO `notification` (`uid`, `user_id`, `value`) VALUES (?, ?, ?)',
            [uid, userId, serialized],
        );
        await this.#invalidateUnack(userId);
        return this.getByUid(uid, { userId });
    }

    async markAcknowledged(uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `acknowledged` = ? WHERE `uid` = ? AND `user_id` = ? AND `acknowledged` IS NULL',
            [now, uid, userId],
        );
        const changed = (result?.affectedRows ?? result?.changes ?? 0) > 0;
        if (changed) await this.#invalidateUnack(userId);
        return changed;
    }

    async markShown(uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `shown` = ? WHERE `uid` = ? AND `user_id` = ? AND `shown` IS NULL',
            [now, uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    async deleteByUid(uid, userId) {
        const result = await this.clients.db.write(
            'DELETE FROM `notification` WHERE `uid` = ? AND `user_id` = ?',
            [uid, userId],
        );
        const changed = (result?.affectedRows ?? result?.changes ?? 0) > 0;
        if (changed) await this.#invalidateUnack(userId);
        return changed;
    }

    // ── Internals ────────────────────────────────────────────────────

    #unackCacheKey(userId) {
        return `${UNACK_CACHE_KEY_PREFIX}:${userId}`;
    }

    async #invalidateUnack(userId) {
        await this.publishCacheKeys({ keys: [this.#unackCacheKey(userId)] });
    }

    #normalizeRow(row) {
        if (!row) return null;
        if (typeof row.value === 'string') {
            try {
                row.value = JSON.parse(row.value);
            } catch {
                /* keep string */
            }
        }
        return row;
    }
}
