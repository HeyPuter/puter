// METADATA // {"ai-commented":{"service":"claude"}}
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
const APIError = require("../../api/APIError");
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const { NodePathSelector } = require("../../filesystem/node/selectors");
const { get_user } = require("../../helpers");
const configurable_auth = require("../../middleware/configurable_auth");
const { Context } = require("../../util/context");
const { Endpoint } = require("../../util/expressutil");
const BaseService = require("../BaseService");
const { AppUnderUserActorType, UserActorType, Actor, SystemActorType, AccessTokenActorType } = require("./Actor");
const { PermissionUtil } = require("./PermissionService");


/**
* ACLService class handles Access Control List functionality for the Puter filesystem.
* Extends BaseService to provide permission management, access control checks, and ACL operations.
* Manages user-to-user permissions, filesystem node access, and handles special cases like
* public folders, app data access, and system actor privileges. Provides methods for
* checking permissions, setting ACLs, and managing access control hierarchies.
* @extends BaseService
*/
class ACLService extends BaseService {
    static MODULES = {
        express: require('express'),
    };


    /**
    * Initializes the ACLService by registering the 'public-folders' feature flag
    * with the feature flag service. The flag's value is determined by the 
    * global_config.enable_public_folders setting.
    * 
    * @async
    * @private
    * @returns {Promise<void>}
    */
    async _init () {
        const svc_featureFlag = this.services.get('feature-flag');
        svc_featureFlag.register('public-folders', {
            $: 'config-flag',
            value: this.global_config.enable_public_folders ?? false,
        });
    }
    /**
    * Checks if an actor has permission to perform a specific mode of access on a resource
    * 
    * @param {Actor} actor - The actor requesting access (user, system, app, etc)
    * @param {FSNode} resource - The filesystem resource being accessed
    * @param {string} mode - The access mode being requested ('read', 'write', etc)
    * @returns {Promise<boolean>} True if access is allowed, false otherwise
    */
    async check (actor, resource, mode) {
        const ld = (Context.get('logdent') ?? 0) + 1;
        /**
        * Checks if an actor has permission for a specific mode on a resource
        * 
        * @param {Actor} actor - The actor requesting permission
        * @param {FSNode} resource - The filesystem resource to check permissions for
        * @param {string} mode - The permission mode to check ('see', 'list', 'read', 'write')
        * @returns {Promise<boolean>} True if actor has permission, false otherwise
        */
        return await Context.get().sub({ logdent: ld }).arun(async () => {
            const result =  await this._check_fsNode(actor, resource, mode);
            if ( this.verbose ) console.log('LOGGING ACL CHECK', {
                actor, mode,
                // trace: (new Error()).stack,
                result,
            });
            return result;
        });
    }


    /**
    * Checks if an actor has permission for a specific mode on a filesystem node.
    * Handles various actor types (System, User, AppUnderUser, AccessToken) and
    * enforces access control rules including public folder access and app data permissions.
    * 
    * @param {Actor} actor - The actor requesting access
    * @param {FSNode} fsNode - The filesystem node to check permissions on
    * @param {string} mode - The permission mode to check ('see', 'list', 'read', 'write')
    * @returns {Promise<boolean>} True if actor has permission, false otherwise
    * @private
    */
    async ['__on_install.routes'] (_, { app }) {
        /**
        * Handles route installation for ACL service endpoints.
        * Sets up routes for user-to-user permission management including:
        * - /acl/stat-user-user: Get permissions between users
        * - /acl/set-user-user: Set permissions between users
        * 
        * @param {*} _ Unused parameter 
        * @param {Object} options Installation options
        * @param {Express} options.app Express app instance to attach routes to
        * @returns {Promise<void>}
        */
        const r_acl = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        app.use('/acl', r_acl);

        Endpoint({
            route: '/stat-user-user',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                // Only user actor is allowed
                if ( ! (req.actor.type instanceof UserActorType) ) {
                    return res.status(403).json({
                        error: 'forbidden',
                    });
                }

                const holder_user = await get_user({
                    username: req.body.user,
                });

                if ( ! holder_user ) {
                    throw APIError.create('user_does_not_exist', null, {
                        username: req.body.user,
                    });
                }

                const issuer = req.actor;
                const holder = new Actor({
                    type: new UserActorType({
                        user: holder_user,
                    }),
                });

                const node = await (new FSNodeParam('path')).consolidate({
                    req,
                    getParam: () => req.body.resource,
                });

                const permissions = await this.stat_user_user(issuer, holder, node);

                res.json({ permissions });
            }
        }).attach(r_acl);

        Endpoint({
            route: '/set-user-user',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                // Only user actor is allowed
                if ( ! (req.actor.type instanceof UserActorType) ) {
                    return res.status(403).json({
                        error: 'forbidden',
                    });
                }

                const holder_user = await get_user({
                    username: req.body.user,
                });

                if ( ! holder_user ) {
                    throw APIError.create('user_does_not_exist', null, {
                        username: req.body.user,
                    });
                }

                const issuer = req.actor;
                const holder = new Actor({
                    type: new UserActorType({
                        user: holder_user,
                    }),
                });

                const node = await (new FSNodeParam('path')).consolidate({
                    req,
                    getParam: () => req.body.resource,
                });

                await this.set_user_user(issuer, holder, node, req.body.mode, req.body.options ?? {});

                res.json({});
            }
        }).attach(r_acl);
    }


    /**
    * Sets user-to-user permissions for a filesystem resource
    * @param {Actor} issuer - The user granting the permission
    * @param {Actor|string} holder - The user receiving the permission, or their username
    * @param {FSNode|string} resource - The filesystem resource or permission string
    * @param {string} mode - The permission mode to set
    * @param {Object} [options={}] - Additional options
    * @param {boolean} [options.only_if_higher] - Only set permission if no higher mode exists
    * @returns {Promise<boolean>} False if permission already exists or higher mode present
    * @throws {Error} If issuer or holder is not a UserActorType
    */
    async set_user_user (issuer, holder, resource, mode, options = {}) {
        const svc_perm = this.services.get('permission');
        const svc_fs = this.services.get('filesystem');

        if ( typeof holder === 'string' ) {
            const holder_user = await get_user({ username: holder });
            if ( ! holder_user ) {
                throw APIError.create('user_does_not_exist', null, { username: holder });
            }

            holder = new Actor({
                type: new UserActorType({ user: holder_user }),
            });
        }

        let uid, _;

        if ( typeof resource === 'string' && mode === undefined ) {
            const perm_parts = PermissionUtil.split(resource);
            ([_, uid, mode] = perm_parts);
            resource = await svc_fs.node(new NodePathSelector(uid));
            if ( ! resource ) {
                throw APIError.create('subject_does_not_exist');
            }
        }

        if ( ! (issuer.type instanceof UserActorType) ) {
            throw new Error('issuer must be a UserActorType');
        }
        if ( ! (holder.type instanceof UserActorType) ) {
            throw new Error('holder must be a UserActorType');
        }

        const stat = await this.stat_user_user(issuer, holder, resource);

        const perms_on_this = stat[await resource.get('path')] ?? [];

        const mode_parts = perms_on_this.map(perm => PermissionUtil.split(perm)[2]);

        // If mode already present, do nothing
        if ( mode_parts.includes(mode) ) {
            return false;
        }

        // If higher mode already present, do nothing
        if ( options.only_if_higher ) {
            const higher_modes = this._higher_modes(mode);
            if ( mode_parts.some(m => higher_modes.includes(m)) ) {
                return false;
            }
        }

        uid = uid ?? await resource.get('uid');

        // If mode not present, add it
        await svc_perm.grant_user_user_permission(
            issuer, holder.type.user.username,
            PermissionUtil.join('fs', uid, mode),
        );

        // Remove other modes
        for ( const perm of perms_on_this ) {
            const perm_parts = PermissionUtil.split(perm);
            if ( perm_parts[2] === mode ) continue;

            await svc_perm.revoke_user_user_permission(
                issuer, holder.type.user.username,
                perm,
            );
        }
    }


    /**
    * Sets user-to-user permissions for a filesystem resource
    * @param {Actor} issuer - The user granting the permission
    * @param {Actor|string} holder - The user receiving the permission, or their username
    * @param {FSNode|string} resource - The filesystem resource or permission string
    * @param {string} mode - The permission mode to set
    * @param {Object} [options={}] - Additional options
    * @param {boolean} [options.only_if_higher] - Only set permission if no higher mode exists
    * @returns {Promise<boolean>} False if permission already exists or higher mode present
    * @throws {Error} If issuer or holder is not a UserActorType
    */
    async stat_user_user (issuer, holder, resource) {
        const svc_perm = this.services.get('permission');

        if ( ! (issuer.type instanceof UserActorType) ) {
            throw new Error('issuer must be a UserActorType');
        }
        if ( ! (holder.type instanceof UserActorType) ) {
            throw new Error('holder must be a UserActorType');
        }

        const permissions = {};

        let perm_fsNode = resource;
        while ( ! await perm_fsNode.get('is-root') ) {
            const prefix = PermissionUtil.join('fs', await perm_fsNode.get('uid'));

            const these_permissions = await
                svc_perm.query_issuer_holder_permissions_by_prefix(issuer, holder, prefix);
            
            if ( these_permissions.length > 0 ) {
                permissions[await perm_fsNode.get('path')] = these_permissions;
            }

            perm_fsNode = await perm_fsNode.getParent();
        }

        return permissions;
    }


    /**
    * Checks filesystem node permissions for a given actor and mode
    * 
    * @param {Actor} actor - The actor requesting access (User, System, AccessToken, or AppUnderUser)
    * @param {FSNode} fsNode - The filesystem node to check permissions for
    * @param {string} mode - The permission mode to check ('see', 'list', 'read', 'write')
    * @returns {Promise<boolean>} True if actor has permission, false otherwise
    * 
    * @description
    * Evaluates access permissions by checking:
    * - System actors always have access
    * - Public folder access rules
    * - Access token authorizer permissions
    * - App data directory special cases
    * - Explicit permissions in the ACL hierarchy
    */
    async _check_fsNode (actor, fsNode, mode) {
        const context = Context.get();

        actor = Actor.adapt(actor);

        if ( actor.type instanceof SystemActorType ) {
            return true;
        }

        const path_selector = fsNode.get_selector_of_type(NodePathSelector);
        if ( path_selector && path_selector.value === '/') {
            if (['list','see','read'].includes(mode)) {
                return true;
            }
            return false;
        }
        
        // PERF: Short-circuit the permission check for users accessing their own files.
        // Since the filesystem structure guarantees ownership within a user's home directory,
        // we can safely grant access without a database lookup for the fsentry.
        if (actor.type instanceof UserActorType) {
            const username = actor.type.user.username;
            const path_selector = fsNode.get_selector_of_type(NodePathSelector);
    
            if (path_selector) {
                const path = path_selector.value;
                // If the path starts with the user's own home directory, grant access immediately.
                if (path === `/${username}` || path.startsWith(`/${username}/`)) {
                    return true;
                }
            }
        }

        // PERF: Short-circuit for apps accessing their own AppData directory.
        if (actor.type instanceof AppUnderUserActorType) {
            const username = actor.type.user.username;
            const app_uid = actor.type.app.uid;
            const path_selector = fsNode.get_selector_of_type(NodePathSelector);

            if (path_selector) {
                const path = path_selector.value;
                const appDataPath = `/${username}/AppData/${app_uid}`;
                if (path === appDataPath || path.startsWith(`${appDataPath}/`)) {
                    return true;
                }
            }
        }

        // Hard rule: anyone and anything can read /user/public directories
        if ( this.global_config.enable_public_folders ) {
            const public_modes = Object.freeze(['read', 'list', 'see']);
            let is_public;
            /**
            * Checks if a given mode is allowed for a public folder path
            * 
            * @param {Actor} actor - The actor requesting access
            * @param {FSNode} fsNode - The filesystem node to check
            * @param {string} mode - The access mode being requested (read/write/etc)
            * @returns {Promise<boolean>} True if access is allowed, false otherwise
            * 
            * Handles special case for /user/public directories when public folders are enabled.
            * Only allows read, list, and see modes for public folders, and only if the folder
            * owner has confirmed their email (except for admin user).
            */
            await (async () => {
                if ( ! public_modes.includes(mode) ) return;
                if ( ! (await fsNode.isPublic()) ) return;
                
                const svc_getUser = this.services.get('get-user');
                
                const username = await fsNode.getUserPart();
                const user = await svc_getUser.get_user({ username });
                if ( ! (user.email_confirmed || user.username === 'admin') ) {
                    return;
                }
                
                is_public = true;
            })();
            if ( is_public ) return true;
        }

        // Access tokens only work if the authorizer has permission
        if ( actor.type instanceof AccessTokenActorType ) {
            const authorizer = actor.type.authorizer;
            const authorizer_perm = await this._check_fsNode(authorizer, fsNode, mode);

            if ( ! authorizer_perm ) return false;
        }

        // Hard rule: if app-under-user is accessing appdata directory, allow
        if ( actor.type instanceof AppUnderUserActorType ) {
            const appdata_path = `/${actor.type.user.username}/AppData/${actor.type.app.uid}`;
            const svc_fs = await context.get('services').get('filesystem');
            const appdata_node = await svc_fs.node(new NodePathSelector(appdata_path));

            if (
                await appdata_node.exists() && (
                    await appdata_node.is(fsNode) ||
                    await appdata_node.is_above(fsNode)
                )
            ) {
                console.log('TRUE BECAUSE APPDATA')
                return true;
            }
        }
        
        // app-under-user only works if the user also has permission
        if ( actor.type instanceof AppUnderUserActorType ) {
            const user_actor = new Actor({
                type: new UserActorType({ user: actor.type.user }),
            });
            const user_perm = await this._check_fsNode(user_actor, fsNode, mode);

            if ( ! user_perm ) return false;
        }
        
        // Hard rule: if app-under-user is accessing appdata directory
        //            under a **different user**, allow,
        //            IFF that appdata directory is shared with  user
        //              (by "user also has permission" check above)
        /**
        * Checks if an actor has permission to perform a specific mode of access on a filesystem node.
        * Handles various actor types (System, AccessToken, AppUnderUser) and special cases like
        * public folders and app data directories.
        * 
        * @param {Actor} actor - The actor requesting access
        * @param {FSNode} fsNode - The filesystem node to check access for
        * @param {string} mode - The access mode to check ('see', 'list', 'read', 'write')
        * @returns {Promise<boolean>} True if access is allowed, false otherwise
        * @private
        */
        if (await (async () => {
            if ( ! (actor.type instanceof AppUnderUserActorType) ) {
                return false;
            }
            if ( await fsNode.getUserPart() === actor.type.user.username ) {
                return false;
            }
            const components = await fsNode.getPathComponents();
            if ( components[1] !== 'AppData' ) return false;
            if ( components[2] !== actor.type.app.uid ) return false;
            return true;
        })()) return true;

        const svc_permission = await context.get('services').get('permission');

        const modes = [mode];
        let perm_fsNode = fsNode;
        while ( ! await perm_fsNode.get('is-root') ) {
            for ( const mode of modes ) {
                const reading = await svc_permission.scan(
                    actor,
                    `fs:${await perm_fsNode.get('uid')}:${mode}`
                );
                const options = PermissionUtil.reading_to_options(reading);
                if ( options.length > 0 ) {
                    // console.log('TRUE BECAUSE PERMISSION', perm)
                    // console.log(`fs:${await perm_fsNode.get('uid')}:${mode}`)
                    return true;
                }
            }
            perm_fsNode = await perm_fsNode.getParent();
        }

        return false;
    }


    /**
    * Gets a safe error message for ACL check failures
    * @param {Actor} actor - The actor attempting the operation
    * @param {FSNode} resource - The filesystem resource being accessed
    * @param {string} mode - The access mode being checked ('read', 'write', etc)
    * @returns {APIError} Returns 'subject_does_not_exist' if actor cannot see resource,
    *                     otherwise returns 'forbidden' error
    */
    async get_safe_acl_error (actor, resource, mode) {
        const can_see = await this.check(actor, resource, 'see');
        if ( ! can_see ) {
            return APIError.create('subject_does_not_exist');
        }

        return APIError.create('forbidden');
    }

    // If any logic depends on knowledge of the highest ACL mode, it should use
    // this method in case a higher mode is added (ex: might add 'config' mode)
    /**
    * Gets the highest permission mode in the ACL system
    * 
    * @returns {string} Returns 'write' as the highest permission mode
    * 
    * @remarks
    * This method should be used by any logic that depends on knowing the highest ACL mode,
    * in case higher modes are added in the future (e.g. a potential 'config' mode).
    * Currently 'write' is the highest mode in the hierarchy: see > list > read > write
    */
    get_highest_mode () {
        return 'write';
    }

    // TODO: DRY: Also in FilesystemService
    _higher_modes (mode) {
        // If you want to X, you can do so with any of [...Y]
        if ( mode === 'see' ) return ['see', 'list', 'read', 'write'];
        if ( mode === 'list' ) return ['list', 'read', 'write'];
        if ( mode === 'read' ) return ['read', 'write'];
        if ( mode === 'write' ) return ['write'];
    }
}

module.exports = {
    ACLService,
};
