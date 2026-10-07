// Client-side size limits for the KV store, exposed publicly as
// `puter.kv.MAX_KEY_SIZE` / `puter.kv.MAX_VALUE_SIZE`.
export const MAX_KEY_SIZE = 1024;
export const MAX_VALUE_SIZE = 399 * 1024;

// Validators throw the stable `{ message, code }` error objects the SDK
// documents; the codes are API surface and must not change.

const encoder = new TextEncoder();

/** @param {string} text */
const utf8Length = (text) => encoder.encode(text).length;

/** @param {unknown} key */
export const assertKeyPresent = (key) => {
    if ( key === undefined || key === null ) {
        throw { message: 'Key cannot be undefined', code: 'key_undefined' };
    }
};

/**
 * Measured like the store does, in UTF-8 bytes. An array (a batched read) is
 * checked key by key; non-string keys are coerced and checked by the store.
 *
 * @param {unknown} key
 */
export const assertKeySize = (key) => {
    for ( const k of Array.isArray(key) ? key : [key] ) {
        if ( typeof k === 'string' && utf8Length(k) > MAX_KEY_SIZE ) {
            throw { message: `Key size cannot be larger than ${MAX_KEY_SIZE}`, code: 'key_too_large' };
        }
    }
};

/**
 * Measured like the store does: UTF-8 bytes of the value's JSON encoding.
 *
 * @param {unknown} value
 */
export const assertValueSize = (value) => {
    let json;
    try {
        json = JSON.stringify(value ?? null);
    } catch {
        // Not JSON-encodable (a cycle, a BigInt); the request fails to encode
        // the same way, so there is no size to check.
        return;
    }
    if ( typeof json === 'string' && utf8Length(json) > MAX_VALUE_SIZE ) {
        throw { message: `Value size cannot be larger than ${MAX_VALUE_SIZE}`, code: 'value_too_large' };
    }
};
