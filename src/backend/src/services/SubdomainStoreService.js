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
const config = require('../config');
const { DB_WRITE } = require('./database/consts');
const { Context } = require('../util/context');
const { UserActorType } = require('./auth/Actor');
const uuidv4 = require('uuid').v4;

const PERM_READ_ALL_SUBDOMAINS = 'read-all-subdomains';
const WRITE_ALL_OWNER_PERM = 'system:es:write-all-owners';

class SubdomainStoreService extends BaseService {
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'subdomains');
    }

    static IMPLEMENTS = {
        ['crud-q']: {
            create: async ({ object }) => await this.create(object),
            read: async ({ uid, id }) => await this.read(uid || id),
            select: async (options = {}) => await this.select(options),
            update: async ({ object, id }) => await this.update(id, object),
            upsert: async ({ object, id }) => await this.upsert(id, object),
            delete: async ({ uid, id }) => await this.delete(uid || id),
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

        if ( !user ) {
            throw APIError.create('forbidden');
        }

        const existing = id ? await this.read(id) : null;
        if ( existing ) {
            await this._check_owner(existing);
        } else {
            await this._check_max_subdomains(user.id);
        }

        const normalized = await this._normalize_payload(payload, existing, user);

        if ( existing ) {
            await this._run_update(existing.uid, normalized);
            return await this.read(existing.uid);
        }

        const uid = normalized.uid || `sd-${ uuidv4()}`;
        await this._run_insert(uid, normalized);
        return await this.read(uid);
    }

    async delete (uid) {
        const existing = await this.read(uid);
        if ( !existing ) {
            throw APIError.create('entity_not_found', null, { identifier: uid });
        }
        await this._check_owner(existing);

        await this.db.write('DELETE FROM subdomains WHERE uuid = ?', [existing.uid]);
        return { uid };
    }

    async read (uidOrPredicate) {
        const clause = this._build_where(uidOrPredicate);
        if ( !clause.sql ) {
            throw APIError.create('invalid_id', null, { id: uidOrPredicate });
        }

        const rows = await this.db.read(
            `SELECT * FROM subdomains WHERE ${clause.sql} LIMIT 1`,
            clause.params,
        );
        if ( rows.length === 0 ) return null;

        const mapped = await this._map_row(rows[0]);
        const actor = Context.get('actor');
        if ( !this._can_read(actor, mapped) ) {
            return null;
        }
        return mapped;
    }

    async select ({ predicate, limit, offset } = {}) {
        const actor = Context.get('actor');
        const user = actor?.type?.user;

        const permission = this.services.get('permission');
        const has_read_all = await permission.check(actor, PERM_READ_ALL_SUBDOMAINS);

        const parts = [];
        const params = [];

        if ( predicate ) {
            const clause = this._build_where(predicate);
            if ( clause.sql ) {
                parts.push(clause.sql);
                params.push(...clause.params);
            }
        }

        if ( !has_read_all && user ) {
            parts.push('user_id = ?');
            params.push(user.id);
        }

        const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
        let sql = `SELECT * FROM subdomains ${where} ORDER BY id DESC`;
        if ( limit ) {
            sql += ` LIMIT ${limit}`;
        }
        if ( offset ) {
            sql += ` OFFSET ${offset}`;
        }

        const rows = await this.db.read(sql, params);
        const results = [];
        for ( const row of rows ) {
            const mapped = await this._map_row(row);
            if ( this._can_read(actor, mapped) ) {
                results.push(mapped);
            }
        }
        return results;
    }

    _build_where (predicate) {
        if ( !predicate ) return { sql: '', params: [] };

        if ( typeof predicate === 'string' ) {
            return { sql: 'uuid = ?', params: [predicate] };
        }

        if ( typeof predicate !== 'object' ) {
            return { sql: '', params: [] };
        }

        if ( predicate.hasOwnProperty('uid') ) {
            return { sql: 'uuid = ?', params: [predicate.uid] };
        }

        const op = predicate.op || predicate.type;
        if ( op === 'eq' && predicate.key ) {
            const column = this._column(predicate.key);
            return { sql: `${column} = ?`, params: [predicate.value] };
        }

        if ( op === 'starts-with' && predicate.key ) {
            const column = this._column(predicate.key);
            return { sql: `${column} LIKE ?`, params: [`${ predicate.value }%`] };
        }

        if ( op === 'or' && Array.isArray(predicate.conditions) ) {
            const children = predicate.conditions.map(p => this._build_where(p)).filter(c => c.sql);
            const sql = children.map(c => `(${c.sql})`).join(' OR ');
            const params = children.flatMap(c => c.params);
            return { sql, params };
        }

        if ( op === 'and' && Array.isArray(predicate.conditions) ) {
            const children = predicate.conditions.map(p => this._build_where(p)).filter(c => c.sql);
            const sql = children.map(c => `(${c.sql})`).join(' AND ');
            const params = children.flatMap(c => c.params);
            return { sql, params };
        }

        return { sql: '', params: [] };
    }

    _column (key) {
        const map = {
            uid: 'uuid',
            subdomain: 'subdomain',
            domain: 'domain',
            owner: 'user_id',
            root_dir: 'root_dir_id',
            associated_app: 'associated_app_id',
            app_owner: 'app_owner',
        };
        return map[key] || key;
    }

    async _normalize_payload (payload, existing, user) {
        const normalized = { ...(existing || {}) };
        if ( payload.subdomain ) {
            const subdomain = payload.subdomain.toLowerCase();
            const regex = config.subdomain_regex instanceof RegExp
                ? config.subdomain_regex
                : new RegExp(config.subdomain_regex);
            if ( !regex.test(subdomain) ) {
                throw APIError.create('field_invalid', null, { key: 'subdomain' });
            }
            if ( config.reserved_words.includes(subdomain) ) {
                throw APIError.create('subdomain_reserved', null, { subdomain });
            }
            if ( subdomain.length > config.subdomain_max_length ) {
                throw APIError.create('field_invalid', null, { key: 'subdomain' });
            }
            normalized.subdomain = subdomain;
        }

        if ( payload.domain !== undefined ) {
            normalized.domain = payload.domain ? payload.domain.toLowerCase() : null;
        }

        if ( payload.root_dir !== undefined ) {
            normalized.root_dir_id = this._node_id(payload.root_dir);
        }

        if ( payload.associated_app !== undefined ) {
            normalized.associated_app_id = payload.associated_app;
        }

        if ( payload.app_owner !== undefined ) {
            normalized.app_owner = payload.app_owner;
        }

        if ( !existing ) {
            normalized.uid = payload.uid || `sd-${ uuidv4()}`;
            normalized.user_id = user.id;
        }

        if ( !normalized.subdomain ) {
            throw APIError.create('field_missing', null, { key: 'subdomain' });
        }

        return normalized;
    }

    async _run_insert (uid, payload) {
        const stmt = `INSERT INTO subdomains
            (uuid, subdomain, user_id, root_dir_id, associated_app_id, app_owner, domain)
            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await this.db.write(stmt, [
            uid,
            payload.subdomain,
            payload.user_id,
            payload.root_dir_id ?? null,
            payload.associated_app_id ?? null,
            payload.app_owner ?? null,
            payload.domain ?? null,
        ]);
    }

    async _run_update (uid, payload) {
        const fields = [];
        const params = [];
        const map = {
            subdomain: 'subdomain',
            domain: 'domain',
            root_dir_id: 'root_dir_id',
            associated_app_id: 'associated_app_id',
            app_owner: 'app_owner',
        };
        for ( const [k, col] of Object.entries(map) ) {
            if ( payload[k] !== undefined ) {
                fields.push(`${col} = ?`);
                params.push(payload[k]);
            }
        }
        if ( fields.length === 0 ) return;
        params.push(uid);
        await this.db.write(
            `UPDATE subdomains SET ${fields.join(', ')} WHERE uuid = ?`,
            params,
        );
    }

    async _map_row (row) {
        return {
            uid: row.uuid,
            subdomain: row.subdomain,
            domain: row.domain,
            root_dir: row.root_dir_id,
            associated_app: row.associated_app_id,
            app_owner: row.app_owner,
            owner: { id: row.user_id },
            protected: !!row.protected,
            created_at: row.ts,
        };
    }

    _node_id (node) {
        if ( node === null || node === undefined ) return null;
        if ( typeof node === 'number' ) return node;
        if ( typeof node === 'string' ) return node;
        if ( node.mysql_id ) return node.mysql_id;
        if ( node.id ) return node.id;
        if ( node.private_meta?.mysql_id ) return node.private_meta.mysql_id;
        return node;
    }

    async _check_owner (subdomain) {
        const actor = Context.get('actor');
        const permission = this.services.get('permission');
        const has_override = await permission.check(actor, WRITE_ALL_OWNER_PERM);
        if ( has_override ) return;

        if ( !(actor?.type instanceof UserActorType) ) {
            throw APIError.create('forbidden');
        }

        if ( subdomain.owner?.id !== actor.type.user.id ) {
            throw APIError.create('forbidden');
        }
    }

    _can_read (actor, subdomain) {
        if ( !subdomain ) return false;
        if ( subdomain.protected !== 1 && subdomain.protected !== true ) return true;

        if ( actor?.type instanceof UserActorType ) {
            return subdomain.owner?.id === actor.type.user.id;
        }

        return false;
    }

    async _check_max_subdomains (user_id) {
        const [{ subdomain_count }] = await this.db.read(
            'SELECT COUNT(id) AS subdomain_count FROM subdomains WHERE user_id = ?',
            [user_id],
        );

        const svc_su = this.services.get('su');
        const max = await svc_su.sudo(async () => {
            const user = Context.get('user');
            return user?.max_subdomains ?? config.max_subdomains_per_user;
        });

        if ( max && subdomain_count >= max ) {
            throw APIError.create('subdomain_limit_reached', null, { limit: max });
        }
    }
}

module.exports = {
    SubdomainStoreService,
};
