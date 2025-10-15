// METADATA // {"def":"core.util.strutil","ai-params":{"service":"claude"},"ai-commented":{"service":"claude"}}
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
* Quotes a string value, handling special cases for undefined, null, functions, objects and numbers.
* Escapes quotes and returns a JSON-stringified version with quote character normalization.
* @param {*} str - The value to quote
* @returns {string} The quoted string representation
*/
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


/**
* Creates an OSC 8 hyperlink sequence for terminal output
* @param {string} url - The URL to link to
* @param {string} [text] - Optional display text, defaults to URL if not provided
* @returns {string} Terminal escape sequence containing the hyperlink
*/
const osclink = (url, text) => {
    if ( ! text ) text = url;
    return `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\`;
}


/**
* Formats a number as a USD currency string with appropriate decimal places
* @param {number} amount - The amount to format
* @returns {string} The formatted USD string
*/
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

// wrap.js
const wrap_text = (text, width = 71) => {
    const out = [];
    const paras = text.split(/\r?\n\s*\r?\n/); // split on blank lines

    for (const p of paras) {
        const words = p.trim().replace(/\s+/g, ' ').split(' ');
        if (words.length === 1 && words[0] === '') { out.push(''); continue; }

        let line = '';
        for (const w of words) {
            if (line.length === 0) {
                // start new line; do NOT split long words
                line = w;
            } else if (line.length + 1 + w.length <= width) {
                line += ' ' + w;
            } else {
                out.push(line);
                line = w; // put word on its own new line (even if > width)
            }
        }
        if (line) out.push(line);
        out.push(''); // blank line between paragraphs
    }

    // remove the extra trailing blank line
    if (out.length && out[out.length - 1] === '') out.pop();

    return out;
};

const ansi_visible_length = str => {
    // Regex that matches ANSI escape sequences
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    return str.replace(ansiRegex, '').length;
};

module.exports = {
    quot,
    osclink,
    format_as_usd,
    wrap_text,
    ansi_visible_length,
};
