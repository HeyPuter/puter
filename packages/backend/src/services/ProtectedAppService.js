const { get_app } = require("../helpers");
const { UserActorType } = require("./auth/Actor");
const { PermissionImplicator, PermissionUtil } = require("./auth/PermissionService");
const BaseService = require("./BaseService");

class ProtectedAppService extends BaseService {
    async _init () {
        const svc_permission = this.services.get('permission');

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
