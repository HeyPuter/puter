/*
 * Copyright (C) 2025-present Puter Technologies Inc.
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
const APIError = require('../api/APIError');
const BaseService = require('./BaseService');
const { DB_WRITE } = require('./database/consts');
const { Context } = require('../util/context');
const { UserActorType } = require('./auth/Actor');
const uuidv4 = require('uuid').v4;

class NotificationStoreService extends BaseService {
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'notification');
    }

    static IMPLEMENTS = {
        ['crud-q']: {
            create: async ({ object }) => await this.create(object),
            read: async ({ uid }) => await this.read(uid),
            select: async (options = {}) => await this.select(options),
            update: async ({ object, id }) => await this.update(id, object),
            upsert: async ({ object, id }) => await this.upsert(id, object),
            delete: async ({ uid }) => await this.delete(uid),
        },
    };

    async create (payload) {
        return await this.upsert(null, payload);
    }

    async update (id, payload) {
        return await this.upsert(id, payload);
    }

    async upsert (id, payload) {
        const actor = Context.get('actor');
        const user = actor?.type?.user;
        if ( !user ) throw APIError.create('forbidden');

        const existing = id ? await this.read(id) : null;
        if ( existing ) {
            if ( existing.owner?.id !== user.id ) {
                throw APIError.create('forbidden');
            }
        }

        const normalized = {
            uid: existing?.uid || payload.uid || uuidv4(),
            user_id: existing?.owner?.id || user.id,
            value: payload.value ?? existing?.value ?? {},
            acknowledged: payload.acknowledged ?? existing?.acknowledged ?? null,
            shown: payload.shown ?? existing?.shown ?? null,
        };

        if ( existing ) {
            await this.db.write(
                'UPDATE notification SET value = ?, acknowledged = ?, shown = ? WHERE uid = ?',
                [JSON.stringify(normalized.value), normalized.acknowledged, normalized.shown, normalized.uid],
            );
            return await this.read(normalized.uid);
        }

        await this.db.write(
            'INSERT INTO notification (uid, user_id, value, acknowledged, shown) VALUES (?, ?, ?, ?, ?)',
            [
                normalized.uid,
                normalized.user_id,
                JSON.stringify(normalized.value),
                normalized.acknowledged,
                normalized.shown,
            ],
        );
        return await this.read(normalized.uid);
    }

    async delete (uid) {
        const actor = Context.get('actor');
        const user = actor?.type?.user;
        if ( !user ) throw APIError.create('forbidden');

        const existing = await this.read(uid);
        if ( !existing ) {
            throw APIError.create('entity_not_found', null, { identifier: uid });
        }
        if ( existing.owner?.id !== user.id ) {
            throw APIError.create('forbidden');
        }

        await this.db.write('DELETE FROM notification WHERE uid = ?', [uid]);
        return { uid };
    }

    async read (uid) {
        if ( !uid ) return null;

        const actor = Context.get('actor');
        const user = actor?.type?.user;

        const rows = await this.db.read('SELECT * FROM notification WHERE uid = ? LIMIT 1', [uid]);
        if ( rows.length === 0 ) return null;
        const mapped = this._map_row(rows[0]);

        if ( mapped.owner?.id !== user?.id ) return null;
        return mapped;
    }

    async select ({ predicate, limit, offset } = {}) {
        const actor = Context.get('actor');
        const user = actor?.type?.user;
        if ( !user || ! (actor.type instanceof UserActorType) ) {
            return [];
        }

        const parts = ['user_id = ?'];
        const params = [user.id];

        if ( predicate ) {
            const clause = this._build_where(predicate);
            if ( clause.sql ) {
                parts.push(clause.sql);
                params.push(...clause.params);
            }
        }

        let sql = `SELECT * FROM notification WHERE ${parts.join(' AND ')} ORDER BY created_at DESC`;
        if ( limit ) sql += ` LIMIT ${limit}`;
        if ( offset ) sql += ` OFFSET ${offset}`;

        const rows = await this.db.read(sql, params);
        return rows.map(row => this._map_row(row));
    }

    _build_where (predicate) {
        const op = predicate.op || predicate.type;
        const key = predicate.key;
        const column = key === 'acknowledge' ? 'acknowledged' : key;
        if ( op === 'eq' && key ) {
            return { sql: `${column} = ?`, params: [predicate.value] };
        }
        if ( op === 'is-not-null' && key ) {
            return { sql: `${column} IS NOT NULL`, params: [] };
        }
        return { sql: '', params: [] };
    }

    _map_row (row) {
        let value = row.value;
        if ( typeof value === 'string' ) {
            try {
                value = JSON.parse(value);
            } catch {
                value = {};
            }
        }
        return {
            uid: row.uid,
            value,
            shown: row.shown,
            acknowledge: row.acknowledged,
            created_at: row.created_at,
            owner: { id: row.user_id },
        };
    }
}

module.exports = {
    NotificationStoreService,
};
