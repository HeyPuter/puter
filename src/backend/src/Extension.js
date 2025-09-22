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
const EmitterFeature = require("@heyputer/putility/src/features/EmitterFeature");
const { Context } = require("./util/context");
const { ExtensionServiceState } = require("./ExtensionService");

/**
 * This class creates the `extension` global that is seen by Puter backend
 * extensions.
 */
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
        this.log = null;
        this.ensure_service_();
        
        this.log = (...a) => {
            this.log_context.info(a.join(' '));
        };
        this.LOG = (...a) => {
            this.log_context.noticeme(a.join(' '));
        };
        ['info','warn','debug','error','tick','noticeme','system'].forEach(lvl => {
            this.log[lvl] = (...a) => {
                this.log_context[lvl](...a);
            }
        });
        
        this.only_one_preinit_fn = null;
        this.only_one_init_fn = null;
        
        this.registry = {
            register: this.register.bind(this),
            of: (typeKey) => {
                return {
                    named: name => {
                        if ( arguments.length === 0 ) {
                            return this.registry_[typeKey].named;
                        }
                        return this.registry_[typeKey].named[name];
                    },
                    all: () => [
                        ...Object.values(this.registry_[typeKey].named),
                        ...this.registry_[typeKey].anonymous,
                    ],
                }
            }
        };
    }

    example () {
        console.log('Example method called by an extension.');
    }
    
    // === [START] RuntimeModule aliases ===
    set exports (value) {
        this.runtime.exports = value;
    }
    get exports () {
        return this.runtime.exports;
    }
    import (name) {
        return this.runtime.import(name);
    }
    // === [END] RuntimeModule aliases ===

    /**
     * This will get a database instance from the default service.
     */
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

    get services () {
        const services = this.service.values.get('services');
        if ( ! services ) {
            throw new Error(
                'extension tried to access "services" before it was ' +
                'initialized'
            );
        }
        return services;
    }

    get log_context () {
        const log_context = this.service.values.get('log_context');
        if ( ! log_context ) {
            throw new Error(
                'extension tried to access "log_context" before it was ' +
                'initialized'
            );
        }
        return log_context;
    }
    
    /**
     * Register anonymous or named data to a particular type/category.
     * @param {string} typeKey Type of data being registered
     * @param {string} [key] Key of data being registered
     * @param {any} data The data to be registered
     */
    register (typeKey, keyOrData, data) {
        if ( ! this.registry_[typeKey] ) {
            this.registry_[typeKey] = {
                named: {},
                anonymous: [],
            };
        }
        
        const typeRegistry = this.registry_[typeKey];
        
        if ( arguments.length <= 1 ) {
            throw new Error('you must specify what to register');
        }
        
        if ( arguments.length === 2 ) {
            data = keyOrData;
            if ( Array.isArray(data) ) {
                for ( const datum of data ) {
                    typeRegistry.anonymous.push(datum);
                }
                return;
            }
            typeRegistry.anonymous.push(data);
            return;
        }
        
        const key = keyOrData;
        typeRegistry.named[key] = data;
    }
    
    /**
     * Alias for .register()
     * @param {string} typeKey Type of data being registered
     * @param {string} [key] Key of data being registered
     * @param {any} data The data to be registered
     */
    reg (...a) {
        this.register(...a);
    }
    
    /**
     * This will create a GET endpoint on the default service.
     * @param {*} path - route for the endpoint
     * @param {*} handler - function to handle the endpoint
     * @param {*} options - options like noauth (bool) and mw (array)
     */
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

    /**
     * This will create a POST endpoint on the default service.
     * @param {*} path - route for the endpoint
     * @param {*} handler - function to handle the endpoint
     * @param {*} options - options like noauth (bool) and mw (array)
     */
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

    preinit (callback) {
        this.on('preinit', callback);
    }
    set preinit (callback) {
        if ( this.only_one_preinit_fn === null ) {
            this.on('preinit', (...a) => {
                this.only_one_preinit_fn(...a);
            });
        }
        if ( callback === null ) {
            this.only_one_preinit_fn = () => {};
        }
        this.only_one_preinit_fn = callback;
    }
    
    init (callback) {
        this.on('init', callback);
    }
    set init (callback) {
        if ( this.only_one_init_fn === null ) {
            this.on('init', (...a) => {
                this.only_one_init_fn(...a);
            });
        }
        if ( callback === null ) {
            this.only_one_init_fn = () => {};
        }
        this.only_one_init_fn = callback;
    }
    
    //

    /**
     * This method will create the "default service" for an extension.
     * This is specifically for Puter extensions that do not define their
     * own service classes.
     * 
     * @returns {void}
     */
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
