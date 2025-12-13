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
const { app_name_exists, refresh_apps_cache } = require('../helpers');
const { DB_WRITE } = require('./database/consts');
const { Context } = require('../util/context');
const { origin_from_url } = require('../util/urlutil');
const { AppUnderUserActorType, UserActorType } = require('./auth/Actor');
const { PermissionUtil } = require('./auth/permissionUtils.mjs');
const uuidv4 = require('uuid').v4;

const WRITE_ALL_OWNER_PERM = 'system:es:write-all-owners';

class AppStoreService extends BaseService {
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'apps');
    }

    static IMPLEMENTS = {
        ['crud-q']: {
            create: async ({ object, options }) => await this.create(object, options),
            read: async ({ uid, id, params }) => await this.read(uid || id, params),
            select: async (options = {}) => await this.select(options),
            update: async ({ object, id, options }) => await this.update(id, object, options),
            upsert: async ({ object, id, options }) => await this.upsert(id, object, options),
            delete: async ({ uid, id }) => await this.delete(uid || id),
        },
    };

    async create (payload, options = {}) {
        return await this.upsert(null, payload, options);
    }

    async update (id, payload, options = {}) {
        return await this.upsert(id, payload, options);
    }

    async upsert (id, payload, options = {}) {
        const actor = Context.get('actor');
        const user = actor?.type?.user;
        if ( !user ) throw APIError.create('forbidden');

        const existing = id ? await this.read(id) : null;
        if ( existing ) {
            await this._check_owner(existing);
        }

        const normalized = await this._normalize_payload(payload, existing, options);
        if ( existing ) {
            await this._run_update(existing.uid, normalized);
            await this._sync_associations(existing.id, normalized.filetype_associations);
            await this._emit_events(existing, normalized);
            return await this.read(existing.uid);
        }

        const uid = normalized.uid || `app-${ uuidv4()}`;
        const app_id = await this._run_insert(uid, user.id, normalized);
        await this._sync_associations(app_id, normalized.filetype_associations);
        return await this.read(uid);
    }

    async delete (uid) {
        const existing = await this.read(uid);
        if ( !existing ) {
            throw APIError.create('entity_not_found', null, { identifier: uid });
        }
        await this._check_owner(existing);

        await this.db.write('DELETE FROM apps WHERE uid = ?', [uid]);
        await this.db.write('DELETE FROM app_filetype_association WHERE app_id = ?', [existing.id]);
        return { uid };
    }

    async read (identifier, params = {}) {
        const actor = Context.get('actor');
        const clause = this._build_where(identifier);
        if ( !clause.sql ) return null;
        const rows = await this.db.read(
            `SELECT * FROM apps WHERE ${clause.sql} LIMIT 1`,
            clause.params,
        );
        if ( rows.length === 0 ) return null;

        const mapped = await this._map_row(rows[0], params);
        if ( !await this._can_read(actor, mapped) ) {
            return null;
        }
        return mapped;
    }

    async select ({ predicate, limit, offset, params } = {}) {
        const actor = Context.get('actor');
        const user = actor?.type?.user;
        const parts = [];
        const values = [];

        if ( predicate ) {
            const clause = this._build_where(predicate);
            if ( clause.sql ) {
                parts.push(clause.sql);
                values.push(...clause.params);
            }
        }

        // Visibility rules
        const visibility = [];
        if ( user ) {
            visibility.push('approved_for_listing = 1');
            visibility.push('owner_user_id = ?');
            values.push(user.id);
        }

        if ( actor?.type instanceof AppUnderUserActorType ) {
            visibility.push('uid = ?');
            values.push(actor.type.app.uid);
        }

        if ( visibility.length ) {
            parts.push(`(${visibility.join(' OR ')})`);
        }

        let sql = 'SELECT * FROM apps';
        if ( parts.length ) {
            sql += ` WHERE ${parts.join(' AND ')}`;
        }
        sql += ' ORDER BY id DESC';
        if ( limit ) sql += ` LIMIT ${limit}`;
        if ( offset ) sql += ` OFFSET ${offset}`;

        const rows = await this.db.read(sql, values);
        const results = [];
        for ( const row of rows ) {
            const mapped = await this._map_row(row, params);
            if ( await this._can_read(actor, mapped) ) {
                results.push(mapped);
            }
        }
        return results;
    }

    _build_where (predicate) {
        if ( !predicate ) return { sql: '', params: [] };

        if ( typeof predicate === 'string' ) {
            return { sql: 'uid = ?', params: [predicate] };
        }

        if ( typeof predicate !== 'object' ) {
            return { sql: '', params: [] };
        }

        if ( predicate.hasOwnProperty('uid') ) {
            return { sql: 'uid = ?', params: [predicate.uid] };
        }

        const op = predicate.op || predicate.type;
        if ( op === 'eq' && predicate.key ) {
            return { sql: `${this._column(predicate.key)} = ?`, params: [predicate.value] };
        }
        if ( op === 'like' && predicate.key ) {
            return { sql: `${this._column(predicate.key)} LIKE ?`, params: [predicate.value] };
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
            uid: 'uid',
            name: 'name',
            title: 'title',
            owner: 'owner_user_id',
            app_owner: 'app_owner',
            approved_for_listing: 'approved_for_listing',
        };
        return map[key] || key;
    }

    async _normalize_payload (payload, existing, options) {
        const normalized = { ...(existing || {}) };
        const actor = Context.get('actor');
        const user = actor?.type?.user;

        if ( payload.name ) {
            const name_regex = config.app_name_regex instanceof RegExp
                ? config.app_name_regex
                : new RegExp(config.app_name_regex);
            if ( !name_regex.test(payload.name) ) {
                throw APIError.create('field_invalid', null, { key: 'name' });
            }
            if ( payload.name.length > config.app_name_max_length ) {
                throw APIError.create('field_invalid', null, { key: 'name' });
            }
            const name_taken = await app_name_exists(payload.name);
            if ( name_taken && (!existing || existing.name !== payload.name) ) {
                if ( options?.dedupe_name ) {
                    const base = payload.name;
                    let number = 1;
                    let candidate = `${base}-${number}`;
                    while ( await app_name_exists(candidate) ) {
                        number++;
                        candidate = `${base}-${number}`;
                    }
                    payload.name = candidate;
                } else {
                    throw APIError.create('app_name_already_in_use', null, { name: payload.name });
                }
            }
            normalized.name = payload.name;
        }

        const stringProps = ['title', 'description', 'icon', 'index_url'];
        for ( const prop of stringProps ) {
            if ( payload[prop] !== undefined ) {
                normalized[prop] = payload[prop];
            }
        }

        if ( payload.metadata !== undefined ) {
            normalized.metadata = payload.metadata;
        }

        if ( payload.maximize_on_start !== undefined ) {
            normalized.maximize_on_start = payload.maximize_on_start ? 1 : 0;
        }
        if ( payload.background !== undefined ) {
            normalized.background = payload.background ? 1 : 0;
        }
        if ( payload.app_owner !== undefined ) {
            normalized.app_owner = payload.app_owner;
        }

        if ( payload.filetype_associations !== undefined ) {
            normalized.filetype_associations = payload.filetype_associations;
        } else if ( existing?.filetype_associations ) {
            normalized.filetype_associations = existing.filetype_associations;
        } else {
            normalized.filetype_associations = [];
        }

        if ( !existing ) {
            normalized.uid = payload.uid || `app-${ uuidv4()}`;
            normalized.owner_user_id = user.id;
        }

        for ( const required of ['name', 'title', 'index_url'] ) {
            if ( !normalized[required] ) {
                throw APIError.create('field_missing', null, { key: required });
            }
        }

        // Derive index_url when subdomain and source directory provided
        if ( payload.subdomain && payload.source_directory ) {
            normalized.index_url = `${config.protocol}://${payload.subdomain}.puter.site`;
        }

        return normalized;
    }

    async _run_insert (uid, owner_id, payload) {
        const stmt = `INSERT INTO apps
            (uid, owner_user_id, icon, name, title, description, maximize_on_start, background, index_url, metadata, app_owner)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const res = await this.db.write(stmt, [
            uid,
            owner_id,
            payload.icon ?? null,
            payload.name,
            payload.title,
            payload.description ?? null,
            payload.maximize_on_start ? 1 : 0,
            payload.background ? 1 : 0,
            payload.index_url,
            payload.metadata ? JSON.stringify(payload.metadata) : null,
            payload.app_owner ?? null,
        ]);
        return res.insertId || res.lastInsertRowid || res.insert_id;
    }

    async _run_update (uid, payload) {
        const fields = [];
        const params = [];
        const map = {
            icon: 'icon',
            name: 'name',
            title: 'title',
            description: 'description',
            maximize_on_start: 'maximize_on_start',
            background: 'background',
            index_url: 'index_url',
            metadata: 'metadata',
            app_owner: 'app_owner',
        };
        for ( const [k, col] of Object.entries(map) ) {
            if ( payload[k] !== undefined ) {
                fields.push(`${col} = ?`);
                params.push(k === 'metadata' ? JSON.stringify(payload[k]) : payload[k]);
            }
        }
        if ( fields.length === 0 ) return;
        params.push(uid);
        await this.db.write(
            `UPDATE apps SET ${fields.join(', ')} WHERE uid = ?`,
            params,
        );
    }

    async _sync_associations (app_id, associations) {
        if ( !app_id ) return;
        await this.db.write('DELETE FROM app_filetype_association WHERE app_id = ?', [app_id]);
        if ( !associations || associations.length === 0 ) return;

        const values = [];
        const placeholders = [];
        for ( const type of associations ) {
            placeholders.push('(?, ?)');
            values.push(app_id, type.toLowerCase());
        }
        await this.db.write(
            `INSERT INTO app_filetype_association (app_id, type) VALUES ${placeholders.join(', ')}`,
            values,
        );
    }

    async _emit_events (existing, payload) {
        const svc_event = this.services.get('event');
        if ( payload.icon && payload.icon !== existing.icon ) {
            const event = {
                app_uid: existing.uid,
                data_url: payload.icon,
            };
            await svc_event.emit('app.new-icon', event);
        }

        if ( payload.name && payload.name !== existing.name ) {
            const event = {
                app_uid: existing.uid,
                new_name: payload.name,
                old_name: existing.name,
            };
            await svc_event.emit('app.rename', event);
        }
    }

    async _map_row (row, params = {}) {
        const app = {
            id: row.id,
            uid: row.uid,
            name: row.name,
            title: row.title,
            description: row.description,
            icon: row.icon,
            index_url: row.index_url,
            maximize_on_start: !!row.maximize_on_start,
            background: !!row.background,
            approved_for_listing: !!row.approved_for_listing,
            approved_for_opening_items: !!row.approved_for_opening_items,
            approved_for_incentive_program: !!row.approved_for_incentive_program,
            last_review: row.last_review,
            created_at: row.timestamp,
            owner: row.owner_user_id ? { id: row.owner_user_id } : null,
            app_owner: row.app_owner ? { id: row.app_owner } : null,
            protected: !!row.protected,
        };

        if ( row.metadata ) {
            try {
                app.metadata = JSON.parse(row.metadata);
            } catch {
                app.metadata = row.metadata;
            }
        }

        app.filetype_associations = await this._fetch_filetype_associations(row.id);

        const actor = Context.get('actor');
        if ( !(actor?.type instanceof UserActorType) || actor.type.user.id !== app.owner?.id ) {
            delete app.approved_for_listing;
            delete app.approved_for_opening_items;
            delete app.approved_for_incentive_program;
        }

        const es_params = Context.get('es_params') || params;
        if ( es_params?.icon_size ) {
            const svc_appIcon = this.services.get('app-icon');
            try {
                const icon_result = await svc_appIcon.get_icon_stream({
                    app_uid: app.uid,
                    app_icon: app.icon,
                    size: es_params.icon_size,
                });
                app.icon = await icon_result.get_data_url();
            } catch (e) {
                const svc_error = this.services.get('error-service');
                svc_error.report('AppStoreService:icon', { source: e });
            }
        }

        if ( es_params?.stats_period ) {
            const svc_appInformation = this.services.get('app-information');
            app.stats = await svc_appInformation.get_stats(
                app.uid,
                {
                    period: es_params.stats_period,
                    grouping: es_params.stats_grouping,
                    created_at: app.created_at,
                },
            );
        }

        try {
            const origin = origin_from_url(app.index_url);
            const svc_auth = this.services.get('auth');
            const expected_uid = await svc_auth.app_uid_from_origin(origin);
            app.created_from_origin = expected_uid === app.uid ? origin : null;
        } catch {
            app.created_from_origin = null;
        }

        refresh_apps_cache({ uid: app.uid }, app);
        return app;
    }

    async _fetch_filetype_associations (app_id) {
        if ( !app_id ) return [];
        const rows = await this.db.read(
            'SELECT type FROM app_filetype_association WHERE app_id = ?',
            [app_id],
        );
        return rows.map(r => r.type);
    }

    async _can_read (actor, app) {
        if ( !app ) return false;

        if ( app.protected ) {
            if ( actor?.type instanceof AppUnderUserActorType && actor.type.app.uid === app.uid ) {
                return true;
            }
            if ( actor?.type instanceof UserActorType && app.owner?.id === actor.type.user.id ) {
                return true;
            }
            const permission = this.services.get('permission');
            const perm = `app:uid#${app.uid}:access`;
            const reading = await permission.scan(actor, perm);
            const options = PermissionUtil.reading_to_options(reading);
            return options.length > 0;
        }

        return true;
    }

    async _check_owner (app) {
        const actor = Context.get('actor');
        const permission = this.services.get('permission');
        const has_override = await permission.check(actor, WRITE_ALL_OWNER_PERM);
        if ( has_override ) return;

        if ( actor?.type instanceof UserActorType ) {
            if ( app.owner?.id === actor.type.user.id ) return;
        }

        if ( actor?.type instanceof AppUnderUserActorType ) {
            const perm = PermissionUtil.join('apps-of-user', actor.type.user.uuid, 'write');
            const can_write_any = await permission.check(actor, perm);
            if ( can_write_any ) return;
            if ( app.app_owner?.id === actor.type.app.id ) return;
        }

        throw APIError.create('forbidden');
    }
}

module.exports = {
    AppStoreService,
};
