// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { get_app, get_user } = require('../../helpers');
const { UserActorType } = require('../../services/auth/Actor');
const { PermissionExploder, PermissionImplicator, PermissionUtil, PermissionRewriter } =
    require('../../services/auth/permissionUtils.mjs');
const BaseService = require('../../services/BaseService');

/**
* @class ProtectedAppService
* @extends BaseService
* @classdesc This class represents a service that handles protected applications. It extends the BaseService and includes
* methods for initializing permissions and registering rewriters and implicators for permission handling. The class
* ensures that the owner of a protected app has implicit permission to access it.
*/
class ProtectedAppService extends BaseService {
    /**
    * Initializes the ProtectedAppService.
    * Registers a permission rewriter and implicator to handle application-specific permissions.
    * @async
    * @method _init
    * @memberof ProtectedAppService
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    */
    async _init () {
        const svc_permission = this.services.get('permission');

        // Allow specifying owner by username and rewrite to the canonical UID form
        svc_permission.register_rewriter(PermissionRewriter.create({
            matcher: permission => {
                if ( ! permission.startsWith('app:') ) return false;
                const [_, specifier] = PermissionUtil.split(permission);
                return specifier.startsWith('owner@');
            },
            rewriter: async permission => {
                const [_1, owner_spec, ...rest] = PermissionUtil.split(permission);
                const username = owner_spec.slice('owner@'.length);
                const user = await get_user({ username });
                return PermissionUtil.join(_1, `owner#${user.uuid ?? user.uid ?? user.id}`, ...rest);
            },
        }));

        svc_permission.register_rewriter(PermissionRewriter.create({
            matcher: permission => {
                if ( ! permission.startsWith('app:') ) return false;
                const [_, specifier] = PermissionUtil.split(permission);
                if ( specifier.startsWith('uid#') ) return false;
                return true;
            },
            rewriter: async permission => {
                const [_1, name, ...rest] = PermissionUtil.split(permission);
                const app = await get_app({ name });
                return PermissionUtil.join(_1, `uid#${app.uid}`, ...rest);
            },
        }));

        // Access levels: write > read > access
        svc_permission.register_exploder(PermissionExploder.create({
            id: 'app-access-levels',
            matcher: permission => permission.startsWith('app:'),
            exploder: async ({ permission }) => {
                const parts = PermissionUtil.split(permission);
                if ( parts.length < 3 ) return [permission];

                const [prefix, spec, lvl, ...rest] = parts;
                const perms = [permission];
                if ( lvl === 'access' ) {
                    perms.push(PermissionUtil.join(prefix, spec, 'read', ...rest));
                    perms.push(PermissionUtil.join(prefix, spec, 'write', ...rest));
                } else if ( lvl === 'read' ) {
                    perms.push(PermissionUtil.join(prefix, spec, 'write', ...rest));
                }
                return perms;
            },
        }));

        // Explode a specific app access permission to the owner's wildcard permission
        svc_permission.register_exploder(PermissionExploder.create({
            id: 'app-owner-wildcard',
            matcher: permission => {
                if ( ! permission.startsWith('app:') ) return false;
                const parts = PermissionUtil.split(permission);
                return parts[1]?.startsWith('uid#') && parts[2];
            },
            exploder: async ({ permission }) => {
                const [_1, app_spec, ...rest] = PermissionUtil.split(permission);
                const app_uid = app_spec.slice('uid#'.length);
                const app = await get_app({ uid: app_uid });
                if ( ! app ) return [permission];

                const owner = await get_user({ id: app.owner_user_id });
                if ( ! owner ) return [permission];

                const owner_id = owner.uuid ?? owner.uid ?? owner.id;
                return [
                    permission,
                    PermissionUtil.join(_1, `owner#${owner_id}`, ...rest),
                ];
            },
        }));

        // track: object description in comment
        // Owner of procted app has implicit permission to access it
        svc_permission.register_implicator(PermissionImplicator.create({
            matcher: permission => {
                return permission.startsWith('app:');
            },
            checker: async ({ actor, permission }) => {
                if ( ! (actor.type instanceof UserActorType) ) {
                    return undefined;
                }

                const parts = PermissionUtil.split(permission);
                if ( parts.length !== 3 ) return undefined;

                const [_, uid_part, lvl] = parts;
                if ( lvl !== 'access' ) return undefined;

                // track: slice a prefix
                const uid = uid_part.slice('uid#'.length);

                const app = await get_app({ uid });

                if ( app.owner_user_id !== actor.type.user.id ) {
                    return undefined;
                }

                return {};
            },
        }));
    }
}

module.exports = {
    ProtectedAppService,
};
