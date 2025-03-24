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
const { APIError } = require("openai");
const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const { whatis } = require("../util/langutil");
const BaseService = require("./BaseService");


/**
* @class PermissionAPIService
* @extends BaseService
* @description Service class that handles API endpoints for permission management, including user-app permissions,
* user-user permissions, and group management. Provides functionality for creating groups, managing group memberships,
* granting/revoking various types of permissions, and checking access control lists (ACLs). Implements RESTful
* endpoints for group operations like creation, adding/removing users, and listing groups.
*/
class PermissionAPIService extends BaseService {
    static MODULES = {
        express: require('express'),
    };


    /**
    * Installs routes for authentication and permission management into the Express app
    * @param {Object} _ Unused parameter
    * @param {Object} options Installation options
    * @param {Express} options.app Express application instance to install routes on
    * @returns {Promise<void>}
    */
    async ['__on_install.routes'] (_, { app }) {
        app.use(require('../routers/auth/get-user-app-token'))
        app.use(require('../routers/auth/grant-user-app'))
        app.use(require('../routers/auth/revoke-user-app'))
        app.use(require('../routers/auth/grant-dev-app'))
        app.use(require('../routers/auth/revoke-dev-app'))
        app.use(require('../routers/auth/grant-user-user'));
        app.use(require('../routers/auth/revoke-user-user'));
        app.use(require('../routers/auth/grant-user-group'));
        app.use(require('../routers/auth/revoke-user-group'));
        app.use(require('../routers/auth/list-permissions'))

        Endpoint(
            require('../routers/auth/check-app-acl.endpoint.js'),
        ).but({
            route: '/auth/check-app-acl',
        }).attach(app);
        
        // track: scoping iife
        /**
        * Creates a scoped router for group-related endpoints using an IIFE pattern
        * @private
        * @returns {express.Router} Express router instance with isolated require scope
        */
        const r_group = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router()
        })();

        this.install_group_endpoints_({ router: r_group });
        app.use('/group', r_group);
    }
    
    install_group_endpoints_ ({ router }) {
        Endpoint({
            route: '/create',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const owner_user_id = req.user.id;
                
                const extra = req.body.extra ?? {};
                const metadata = req.body.metadata ?? {};
                if ( whatis(extra) !== 'object' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'extra',
                        expected: 'object',
                        got: whatis(extra),
                    })
                }
                if ( whatis(metadata) !== 'object' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'metadata',
                        expected: 'object',
                        got: whatis(metadata),
                    })
                }

                const svc_group = this.services.get('group');
                const uid = await svc_group.create({
                    owner_user_id,
                    // TODO: includeslist for allowed 'extra' fields
                    extra: {},
                    // Metadata can be specified in request
                    metadata: metadata ?? {},
                });
                
                res.json({ uid });
            }
        }).attach(router);
        
        Endpoint({
            route: '/add-users',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const svc_group = this.services.get('group')
                
                // TODO: validate string and uuid for request

                const group = await svc_group.get(
                    { uid: req.body.uid });
                
                if ( ! group ) {
                    throw APIError.create('entity_not_found', null, {
                        identifier: req.body.uid,
                    })
                }
                
                if ( group.owner_user_id !== req.user.id ) {
                    throw APIError.create('forbidden');
                }
                
                if ( whatis(req.body.users) !== 'array' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'users',
                        expected: 'array',
                        got: whatis(req.body.users),
                    });
                }
                
                for ( let i=0 ; i < req.body.users.length ; i++ ) {
                    const value = req.body.users[i];
                    if ( whatis(value) === 'string' ) continue;
                    throw APIError.create('field_invalid', null, {
                        key: `users[${i}]`,
                        expected: 'string',
                        got: whatis(value),
                    });
                }
                
                await svc_group.add_users({
                    uid: req.body.uid,
                    users: req.body.users,
                });
                
                res.json({});
            }
        }).attach(router);

        // TODO: DRY: add-users is very similar
        Endpoint({
            route: '/remove-users',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const svc_group = this.services.get('group')
                
                // TODO: validate string and uuid for request

                const group = await svc_group.get(
                    { uid: req.body.uid });
                
                if ( ! group ) {
                    throw APIError.create('entity_not_found', null, {
                        identifier: req.body.uid,
                    })
                }

                if ( group.owner_user_id !== req.user.id ) {
                    throw APIError.create('forbidden');
                }
                
                if ( whatis(req.body.users) !== 'array' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'users',
                        expected: 'array',
                        got: whatis(req.body.users),
                    });
                }
                
                for ( let i=0 ; i < req.body.users.length ; i++ ) {
                    const value = req.body.users[i];
                    if ( whatis(value) === 'string' ) continue;
                    throw APIError.create('field_invalid', null, {
                        key: `users[${i}]`,
                        expected: 'string',
                        got: whatis(value),
                    });
                }
                
                await svc_group.remove_users({
                    uid: req.body.uid,
                    users: req.body.users,
                });
                
                res.json({});
            }
        }).attach(router);

        Endpoint({
            route: '/list',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const svc_group = this.services.get('group');
                
                // TODO: validate string and uuid for request

                const owned_groups = await svc_group.list_groups_with_owner(
                    { owner_user_id: req.user.id });

                const in_groups = await svc_group.list_groups_with_member(
                    { user_id: req.user.id });

                const public_groups = await svc_group.list_public_groups();

                res.json({
                    owned_groups: await Promise.all(owned_groups.map(
                        g => g.get_client_value({ members: true }))),
                    in_groups: await Promise.all(in_groups.map(
                        g => g.get_client_value({ members: true }))),
                    public_groups: await Promise.all(public_groups.map(
                        g => g.get_client_value())),
                });
            }
        }).attach(router);

        Endpoint({
            route: '/public-groups',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                res.json({
                    user: this.global_config.default_user_group,
                    temp: this.global_config.default_temp_group,
                });
            }
        }).attach(router);
    }
}

module.exports = {
    PermissionAPIService,
};
