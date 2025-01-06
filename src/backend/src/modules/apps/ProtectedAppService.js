// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { get_app } = require("../../helpers");
const { UserActorType } = require("../../services/auth/Actor");
const { PermissionImplicator, PermissionUtil, PermissionRewriter } =
    require("../../services/auth/PermissionService");
const BaseService = require("../../services/BaseService");


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
                return PermissionUtil.join(
                    _1, `uid#${app.uid}`, ...rest,
                );
            },
        }));

        // track: object description in comment
        // Owner of procted app has implicit permission to access it
        svc_permission.register_implicator(PermissionImplicator.create({
            matcher: permission => {
                return permission.startsWith('app:');
            },
            checker: async ({ actor, permission }) => {
                if ( !(actor.type instanceof UserActorType) ) {
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
