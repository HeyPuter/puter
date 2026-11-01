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

import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * @typedef {{
 *     userId: number;
 *     value: unknown;
 *     uid?: string;
 *     type?: string;
 *     audience?: string;
 *     appUid?: string | null;
 *     group?: string | null;
 * }} NotificationInsert
 */

/**
 * Fixed width and compared byte for byte on every engine, whatever `group`
 * holds.
 */
const groupKey = (group) =>
    group ? createHash('sha256').update(group, 'utf8').digest('hex') : null;

const pageLimit = (limit) => {
    const n = Number(limit);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 50;
};

/**
 * The WHERE terms that pick one mailbox slice. `appUid: null` is the rows about
 * no app; `undefined` is every app.
 *
 * @param {number} userId
 * @param {{
 *     audience: string;
 *     appUid?: string | null;
 *     excludeTypes: readonly string[];
 * }} scope
 */
const sliceWhere = (userId, { audience, appUid, excludeTypes }) => {
    const where = ['`user_id` = ?', '`audience` = ?'];
    const params = [userId, audience];
    if (excludeTypes.length > 0) {
        where.push(
            `\`type\` NOT IN (${excludeTypes.map(() => '?').join(', ')})`,
        );
        params.push(...excludeTypes);
    }
    if (appUid === null) {
        where.push('`app_uid` IS NULL');
    } else if (appUid !== undefined) {
        where.push('`app_uid` = ?');
        params.push(appUid);
    }
    return { where, params };
};

export class NotificationStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    /**
     * Pass `primary` to read back a row just written; a replica may lag.
     *
     * @param {string} uid
     * @param {{ userId?: number; primary?: boolean }} [opts]
     */
    async getByUid(uid, { userId, primary = false } = {}) {
        const where =
            userId !== undefined
                ? 'WHERE `uid` = ? AND `user_id` = ?'
                : 'WHERE `uid` = ?';
        const params = userId !== undefined ? [uid, userId] : [uid];
        const sql = `SELECT * FROM \`notification\` ${where} LIMIT 1`;
        const rows = primary
            ? await this.clients.db.pread(sql, params)
            : await this.clients.db.read(sql, params);
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /**
     * The row a delayed send wrote or last replaced, from the primary.
     *
     * @param {string} sendKey
     */
    async getBySendKey(sendKey) {
        const rows = await this.clients.db.pread(
            'SELECT * FROM `notification` WHERE `send_key` = ? LIMIT 1',
            [sendKey],
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /**
     * The newest row `appUid` wrote for the user under `group`, or null when it
     * was shown or acknowledged: an older row is never picked up in its place.
     * Rows written without a group never match.
     *
     * @param {number} userId
     * @param {string} appUid
     * @param {string} group
     * @param {{ primary?: boolean }} [opts]
     */
    async getUnseenByGroup(userId, appUid, group, { primary = false } = {}) {
        const sql =
            'SELECT * FROM `notification` WHERE `user_id` = ? AND `app_uid` = ? ' +
            'AND `group_key` = ? ORDER BY `id` DESC LIMIT 1';
        const params = [userId, appUid, groupKey(group)];
        const rows = primary
            ? await this.clients.db.pread(sql, params)
            : await this.clients.db.read(sql, params);
        const row = rows[0];
        if (!row || (row.shown ?? row.acknowledged ?? null) !== null) {
            return null;
        }
        return this.#normalizeRow(row);
    }

    /**
     * A mailbox, newest first. `scope` narrows to one audience/app slice on the
     * way out of the database — `appUid: null` means the rows naming no app,
     * which is not the same question as "any app". `excludeTypes` leaves rows
     * of those types out.
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
     *     excludeTypes?: readonly string[];
     * }} [opts]
     */
    async listByUserId(
        userId,
        {
            limit = 200,
            onlyUnacknowledged = false,
            filter = undefined,
            scope = null,
            excludeTypes = [],
        } = {},
    ) {
        const where = ['`user_id` = ?'];
        const params = [userId];

        if (excludeTypes.length > 0) {
            where.push(
                `\`type\` NOT IN (${excludeTypes.map(() => '?').join(', ')})`,
            );
            params.push(...excludeTypes);
        }

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
     * `excludeTypes` leaves rows of those types out.
     *
     * @param {number} userId
     * @param {{
     *     audience: string;
     *     appUid?: string | null;
     *     after?: number | null;
     *     limit?: number;
     *     excludeTypes?: readonly string[];
     * }} opts
     */
    async listScoped(
        userId,
        { audience, appUid, after = null, limit = 50, excludeTypes = [] },
    ) {
        const safeLimit = pageLimit(limit);
        if (safeLimit === 0) return [];

        const { where, params } = sliceWhere(userId, {
            audience,
            appUid,
            excludeTypes,
        });
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

    /**
     * The rows of a mailbox slice up to id `upTo` that were replaced after
     * `after`, in replacement order: what a client that read up to `upTo` has
     * not seen since. Keyset on (`replaced_at`, `id`), so rows replaced in the
     * same millisecond page without a repeat or a skip. Scoped like
     * `listScoped`.
     *
     * @param {number} userId
     * @param {{
     *     audience: string;
     *     appUid?: string | null;
     *     upTo: number;
     *     after: { replacedAt: number; id: number };
     *     limit?: number;
     *     excludeTypes?: readonly string[];
     * }} opts
     */
    async listReplacedScoped(
        userId,
        { audience, appUid, upTo, after, limit = 50, excludeTypes = [] },
    ) {
        const safeLimit = pageLimit(limit);
        if (safeLimit === 0) return [];

        const { where, params } = sliceWhere(userId, {
            audience,
            appUid,
            excludeTypes,
        });
        where.push(
            '`id` <= ?',
            '`replaced_at` >= ?',
            '(`replaced_at` > ? OR `id` > ?)',
        );
        params.push(upTo, after.replacedAt, after.replacedAt, after.id);

        const rows = await this.clients.db.read(
            `SELECT * FROM \`notification\`
             WHERE ${where.join(' AND ')}
             ORDER BY \`replaced_at\` ASC, \`id\` ASC
             LIMIT ?`,
            [...params, safeLimit],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    // -- Writes -------------------------------------------------------

    /**
     * Write a notification and return its row, built from what was written:
     * `created_at` is stamped here rather than defaulted, so nothing needs
     * reading back.
     *
     * `uid` lets the caller name the row up front — NotificationService pushes
     * the uid to the socket after this insert lands, and the ack / mark-shown
     * round trip comes back keyed on it.
     *
     * `type`, `audience` and `appUid` are the scope tuple; the registry in the
     * notification service is what decides which combinations are legal, and
     * the empty `type` written by a caller that names none reads as legacy.
     * `group` is kept as a key `getUnseenByGroup` finds the row by.
     *
     * @param {NotificationInsert} args
     */
    async create({
        userId,
        value,
        uid = uuidv4(),
        type = '',
        audience = 'account',
        appUid = null,
        group = null,
    }) {
        if (!userId) throw new Error('create: userId is required');
        const db = this.clients.db;
        const serialized =
            typeof value === 'string' ? value : JSON.stringify(value ?? {});
        const createdAt = Math.floor(Date.now() / 1000);
        const key = groupKey(group);
        const { insertId } = await db.write(
            'INSERT INTO `notification` (`uid`, `user_id`, `value`, `type`, ' +
                '`audience`, `app_uid`, `group_key`, `created_at`) VALUES ' +
                `(?, ?, ?, ?, ?, ?, ?, ${db.timestampFromUnixSql()})${db.returningIdClause()}`,
            [uid, userId, serialized, type, audience, appUid, key, createdAt],
        );
        return this.#normalizeRow({
            id: Number(insertId),
            uid,
            user_id: userId,
            value: serialized,
            acknowledged: null,
            shown: null,
            created_at: db.timestampValue(createdAt),
            app_uid: appUid,
            audience,
            type,
            group_key: key,
            replaced_at: null,
            send_key: null,
        });
    }

    /**
     * `create` for a caller that needs only the uid.
     *
     * @param {NotificationInsert} args
     * @returns {Promise<string>}
     */
    async insert(args) {
        return (await this.create(args)).uid;
    }

    /**
     * The statements that write a delayed send's notification, for the caller's
     * transaction. Each runs only while `guard` holds. With `replaceUid` the
     * open row is replaced in place and takes `sendKey`; the insert, whose uid
     * is `sendKey`, then runs only if that row was shown or dismissed in
     * between.
     *
     * @param {{
     *     sendKey: string;
     *     userId: number;
     *     value: unknown;
     *     type: string;
     *     audience: string;
     *     appUid: string | null;
     *     group?: string | null;
     *     replaceUid?: string | null;
     *     at: number;
     * }} send
     *   `at` is epoch ms, the row's time either way.
     * @param {{ table: string; where: string; values: unknown[] }} guard
     * @returns {{ statement: string; values: unknown[] }[]}
     */
    sendEntries(send, guard) {
        const db = this.clients.db;
        const serialized = JSON.stringify(send.value ?? {});
        const seconds = Math.floor(send.at / 1000);
        const fence = `SELECT 1 FROM \`${guard.table}\` WHERE ${guard.where}`;
        const entries = [];
        if (send.replaceUid) {
            entries.push({
                statement:
                    'UPDATE `notification` SET `value` = ?, `shown` = NULL, ' +
                    `\`created_at\` = ${db.timestampFromUnixSql()}, ` +
                    '`replaced_at` = ?, `send_key` = ? WHERE `uid` = ? ' +
                    'AND `user_id` = ? AND `shown` IS NULL ' +
                    `AND \`acknowledged\` IS NULL AND EXISTS (${fence})`,
                values: [
                    serialized,
                    seconds,
                    send.at,
                    send.sendKey,
                    send.replaceUid,
                    send.userId,
                    ...guard.values,
                ],
            });
        }
        // Postgres can't type a bare parameter in a SELECT list.
        const param = (type) =>
            db.case({ postgres: `CAST(? AS ${type})`, otherwise: '?' });
        entries.push({
            statement:
                'INSERT INTO `notification` (`uid`, `user_id`, `value`, `type`, ' +
                '`audience`, `app_uid`, `group_key`, `created_at`, `send_key`) ' +
                `SELECT ${param('TEXT')}, ${param('INTEGER')}, ${param('JSONB')}, ` +
                `${param('TEXT')}, ${param('TEXT')}, ${param('TEXT')}, ` +
                `${param('TEXT')}, ${db.timestampFromUnixSql()}, ${param('TEXT')} ` +
                `FROM \`${guard.table}\` WHERE ${guard.where} AND NOT EXISTS ` +
                '(SELECT 1 FROM `notification` WHERE `send_key` = ?)',
            values: [
                send.sendKey,
                send.userId,
                serialized,
                send.type,
                send.audience,
                send.appUid,
                groupKey(send.group),
                seconds,
                send.sendKey,
                ...guard.values,
                send.sendKey,
            ],
        });
        return entries;
    }

    /**
     * Rewrite a notification the recipient hasn't dismissed. `shown` is cleared
     * with it, so changed wording goes out again on their next connect —
     * `#sendUnreads` only carries what was never shown.
     *
     * `onlyUnseen` also skips a row already shown. `replacedAt`, in epoch ms,
     * records the rewrite as a replacement and dates the row to it.
     *
     * `send_key` is cleared with it: the content is no longer what a delayed
     * send wrote, so its recovery must not deliver it under that send's key.
     *
     * False when no such row exists, so callers can fall back to a fresh
     * notification instead of dropping what they were reporting.
     *
     * @param {string} uid @param {number} userId @param {unknown} value
     * @param {{ onlyUnseen?: boolean; replacedAt?: number }} [opts]
     */
    async updateValue(
        uid,
        userId,
        value,
        { onlyUnseen = false, replacedAt = undefined } = {},
    ) {
        const db = this.clients.db;
        const serialized =
            typeof value === 'string' ? value : JSON.stringify(value ?? {});
        const set = ['`value` = ?', '`shown` = NULL', '`send_key` = NULL'];
        const params = [serialized];
        if (replacedAt !== undefined) {
            set.push(
                `\`created_at\` = ${db.timestampFromUnixSql()}`,
                '`replaced_at` = ?',
            );
            params.push(Math.floor(replacedAt / 1000), replacedAt);
        }
        const where = ['`uid` = ?', '`user_id` = ?', '`acknowledged` IS NULL'];
        if (onlyUnseen) where.push('`shown` IS NULL');
        const result = await db.write(
            `UPDATE \`notification\` SET ${set.join(', ')} WHERE ${where.join(' AND ')}`,
            [...params, uid, userId],
        );
        return result.anyRowsAffected;
    }

    async markAcknowledged(uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `acknowledged` = ? WHERE `uid` = ? AND `user_id` = ? AND `acknowledged` IS NULL',
            [now, uid, userId],
        );
        return result.anyRowsAffected;
    }

    async markShown(uid, userId) {
        const now = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'UPDATE `notification` SET `shown` = ? WHERE `uid` = ? AND `user_id` = ? AND `shown` IS NULL',
            [now, uid, userId],
        );
        return result.anyRowsAffected;
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
        return result.affectedRows;
    }

    async deleteByUid(uid, userId) {
        const result = await this.clients.db.write(
            'DELETE FROM `notification` WHERE `uid` = ? AND `user_id` = ?',
            [uid, userId],
        );
        return result.anyRowsAffected;
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
        return result.affectedRows;
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
