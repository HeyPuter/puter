import { v4 as uuidv4 } from 'uuid';

import APIError from '../../api/APIError.js';
import config from '../../config.js';
import { app_name_exists, refresh_apps_cache } from '../../helpers.js';
import { AppUnderUserActorType, UserActorType } from '../../services/auth/Actor.js';
import BaseService from '../../services/BaseService.js';
import { DB_READ, DB_WRITE } from '../../services/database/consts.js';
import { Context } from '../../util/context.js';
import AppRepository from './AppRepository.js';
import { as_bool } from './lib/coercion.js';
import { user_to_client } from './lib/filter.js';
import { extract_from_prefix } from './lib/sqlutil.js';
import {
    validate_array_of_strings,
    validate_image_base64,
    validate_json,
    validate_string,
    validate_url,
} from './lib/validation.js';

/**
 * AppService contains an instance using the repository pattern
 */
export default class AppService extends BaseService {
    async _init () {
        this.repository = new AppRepository();
        this.db = this.services.get('database').get(DB_READ, 'apps');
        this.db_write = this.services.get('database').get(DB_WRITE, 'apps');
    }

    static PROTECTED_FIELDS = ['last_review'];
    static READ_ONLY_FIELDS = [
        'approved_for_listing',
        'approved_for_opening_items',
        'approved_for_incentive_program',
        'godmode',
    ];
    static WRITE_ALL_OWNER_PERMISSION = 'system:es:write-all-owners';

    static IMPLEMENTS = {
        ['crud-q']: {
            async create ({ object, options }) {
                return await this.#create({ object, options });
            },
            async update ({ object, id, options }) {
                return await this.#update({ object, id, options });
            },
            async upsert ({ object, id, options }) {
                // Try to find an existing entity
                let existing = null;

                if ( object.uid !== undefined || id !== undefined ) {
                    try {
                        existing = await this.#read({
                            uid: object.uid,
                            id,
                        });
                    } catch ( error ) {
                        // If entity not found, we'll create it
                        if ( error.fields?.code !== 'entity_not_found' ) {
                            throw error;
                        }
                    }
                }

                if ( existing ) {
                    // Entity exists, call update
                    return await this.#update({ object, id, options });
                } else {
                    // Entity doesn't exist, call create
                    return await this.#create({ object, options });
                }
            },
            async read ({ uid, id, params = {} }) {
                return this.#read({ uid, id, params });
            },
            async select (options) {
                return this.#select(options);
            },
            async delete ({ uid, id }) {
                return await this.#delete({ uid, id });
            },
        },
    };

    // value of require('om/mappings/app.js').redundant_identifiers
    static REDUNDANT_IDENTIFIERS = ['name'];

    async #select ({ predicate, params, ...rest }) {
        const db = this.db;

        if ( predicate === undefined ) predicate = [];
        if ( params === undefined ) params = {};
        if ( ! Array.isArray(predicate) ) throw new Error('predicate must be an array');

        const userCanEditOnly = Array.prototype.includes.call(predicate, 'user-can-edit');

        const sql_associatedFiletypes = this.db.case({
            mysql: 'COALESCE(JSON_ARRAYAGG(afa.type), JSON_ARRAY())',
            sqlite: "COALESCE(json_group_array(afa.type), json('[]'))",
        });

        const stmt = 'SELECT apps.*, ' +
            'owner_user.username AS owner_user_username, ' +
            'owner_user.uuid AS owner_user_uuid, ' +
            'app_owner.uid AS app_owner_uid, ' +
            `${sql_associatedFiletypes} AS filetypes ` +
            'FROM apps ' +
            'LEFT JOIN user owner_user ON apps.owner_user_id = owner_user.id ' +
            'LEFT JOIN apps app_owner ON apps.app_owner = app_owner.id ' +
            'LEFT JOIN app_filetype_association afa ON apps.id = afa.app_id ' +
            `${userCanEditOnly ? 'WHERE apps.owner_user_id=?' : ''} ` +
            'GROUP BY apps.id ' +
            'LIMIT 5000';
        const values = userCanEditOnly ? [Context.get('user').id] : [];
        const rows = await db.read(stmt, values);

        const client_safe_apps = [];
        for ( const row of rows ) {
            const app = {};

            // FROM ROW
            app.approved_for_incentive_program = as_bool(row.approved_for_incentive_program);
            app.approved_for_listing = as_bool(row.approved_for_listing);
            app.approved_for_opening_items = as_bool(row.approved_for_opening_items);
            app.background = as_bool(row.background);
            app.created_at = row.created_at;
            app.created_from_origin = row.created_from_origin;
            app.description = row.description;
            app.godmode = as_bool(row.godmode);
            app.icon = row.icon;
            app.index_url = row.index_url;
            app.maximize_on_start = as_bool(row.maximize_on_start);
            app.metadata = row.metadata;
            app.name = row.name;
            app.protected = as_bool(row.protected);
            app.stats = row.stats;
            app.title = row.title;
            app.uid = row.uid;

            // REQURIES OTHER DATA
            // app.app_owner;
            // app.filetype_associations = row.filetype_associations;
            // app.owner = row.owner;

            app.app_owner = {
                uid: row.app_owner_uid,
            };

            {
                const owner_user = extract_from_prefix(row, 'owner_user_');
                app.owner = user_to_client(owner_user);
            }

            if ( typeof row.filetypes === 'string' ) {
                try {
                    let filetypesAsJSON = JSON.parse(row.filetypes);
                    filetypesAsJSON = filetypesAsJSON.filter(ft => ft !== null);
                    for ( let i = 0 ; i < filetypesAsJSON.length ; i++ ) {
                        if ( typeof filetypesAsJSON[i] !== 'string' ) {
                            throw new Error(`expected filetypesAsJSON[${i}] to be a string, got: ${filetypesAsJSON[i]}`);
                        }
                        if ( String.prototype.startsWith.call(filetypesAsJSON[i], '.') ) {
                            filetypesAsJSON[i] = filetypesAsJSON[i].slice(1);
                        }
                    }
                    app.filetype_associations = filetypesAsJSON;
                } catch (e) {
                    throw new Error(`failed to get app filetype associations: ${e.message}`, { cause: e });
                }
            }

            // REFINED BY OTHER DATA
            // app.icon;
            if ( params.icon_size ) {
                const icon_size = params.icon_size;
                const svc_appIcon = this.context.get('services').get('app-icon');
                try {
                    const icon_result = await svc_appIcon.get_icon_stream({
                        app_uid: row.uid,
                        app_icon: row.icon,
                        size: icon_size,
                    });
                    console.log('this is working it looks like');
                    app.icon = await icon_result.get_data_url();
                } catch (e) {
                    const svc_error = this.context.get('services').get('error-service');
                    svc_error.report('AppES:read_transform', { source: e });
                }
            }

            client_safe_apps.push(app);
        }

        return client_safe_apps;
    }

    async #read ({ uid, id, params = {}, backend_only_options = {} }) {
        const db = this.db;

        if ( uid === undefined && id === undefined ) {
            throw new Error('read requires either uid or id');
        }

        const sql_associatedFiletypes = this.db.case({
            mysql: 'COALESCE(JSON_ARRAYAGG(afa.type), JSON_ARRAY())',
            sqlite: "COALESCE(json_group_array(afa.type), json('[]'))",
        });

        // Build WHERE clause based on identifier type
        let whereClause;
        let whereValues;

        if ( uid !== undefined ) {
            // Simple uid lookup
            whereClause = 'apps.uid = ?';
            whereValues = [uid];
        } else if ( id !== null && typeof id === 'object' && !Array.isArray(id) ) {
            // Complex id lookup (e.g., { name: 'editor' })
            const { clause, values } = this.#build_complex_id_where(id);
            whereClause = clause;
            whereValues = values;
        } else {
            throw APIError.create('invalid_id', null, { id });
        }

        const stmt = 'SELECT apps.*, ' +
            'owner_user.username AS owner_user_username, ' +
            'owner_user.uuid AS owner_user_uuid, ' +
            'app_owner.uid AS app_owner_uid, ' +
            `${sql_associatedFiletypes} AS filetypes ` +
            'FROM apps ' +
            'LEFT JOIN user owner_user ON apps.owner_user_id = owner_user.id ' +
            'LEFT JOIN apps app_owner ON apps.app_owner = app_owner.id ' +
            'LEFT JOIN app_filetype_association afa ON apps.id = afa.app_id ' +
            `WHERE ${whereClause} ` +
            'GROUP BY apps.id ' +
            'LIMIT 1';

        const rows = await db.read(stmt, whereValues);

        if ( rows.length === 0 ) {
            throw APIError.create('entity_not_found', null, {
                identifier: uid || JSON.stringify(id),
            });
        }

        const row = rows[0];
        const app = {};

        app.approved_for_incentive_program = as_bool(row.approved_for_incentive_program);
        app.approved_for_listing = as_bool(row.approved_for_listing);
        app.approved_for_opening_items = as_bool(row.approved_for_opening_items);
        app.background = as_bool(row.background);
        app.created_at = row.created_at;
        app.created_from_origin = row.created_from_origin;
        app.description = row.description;
        app.godmode = as_bool(row.godmode);
        app.icon = row.icon;
        app.index_url = row.index_url;
        app.maximize_on_start = as_bool(row.maximize_on_start);
        app.metadata = row.metadata;
        app.name = row.name;
        app.protected = as_bool(row.protected);
        app.stats = row.stats;
        app.title = row.title;
        app.uid = row.uid;

        app.app_owner = {
            uid: row.app_owner_uid,
        };

        {
            const owner_user = extract_from_prefix(row, 'owner_user_');
            if ( backend_only_options.no_filter_owner ) app.owner = owner_user;
            else app.owner = user_to_client(owner_user);
        }

        if ( typeof row.filetypes === 'string' ) {
            try {
                let filetypesAsJSON = JSON.parse(row.filetypes);
                filetypesAsJSON = filetypesAsJSON.filter(ft => ft !== null);
                for ( let i = 0 ; i < filetypesAsJSON.length ; i++ ) {
                    if ( typeof filetypesAsJSON[i] !== 'string' ) {
                        throw new Error(`expected filetypesAsJSON[${i}] to be a string, got: ${filetypesAsJSON[i]}`);
                    }
                    if ( String.prototype.startsWith.call(filetypesAsJSON[i], '.') ) {
                        filetypesAsJSON[i] = filetypesAsJSON[i].slice(1);
                    }
                }
                app.filetype_associations = filetypesAsJSON;
            } catch (e) {
                throw new Error(`failed to get app filetype associations: ${e.message}`, { cause: e });
            }
        }

        if ( params.icon_size ) {
            const icon_size = params.icon_size;
            const svc_appIcon = this.context.get('services').get('app-icon');
            try {
                const icon_result = await svc_appIcon.get_icon_stream({
                    app_uid: row.uid,
                    app_icon: row.icon,
                    size: icon_size,
                });
                app.icon = await icon_result.get_data_url();
            } catch (e) {
                const svc_error = this.context.get('services').get('error-service');
                svc_error.report('AppES:read_transform', { source: e });
            }
        }

        return app;
    }

    async #create ({ object, options }) {
        // Only UserActorType and AppUnderUserActorType are allowed to do this
        const actor = Context.get('actor');
        if ( ! (actor.type instanceof UserActorType || actor.type instanceof AppUnderUserActorType) ) {
            throw APIError.create('forbidden');
        }

        const user = actor.type.user;

        // Remove protected/read_only fields from the input (ValidationES behavior)
        {
            object = { ...object };
            for ( const field of this.constructor.PROTECTED_FIELDS ) {
                delete object[field];
            }
            for ( const field of this.constructor.READ_ONLY_FIELDS ) {
                delete object[field];
            }
        }

        // Validate required fields
        {
            if ( object.name === undefined ) {
                throw APIError.create('field_missing', null, { key: 'name' });
            }
            if ( object.title === undefined ) {
                throw APIError.create('field_missing', null, { key: 'title' });
            }
            if ( object.index_url === undefined ) {
                throw APIError.create('field_missing', null, { key: 'index_url' });
            }
        }

        // Validate fields
        {
            validate_string(object.name, {
                key: 'name',
                maxlen: config.app_name_max_length,
                regex: config.app_name_regex,
            });

            validate_string(object.title, {
                key: 'title',
                maxlen: config.app_title_max_length,
            });

            if ( object.description !== undefined && object.description !== null ) {
                validate_string(object.description, {
                    key: 'description',
                    maxlen: 7000,
                });
            }

            if ( object.icon !== undefined && object.icon !== null ) {
                validate_image_base64(object.icon, { key: 'icon' });
            }

            validate_url(object.index_url, {
                key: 'index_url',
                maxlen: 3000,
            });

            if ( object.maximize_on_start !== undefined ) {
                object.maximize_on_start = as_bool(object.maximize_on_start);
            }
            if ( object.background !== undefined ) {
                object.background = as_bool(object.background);
            }

            if ( object.metadata !== undefined && object.metadata !== null ) {
                validate_json(object.metadata, { key: 'metadata' });
            }

            if ( object.filetype_associations !== undefined ) {
                validate_array_of_strings(object.filetype_associations, {
                    key: 'filetype_associations',
                });
            }
        }

        // Ensure puter.site subdomain is owned by user (if index_url uses it)
        await this.#ensure_puter_site_subdomain_is_owned(object.index_url, user);

        // Handle app name conflicts (AppES behavior)
        if ( await app_name_exists(object.name) ) {
            if ( options?.dedupe_name ) {
                const base = object.name;
                let number = 1;
                while ( await app_name_exists(`${base}-${number}`) ) {
                    number++;
                }
                object.name = `${base}-${number}`;
            } else {
                throw APIError.create('app_name_already_in_use', null, {
                    name: object.name,
                });
            }
        }

        // Generate UID for the new app (puter-uuid format: app-{uuid})
        const uid = `app-${uuidv4()}`;

        // Determine app_owner if actor is AppUnderUserActorType (SetOwnerES behavior)
        let app_owner_id = null;
        if ( actor.type instanceof AppUnderUserActorType ) {
            app_owner_id = actor.type.app.id;
        }

        // Execute SQL INSERT
        const insert_id = await this.#execute_insert(object, uid, user.id, app_owner_id);

        // Handle file type associations
        if ( object.filetype_associations ) {
            await this.#update_filetype_associations(insert_id, object.filetype_associations);
        }

        // Emit icon event if icon is set
        if ( object.icon ) {
            const svc_event = this.services.get('event');
            const event = {
                app_uid: uid,
                data_url: object.icon,
            };
            await svc_event.emit('app.new-icon', event);
        }

        // Update app cache
        const raw_app = {
            uuid: uid,
            owner_user_id: user.id,
            name: object.name,
            title: object.title,
            description: object.description,
            icon: object.icon,
            index_url: object.index_url,
            maximize_on_start: object.maximize_on_start,
        };
        refresh_apps_cache({ uid: raw_app.uuid }, raw_app);

        // Return the created app
        return await this.#read({ uid });
    }

    async #execute_insert (object, uid, owner_user_id, app_owner_id) {
        const columns = ['uid', 'owner_user_id'];
        const values = [uid, owner_user_id];

        if ( app_owner_id !== null ) {
            columns.push('app_owner');
            values.push(app_owner_id);
        }

        const sql_column_map = {
            name: 'name',
            title: 'title',
            description: 'description',
            icon: 'icon',
            index_url: 'index_url',
            maximize_on_start: 'maximize_on_start',
            background: 'background',
            metadata: 'metadata',
        };

        for ( const [field, column] of Object.entries(sql_column_map) ) {
            if ( object[field] === undefined ) continue;

            let value = object[field];

            // Handle JSON fields
            if ( field === 'metadata' && value !== null ) {
                value = JSON.stringify(value);
            }

            // Handle boolean fields
            if ( field === 'maximize_on_start' || field === 'background' ) {
                value = value ? 1 : 0;
            }

            columns.push(column);
            values.push(value);
        }

        const placeholders = columns.map(() => '?').join(', ');
        const stmt = `INSERT INTO apps (${columns.join(', ')}) VALUES (${placeholders})`;
        const result = await this.db_write.write(stmt, values);

        return result.insertId;
    }

    async #delete ({ uid, id }) {
        // Only UserActorType and AppUnderUserActorType are allowed to do this
        const actor = Context.get('actor');
        if ( ! (actor.type instanceof UserActorType || actor.type instanceof AppUnderUserActorType) ) {
            throw APIError.create('forbidden');
        }

        // Read the existing app
        const old_app = await this.#read({
            uid,
            id,
            backend_only_options: { no_filter_owner: true },
        });
        if ( ! old_app ) {
            throw APIError.create('entity_not_found', null, {
                identifier: uid || JSON.stringify(id),
            });
        }

        // Check owner permission (WriteByOwnerOnlyES behavior)
        await this.#check_owner_permission(old_app);

        // If actor is AppUnderUserActorType, check app_owner (AppLimitedES behavior)
        if ( actor.type instanceof AppUnderUserActorType ) {
            await this.#check_app_owner_permission(old_app, actor);
        }

        // Call app-information service to perform the deletion (AppES behavior)
        const svc_appInformation = this.services.get('app-information');
        await svc_appInformation.delete_app(old_app.uid);

        // Invalidate app cache
        refresh_apps_cache({ uid: old_app.uid }, null);

        return { success: true, uid: old_app.uid };
    }

    async #check_app_owner_permission (old_app, actor) {
        // Check if app has write permission to all user's apps
        const svc_permission = this.services.get('permission');
        const user = actor.type.user;
        const perm = `es:app:${user.uuid}:write`;
        const can_write_any = await svc_permission.check(actor, perm);
        if ( can_write_any ) {
            return;
        }

        // Otherwise verify the app owns this entity
        const app = actor.type.app;
        const app_owner = old_app.app_owner;
        const app_owner_uid = app_owner?.uid;

        if ( ! app_owner_uid || app_owner_uid !== app.uid ) {
            throw APIError.create('forbidden');
        }
    }

    async #update ({ object, id, options }) {
        const old_app = await this.#read({
            uid: object.uid,
            id,
            backend_only_options: { no_filter_owner: true },
        });
        if ( ! old_app ) {
            throw APIError.create('entity_not_found', null, {
                identifier: object.uid || JSON.stringify(id),
            });
        }

        // Only UserActorType and AppUnderUserActorType are allowed to do this
        const actor = Context.get('actor');
        if ( ! (actor.type instanceof UserActorType || actor.type instanceof AppUnderUserActorType) ) {
            throw APIError.create('forbidden');
        }

        // Check owner permission (WriteByOwnerOnlyES behavior)
        await this.#check_owner_permission(old_app);

        // If actor is AppUnderUserActorType, check app_owner (AppLimitedES behavior)
        if ( actor.type instanceof AppUnderUserActorType ) {
            await this.#check_app_owner_permission(old_app, actor);
        }

        // Remove protected/read_only fields from the update (ValidationES behavior)
        {
            object = { ...object };
            for ( const field of this.constructor.PROTECTED_FIELDS ) {
                delete object[field];
            }
            for ( const field of this.constructor.READ_ONLY_FIELDS ) {
                delete object[field];
            }
        }

        // Validate fields
        {
            if ( object.name !== undefined ) {
                validate_string(object.name, {
                    key: 'name',
                    maxlen: config.app_name_max_length,
                    regex: config.app_name_regex,
                });
            }

            if ( object.title !== undefined ) {
                validate_string(object.title, {
                    key: 'title',
                    maxlen: config.app_title_max_length,
                });
            }

            if ( object.description !== undefined && object.description !== null ) {
                validate_string(object.description, {
                    key: 'description',
                    maxlen: 7000,
                });
            }

            if ( object.icon !== undefined && object.icon !== null ) {
                validate_image_base64(object.icon, { key: 'icon' });
            }

            if ( object.index_url !== undefined ) {
                validate_url(object.index_url, {
                    key: 'index_url',
                    maxlen: 3000,
                });
            }

            // Flag type - adapt values using as_bool
            if ( object.maximize_on_start !== undefined ) {
                object.maximize_on_start = as_bool(object.maximize_on_start);
            }
            if ( object.background !== undefined ) {
                object.background = as_bool(object.background);
            }

            if ( object.metadata !== undefined && object.metadata !== null ) {
                validate_json(object.metadata, { key: 'metadata' });
            }

            if ( object.filetype_associations !== undefined ) {
                validate_array_of_strings(object.filetype_associations, {
                    key: 'filetype_associations',
                });
            }
        }

        // Handle app-specific logic (AppES behavior)
        const user = actor.type.user;

        // Ensure puter.site subdomain is owned by user (if index_url changed)
        if ( object.index_url && object.index_url !== old_app.index_url ) {
            await this.#ensure_puter_site_subdomain_is_owned(object.index_url, user);
        }

        // Handle app name conflicts
        if ( object.name !== undefined ) {
            await this.#handle_name_conflict(object, old_app, options);
        }

        // Build and execute SQL UPDATE
        const { insert_id } = await this.#execute_update(object, old_app);

        // Handle file type associations
        if ( object.filetype_associations !== undefined ) {
            await this.#update_filetype_associations(insert_id, object.filetype_associations);
        }

        // Emit events for icon/name changes
        await this.#emit_change_events(object, old_app);

        // Update app cache
        const merged_app = { ...old_app, ...object };
        this.#refresh_cache(merged_app, old_app);

        // Return the updated app (re-fetch for client-safe output)
        // TODO: optimize this
        return await this.#read({ uid: old_app.uid });
    }

    async #check_owner_permission (old_app) {
        const svc_permission = this.services.get('permission');
        const actor = Context.get('actor');

        // Check if user has system-wide write permission
        {
            /* eslint-disable */ // We need to fix eslint rule for multi-line calls
            const has_permission_to_write_all = await svc_permission.check(
                actor,
                this.constructor.WRITE_ALL_OWNER_PERMISSION,
            );
            /* eslint-enable */
            if ( has_permission_to_write_all ) {
                return;
            }
        }

        // Check if user owns the app
        {
            const user = Context.get('user');
            if ( ! old_app.owner ) {
                throw APIError.create('forbidden');
            }
            if ( user.id !== old_app.owner.id ) {
                throw APIError.create('forbidden');
            }
        }
    }

    async #ensure_puter_site_subdomain_is_owned (index_url, user) {
        if ( ! user ) return;

        let hostname;
        try {
            hostname = (new URL(index_url)).hostname.toLowerCase();
        } catch {
            return;
        }

        const hosting_domain = config.static_hosting_domain?.toLowerCase();
        if ( ! hosting_domain ) return;

        const suffix = `.${hosting_domain}`;
        if ( ! hostname.endsWith(suffix) ) return;

        const subdomain = hostname.slice(0, hostname.length - suffix.length);
        if ( ! subdomain ) return;

        const svc_puterSite = this.services.get('puter-site');
        const site = await svc_puterSite.get_subdomain(subdomain, { is_custom_domain: false });

        if ( !site || site.user_id !== user.id ) {
            throw APIError.create('subdomain_not_owned', null, { subdomain });
        }
    }

    async #handle_name_conflict (object, old_app, options) {
        const new_name = object.name;
        const old_name = old_app.name;

        // If the name hasn't changed, nothing to do
        if ( new_name === old_name ) {
            delete object.name;
            return;
        }

        // Check if the name is taken
        if ( await app_name_exists(new_name) ) {
            if ( options?.dedupe_name ) {
                // Auto-deduplicate the name
                let number = 1;
                while ( await app_name_exists(`${new_name}-${number}`) ) {
                    number++;
                }
                object.name = `${new_name}-${number}`;
            } else {
                // Check if this is an old name of the same app
                const svc_oldAppName = this.services.get('old-app-name');
                const name_info = await svc_oldAppName.check_app_name(new_name);
                if ( !name_info || name_info.app_uid !== old_app.uid ) {
                    throw APIError.create('app_name_already_in_use', null, {
                        name: new_name,
                    });
                }
                // Remove the old name from the old-app-name service
                await svc_oldAppName.remove_name(name_info.id);
            }
        }
    }

    async #execute_update (object, old_app) {
        // Map object fields to SQL columns
        const sql_column_map = {
            name: 'name',
            title: 'title',
            description: 'description',
            icon: 'icon',
            index_url: 'index_url',
            maximize_on_start: 'maximize_on_start',
            background: 'background',
            metadata: 'metadata',
        };

        const set_clauses = [];
        const values = [];

        for ( const [field, column] of Object.entries(sql_column_map) ) {
            if ( object[field] === undefined ) continue;

            let value = object[field];

            // Handle JSON fields
            if ( field === 'metadata' && value !== null ) {
                value = JSON.stringify(value);
            }

            // Handle boolean fields
            if ( field === 'maximize_on_start' || field === 'background' ) {
                value = value ? 1 : 0;
            }

            set_clauses.push(`${column} = ?`);
            values.push(value);
        }

        if ( set_clauses.length > 0 ) {
            values.push(old_app.uid);
            const stmt = `UPDATE apps SET ${set_clauses.join(', ')} WHERE uid = ? LIMIT 1`;
            await this.db_write.write(stmt, values);
        }

        // Fetch the internal ID
        const rows = await this.db.read('SELECT id FROM apps WHERE uid = ?',
                        [old_app.uid]);
        return { insert_id: rows[0]?.id };
    }

    async #update_filetype_associations (app_id, filetype_associations) {
        // Remove old file associations
        await this.db_write.write('DELETE FROM app_filetype_association WHERE app_id = ?',
                        [app_id]);

        // Add new file associations
        if ( !filetype_associations || !(filetype_associations.length > 0) ) {
            return;
        }

        const stmt =
            `INSERT INTO app_filetype_association (app_id, type) VALUES ${
                filetype_associations.map(() => '(?, ?)').join(', ')}`;
        const values = filetype_associations.flatMap(ft => [app_id, ft.toLowerCase()]);
        await this.db_write.write(stmt, values);
    }

    async #emit_change_events (object, old_app) {
        const svc_event = this.services.get('event');

        // Emit icon change event
        if ( object.icon !== undefined && object.icon !== old_app.icon ) {
            const event = {
                app_uid: old_app.uid,
                data_url: object.icon,
            };
            await svc_event.emit('app.new-icon', event);
        }

        // Emit name change event
        if ( object.name !== undefined && object.name !== old_app.name ) {
            const event = {
                app_uid: old_app.uid,
                new_name: object.name,
                old_name: old_app.name,
            };
            await svc_event.emit('app.rename', event);
        }
    }

    #refresh_cache (merged_app, old_app) {
        const raw_app = {
            uuid: merged_app.uid,
            owner_user_id: old_app.owner?.id || old_app.owner,
            name: merged_app.name,
            title: merged_app.title,
            description: merged_app.description,
            icon: merged_app.icon,
            index_url: merged_app.index_url,
            maximize_on_start: merged_app.maximize_on_start,
        };

        refresh_apps_cache({ uid: raw_app.uuid }, raw_app);
    }

    #build_complex_id_where (id) {
        const id_keys = Object.keys(id);
        id_keys.sort();

        // 1. Validate the identifier key from `id`

        const redundant_identifiers = this.constructor.REDUNDANT_IDENTIFIERS;
        let match_found = false;

        for ( let key_set of redundant_identifiers ) {
            key_set = Array.isArray(key_set) ? key_set : [key_set];
            const sorted_key_set = [...key_set].sort();

            // Check if id_keys matches this key_set exactly
            if ( id_keys.length === sorted_key_set.length &&
                id_keys.every((k, i) => k === sorted_key_set[i]) ) {
                match_found = true;
                break;
            }
        }

        if ( ! match_found ) {
            throw new Error(`Invalid complex id keys: ${id_keys.join(', ')}. ` +
                `Allowed: ${redundant_identifiers.join(', ')}`);
        }

        // 2. Build the SQL string for the predicate

        const conditions = [];
        const values = [];

        for ( const key of id_keys ) {
            conditions.push(`apps.${key} = ?`);
            values.push(id[key]);
        }

        return {
            clause: conditions.join(' AND '),
            values,
        };
    }
}
