const { UserActorType } = require('../../services/auth/Actor');
const { PermissionImplicator, PermissionUtil } = require('../../services/auth/permissionUtils.mjs');
const BaseService = require('../../services/BaseService');

class AppPermissionService extends BaseService {
    async _init () {
        const svc_permission = this.services.get('permission');
        svc_permission.register_implicator(PermissionImplicator.create({
            id: 'user-can-grant-read-own-apps',
            matcher: permission => {
                return permission.startsWith('apps-of-user:');
            },
            checker: async ({ actor, permission }) => {
                if ( ! (actor.type instanceof UserActorType) ) {
                    return undefined;
                }

                const parts = PermissionUtil.split(permission);
                if ( parts[1] === actor.type.user.uuid ) {
                    return {};
                }
            },
        }));
    }
}

module.exports = {
    AppPermissionService,
};
