const { AdvancedBase } = require("@heyputer/putility");
const BaseService = require("./services/BaseService");
const { Endpoint } = require("./util/expressutil");
const configurable_auth = require("./middleware/configurable_auth");
const { Context } = require("./util/context");
const { DB_READ, DB_WRITE } = require("./services/database/consts");

/**
 * State shared with the default service and the `extension` global so that
 * methods on `extension` can register routes (and make other changes in the
 * future) to the default service.
 */
class ExtensionServiceState extends AdvancedBase {
    constructor (...a) {
        super(...a);

        this.extension = a[0].extension;

        this.endpoints_ = [];
        
        // Values shared between the `extension` global and its service
        this.values = new Context();
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
        this.endpoints_ = [];
    }
    async _init (args) {
        this.state = args.state;

        // Create database access object for extension
        const db = this.services.get('database').get(DB_WRITE, 'extension');
        this.state.values.set('db', db);

        // Propagate all events not from extensions to `core.`
        const svc_event = this.services.get('event');
        svc_event.on_all((key, data, meta = {}) => {
            meta.from_outside_of_extension = true;
            this.state.extension.emit(`core.${key}`, data, meta);
        });

        this.state.extension.on_all((key, data, meta) => {
            if ( meta.from_outside_of_extension ) return;

            svc_event.emit(key, data, meta);
        });
    }

    ['__on_install.routes'] (_, { app }) {
        if ( ! this.state ) debugger;
        for ( const endpoint of this.state.endpoints_ ) {
            endpoint.attach(app);
        }
    }

}

module.exports = {
    ExtensionService,
    ExtensionServiceState,
};
