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
const { DB_WRITE } = require("./services/database/consts");
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

        this.expressThings_ = [];
        
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
            ...(options.subdomain ? { subdomain: options.subdomain } : {}),
        });
    
        this.expressThings_.push({ type: 'endpoint', value: endpoint });
    }
}

/**
 * A service that does absolutely nothing by default, but its behavior can be
 * extended by adding route handlers and event listeners. This is used to
 * provide a default service for extensions.
 */
class ExtensionService extends BaseService {
    _construct () {
        this.expressThings_ = [];
    }
    async _init (args) {
        this.state = args.state;
        
        this.state.values.set('services', this.services);
        this.state.values.set('log_context', this.services.get('log-service').create(
            this.state.extension.name));

        // Create database access object for extension
        const db = this.services.get('database').get(DB_WRITE, 'extension');
        this.state.values.set('db', db);

        // Propagate all events from Puter's event bus to extensions
        const svc_event = this.services.get('event');
        svc_event.on_all(async (key, data, meta = {}) => {
            meta.from_outside_of_extension = true;

            await Context.sub({
                extension_name: this.state.extension.name,
            }).arun(async () => {
                const promises = [
                    // push event to the extension's event bus
                    this.state.extension.emit(key, data, meta),
                    // legacy: older extensions prefix "core." to events from Puter
                    this.state.extension.emit(`core.${key}`, data, meta),
                ];
                // await this.state.extension.emit(key, data, meta);
                await Promise.all(promises);
            });
            // await Promise.all(promises);
        });

        // Propagate all events from extension to Puter's event bus
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
        
        this.state.extension.emit('preinit');
    }
    
    async ['__on_boot.consolidation'] (...a) {
        await this.state.extension.emit('init', {}, {
            from_outside_of_extension: true,
        });
    }
    async ['__on_boot.activation'] (...a) {
        await this.state.extension.emit('activate', {}, {
            from_outside_of_extension: true,
        });
    }
    async ['__on_boot.ready'] (...a) {
        await this.state.extension.emit('ready', {}, {
            from_outside_of_extension: true,
        });
    }

    ['__on_install.routes'] (_, { app }) {
        if ( ! this.state ) debugger;
        for ( const thing of this.state.expressThings_ ) {
            if ( thing.type === 'endpoint' ) {
                thing.value.attach(app);
                continue;
            }
            if ( thing.type === 'router' ) {
                app.use(...thing.value);
                continue;
            }
        }
    }

}

module.exports = {
    ExtensionService,
    ExtensionServiceState,
};
