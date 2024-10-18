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
module.exports = {
    name: 'Properties',
    depends: ['Listeners'],
    install_in_instance: (instance) => {
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

            if ( typeof properties[k] === 'object' ) {
                // This will be supported in the future.
                throw new Error(`Property ${k} in ${instance.constructor.name} ` +
                    `is not a supported property specification.`);
            }

            let value = (() => {
                if ( typeof properties[k] === 'function' ) {
                    return properties[k]();
                }

                return properties[k];
            })();

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
                    state.value = value;
                },
            });

            state.value = value;
        }
    }
}
