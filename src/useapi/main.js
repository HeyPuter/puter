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
const globalwith = (vars, fn) => {
    const original_values = {};
    const keys = Object.keys(vars);

    for ( const key of keys ) {
        if ( key in globalThis ) {
            original_values[key] = globalThis[key];
        }
        globalThis[key] = vars[key];
    }

    try {
        return fn();
    } finally {
        for ( const key of keys ) {
            if ( key in original_values ) {
                globalThis[key] = original_values[key];
            } else {
                delete globalThis[key];
            }
        }
    }
};

const aglobalwith = async (vars, fn) => {
    const original_values = {};
    const keys = Object.keys(vars);

    for ( const key of keys ) {
        if ( key in globalThis ) {
            original_values[key] = globalThis[key];
        }
        globalThis[key] = vars[key];
    }

    try {
        return await fn();
    } finally {
        for ( const key of keys ) {
            if ( key in original_values ) {
                globalThis[key] = original_values[key];
            } else {
                delete globalThis[key];
            }
        }
    }
};

let default_fn = () => {
    const use = name => {
        const parts = name.split('.');
        let obj = use;
        for ( const part of parts ) {
            if ( ! obj[part] ) {
                obj[part] = {};
            }
            obj = obj[part];
        }

        return obj;
    };
    const library = {
        use,
        def: (name, value, options = {}) => {
            const parts = name.split('.');
            let obj = use;
            for ( const part of parts.slice(0, -1) ) {
                if ( ! obj[part] ) {
                    obj[part] = {};
                }
                obj = obj[part];
            }

            const lastpart = parts[parts.length - 1];

            if ( options.assign ) {
                if ( ! obj[lastpart] ) {
                    obj[lastpart] = {};
                }
                Object.assign(obj[lastpart], value);
                return;
            }

            obj[lastpart] = value;
        },
        withuse: fn => {
            return globalwith({
                use,
                def: library.def,
            }, fn);
        },
        awithuse: async fn => {
            return await aglobalwith({
                use,
                def: library.def,
            }, fn);
        },
    };

    return library;
};

const useapi = function useapi () {
    return default_fn();
};

// We export some things on the function itself
useapi.globalwith = globalwith;
useapi.aglobalwith = aglobalwith;

module.exports = useapi;
