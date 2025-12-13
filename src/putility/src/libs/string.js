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

module.exports = {
    quot,
};
