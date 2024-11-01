const { AdvancedBase } = require("@heyputer/putility");
const BaseService = require("./services/BaseService");
const { Endpoint } = require("./util/expressutil");
const configurable_auth = require("./middleware/configurable_auth");

class ExtensionServiceState extends AdvancedBase {
    constructor (...a) {
        super(...a);

        this.endpoints_ = [];
    }
    register_route_handler_ (path, handler, options = {}) {
        // handler and options may be flipped
        if ( typeof handler === 'object' ) {
            [handler, options] = [options, handler];
        }

        const mw = options.mw ?? [];

        // TODO: option for auth middleware is harcoded here, but eventually
        // all exposed middlewares should be registered under the simpele names
        // used in this options object (probably; still not 100% decided on that)
        if ( ! options.noauth ) {
            const auth_conf = typeof options.auth === 'object' ?
                options.auth : {};
            mw.push(configurable_auth(auth_conf));
        }

        const endpoint = Endpoint({
            methods: options.methods ?? ['GET'],
            mw,
            route: path,
            handler: handler,
        });
    
        this.endpoints_.push(endpoint);
    }
}

/**
 * A service that does absolutely nothing by default, but its behavior can be
 * extended by adding route handlers and event listeners. This is used to
 * provide a default service for extensions.
 */
class ExtensionService extends BaseService {
    _construct () {
        this.extension = null;
        this.endpoints_ = [];
    }
    async _init (args) {
        this.state = args.state;
    }

    ['__on_install.routes'] (_, { app }) {
        for ( const endpoint of this.state.endpoints_ ) {
            endpoint.attach(app);
        }
    }

}

module.exports = {
    ExtensionService,
    ExtensionServiceState,
};
