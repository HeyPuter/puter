// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");


/**
 * A proxy to EventService or another scoped event bus, allowing for
 * emitting or listening on a prefix (ex: `a.b.c`) without the user
 * of the scoped bus needed to know what the prefix is.
 */
class ScopedEventBus {
    constructor (event_bus, scope) {
        this.event_bus = event_bus;
        this.scope = scope;
    }

    async emit (key, data) {
        await this.event_bus.emit(this.scope + '.' + key, data);
    }

    on (key, callback) {
        return this.event_bus.on(this.scope + '.' + key, callback);
    }
}


/**
* Class representing the EventService, which extends the BaseService.
* This service is responsible for managing event listeners and emitting 
* events within a scoped context, allowing for flexible event handling 
* and decoupled communication between different parts of the application.
*/
class EventService extends BaseService {
    /**
     * Initializes listeners and global listeners for the EventService.
     * This method is called to set up the internal data structures needed 
     * for managing event listeners upon construction of the service.
     * 
     * @async
     * @returns {Promise} A promise that resolves when the initialization is complete.
     */
    async _construct () {
        this.listeners_ = {};
        this.global_listeners_ = [];
    }
    
    async ['__on_boot.ready'] () {
        this.emit('ready', {}, {});
    }

    async emit (key, data, meta) {
        meta = meta ?? {};
        const parts = key.split('.');
        for ( let i = 0; i < parts.length; i++ ) {
            const part = i === parts.length - 1
                ? parts.join('.')
                : parts.slice(0, i + 1).join('.') + '.*';

            // actual emit
            const listeners = this.listeners_[part];
            if ( ! listeners ) continue;
            for ( const callback of listeners ) {
                // IIAFE wrapper to catch errors without blocking
                // event dispatch.
                await Context.arun(async () => {
                    try {
                        await callback(key, data, meta);
                    } catch (e) {
                        this.errors.report('event-service.emit', {
                            source: e,
                            trace: true,
                            alarm: true,
                        });
                    }
                });
            }
        }
        
        for ( const callback of this.global_listeners_ ) {
            // IIAFE wrapper to catch errors without blocking
            // event dispatch.
            /**
            * Invokes all registered global listeners for an event with the provided key, data, and meta
            * information. Each callback is executed within a context that handles errors gracefully, 
            * ensuring that one failing listener does not disrupt subsequent invocations.
            *
            * @param {string} key - The event key to emit.
            * @param {*} data - The data to be passed to the listeners.
            * @param {Object} [meta={}] - Optional metadata related to the event.
            * @returns {void}
            */
            await Context.arun(async () => {
                try {
                    await callback(key, data, meta);
                } catch (e) {
                    this.errors.report('event-service.emit', {
                        source: e,
                        trace: true,
                        alarm: true,
                    });
                }
            });
        }

    }

    /**
    * Registers a callback function for the specified event selector.
    * 
    * This method will push the provided callback onto the list of listeners
    * for the event specified by the selector. It returns an object containing
    * a detach method, which can be used to remove the listener.
    *
    * @param {string} selector - The event selector to listen for.
    * @param {Function} callback - The function to be invoked when the event is emitted.
    * @returns {Object} An object with a detach method to unsubscribe the listener.
    */
    on (selector, callback) {
        const listeners = this.listeners_[selector] ||
            (this.listeners_[selector] = []);
        
        listeners.push(callback);

        const det = {
            detach: () => {
                const idx = listeners.indexOf(callback);
                if ( idx !== -1 ) {
                    listeners.splice(idx, 1);
                }
            }
        };

        return det;
    }
    
    on_all (callback) {
        this.global_listeners_.push(callback);
    }

    get_scoped (scope) {
        return new ScopedEventBus(this, scope);
    }
}

module.exports = {
    EventService
};
