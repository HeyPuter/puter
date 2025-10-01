// METADATA // {"ai-commented":{"service":"xai"}}
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
const APIError = require('../../api/APIError');
const { hardcoded_user_group_permissions } = require('../../data/hardcoded-permissions.js');
const { ECMAP } = require('../../filesystem/ECMAP');
const { get_user, get_app } = require('../../helpers');
const { reading_has_terminal } = require('../../unstructured/permission-scan-lib');
const BaseService = require('../BaseService');
const { DB_WRITE } = require('../database/consts');
const { UserActorType, Actor, AppUnderUserActorType } = require('./Actor');
const { PermissionUtil, PermissionExploder, PermissionImplicator, PermissionRewriter } = require('./PermissionUtils.mjs');
const PERM_KEY_PREFIX = 'perm';

/**
* @class PermissionService
* @extends BaseService
* @description
* The PermissionService class manages and enforces permissions within the application. It provides methods to:
* - Check, grant, and revoke permissions for users and applications.
* - Scan for existing permissions.
* - Handle permission implications, rewriting, and explosion to support complex permission hierarchies.
* This service interacts with the database to manage permissions and logs actions for auditing purposes.
*/
class PermissionService extends BaseService {
    static MODULES = {
        memKVMap: globalThis.kv,
    };

    static CONCERN = 'permissions';
    /**
    * Initializes the PermissionService by setting up internal arrays for permission handling.
    *
    * This method is called during the construction of the PermissionService instance to
    * prepare it for handling permissions, rewriters, implicators, and exploders.
    */
    _construct() {
        this._permission_rewriters = [];
        this._permission_implicators = [];
        this._permission_exploders = [];
    }

    /**
    * Registers a permission exploder which expands permissions into their component parts or related permissions.
    *
    * @param {PermissionExploder} exploder - The PermissionExploder instance to register.
    * @throws {Error} If the provided exploder is not an instance of PermissionExploder.
    */
    async _init() {
        /**
         * @type {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} db
         */
        this.kvService = this.services.get('puter-kvstore').as('puter-kvstore');
        this.db = this.services.get('database').get(DB_WRITE, 'permissions');
        this._register_commands(this.services.get('commands'));
        this.kvAvgTimes = { count: 0, avg: 0, max: 0 };
        this.dbAvgTimes = { count: 0, avg: 0, max: 0 };
    }
    
    async ['__on_boot.consolidation'] () {
        const svc_event = this.services.get('event');
        // Event to allow extensions to add permissions
        {
            const event = {};
            event.grant_to_everyone = permission => {
                /* eslint-disable */
                hardcoded_user_group_permissions
                    .system
                    [this.global_config.default_temp_group]
                    [permission]
                    = {};
                hardcoded_user_group_permissions
                    .system
                    [this.global_config.default_user_group]
                    [permission]
                    = {};
                /* eslint-enable */
            };
            event.grant_to_users = permission => {
                /* eslint-disable */
                hardcoded_user_group_permissions
                    [this.global_config.default_user_group]
                    [permission]
                    = {};
                /* eslint-enable */
            };
            svc_event.emit('create.permissions', event);
        }
    }

    /**
    * Rewrites the given permission string based on registered PermissionRewriters.
    *
    * @param {string} permission - The original permission string to be rewritten.
    * @returns {Promise<string>} A promise that resolves to the rewritten permission string.
    *
    * @note This method iterates through all registered rewriters. If a rewriter matches the permission,
    *       it applies the rewrite transformation. The process continues until no more matches are found.
    */
    async _rewrite_permission(permission) {
        for ( const rewriter of this._permission_rewriters ) {
            if ( ! rewriter.matches(permission) ) continue;
            permission = await rewriter.rewrite(permission);
        }
        return permission;
    }

    /**
    * Checks if the actor has any of the specified permissions.
    *
    * @param {Actor} actor - The actor to check permissions for.
    * @param {Array|string} permission_options - The permissions to check against.
    * Can be a single permission string or an array of permission strings.
    * @returns {Promise<boolean>} - True if the actor has at least one of the permissions, false otherwise.
    *
    * @note This method currently delegates to `scan()`, but a TODO suggests
    * an optimized implementation is planned.
    */
    async check(actor, permission_options) {
        // TODO: optimized implementation for check instead of
        //       delegating to the scan() method
        const svc_trace = this.services.get('traceService');
        return await svc_trace.spanify('permission:check', async () => {
            const reading = await this.scan(actor, permission_options);
            const options = PermissionUtil.reading_to_options(reading);
            return options.length > 0;
        });
    }

    /**
    * Scans the permissions for an actor against specified permission options.
    *
    * This method performs a comprehensive scan of permissions, considering:
    * - Direct permissions
    * - Implicit permissions
    * - Permission rewriters
    *
    * @param {Actor} actor - The actor whose permissions are being checked.
    * @param {string|string[]} permission_options - One or more permission strings to check against.
    * @param {*} _reserved - Reserved for future use, currently not utilized.
    * @param {Object} state - State object to manage recursion and prevent cycles.
    *
    * @returns {Promise<Array>} A promise that resolves to an array of permission readings.
    */
    async scan(actor, permission_options, _reserved, state) {
        const svc_trace = this.services.get('traceService');
        return await svc_trace.spanify('permission:scan', async () => {
            return await ECMAP.arun(async () => {
                return await this.#scan(actor, permission_options, _reserved, state);
            });
        }, { attributes: { permission_options }, actor: actor.uid });
    }
    async #scan(actor, permission_options, _reserved, state) {
        if ( ! state ) {
            this.log.info('scan', {
                actor: actor.uid,
                permission_options,
            });
        }
        const reading = [];

        if ( ! state ) {
            state = {
                anti_cycle_actors: [actor],
            };
        }

        if ( ! Array.isArray(permission_options) ) {
            permission_options = [permission_options];
        }

        const cache_str = PermissionUtil.join('permission-scan',
                        actor.uid,
                        'options-list',
                        ...permission_options);

        const cached = this.modules.memKVMap.get(cache_str);
        if ( cached ) {
            return cached;
        }

        // TODO: command to enable these logs
        // const l = get_a_letter();
        // cylog(l, 'ACT & PERM:', actor.uid, permission_options);

        const start_ts = Date.now();
        await require('../../structured/sequence/scan-permission.mjs').default
            .call(this, {
                actor,
                permission_options,
                reading,
                state,
            });
        const end_ts = Date.now();

        // TODO: command to enable these logs
        // cylog(l, 'READING', JSON.stringify(reading, null, '  '));

        reading.push({
            $: 'time',
            value: end_ts - start_ts,
        });

        this.modules.memKVMap.set(cache_str, reading, { EX: 20 });

        return reading;
    }

    async validateUserPerms({ actor, permissions }){

        const flatPermsReading = await this.#flat_validateUserPerms({ actor, permissions });
        const linkedPermsReadingPromise =  this.#linked_validateUserPerms({ actor, permissions, state: { anti_cycle_actors: [actor] } });

        if ( flatPermsReading && flatPermsReading.length > 0 ){
            return flatPermsReading[0].deleted ? [] : flatPermsReading;
        }

        const linkedPermsReading = await linkedPermsReadingPromise;
        const options = PermissionUtil.reading_to_options(linkedPermsReading);

        options.forEach((perm, index) => {
            const possiblePerm = linkedPermsReading[index];
            this.kvService.set({
                key: PermissionUtil.join(PERM_KEY_PREFIX, actor.type.user.id, perm.permission),
                value: {
                    permission: perm.permission,
                    issuer_user_id: possiblePerm.data.issuer_user_id,
                    ...perm.data,
                },
            });
        });
        return flatPermsReading;
    }

    async #flat_validateUserPerms({ actor, permissions }){
        const start = Date.now();
        try {
        /** @type {Promise<Record<string, unknown>[]>} */
            const validPerms = (await this.services.get('su').sudo(() => (
                this.kvService.get({
                    key: [...new Set(permissions.map(perm => PermissionUtil.join(PERM_KEY_PREFIX, actor.type.user.id, perm)))],
                })
            ))).filter(Boolean);

            let permDeleted = false;
            // We no longer fetch up the tree, if user was given this perm, then they have it
            for ( const validPerm of validPerms ){
                const { permission, issuer_user_id, deleted, ...extra } = validPerm;
                if ( deleted ){
                    permDeleted = true;
                    continue;
                }
                const issuer_actor = new Actor({
                    type: new UserActorType({
                        user: await get_user({ id: issuer_user_id }),
                    }),
                });
                // return first perm that allows them in here
                return [{
                    $: 'option',
                    via: 'user',
                    has_terminal: true,
                    permission: permission,
                    data: extra,
                    holder_username: actor.type.user.username,
                    issuer_username: issuer_actor.type.user.username,
                    issuer_user_id: issuer_actor.type.user.uuid,
                    reading: [],
                }];

            }
            return permDeleted ? [{
                deleted: true,
            }] : [];
        } finally {
            const end = Date.now();
            this.kvAvgTimes.avg = (this.kvAvgTimes.avg * this.kvAvgTimes.count +  (end - start)) / (this.kvAvgTimes.count + 1);
            this.kvAvgTimes.count++;
            this.kvAvgTimes.max = Math.max(this.kvAvgTimes.max, end - start);
        }
    }
    async #linked_validateUserPerms({ actor, permissions, state }){

        const start = Date.now();
        try {
            let sqlPermQuery = permissions.map(_perm => {
                return '`permission` = ?';
            }).join(' OR ');

            if ( permissions.length > 1 ) {
                sqlPermQuery = `(${sqlPermQuery})`;
            }

            const rows = await this.db.read('SELECT * FROM `user_to_user_permissions` ' +
                `WHERE \`holder_user_id\` = ? AND ${
                    sqlPermQuery}`,
            [
                actor.type.user.id,
                ...permissions,
            ]);

            const readings = [];
            // Return the first matching permission where the
            // issuer also has the permission granted
            for ( const row of rows ) {
                row.extra = this.db.case({
                    mysql: () => row.extra,
                    otherwise: () => JSON.parse(row.extra ?? '{}'),
                })();

                const issuer_actor = new Actor({
                    type: new UserActorType({
                        user: await get_user({ id: row.issuer_user_id }),
                    }),
                });

                let should_continue = false;
                for ( const seen_actor of state.anti_cycle_actors ) {
                    if ( seen_actor.type.user.id === issuer_actor.type.user.id ) {
                        should_continue = true;
                        break;
                    }
                }

                if ( should_continue ) continue;

                const issuer_reading = await this.scan(issuer_actor, row.permission, undefined, state);

                const has_terminal = reading_has_terminal({ reading: issuer_reading });

                readings.push({
                    $: 'path',
                    via: 'user',
                    has_terminal,
                    permission: row.permission,
                    data: row.extra,
                    holder_username: actor.type.user.username,
                    issuer_username: issuer_actor.type.user.username,
                    issuer_user_id: issuer_actor.type.user.uuid,
                    reading: issuer_reading,
                });
            }
            return readings;
        } finally {
            const end = Date.now();
            this.dbAvgTimes.avg = (this.dbAvgTimes.avg * this.dbAvgTimes.count +  (end - start)) / (this.dbAvgTimes.count + 1);
            this.dbAvgTimes.count++;
            this.dbAvgTimes.max = Math.max(this.dbAvgTimes.max, end - start);
        }
    }

    /**
    * Grants a user permission to interact with another user.
    *
    * @param {Actor} actor - The actor granting the permission (must be a user).
    * @param {string} app_uid - The unique identifier or name of the app.
    * @param {string} username - The username of the user receiving the permission.
    * @param {string} permission - The permission string to grant.
    * @param {Object} [extra={}] - Additional metadata or conditions for the permission.
    * @param {Object} [meta] - Metadata for logging or auditing purposes.
    * @throws {Error} If the user to grant permission to is not found or if attempting to grant permissions to oneself.
    * @returns {Promise<void>}
    */
    async grant_user_app_permission(actor, app_uid, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });

        if ( ! app ) {
            throw APIError.create('entity_not_found', null, {
                identifier: `app:${app_uid}`,
            });
        }

        const app_id = app.id;

        // UPSERT permission
        await this.db.write('INSERT INTO `user_to_app_permissions` (`user_id`, `app_id`, `permission`, `extra`) ' +
            `VALUES (?, ?, ?, ?) ${
                this.db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                    otherwise: 'ON CONFLICT(`user_id`, `app_id`, `permission`) DO UPDATE SET `extra` = ?',
                })}`,
        [
            actor.type.user.id,
            app_id,
            permission,
            JSON.stringify(extra),
            JSON.stringify(extra),
        ]);

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission,
            action: 'grant',
            reason: meta?.reason || 'granted via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map(() => '?').join(', ');

        await this.db.write(`INSERT INTO \`audit_user_to_app_permissions\` (${sql_cols}) ` +
            `VALUES (${sql_vals})`,
        Object.values(audit_values));
    }

    /**
    * Grants an app a permission for any user, as long as the user granting the
    * permission also has the permission.
    *
    * @param {Actor} actor - The actor granting the permission (must be a user).
    * @param {string} app_uid - The unique identifier or name of the app.
    * @param {string} username - The username of the user receiving the permission.
    * @param {string} permission - The permission string to grant.
    * @param {Object} [extra={}] - Additional metadata or conditions for the permission.
    * @param {Object} [meta] - Metadata for logging or auditing purposes.
    * @throws {Error} If the user to grant permission to is not found or if attempting to grant permissions to oneself.
    * @returns {Promise<void>}
    */
    async grant_dev_app_permission(actor, app_uid, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });

        if ( ! app ) {
            throw APIError.create('entity_not_found', null, {
                identifier: `app:${app_uid}`,
            });
        }

        const app_id = app.id;

        // UPSERT permission
        await this.db.write('INSERT INTO `dev_to_app_permissions` (`user_id`, `app_id`, `permission`, `extra`) ' +
            `VALUES (?, ?, ?, ?) ${
                this.db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                    otherwise: 'ON CONFLICT(`user_id`, `app_id`, `permission`) DO UPDATE SET `extra` = ?',
                })}`,
        [
            actor.type.user.id,
            app_id,
            permission,
            JSON.stringify(extra),
            JSON.stringify(extra),
        ]);

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission,
            action: 'grant',
            reason: meta?.reason || 'granted via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map(() => '?').join(', ');

        await this.db.write(`INSERT INTO \`audit_dev_to_app_permissions\` (${sql_cols}) ` +
            `VALUES (${sql_vals})`,
        Object.values(audit_values));
    }
    async revoke_dev_app_permission(actor, app_uid, permission, meta) {
        permission = await this._rewrite_permission(permission);

        // For now, actor MUST be a user
        if ( ! (actor.type instanceof UserActorType) ) {
            throw new Error('actor must be a user');
        }

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        if ( ! app ) {
            throw APIError.create('entity_not_found', null, {
                identifier: `app${app_uid}`,
            });
        }
        const app_id = app.id;

        // DELETE permission
        await this.db.write('DELETE FROM `dev_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ? AND `permission` = ?',
        [
            actor.type.user.id,
            app_id,
            permission,
        ]);

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission,
            action: 'revoke',
            reason: meta?.reason || 'revoked via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map(() => '?').join(', ');

        await this.db.write(`INSERT INTO \`audit_dev_to_app_permissions\` (${sql_cols}) ` +
            `VALUES (${sql_vals})`,
        Object.values(audit_values));
    }
    async revoke_dev_app_all(actor, app_uid, meta) {
        // For now, actor MUST be a user
        if ( ! (actor.type instanceof UserActorType) ) {
            throw new Error('actor must be a user');
        }

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        const app_id = app.id;

        // DELETE permissions
        await this.db.write('DELETE FROM `dev_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ?',
        [
            actor.type.user.id,
            app_id,
        ]);

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission: '*',
            action: 'revoke',
            reason: meta?.reason || 'revoked all via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map(() => '?').join(', ');

        await this.db.write(`INSERT INTO \`audit_dev_to_app_permissions\` (${sql_cols}) ` +
            `VALUES (${sql_vals})`,
        Object.values(audit_values));
    }

    /**
    * Grants a permission to a user for a specific app.
    *
    * @param {Actor} actor - The actor granting the permission, must be a user.
    * @param {string} app_uid - The unique identifier or name of the app.
    * @param {string} permission - The permission string to be granted.
    * @param {Object} [extra={}] - Additional data associated with the permission.
    * @param {Object} [meta] - Metadata for the operation, including a reason for the grant.
    *
    * @throws {Error} If the actor is not a user or if the app is not found.
    *
    * @returns {Promise<void>} A promise that resolves when the permission is granted and logged.
    */
    async revoke_user_app_permission(actor, app_uid, permission, meta) {
        permission = await this._rewrite_permission(permission);

        // For now, actor MUST be a user
        if ( ! (actor.type instanceof UserActorType) ) {
            throw new Error('actor must be a user');
        }

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        if ( ! app ) {
            throw APIError.create('entity_not_found', null, {
                identifier: `app${app_uid}`,
            });
        }
        const app_id = app.id;

        // DELETE permission
        await this.db.write('DELETE FROM `user_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ? AND `permission` = ?',
        [
            actor.type.user.id,
            app_id,
            permission,
        ]);

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission,
            action: 'revoke',
            reason: meta?.reason || 'revoked via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map(() => '?').join(', ');

        await this.db.write(`INSERT INTO \`audit_user_to_app_permissions\` (${sql_cols}) ` +
            `VALUES (${sql_vals})`,
        Object.values(audit_values));
    }

    /**
    * Revokes all permissions for a user on a specific app.
    *
    * @param {Actor} actor - The actor performing the revocation, must be a user.
    * @param {string} app_uid - The unique identifier or name of the app for which permissions are being revoked.
    * @param {Object} meta - Metadata for logging the revocation action.
    * @throws {Error} If the actor is not a user.
    */
    async revoke_user_app_all(actor, app_uid, meta) {
        // For now, actor MUST be a user
        if ( ! (actor.type instanceof UserActorType) ) {
            throw new Error('actor must be a user');
        }

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        const app_id = app.id;

        // DELETE permissions
        await this.db.write('DELETE FROM `user_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ?',
        [
            actor.type.user.id,
            app_id,
        ]);

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission: '*',
            action: 'revoke',
            reason: meta?.reason || 'revoked all via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map(() => '?').join(', ');

        await this.db.write(`INSERT INTO \`audit_user_to_app_permissions\` (${sql_cols}) ` +
            `VALUES (${sql_vals})`,
        Object.values(audit_values));
    }

    /**
    * @typedef {Object} GrantUserUserPermissionParams
    * @property {Actor} actor - The actor granting the permission (must be a user).
    * @property {string} username - The username of the user receiving the permission.
    * @property {string} permission - The permission string to be granted.
    * @property {Object} [extra={}] - Additional metadata or conditions for the permission.
    * @property {Object} [meta] - Metadata for auditing purposes, including a reason for the action.
    */

    /**
    * Grants a permission from one user to another.
    *
    * This method handles the process of granting permissions between users,
    * ensuring that the permission is correctly formatted, the users exist,
    * and that self-granting is not allowed.
    *
    * @param {GrantUserUserPermissionParams} params - Parameters for granting permission.
    * @throws {Error} Throws if the user is not found or if attempting to grant permissions to oneself.
    * @returns {Promise<void>}
    */
    async grant_user_user_permission(actor, username, permission, extra = {}, meta) {
        const flatRes =  this.#flat_grant_user_user_permission(actor, username, permission, extra, meta);
        // shoot this async
        this.#linked_grant_user_user_permission(actor, username, permission, extra, meta);
        return flatRes;

    }

    /**
    * @param {GrantUserUserPermissionParams} params - Parameters for granting permission.
    * @throws {Error} Throws if the user is not found or if attempting to grant permissions to oneself.
    * @returns {Promise<void>}
    */
    async #flat_grant_user_user_permission(actor, username, permission, extra = {}, _meta) {
        permission = await this._rewrite_permission(permission);
        const user = await get_user({ username });
        if ( ! user ) {
            throw APIError.create('user_does_not_exist', null, {
                username,
            });
        }

        // Don't allow granting permissions to yourself
        if ( user.id === actor.type.user.id ) {
            throw new Error('cannot grant permissions to yourself');
        }

        // TODO DS: for now I'm just gonna check that the actor has the perm they wanna give
        const canManagePerms = await this.check(actor, permission);

        // UPSERT permission
        if ( canManagePerms )
        {
            await this.services.get('su').sudo(() =>
                this.kvService.set({
                    key: PermissionUtil.join(PERM_KEY_PREFIX, user.id, permission),
                    value: {
                        ...extra,
                        issuer_user_id: actor.type.user.id,
                        permission,
                        deleted: false,
                    },
                }));
        }
    }

    /**
    * @param {GrantUserUserPermissionParams} params - Parameters for granting permission.
    * @throws {Error} Throws if the user is not found or if attempting to grant permissions to oneself.
    * @returns {Promise<void>}
    */
    async #linked_grant_user_user_permission(actor, username, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);
        const user = await get_user({ username });
        if ( ! user ) {
            throw APIError.create('user_does_not_exist', null, {
                username,
            });
        }

        // Don't allow granting permissions to yourself
        if ( user.id === actor.type.user.id ) {
            throw new Error('cannot grant permissions to yourself');
        }

        // UPSERT permission
        await this.db.write('INSERT INTO `user_to_user_permissions` (`holder_user_id`, `issuer_user_id`, `permission`, `extra`) ' +
            `VALUES (?, ?, ?, ?) ${
                this.db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                    otherwise: 'ON CONFLICT(`holder_user_id`, `issuer_user_id`, `permission`) DO UPDATE SET `extra` = ?',
                })}`,
        [
            user.id,
            actor.type.user.id,
            permission,
            JSON.stringify(extra),
            JSON.stringify(extra),
        ]);

        // INSERT audit table
        await  this.db.write('INSERT INTO `audit_user_to_user_permissions` (' +
            '`holder_user_id`, `holder_user_id_keep`, `issuer_user_id`, `issuer_user_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            user.id,
            user.id,
            actor.type.user.id,
            actor.type.user.id,
            permission,
            'grant',
            meta?.reason || 'granted via PermissionService',
        ]);
    }

    /**
    * Grants a user permission to interact with a specific group.
    *
    * @param {Actor} actor - The actor granting the permission.
    * @param {string} gid - The group identifier (UID or name).
    * @param {string} permission - The permission string to be granted.
    * @param {Object} [extra={}] - Additional metadata for the permission.
    * @param {Object} [meta] - Metadata about the grant action, including the reason.
    * @returns {Promise<void>}
    *
    * @note This method ensures the group exists before granting permission.
    * @note The permission is first rewritten using any registered rewriters.
    * @note If the permission already exists, its extra data is updated.
    */
    async grant_user_group_permission(actor, gid, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);
        const svc_group = this.services.get('group');
        const group = await svc_group.get({ uid: gid });
        if ( ! group ) {
            throw APIError.create('entity_not_found', null, {
                identifier: `group:${gid}`,
            });
        }

        await this.db.write('INSERT INTO `user_to_group_permissions` (`user_id`, `group_id`, `permission`, `extra`) ' +
            `VALUES (?, ?, ?, ?) ${
                this.db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                    otherwise: 'ON CONFLICT(`user_id`, `group_id`, `permission`) DO UPDATE SET `extra` = ?',
                })}`,
        [
            actor.type.user.id,
            group.id,
            permission,
            JSON.stringify(extra),
            JSON.stringify(extra),
        ]);

        // INSERT audit table
        await this.db.write('INSERT INTO `audit_user_to_group_permissions` (' +
            '`user_id`, `user_id_keep`, `group_id`, `group_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            actor.type.user.id,
            actor.type.user.id,
            group.id,
            group.id,
            permission,
            'grant',
            meta?.reason || 'granted via PermissionService',
        ]);
    }

    /**
    * @typedef {Object} RevokeUserUserPermissionParams
    * @property {Actor} actor - The actor performing the revocation
    * @property {string} username - The username of the user whose permission is being revoked
    * @property {string} permission - The specific permission string to revoke
    * @property {Object} meta - Metadata for the revocation action
    */

    /**
    * Revokes a specific user-to-user permission
    *
    * @param {RevokeUserUserPermissionParams} params - Parameters for revoking permission
    * @throws {Error} If the specified user is not found
    * @returns {Promise<void>} A promise that resolves when the permission has been revoked and audit logs updated
    */
    async revoke_user_user_permission(actor, username, permission, meta) {
        const flatRes = this.#flat_revoke_user_user_permission(actor, username, permission, meta);
        // shoot this async
        this.#linked_revoke_user_user_permission(actor, username, permission, meta);
        return flatRes;
    }

    /**
     * @param {RevokeUserUserPermissionParams} params - Parameters for revoking permission
     * @throws {Error} If the specified user is not found
     * @returns {Promise<void>} A promise that resolves when the permission has been revoked and audit logs updated
     */
    async #flat_revoke_user_user_permission(actor, username, permission, _meta) {
        permission = await this._rewrite_permission(permission);

        const user = await get_user({ username });
        if ( ! user ) {
            if ( ! user ) {
                throw APIError.create('user_does_not_exist', null, {
                    username,
                });
            }
        }

        // TODO DS: for now I'm just gonna check that the actor has the perm they wanna take away
        const canManagePerms = await this.check(actor, permission);

        if ( canManagePerms ) {
            // DELETE permission
            await this.services.get('su').sudo(() =>
                this.kvService.set(PermissionUtil.join(PERM_KEY_PREFIX, user.id, permission), {
                    deleted: true,
                }));
        }
    }
    /**
     * @param {RevokeUserUserPermissionParams} params - Parameters for revoking permission
     * @throws {Error} If the specified user is not found
     * @returns {Promise<void>} A promise that resolves when the permission has been revoked and audit logs updated
     */
    async #linked_revoke_user_user_permission(actor, username, permission, meta) {
        permission = await this._rewrite_permission(permission);

        const user = await get_user({ username });
        if ( ! user ) {
            if ( ! user ) {
                throw APIError.create('user_does_not_exist', null, {
                    username,
                });
            }
        }

        // DELETE permission
        await this.db.write('DELETE FROM `user_to_user_permissions` ' +
            'WHERE `holder_user_id` = ? AND `permission` = ?',
        [
            user.id,
            permission,
        ]);

        // INSERT audit table
        await this.db.write('INSERT INTO `audit_user_to_user_permissions` (' +
            '`holder_user_id`, `holder_user_id_keep`, `issuer_user_id`, `issuer_user_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            user.id,
            user.id,
            actor.type.user.id,
            actor.type.user.id,
            permission,
            'revoke',
            meta?.reason || 'revoked via PermissionService',
        ]);
    }

    /**
    * Revokes a specific permission granted by the actor to a group.
    *
    * This method removes the specified permission from the `user_to_group_permissions` table,
    * ensuring that the actor no longer has that permission for the specified group.
    *
    * @param {Actor} actor - The actor revoking the permission.
    * @param {string} gid - The group ID for which the permission is being revoked.
    * @param {string} permission - The permission string to revoke.
    * @param {Object} meta - Metadata for the revocation action, including reason.
    * @returns {Promise<void>} A promise that resolves when the revocation is complete.
    */
    async revoke_user_group_permission(actor, gid, permission, meta) {
        permission = await this._rewrite_permission(permission);
        const svc_group = this.services.get('group');
        const group = await svc_group.get({ uid: gid });
        if ( ! group ) {
            throw APIError.create('entity_not_found', null, {
                identifier: `group:${gid}`,
            });
        }

        // DELETE permission
        await this.db.write('DELETE FROM `user_to_group_permissions` ' +
            'WHERE `user_id` = ? AND `group_id` = ? AND `permission` = ?',
        [
            actor.type.user.id,
            group.id,
            permission,
        ]);

        // INSERT audit table
        await this.db.write('INSERT INTO `audit_user_to_group_permissions` (' +
            '`user_id`, `user_id_keep`, `group_id`, `group_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            actor.type.user.id,
            actor.type.user.id,
            group.id,
            group.id,
            permission,
            'revoke',
            meta?.reason || 'revoked via PermissionService',
        ]);
    }

    /**
     * List the users that have any permissions granted to the
     * specified user.
     *
     * This is a "flat" (non-cascading) view.
     *
     * Use History:
     * - This was written for use in ll_listusers to display
     *   home directories of users that shared files with the
     *   current user.
     *
     * @param {Object} user - The user whose permission issuers are to be listed.
     * @returns {Promise<Array>} A promise that resolves to an array of user objects.
     */
    async list_user_permission_issuers(user) {
        const rows = await this.db.read('SELECT DISTINCT issuer_user_id FROM `user_to_user_permissions` ' +
            'WHERE `holder_user_id` = ?',
        [ user.id ]);

        const users = [];
        for ( const row of rows ) {
            users.push(await get_user({ id: row.issuer_user_id }));
        }

        return users;
    }

    /**
     * List the permissions that the specified actor (the "issuer")
     * has granted to all other users which have some specified
     * prefix in the permission key (ex: "fs:FILE-UUID")
     *
     * Note that if the prefix contains a literal '%' character
     * the behavior may not be as expected.
     *
     * This is a "flat" (non-cascading) view.
     *
     * Use History:
     * - This was written for FSNodeContext.fetchShares to query
     *   all the "shares" associated with a file.
     *
     * This method retrieves permissions from the database where the permission key starts with a specified prefix.
     * It is designed for "flat" (non-cascading) queries.
     *
     * @param {Object} issuer - The actor granting the permissions.
     * @param {string} prefix - The prefix to match in the permission key.
     * @returns {Object} An object containing arrays of user and app permissions matching the prefix.
     */
    async query_issuer_permissions_by_prefix(issuer, prefix) {
        const user_perms = await this.db.read('SELECT DISTINCT holder_user_id, permission ' +
            'FROM `user_to_user_permissions` ' +
            'WHERE issuer_user_id = ? ' +
            'AND permission LIKE ?',
        [issuer.id, `${prefix}%`]);

        const app_perms = await this.db.read('SELECT DISTINCT app_id, permission ' +
            'FROM `user_to_app_permissions` ' +
            'WHERE user_id = ? ' +
            'AND permission LIKE ?',
        [issuer.id, `${prefix}%`]);

        const retval = { users: [], apps: [] };

        for ( const user_perm of user_perms ) {
            const { holder_user_id, permission } = user_perm;
            retval.users.push({
                user: await get_user({ id: holder_user_id }),
                permission,
            });
        }

        for ( const app_perm of app_perms ) {
            const { app_id, permission } = app_perm;
            retval.apps.push({
                app: await get_app({ id: app_id }),
                permission,
            });
        }

        return retval;
    }

    /**
     * List the permissions that the specified actor (the "issuer")
     * has granted to the specified user (the "holder") which have
     * some specified prefix in the permission key (ex: "fs:FILE-UUID")
     *
     * Note that if the prefix contains a literal '%' character
     * the behavior may not be as expected.
     *
     * This is a "flat" (non-cascading) view.
     *
     * @param {Object} issuer - The actor granting the permissions.
     * @param {Object} holder - The actor receiving the permissions.
     * @param {string} prefix - The prefix of the permission keys to match.
     * @returns {Promise<Array<string>>} An array of permission strings matching the prefix.
     */
    async query_issuer_holder_permissions_by_prefix(issuer, holder, prefix) {
        const user_perms = await this.db.read('SELECT permission ' +
            'FROM `user_to_user_permissions` ' +
            'WHERE issuer_user_id = ? ' +
            'AND holder_user_id = ? ' +
            'AND permission LIKE ?',
        [issuer.type.user.id, holder.type.user.id, `${prefix}%`]);

        return user_perms.map(row => row.permission);
    }

    /**
    * Retrieves permissions granted by an issuer to a specific holder with a given prefix.
    *
    * @param {Actor} issuer - The actor granting the permissions.
    * @param {Actor} holder - The actor receiving the permissions.
    * @param {string} prefix - The prefix to filter permissions by.
    * @returns {Promise<Array<string>>} A promise that resolves to an array of permission strings.
    *
    * @note This method performs a database query to fetch permissions. It does not handle
    *       recursion or implication of permissions, providing only a direct, flat list.
    */
    async get_higher_permissions(permission) {
        const higher_perms = new Set();
        higher_perms.add(permission);

        const parent_perms = this.get_parent_permissions(permission);
        for ( const parent_perm of parent_perms ) {
            higher_perms.add(parent_perm);
            for ( const exploder of this._permission_exploders ) {
                if ( ! exploder.matches(parent_perm) ) continue;
                const perms = await exploder.explode({
                    permission: parent_perm,
                });
                for ( const perm of perms ) higher_perms.add(perm);
            }
        }
        return Array.from(higher_perms);
    }

    get_parent_permissions(permission) {
        const parent_perms = [];
        {
            // We don't use PermissionUtil.split here because it unescapes
            // components; we want to keep the components escaped for matching.
            const parts = permission.split(':');

            // Add sub-permissions
            for ( let i = 0 ; i < parts.length ; i++ ) {
                parent_perms.push(parts.slice(0, i + 1).join(':'));
            }
        }
        parent_perms.reverse();
        return parent_perms;
    }

    /**
     * Register a permission rewriter. For details see the documentation on the
     * PermissionRewriter class.
     *
     * @param {PermissionRewriter} rewriter - The permission rewriter to register
     */
    register_rewriter(rewriter) {
        if ( ! (rewriter instanceof PermissionRewriter) ) {
            throw new Error('rewriter must be a PermissionRewriter');
        }

        this._permission_rewriters.push(rewriter);
    }

    /**
     * Register a permission implicator. For details see the documentation on the
     * PermissionImplicator class.
     *
     * @param {PermissionImplicator} implicator - The permission implicator to register
     */
    register_implicator(implicator) {
        if ( ! (implicator instanceof PermissionImplicator) ) {
            throw new Error('implicator must be a PermissionImplicator');
        }

        this._permission_implicators.push(implicator);
    }

    /**
     * Register a permission exploder. For details see the documentation on the
     * PermissionExploder class.
     *
     * @param {PermissionExploder} exploder - The permission exploder to register
     */
    register_exploder(exploder) {
        if ( ! (exploder instanceof PermissionExploder) ) {
            throw new Error('exploder must be a PermissionExploder');
        }

        this._permission_exploders.push(exploder);
    }

    _register_commands(commands) {
        commands.registerCommands('perms', [
            {
                id: 'grant-user-app',
                handler: async (args, _log) => {
                    const [ username, app_uid, permission, extra ] = args;

                    // actor from username
                    const actor = new Actor({
                        type: new UserActorType({
                            user: await get_user({ username }),
                        }),
                    });

                    await this.grant_user_app_permission(actor, app_uid, permission, extra);
                },
            },
            {
                id: 'scan',
                handler: async (args, ctx) => {
                    const [ username, permission ] = args;

                    // actor from username
                    const actor = new Actor({
                        type: new UserActorType({
                            user: await get_user({ username }),
                        }),
                    });

                    let reading = await this.scan(actor, permission);
                    // reading = PermissionUtil.reading_to_options(reading);
                    ctx.log(JSON.stringify(reading, undefined, '  '));
                },
            },
            {
                id: 'scan-app',
                handler: async (args, ctx) => {
                    const [ username, app_name, permission ] = args;
                    const app = await get_app({ name: app_name });

                    // actor from username
                    const actor = new Actor({
                        type: new AppUnderUserActorType({
                            app,
                            user: await get_user({ username }),
                        }),
                    });

                    const reading = await this.scan(actor, permission);
                    // reading = PermissionUtil.reading_to_options(reading);
                    ctx.log(JSON.stringify(reading, undefined, '  '));
                },
            },
        ]);
    }
}

module.exports = {
    PermissionService,
};
