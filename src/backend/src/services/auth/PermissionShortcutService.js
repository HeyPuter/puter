const BaseService = require("../BaseService");
const { PermissionImplicator } = require("./PermissionService");

class PermissionShortcutService extends BaseService {
    _init () {
        const svc_permission = this.services.get('permission');
        
        svc_permission.register_implicator(PermissionImplicator.create({
            id: 'kv permissions are easy',
            shortcut: true,
            matcher: permission => {
                return permission === 'service:puter-kvstore:ii:puter-kvstore';
            },
            checker: async ({ actor }) => {
                return {
                    policy: {
                        "rate-limit": {
                            max: 3000,
                            period: 30000,
                        }
                    }
                };
            }
        }));
    }
}

module.exports = {
    PermissionShortcutService,
};