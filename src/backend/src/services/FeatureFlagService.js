const { Context } = require("../util/context");
const { whatis } = require("../util/langutil");
const { PermissionUtil } = require("./auth/PermissionService");
const BaseService = require("./BaseService");

/**
 * FeatureFlagService is a way to let the client (frontend) know what features
 * are enabled or disabled for the current user.
 */
class FeatureFlagService extends BaseService {
    _construct () {
        this.known_flags = new Map();
    }
    register (name, spec) {
        this.known_flags.set(name, spec);
    }
    async _init () {
        const svc_detailProvider = this.services.get('whoami');
        svc_detailProvider.register_provider(async (context, out) => {
            console.log(`\x1B[36;1mCALLED\x1B[0m`);
            if ( ! context.actor ) return;
            out.feature_flags = await this.get_summary(context.actor);
        });
    }
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

        if ( ! this.known_flags.has(permission) ) {
            this.known_flags.set(permission, true);
        }
        

        const actor = options.actor ?? Context.get('actor');

        const svc_permission = this.services.get('permission');
        const reading = await svc_permission.scan(actor, `feature:${permission}`);
        const l = PermissionUtil.reading_to_options(reading);
        if ( l.length === 0 ) return false;
        return true;
    }

    async get_summary (actor) {
        const summary = {};
        for ( const [key, value] of this.known_flags.entries() ) {
            if ( value.$ === 'config-flag' ) {
                summary[key] = value.value;
                continue;
            }
            const svc_permission = this.services.get('permission');
            const reading = await svc_permission.scan(actor, `feature:${key}`);
            const l = PermissionUtil.reading_to_options(reading);
            summary[key] = l.length > 0;
        }

        return summary;
    }
}

module.exports = {
    FeatureFlagService
};
