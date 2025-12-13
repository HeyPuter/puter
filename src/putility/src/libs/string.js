// METADATA // {"def":"core.util.strutil","ai-params":{"service":"claude"},"":{"service":"claude"}}

/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

/*eslint no-control-regex: 'off'*/

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
    if ( typeof str === 'number' ) return `(${ str })`;

    str = `${ str}`;

    str = str.replace(/["`]/g, m => m === '"' ? '`' : '"');
    str = JSON.stringify(`${ str}`);
    str = str.replace(/["`]/g, m => m === '"' ? '`' : '"');
    return str;
};

/**
* Creates an OSC 8 hyperlink sequence for terminal output
* @param {string} url - The URL to link to
* @param {string} [text] - Optional display text, defaults to URL if not provided
* @returns {string} Terminal escape sequence containing the hyperlink
*/
const osclink = (url, text) => {
    if ( ! text ) text = url;
    return `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\`;
};

/**
* Formats a number as a USD currency string with appropriate decimal places
* @param {number} amount - The amount to format
* @returns {string} The formatted USD string
*/
const format_as_usd = (amount) => {
    if ( amount < 0.01 ) {
        if ( amount < 0.00001 ) {
            // scientific notation
            return `$${ amount.toExponential(2)}`;
        }
        return `$${ amount.toFixed(5)}`;
    }
    return `$${ amount.toFixed(2)}`;
};

module.exports = {
    quot,
    osclink,
    format_as_usd,
};
