/**
 * Client-side normalization for `puter.ui.setURLParams()`.
 *
 * The GUI re-validates everything this produces — it is the authority,
 * since an app can postMessage without going through the SDK. What this
 * adds is developer experience: accept the shapes a caller naturally
 * reaches for, and fail loudly and early on the ones that would quietly
 * do the wrong thing.
 */

/**
 * @param {Record<string, string|number|boolean|null|undefined>|string|URLSearchParams|null|undefined} params
 * @returns {{ params: Record<string, string> } | { code: string, message: string }}
 */
export const normalizeURLParams = (params) => {
    if ( typeof params === 'string'
        || (typeof URLSearchParams !== 'undefined' && params instanceof URLSearchParams) ) {
        return { params: Object.fromEntries(new URLSearchParams(params)) };
    }

    // No argument clears the query string.
    if ( params === undefined || params === null ) {
        return { params: {} };
    }

    // A Map, Set, or class instance keeps its data off its own enumerable
    // keys, so it would serialize to {} and silently CLEAR the URL rather
    // than set anything. Only plain objects carry key/value pairs.
    const prototype = typeof params === 'object' ? Object.getPrototypeOf(params) : undefined;
    if ( typeof params !== 'object' || Array.isArray(params)
        || (prototype !== Object.prototype && prototype !== null) ) {
        return {
            code: 'params_invalid',
            message: 'params must be a plain object, query string, or URLSearchParams.'
                + ' (A Map, Set, or class instance would serialize to nothing and clear the URL.)',
        };
    }

    /** @type {Record<string, string>} */
    const normalized = {};
    for ( const key of Object.keys(params) ) {
        const value = params[key];
        // Dropped rather than rejected, so callers can spread optional
        // state without pruning it first.
        if ( value === undefined || value === null ) continue;
        if ( typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' ) {
            return { code: 'value_invalid', message: `value of "${key}" must be a string, number, or boolean.` };
        }
        normalized[key] = String(value);
    }
    return { params: normalized };
};
