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

const cart_product = (obj) => {
    // Get array of keys
    let keys = Object.keys(obj);

    // Generate the Cartesian Product
    return keys.reduce((acc, key) => {
        let appendArrays = Array.isArray(obj[key]) ? obj[key] : [obj[key]];

        let newAcc = [];
        acc.forEach(arr => {
            appendArrays.forEach(item => {
                newAcc.push([...arr, item]);
            });
        });

        return newAcc;
    }, [[]]); // start with the "empty product"
}

const apply_keys = (keys, ...entries) => {
    const l = [];
    for ( const entry of entries ) {
        const o = {};
        for ( let i=0 ; i < keys.length ; i++ ) {
            o[keys[i]] = entry[i];
        }
        l.push(o);
    }
    return l;
}

module.exports = {
    cart_product,
    apply_keys,
};
