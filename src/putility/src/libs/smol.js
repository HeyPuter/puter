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
// All of these utilities are trivial and just make the code look nicer.
class SmolUtil {
    // Array coercion
    static ensure_array (value) {
        return Array.isArray(value) ? value : [value];
    }
    // Variadic sum
    static add (...a) {
        return a.reduce((a, b) => a + b, 0);
    }
    static split (str, sep, options = {}) {
        options = options || {};
        const { trim, discard_empty } = options;

        const operations = [];

        if ( options.trim ) {
            operations.push(a => a.map(str => str.trim()));
        }

        if ( options.discard_empty ) {
            operations.push(a => a.filter(str => str.length > 0));
        }

        let result = str.split(sep);
        for ( const operation of operations ) {
            result = operation(result);
        }
        return result;
    }
}

module.exports = SmolUtil;

