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
import { PuterStore } from '../types';

export class NotificationStore extends PuterStore {
    // -- Reads --------------------------------------------------------

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

    /**
     * A mailbox, newest first. `scope` narrows to one audience/app slice on the
     * way out of the database — `appUid: null` means the rows naming no app,
     * which is not the same question as "any app".
     *
     * @param {number} userId
     * @param {{
     *     limit?: number;
     *     onlyUnacknowledged?: boolean;
     *     filter?: string;
     *     scope?: {
     *         audiences: readonly string[];
     *         appUid: string | null;
     *     } | null;
     * }} [opts]
     */
    async listByUserId(
        userId,
        {
            limit = 200,
            onlyUnacknowledged = false,
            filter = undefined,
            scope = null,
        } = {},
    ) {
        const where = ['`user_id` = ?'];
        const params = [userId];

        if (onlyUnacknowledged || filter === 'unacknowledged') {
            where.push('`acknowledged` IS NULL');
        } else if (filter === 'unseen') {
            where.push('`shown` IS NULL', '`acknowledged` IS NULL');
        } else if (filter === 'acknowledged') {
            where.push('`acknowledged` IS NOT NULL');
        }

        if (scope) {
            if (scope.audiences.length === 0) return [];
            const placeholders = scope.audiences.map(() => '?').join(', ');
            where.push(`\`audience\` IN (${placeholders})`);
            params.push(...scope.audiences);
            // `undefined` is "any app" — a session's own generic slice, left
            // unfiltered here because the caller applies the audience
            // predicate over the page afterwards.
            if (scope.appUid === null) {
                where.push('`app_uid` IS NULL');
            } else if (scope.appUid !== undefined) {
                where.push('`app_uid` = ?');
                params.push(scope.appUid);
            }
        }

        const n = Number(limit);
        const safeLimit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 200;
        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\`
             WHERE ${where.join(' AND ')}
             ORDER BY \`created_at\` DESC, \`id\` DESC
             LIMIT ?`,
            [...params, safeLimit],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * One page of a mailbox slice, oldest first, for a client catching up on
     * what it missed. Keyset on `id`: `after` is the last id of the previous
     * page, so a page cannot repeat or skip a row the way an offset can when
     * rows arrive between requests.
     *
     * `appUid` is matched, not filtered afterwards — `null` means the rows
     * about no app, which is not the same question as "any app". `undefined` is
     * "any app": a session's own generic slice, which spans every app the
     * audience predicate already grants it rather than one named ref.
     *
     * @param {number} userId
     * @param {{
     *     audience: string;
     *     appUid?: string | null;
     *     after?: number | null;
     *     limit?: number;
     * }} opts
     */
    async listScoped(userId, { audience, appUid, after = null, limit = 50 }) {
        const n = Number(limit);
        const safeLimit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 50;
        if (safeLimit === 0) return [];

        const where = ['`user_id` = ?', '`audience` = ?'];
        const params = [userId, audience];
        if (appUid === null) {
            where.push('`app_uid` IS NULL');
        } else if (appUid !== undefined) {
            where.push('`app_uid` = ?');
            params.push(appUid);
        }
        if (after !== null && Number.isFinite(Number(after))) {
            where.push('`id` > ?');
            params.push(Math.floor(Number(after)));
        }

        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\`
             WHERE ${where.join(' AND ')}
             ORDER BY \`id\` ASC
             LIMIT ?`,
            [...params, safeLimit],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    // -- Writes -------------------------------------------------------

    /**
     * `uid` lets the caller name the row up front — NotificationService pushes
     * the uid to the socket before this insert lands, and the ack / mark-shown
     * round trip comes back keyed on it.
     *
     * `type`, `audience` and `appUid` are the scope tuple; the registry in the
     * notification service is what decides which combinations are legal, and
     * the empty `type` written by a caller that names none reads as legacy.
     *
     * @param {{
     *     userId: number;
     *     value: unknown;
     *     uid?: string;
     *     type?: string;
     *     audience?: string;
     *     appUid?: string | null;
     * }} args
     */
    async create({
        userId,
        value,
        uid = uuidv4(),
        type = '',
        audience = 'account',
        appUid = null,
    }) {
        if (!userId) throw new Error('create: userId is required');
        const serialized =
            typeof value === 'string' ? value : JSON.stringify(value ?? {});
        await this.clients.db.write(
            'INSERT INTO `notification` (`uid`, `user_id`, `value`, `type`, `audience`, `app_uid`) VALUES (?, ?, ?, ?, ?, ?)',
            [uid, userId, serialized, type, audience, appUid],
        );
        return this.getByUid(uid, { userId });
    }

    /**
     * Rewrite a notification the recipient hasn't dismissed. `shown` is cleared
     * with it, so changed wording goes out again on their next connect —
     * `#sendUnreads` only carries what was never shown.
     *
     * False when no such row exists, so callers can fall back to a fresh
     * notification instead of dropping what they were reporting.
     *
     * @param {string} uid @param {number} userId @param {unknown} value
     */
    async updateValue(uid, userId, value) {
        const serialized =
            typeof value === 'string' ? value : JSON.stringify(value ?? {});
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `value` = ?, `shown` = NULL WHERE `uid` = ? AND `user_id` = ? AND `acknowledged` IS NULL',
            [serialized, uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    async markAcknowledged(uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `acknowledged` = ? WHERE `uid` = ? AND `user_id` = ? AND `acknowledged` IS NULL',
            [now, uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    async markShown(uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `shown` = ? WHERE `uid` = ? AND `user_id` = ? AND `shown` IS NULL',
            [now, uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    /**
     * Mark a batch shown in one statement. The reconnect replay hands over
     * everything a client missed at once, and a round trip per row turns one
     * connect into up to two hundred of them.
     *
     * @param {string[]} uids @param {number} userId
     */
    async markShownByUids(uids, userId) {
        const unique = [...new Set(uids.filter((uid) => !!uid))];
        if (unique.length === 0) return 0;
        const now = Math.floor(Date.now() / 1000);
        const placeholders = unique.map(() => '?').join(', ');
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `shown` = ? ' +
                `WHERE \`user_id\` = ? AND \`shown\` IS NULL AND \`uid\` IN (${placeholders})`,
            [now, userId, ...unique],
        );
        return result?.affectedRows ?? result?.changes ?? 0;
    }

    async deleteByUid(uid, userId) {
        const result = await this.clients.db.write(
            'DELETE FROM `notification` WHERE `uid` = ? AND `user_id` = ?',
            [uid, userId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    /**
     * Delete up to `limit` rows created more than `days` ago, and report how
     * many went — a full batch means there is more behind it.
     *
     * Only mysql takes a LIMIT on DELETE — postgres has none and sqlite's needs
     * an optional build flag — so the other two bound the batch through an id
     * list. Each engine computes its own cutoff, so no clock crosses the wire.
     *
     * @param {number} days @param {number} limit
     */
    async deleteCreatedBefore(days, limit) {
        const retentionDays = Math.floor(Number(days));
        const batch = Math.floor(Number(limit));
        if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
        if (!Number.isFinite(batch) || batch <= 0) return 0;

        const cutoff = this.clients.db.case({
            sqlite: `datetime('now', '-${retentionDays} days')`,
            postgres: `(NOW() - INTERVAL '${retentionDays} days')`,
            otherwise: `(NOW() - INTERVAL ${retentionDays} DAY)`,
        });
        const statement = this.clients.db.case({
            mysql:
                'DELETE FROM `notification` ' +
                `WHERE \`created_at\` < ${cutoff} ORDER BY \`id\` LIMIT ?`,
            otherwise:
                'DELETE FROM `notification` WHERE `id` IN (' +
                'SELECT `id` FROM `notification` ' +
                `WHERE \`created_at\` < ${cutoff} ORDER BY \`id\` LIMIT ?)`,
        });

        const result = await this.clients.db.write(statement, [batch]);
        return result?.affectedRows ?? result?.changes ?? 0;
    }

    // -- Internals ----------------------------------------------------

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
