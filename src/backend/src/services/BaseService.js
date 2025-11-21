// METADATA // {"ai-params":{"service":"xai"},"ai-refs":["../../doc/contributors/boot-sequence.md"],"ai-commented":{"service":"xai"}}
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
const { concepts } = require("@heyputer/putility");



// This is a no-op function that AI is incapable of writing a comment for.
// That said, I suppose it didn't need one anyway.
const NOOP = async () => {};


/**
* @class BaseService
* @extends concepts.Service
* @description
* BaseService is the foundational class for all services in the Puter backend.
* It provides lifecycle methods like `construct` and `init` that are invoked during
* different phases of the boot sequence. This class ensures that services can be
* instantiated, initialized, and activated in a coordinated manner through
* events emitted by the Kernel. It also manages common service resources like
* logging and error handling, and supports legacy services by allowing
* instantiation after initialization but before consolidation.
*/
class BaseService extends concepts.Service {
    constructor (service_resources, ...a) {
        const { services, config, name, args, context } = service_resources;
        super(service_resources, ...a);

        this.args = args;
        this.service_name = name || this.constructor.name;
        this.services = services;
        let configOverride = undefined;
        Object.defineProperty(this, 'config', {
            get: () => configOverride ?? config.services?.[name] ?? {},
            set: why => {
                // TODO: uncomment and fix these in legacy services
                //       (not very important; low priority)
                // console.warn('replacing config like this is probably a bad idea');
                configOverride = why;
            },
        });
        this.global_config = config;
        this.context = context;

        if ( this.global_config.server_id === '' ) {
            this.global_config.server_id = 'local';
        }
    }
    
    async run_as_early_as_possible () {
        await (this._run_as_early_as_possible || NOOP).call(this, this.args);
    }

    /**
    * Creates the service's data structures and initial values.
    * This method sets up logging and error handling, and calls a custom `_construct` method if defined.
    * 
    * @returns {Promise<void>} A promise that resolves when construction is complete.
    */
    async construct () {
        const useapi = this.context.get('useapi');
        const use = this._get_merged_static_object('USE');
        for ( const [key, value] of Object.entries(use) ) {
            this[key] = useapi.use(value);
        }
        await (this._construct || NOOP).call(this, this.args);
    }


    /**
    * Performs the initialization phase of the service lifecycle.
    * This method sets up logging and error handling for the service,
    * then calls the service-specific initialization logic if defined.
    * 
    * @async
    * @memberof BaseService
    * @instance
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
    async init () {
        const services = this.services;
        const log_fields = {};
        if ( this.constructor.CONCERN ) {
            log_fields.concern = this.constructor.CONCERN;
        }
        this.log = services.get('log-service').create(this.service_name, log_fields);

        // INFO logs are treated as DEBUG logs instead if...
        if (
            // The configuration file explicitly says to do so
            this.config.log_debug ||
            // The class has `static LOG_DEBUG = true`; AND,
            // the configuration file does NOT explicitly say NOT to do this
            (! this.config.log_info && this.constructor.LOG_DEBUG)
        ) {
            this.log.info = this.log.debug;
        }
        this.errors = services.get('error-service').create(this.log);

        await (this._init || NOOP).call(this, this.args);
    }


    /**
    * Handles an event by retrieving the appropriate event handler
    * and executing it with the provided arguments.
    *
    * @param {string} id - The identifier of the event to handle.
    * @param {Array<any>} args - The arguments to pass to the event handler.
    * @returns {Promise<any>} The result of the event handler execution.
    */
    async __on (id, args) {
        const handler = this.__get_event_handler(id);

        return await handler(id, ...args);
    }

    __get_event_handler (id) {
        return this[`__on_${id}`]?.bind?.(this)
            || this.constructor[`__on_${id}`]?.bind?.(this.constructor)
            || NOOP;
    }

    /**
    * Sets the service mode, enabling method overriding with prefixed methods.
    * This allows services to be "modal" - switching between different behavior modes
    * (e.g., test mode, debug mode, etc.) by overriding methods with prefixed versions.
    * 
    * @param {Object|null} mode - Mode configuration object or null to restore normal mode
    * @param {string} [mode.override_prefix] - Prefix for methods that should override their unprefixed counterparts
    *                                          (e.g., '__test_' will make __test_methodName override methodName)
    * @returns {void}
    * 
    * @example
    * // Enable test mode
    * service.setServiceMode({ override_prefix: '__test_' });
    * 
    * // Restore normal mode
    * service.setServiceMode(null);
    */
    setServiceMode (mode) {
        // Restore previous mode if switching modes
        if ( this._serviceModeState ) {
            this._restoreServiceMode();
        }

        // If mode is null or empty, just restore and return
        if ( ! mode || ! mode.override_prefix ) {
            this._serviceModeState = null;
            return;
        }

        // Store mode state
        this._serviceModeState = {
            override_prefix: mode.override_prefix,
            methodOverrides: {},
        };

        // Discover and apply method overrides
        const checkSources = [
            Object.getPrototypeOf(this),
            this
        ];

        for ( const source of checkSources ) {
            for ( const key of Object.getOwnPropertyNames(source) ) {
                if ( key.startsWith(mode.override_prefix) && typeof this[key] === 'function' ) {
                    const originalMethodName = key.slice(mode.override_prefix.length);
                    if ( typeof this[originalMethodName] === 'function' ) {
                        // Store original method for restoration (only if not already stored)
                        if ( ! this._serviceModeState.methodOverrides[originalMethodName] ) {
                            this._serviceModeState.methodOverrides[originalMethodName] = this[originalMethodName];
                        }
                        // Override with prefixed method
                        this[originalMethodName] = this[key].bind(this);
                    }
                }
            }
        }
    }

    /**
    * Restores the service to normal mode by reverting all method overrides.
    * @private
    * @returns {void}
    */
    _restoreServiceMode () {
        if ( ! this._serviceModeState || ! this._serviceModeState.methodOverrides ) {
            return;
        }

        // Restore original methods
        for ( const [methodName, originalMethod] of Object.entries(this._serviceModeState.methodOverrides) ) {
            this[methodName] = originalMethod;
        }

        this._serviceModeState.methodOverrides = {};
    }
}

module.exports = BaseService;
