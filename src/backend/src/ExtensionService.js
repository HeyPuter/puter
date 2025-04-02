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

const { AdvancedBase } = require("@heyputer/putility");
const BaseService = require("./services/BaseService");
const { Endpoint } = require("./util/expressutil");
const configurable_auth = require("./middleware/configurable_auth");
const { Context } = require("./util/context");
const { DB_READ, DB_WRITE } = require("./services/database/consts");
const { Actor } = require("./services/auth/Actor");

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
        
        this.state.values.set('services', this.services);

        // Create database access object for extension
        const db = this.services.get('database').get(DB_WRITE, 'extension');
        this.state.values.set('db', db);

        // Propagate all events not from extensions to `core.`
        const svc_event = this.services.get('event');
        svc_event.on_all(async (key, data, meta = {}) => {
            meta.from_outside_of_extension = true;

            await this.state.extension.emit(`core.${key}`, data, meta);
        });

        this.state.extension.on_all(async (key, data, meta) => {
            if ( meta.from_outside_of_extension ) return;
            
            await svc_event.emit(key, data, meta);
        });
        
        this.state.extension.kv = (() => {
            const impls = this.services.get_implementors('puter-kvstore');
            const impl_kv = impls[0].impl;
            
            return new Proxy(impl_kv, {
                get: (target, prop) => {
                    if ( typeof target[prop] !== 'function' ) {
                        return target[prop];
                    }
                    
                    return (...args) => {
                        if ( typeof args[0] !== 'object' ) {
                            // Luckily named parameters don't have positional
                            // overlaps between the different kv methods, so
                            // we can just set them all.
                            args[0] = {
                                key: args[0],
                                as: args[0],
                                value: args[1],
                                amount: args[2],
                                timestamp: args[2],
                                ttl: args[2],
                            };
                        }
                        return Context.sub({
                            actor: Actor.get_system_actor(),
                        }).arun(() => target[prop](...args));
                    };
                },
            });
        })();
        console.log('set kv on', this.state.extension);
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
