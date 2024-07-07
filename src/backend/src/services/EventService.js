/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const BaseService = require("./BaseService");

class ScopedEventBus {
    constructor (event_bus, scope) {
        this.event_bus = event_bus;
        this.scope = scope;
    }

    emit (key, data) {
        this.event_bus.emit(this.scope + '.' + key, data);
    }

    on (key, callback) {
        return this.event_bus.on(this.scope + '.' + key, callback);
    }
}

class EventService extends BaseService {
    async _construct () {
        this.listeners_ = {};
        this.global_listeners_ = [];
    }

    emit (key, data, meta) {
        meta = meta ?? {};
        const parts = key.split('.');
        for ( let i = 0; i < parts.length; i++ ) {
            const part = i === parts.length - 1
                ? parts.join('.')
                : parts.slice(0, i + 1).join('.') + '.*';

            // actual emit
            const listeners = this.listeners_[part];
            if ( ! listeners ) continue;
            for ( let i = 0; i < listeners.length; i++ ) {
                const callback = listeners[i];

                // IIAFE wrapper to catch errors without blocking
                // event dispatch.
                (async () => {
                    try {
                        await callback(key, data, meta);
                    } catch (e) {
                        this.errors.report('event-service.emit', {
                            source: e,
                            trace: true,
                            alarm: true,
                        });
                    }
                })();
            }
        }
        
        for ( const callback of this.global_listeners_ ) {
            // IIAFE wrapper to catch errors without blocking
            // event dispatch.
            (async () => {
                try {
                    await callback(key, data, meta);
                } catch (e) {
                    this.errors.report('event-service.emit', {
                        source: e,
                        trace: true,
                        alarm: true,
                    });
                }
            })();
        }

    }

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
