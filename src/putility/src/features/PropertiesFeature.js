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
module.exports = {
    name: 'Properties',
    depends: ['Listeners'],
    install_in_instance: (instance, { parameters }) => {
        const properties = instance._get_merged_static_object('PROPERTIES');

        instance.onchange = (name, callback) => {
            instance._.properties[name].listeners.push(callback);
        };

        instance._.properties = {};

        for ( const k in properties ) {
            const state = {
                definition: properties[k],
                listeners: [],
                value: undefined,
            };
            instance._.properties[k] = state;

            let spec = null;
            if ( typeof properties[k] === 'object' ) {
                spec = properties[k];
                if ( spec.factory ) {
                    spec.value = spec.factory({ parameters });
                }
            } else if ( typeof properties[k] === 'function' ) {
                spec = {};
                spec.value = properties[k]();
            }

            if ( spec === null ) {
                throw new Error('this will never happen');
            }

            Object.defineProperty(instance, k, {
                get: () => {
                    return state.value;
                },
                set: (value) => {
                    for ( const listener of instance._.properties[k].listeners ) {
                        listener(value, {
                            old_value: instance[k],
                        });
                    }
                    const old_value = instance[k];
                    const intermediate_value = value;
                    if ( spec.adapt ) {
                        value = spec.adapt(value);
                    }
                    state.value = value;
                    if ( spec.post_set ) {
                        spec.post_set.call(instance, value, {
                            intermediate_value,
                            old_value,
                        });
                    }
                },
            });

            state.value = spec.value;

            if ( properties[k].construct ) {
                const k_cons = typeof properties[k].construct === 'string'
                    ? properties[k].construct
                    : k;
                instance[k] = parameters[k_cons];
            }
        }
    }
}
