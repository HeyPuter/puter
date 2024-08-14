const { Context } = require("../util/context");
const { whatis } = require("../util/langutil");
const { PermissionUtil } = require("./auth/PermissionService");
const BaseService = require("./BaseService");

/**
 * FeatureFlagService is a way to let the client (frontend) know what features
 * are enabled or disabled for the current user.
 */
class FeatureFlagService extends BaseService {
    async check (...a) {
        // allows binding call with multiple options objects;
        // the last argument is the permission to check
        const { options, value: permission } = (() => {
            let value;
            const options = {};
            for ( const arg of a ) {
                if ( whatis(arg) === 'object' ) {
                    Object.assign(options, arg);
                    continue;
                }
                value = arg;
                break;
            }
            return { options, value };
        })();

        

        const actor = options.actor ?? Context.get('actor');

        const svc_permission = this.services.get('permission');
        const reading = await svc_permission.scan(actor, `feature:${permission}`);
        const l = PermissionUtil.reading_to_options(reading);
        if ( l.length === 0 ) return false;
        return true;
    }
}

module.exports = {
    FeatureFlagService
};
