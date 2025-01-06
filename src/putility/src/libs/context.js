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

class Context {
    constructor (values = {}) {
        const descs = Object.getOwnPropertyDescriptors(values);
        for ( const k in descs ) {
            Object.defineProperty(this, k, descs[k]);
        }
    }
    follow (source, keys) {
        const values = {};
        for ( const k of keys ) {
            Object.defineProperty(values, k, {
                get: () => source[k]
            });
        }
        return this.sub(values);
    }
    sub (newValues) {
        if ( newValues === undefined ) newValues = {};
        const sub = Object.create(this);

        const alreadyApplied = {};
        for ( const k in sub ) {
            if ( sub[k] instanceof Context ) {
                const newValuesForK =
                    newValues.hasOwnProperty(k)
                        ? newValues[k] : undefined;
                sub[k] = sub[k].sub(newValuesForK);
                alreadyApplied[k] = true;
            }
        }

        const descs = Object.getOwnPropertyDescriptors(newValues);
        for ( const k in descs ){
            if ( alreadyApplied[k] ) continue;
            Object.defineProperty(sub, k, descs[k]);
        }

        return sub;
    }
}

module.exports = {
    Context,
};
