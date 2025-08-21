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

const { AdvancedBase } = require("../AdvancedBase");
const ServiceFeature = require("../features/ServiceFeature");

/** @type {Function} No-operation async function */
const NOOP = async () => {};

/** @type {Symbol} Service trait symbol */
const TService = Symbol('TService');

/**
 * Service class that will be incrementally updated to consolidate
 * BaseService in Puter's backend with Service in Puter's frontend,
 * becoming the common base for both and a useful utility in general.
 * 
 * @class Service
 * @extends AdvancedBase
 */
class Service extends AdvancedBase {
    /** @type {Array} Array of features this service supports */
    static FEATURES = [
        ServiceFeature,
    ];

    /**
     * Handles events by calling the appropriate event handler
     * 
     * @param {string} id - The event identifier
     * @param {Array} args - Arguments to pass to the event handler
     * @returns {Promise<*>} The result of the event handler
     */
    async __on (id, args) {
        const handler = this.__get_event_handler(id);

        return await handler(id, ...args);
    }

    /**
     * Retrieves the event handler for a given event ID
     * 
     * @param {string} id - The event identifier
     * @returns {Function} The event handler function or NOOP if not found
     */
    __get_event_handler (id) {
        return this[`__on_${id}`]?.bind?.(this)
            || this.constructor[`__on_${id}`]?.bind?.(this.constructor)
            || NOOP;
    }

    /**
     * Factory method to create a new service instance
     * 
     * @param {Object} config - Configuration object
     * @param {Object} config.parameters - Parameters for service construction
     * @param {Object} config.context - Context for the service
     * @returns {Service} A new service instance
     */
    static create ({ parameters, context }) {
        const ins = new this();
        ins._.context = context;
        ins.as(TService).construct(parameters);
        return ins;
    }

    static IMPLEMENTS = {
        /** @type {Object} Implementation of the TService trait */
        [TService]: {
            /**
             * Initializes the service by running init hooks and calling _init if present
             * 
             * @param {...*} a - Arguments to pass to _init method
             * @returns {*} Result of _init method if it exists
             */
            init (...a) {
                if ( this._.init_hooks ) {
                    for ( const hook of this._.init_hooks ) {
                        hook.call(this);
                    }
                }
                if ( ! this._init ) return;
                return this._init(...a);
            },
            /**
             * Constructs the service with given parameters
             * 
             * @param {Object} o - Parameters object
             * @returns {*} Result of _construct method if it exists
             */
            construct (o) {
                this.$parameters = {};
                for ( const k in o ) this.$parameters[k] = o[k];
                if ( ! this._construct ) return;
                return this._construct(o);
            },
            /**
             * Gets the dependencies for this service
             * 
             * @returns {Array} Array of dependencies
             */
            get_depends () {
                return [
                    ...(this.constructor.DEPENDS ?? []),
                    ...(this.get_depends?.() ?? []),
                ];
            }
        }
    }
}

module.exports = {
    TService,
    Service,
};
