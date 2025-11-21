/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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
