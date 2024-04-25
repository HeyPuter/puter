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
// Convenience function for quoting strings in error messages.
// Turns a string like this: some`value`
// Into a string like this: `some\`value\``
const quot = (str) => {
    if ( str === undefined ) return '[undefined]';
    if ( str === null ) return '[null]';
    if ( typeof str === 'function' ) return '[function]';
    if ( typeof str === 'object' ) return '[object]';
    if ( typeof str === 'number' ) return '(' + str + ')';

    str = '' + str;

    str = str.replace(/["`]/g, m => m === '"' ? "`" : '"');
    str = JSON.stringify('' + str);
    str = str.replace(/["`]/g, m => m === '"' ? "`" : '"');
    return str;
}

const osclink = (url, text) => {
    if ( ! text ) text = url;
    return `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\`;
}

const format_as_usd = (amount) => {
    if ( amount < 0.01 ) {
        if ( amount < 0.00001 ) {
            // scientific notation
            return '$' + amount.toExponential(2);
        }
        return '$' + amount.toFixed(5);
    }
    return '$' + amount.toFixed(2);
}

module.exports = {
    quot,
    osclink,
    format_as_usd,
};