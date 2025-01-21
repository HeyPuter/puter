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

/**
 * A simpler alternative to TopicsFeature. This is an opt-in and not included
 * in AdvancedBase.
 * 
 * Adds methods `.on` and `emit`. Unlike TopicsFeature, this does not implement
 * a trait. Usage is similar to node's built-in EventEmitter, but because it's
 * installed as a mixin it can be used with other class features.
 * 
 * When listeners return a promise, they will block the promise returned by the
 * corresponding `emit()` call. Listeners are invoked concurrently, so
 * listeners of the same event do not block each other.
 */
module.exports = ({ decorators }) => ({
    install_in_instance (instance, { parameters }) {
        // install the internal state
        const state = instance._.emitterFeature = {};
        state.listeners_ = {};
        state.global_listeners_ = [];
        state.callbackDecorators = decorators || [];
        
        instance.emit = async (key, data, meta) => {
            meta = meta ?? {};
            const parts = key.split('.');
            
            const promises = [];
            
            for ( let i = 0 ; i < state.global_listeners_.length ; i++ ) {
                let callback = state.global_listeners_[i];
                for ( const decorator of state.callbackDecorators ) {
                    callback = decorator(callback);
                }

                promises.push(callback(key, data,
                    { ...meta, key }));
            }

            for ( let i = 0; i < parts.length; i++ ) {
                const part = i === parts.length - 1
                    ? parts.join('.')
                    : parts.slice(0, i + 1).join('.') + '.*';

                // actual emit
                const listeners = state.listeners_[part];
                if ( ! listeners ) continue;
                for ( let i = 0; i < listeners.length; i++ ) {
                    let callback = listeners[i];
                    for ( const decorator of state.callbackDecorators ) {
                        callback = decorator(callback);
                    }

                    promises.push(callback(data, {
                        ...meta,
                        key,
                    }));
                }
            }

            return await Promise.all(promises);
        }
        
        instance.on = (selector, callback) => {
            const listeners = state.listeners_[selector] ||
                (state.listeners_[selector] = []);
            
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

        instance.on_all = (callback) => {
            state.global_listeners_.push(callback);
        };
    }
});

