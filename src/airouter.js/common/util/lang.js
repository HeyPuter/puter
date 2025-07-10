// Utilities that cover language builtin shortcomings, and make
// writing javascript code a little more convenient.

/**
 * whatis exists because checking types such as 'object' and 'array'
 * can be done incorrectly very easily. This give sthe correct
 * implementation a single source of truth.
 * @param {*} thing 
 * @returns {string}
 */
export const whatis = thing => {
    if ( Array.isArray(thing) ) return 'array';
    if ( thing === null ) return 'null';
    return typeof thing;
};

/**
 * nou makes a null or undefined check the path of least resistance,
 * encouraging developers to treat both as the same which encourages
 * more predictable branching behavior.
 * @param {*} v 
 * @returns {boolean}
 */
export const nou = v => v === null || v === undefined;
