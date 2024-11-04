const { AdvancedBase } = require("@heyputer/putility");
const EmitterFeature = require("@heyputer/putility/src/features/EmitterFeature");
const { Context } = require("./util/context");
const { ExtensionServiceState } = require("./ExtensionService");

class Extension extends AdvancedBase {
    static FEATURES = [
        EmitterFeature({
            decorators: [
                fn => Context.get(undefined, {
                    allow_fallback: true,
                }).abind(fn)
            ]
        }),
    ];

    constructor (...a) {
        super(...a);
        this.service = null;
        this.ensure_service_();
    }

    example () {
        console.log('Example method called by an extension.');
    }

    get db () {
        const db = this.service.values.get('db');
        if ( ! db ) {
            throw new Error(
                'extension tried to access database before it was ' +
                'initialized'
            );
        }
        return db;
    }

    get (path, handler, options) {
        // this extension will have a default service
        this.ensure_service_();

        // handler and options may be flipped
        if ( typeof handler === 'object' ) {
            [handler, options] = [options, handler];
        }
        if ( ! options ) options = {};

        this.service.register_route_handler_(path, handler, {
            ...options,
            methods: ['GET'],
        });
    }

    post (path, handler, options) {
        // this extension will have a default service
        this.ensure_service_();

        // handler and options may be flipped
        if ( typeof handler === 'object' ) {
            [handler, options] = [options, handler];
        }
        if ( ! options ) options = {};

        this.service.register_route_handler_(path, handler, {
            ...options,
            methods: ['POST'],
        });
    }

    ensure_service_ () {
        if ( this.service ) {
            return;
        }

        this.service = new ExtensionServiceState({
            extension: this,
        });
    }
}

module.exports = {
    Extension,
}
