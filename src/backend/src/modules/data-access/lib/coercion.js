// These utility functions describe how values stored in the database
// are to be understood as their higher-level counterparts.

import { CoercionTypeError } from './error.js';

/**
 * MySQL lets us store `1` (an integer) or `0` (also an integer) as
 * the closest parallel to a boolean "true or false" value.
 * Sqlite lets us store `"1"` (a string) or `0` (also a string) as
 * the closest parallel to a boolean "true of false" value.
 *
 * So we define a function here called `as_bool` that will make
 * `"0"` or `0` become `false`, and `"1"` or `1` become `true`.
 *
 * @param {any} value - The value to coerce to a boolean.
 * @returns {boolean} The coerced boolean value.
 */
export const as_bool = value => {
    if ( value === undefined ) return false;
    if ( value === 0 ) value = false;
    if ( value === 1 ) value = true;
    if ( value === '0' ) value = false;
    if ( value === '1' ) value = true;
    if ( typeof value !== 'boolean' ) {
        throw new CoercionTypeError({ expected: 'boolean', got: typeof value });
    }
    return value;
};
