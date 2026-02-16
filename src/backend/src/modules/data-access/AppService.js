import { v4 as uuidv4 } from 'uuid';

import APIError from '../../api/APIError.js';
import config from '../../config.js';
import { app_name_exists } from '../../helpers.js';
import { AppUnderUserActorType, UserActorType } from '../../services/auth/Actor.js';
import { PermissionUtil } from '../../services/auth/permissionUtils.mjs';
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

const APP_ICON_ENDPOINT_PATH_REGEX = /^\/app-icon\/[^/?#]+\/\d+\/?$/;
const ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const getCanonicalAppIconBaseUrl = () => {
    const candidate = [config.api_base_url, config.origin]
        .find(value => typeof value === 'string' && value.trim());
    if ( ! candidate ) return null;
    try {
        return (new URL(candidate)).origin;
    } catch {
        return null;
    }
};

const getAllowedAppIconOrigins = () => {
    const origins = new Set();
    for ( const candidate of [config.api_base_url, config.origin] ) {
        if ( typeof candidate !== 'string' || !candidate ) continue;
        try {
            origins.add((new URL(candidate)).origin);
        } catch {
            // Ignore invalid config values.
        }
    }
    return origins;
};

const isAppIconEndpointPath = (value) => {
    if ( typeof value !== 'string' ) return false;
    const trimmed = value.trim();
    if ( ! trimmed ) return false;

    try {
        const parsed = new URL(trimmed, 'http://localhost');
        const pathname = parsed.pathname;
        return APP_ICON_ENDPOINT_PATH_REGEX.test(pathname);
    } catch {
        return false;
    }
};

const isAllowedAppIconEndpointUrl = value => {
    if ( ! isAppIconEndpointPath(value) ) return false;

    const trimmed = value.trim();
    const isAbsoluteUrl = ABSOLUTE_URL_REGEX.test(trimmed) || trimmed.startsWith('//');
    if ( ! isAbsoluteUrl ) {
        return true;
    }

    try {
        const parsed = new URL(trimmed, 'http://localhost');
        return getAllowedAppIconOrigins().has(parsed.origin);
    } catch {
        return false;
    }
};

const migrateRelativeAppIconEndpointUrl = value => {
    if ( typeof value !== 'string' ) return value;
    const trimmed = value.trim();
    if ( ! isAppIconEndpointPath(trimmed) ) return value;

    const isAbsoluteUrl = ABSOLUTE_URL_REGEX.test(trimmed) || trimmed.startsWith('//');
    if ( isAbsoluteUrl ) return trimmed;

    const baseUrl = getCanonicalAppIconBaseUrl();
    if ( ! baseUrl ) return trimmed;

    try {
        return new URL(trimmed, `${baseUrl}/`).toString();
    } catch {
        return trimmed;
    }
};

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

    async #select ({ predicate, params, ..._rest }) {
        const db = this.db;

        if ( predicate === undefined ) predicate = [];
        if ( params === undefined ) params = {};
        if ( ! Array.isArray(predicate) ) throw new Error('predicate must be an array');

        const userCanEditOnly = Array.prototype.includes.call(predicate, 'user-can-edit');

        const stmt = 'SELECT apps.*, ' +
            'owner_user.username AS owner_user_username, ' +
            'owner_user.uuid AS owner_user_uuid, ' +
            'app_owner.uid AS app_owner_uid ' +
            'FROM apps ' +
            'LEFT JOIN user owner_user ON apps.owner_user_id = owner_user.id ' +
            'LEFT JOIN apps app_owner ON apps.app_owner = app_owner.id ' +
            `${userCanEditOnly ? 'WHERE apps.owner_user_id=?' : ''} ` +
            'LIMIT 5000';
        const values = userCanEditOnly ? [Context.get('user').id] : [];
        const rows = await db.read(stmt, values);

        const shouldFetchFiletypes = rows.some(row => typeof row.filetypes !== 'string');
        const filetypesByAppId = shouldFetchFiletypes
            ? await this.#getFiletypeAssociationsByAppIds(rows.map(row => row.id))
            : new Map();

        const svc_appIcon = params.icon_size
            ? this.context.get('services').get('app-icon')
            : null;
        const svc_error = params.icon_size
            ? this.context.get('services').get('error-service')
            : null;

        const appAndOwnerIds = [];
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

            try {
                if ( typeof row.filetypes === 'string' ) {
                    app.filetype_associations = this.#parseFiletypeAssociationsJson(row.filetypes);
                } else {
                    app.filetype_associations = this.#normalizeFiletypeAssociations(filetypesByAppId.get(row.id) ?? []);
                }
            } catch (e) {
                throw new Error(`failed to get app filetype associations: ${e.message}`, { cause: e });
            }

            // REFINED BY OTHER DATA
            // app.icon;
            if ( params.icon_size && svc_appIcon ) {
                const icon_size = params.icon_size;
                try {
                    const iconPath = svc_appIcon.getAppIconPath({
                        appUid: row.uid,
                        size: icon_size,
                    });
                    if ( iconPath ) {
                        app.icon = iconPath;
                    }
                } catch (e) {
                    svc_error?.report('AppES:read_transform', { source: e });
                }
            }

            appAndOwnerIds.push({
                app,
                ownerUserId: row.owner_user_id,
            });
        }

        // Check protected app access in parallel for faster large selections.
        const allowed_apps = await Promise.all(appAndOwnerIds.map(async ({ app, ownerUserId }) => {
            if ( await this.#check_protected_app_access(app, ownerUserId) ) {
                return null;
            }
            return app;
        }));

        return allowed_apps.filter(Boolean);
    }

    async #read ({ uid, id, params = {}, backend_only_options = {} }) {
        const db = this.db;

        if ( uid === undefined && id === undefined ) {
            throw new Error('read requires either uid or id');
        }

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
            'app_owner.uid AS app_owner_uid ' +
            'FROM apps ' +
            'LEFT JOIN user owner_user ON apps.owner_user_id = owner_user.id ' +
            'LEFT JOIN apps app_owner ON apps.app_owner = app_owner.id ' +
            `WHERE ${whereClause} ` +
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

        let protectedAccessPromise;
        try {
            if ( typeof row.filetypes === 'string' ) {
                app.filetype_associations = this.#parseFiletypeAssociationsJson(row.filetypes);
            } else {
                protectedAccessPromise = this.#check_protected_app_access(app, row.owner_user_id);
                const filetypeAssociations = await this.#getFiletypeAssociationsByAppId(row.id);
                app.filetype_associations = this.#normalizeFiletypeAssociations(filetypeAssociations);
            }
        } catch (e) {
            throw new Error(`failed to get app filetype associations: ${e.message}`, { cause: e });
        }

        // Check protected app access as soon as dependent fields are resolved.
        if ( ! protectedAccessPromise ) {
            protectedAccessPromise = this.#check_protected_app_access(app, row.owner_user_id);
        }
        if ( await protectedAccessPromise ) {
            // App should not be accessible
            throw APIError.create('entity_not_found', null, {
                identifier: uid || JSON.stringify(id),
            });
        }

        if ( params.icon_size ) {
            const icon_size = params.icon_size;
            const svc_appIcon = this.context.get('services').get('app-icon');
            try {
                const iconPath = svc_appIcon.getAppIconPath({
                    appUid: row.uid,
                    size: icon_size,
                });
                if ( iconPath ) {
                    app.icon = iconPath;
                }
            } catch (e) {
                const svc_error = this.context.get('services').get('error-service');
                svc_error.report('AppES:read_transform', { source: e });
            }
        }

        return app;
    }

    #parseFiletypeAssociationsJson (filetypes) {
        return this.#normalizeFiletypeAssociations(JSON.parse(filetypes));
    }

    async #getFiletypeAssociationsByAppId (appId) {
        if ( appId === undefined || appId === null ) return [];

        const rows = await this.db.read('SELECT type FROM app_filetype_association WHERE app_id = ?',
                        [appId]);
        return rows
            .map(row => row.type)
            .filter(type => typeof type === 'string' || type === null);
    }

    #normalizeFiletypeAssociations (filetypesAsJSON) {
        filetypesAsJSON = Array.isArray(filetypesAsJSON)
            ? filetypesAsJSON
            : [];
        filetypesAsJSON = filetypesAsJSON.filter(ft => ft !== null);
        for ( let i = 0 ; i < filetypesAsJSON.length ; i++ ) {
            if ( typeof filetypesAsJSON[i] !== 'string' ) {
                throw new Error(`expected filetypesAsJSON[${i}] to be a string, got: ${filetypesAsJSON[i]}`);
            }
            if ( String.prototype.startsWith.call(filetypesAsJSON[i], '.') ) {
                filetypesAsJSON[i] = filetypesAsJSON[i].slice(1);
            }
        }
        return filetypesAsJSON;
    }

    async #getFiletypeAssociationsByAppIds (appIds) {
        appIds = [...new Set(appIds.filter(appId => appId !== undefined && appId !== null))];
        if ( appIds.length === 0 ) return new Map();

        const filetypesByAppId = new Map();
        for ( const appId of appIds ) {
            filetypesByAppId.set(appId, []);
        }

        // SQLite has a low bind-parameter limit; chunk to avoid oversized IN lists.
        const chunkSize = 500;
        for ( let i = 0 ; i < appIds.length ; i += chunkSize ) {
            const chunk = appIds.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = await this.db.read(`SELECT app_id, type FROM app_filetype_association WHERE app_id IN (${placeholders})`,
                            chunk);
            for ( const row of rows ) {
                if ( ! filetypesByAppId.has(row.app_id) ) {
                    filetypesByAppId.set(row.app_id, []);
                }
                filetypesByAppId.get(row.app_id).push(row.type);
            }
        }

        return filetypesByAppId;
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
                if ( typeof object.icon === 'string' ) {
                    object.icon = migrateRelativeAppIconEndpointUrl(object.icon);
                }
                if ( typeof object.icon === 'string' && object.icon.startsWith('data:') ) {
                    validate_image_base64(object.icon, { key: 'icon' });
                } else if ( isAllowedAppIconEndpointUrl(object.icon) ) {
                    // Allow existing relative app icon endpoint references.
                } else {
                    throw APIError.create('field_invalid', null, { key: 'icon' });
                }
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
                url: '',
            };
            await svc_event.emit('app.new-icon', event);
            if ( event.url ) {
                this.db_write.write('UPDATE apps SET icon = ? WHERE uid = ? LIMIT 1',
                                [event.url, uid]);
            }
        }

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

        if ( !app_owner_uid || app_owner_uid !== app.uid ) {
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
                if ( typeof object.icon === 'string' ) {
                    object.icon = migrateRelativeAppIconEndpointUrl(object.icon);
                }
                if ( typeof object.icon === 'string' && object.icon.startsWith('data:') ) {
                    validate_image_base64(object.icon, { key: 'icon' });
                } else if ( isAllowedAppIconEndpointUrl(object.icon) ) {
                    // Allow existing relative app icon endpoint references.
                } else {
                    throw APIError.create('field_invalid', null, { key: 'icon' });
                }
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

        const svc_event = this.services.get('event');
        svc_event.emit('app.changed', {
            app_uid: old_app.uid,
            action: 'updated',
        });

        // Return the updated app (re-fetch for client-safe output)
        // TODO: optimize this
        return await this.#read({ uid: old_app.uid });
    }

    async #check_owner_permission (old_app) {
        const svc_permission = this.services.get('permission');
        const actor = Context.get('actor');

        // Check if user has system-wide write permission
        {
            // We need to fix eslint rule for multi-line calls
            const has_permission_to_write_all = await svc_permission.check(actor,
                            this.constructor.WRITE_ALL_OWNER_PERMISSION);

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
            if ( event.url ) {
                await this.db_write.write('UPDATE apps SET icon = ? WHERE uid = ? LIMIT 1',
                                [event.url, old_app.uid]);
            }
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

    /**
     * Checks if a protected app should be filtered out (not accessible to the current actor).
     * Returns true if the app should be filtered out, false if it's accessible.
     *
     * @param {Object} app - The app object with protected, uid, and owner fields
     * @param {number} owner_user_id - The database ID of the app owner (for accurate comparison)
     * @returns {Promise<boolean>} true if app should be filtered out, false if accessible
     */
    async #check_protected_app_access (app, owner_user_id) {
        // If it's not a protected app, no worries - allow it
        if ( ! app.protected ) {
            return false;
        }

        const actor = Context.get('actor');
        const services = this.services;

        // If actor is this app itself, allow it
        if (
            actor.type instanceof AppUnderUserActorType &&
            app.uid === actor.type.app.uid
        ) {
            return false;
        }

        // If actor is owner of this app, allow it
        // Compare using owner_user_id from database for accuracy
        if (
            actor.type instanceof UserActorType &&
            owner_user_id &&
            owner_user_id === actor.type.user.id
        ) {
            return false;
        }

        // Now we need to check for permission
        const app_uid = app.uid;
        const svc_permission = services.get('permission');
        const permission_to_check = `app:uid#${app_uid}:access`;
        const reading = await svc_permission.scan(actor, permission_to_check);
        const options = PermissionUtil.reading_to_options(reading);

        // If they have permission, allow it
        if ( options.length > 0 ) {
            return false;
        }

        // No access - filter it out
        return true;
    }
}
