// Client-side size limits for the KV store, exposed publicly as
// `puter.kv.MAX_KEY_SIZE` / `puter.kv.MAX_VALUE_SIZE`.
export const MAX_KEY_SIZE = 1024;
export const MAX_VALUE_SIZE = 399 * 1024;

// Validators throw the stable `{ message, code }` error objects the SDK
// documents; the codes are API surface and must not change.

/** @param {unknown} key */
export const assertKeyPresent = (key) => {
    if ( key === undefined || key === null ) {
        throw { message: 'Key cannot be undefined', code: 'key_undefined' };
    }
};

/** @param {unknown} key */
export const assertKeySize = (key) => {
    if ( /** @type {{ length?: number }} */ (key).length > MAX_KEY_SIZE ) {
        throw { message: `Key size cannot be larger than ${MAX_KEY_SIZE}`, code: 'key_too_large' };
    }
};

/** @param {unknown} value */
export const assertValueSize = (value) => {
    if ( value && /** @type {{ length?: number }} */ (value).length > MAX_VALUE_SIZE ) {
        throw { message: `Value size cannot be larger than ${MAX_VALUE_SIZE}`, code: 'value_too_large' };
    }
};
