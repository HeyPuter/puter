// Shared argument-shape helpers for the puter.kv methods. Most methods accept
// positional shorthands, an options object, an optional trailing `optConfig`,
// and legacy success/error callbacks; these keep that parsing in one place.

/** @returns {value is Record<string, unknown>} */
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// An `{ appUuid }` object passed where an amount/value would go is the
// optConfig shorthand form.
export const isOptConfigShorthand = (value) => isObject(value) && Object.prototype.hasOwnProperty.call(value, 'appUuid');

export const isBatchSetItem = (value) => isObject(value) && Object.prototype.hasOwnProperty.call(value, 'key');

/**
 * Consumes `[optConfig], [success], [error]` from the front of `rest`
 * (skipping one explicit `undefined`), as set()/update() accept after their
 * positional arguments. Mutates `rest`.
 *
 * @param {unknown[]} rest
 */
export const parseTrailingArgs = (rest) => {
    if ( rest[0] === undefined ) {
        rest.shift();
    }
    const optConfig = isObject(rest[0]) ? rest.shift() : undefined;
    const success = typeof rest[0] === 'function' ? rest.shift() : undefined;
    const error = typeof rest[0] === 'function' ? rest.shift() : undefined;
    return { optConfig, success, error };
};

/**
 * get()/del()/flush() accept `[optConfig], [success], [error]` positionally,
 * where the callbacks shift left when optConfig is omitted.
 *
 * @param {unknown[]} rest
 */
export const parseOptConfigThenCallbacks = (rest) => {
    if ( isObject(rest[0]) ) {
        return { optConfig: rest[0], success: rest[1], error: rest[2] };
    }
    return { success: rest[0], error: rest[1] };
};

/**
 * incr()/decr() argument parsing: `(key, [amountOrMap], [optConfig])`, or a
 * single options object passed through to the driver as-is.
 *
 * @param {unknown} keyOrOptions
 * @param {unknown} [amountOrMap]
 * @param {unknown} [optConfig]
 * @returns {Record<string, unknown>}
 */
export const parseCounterArgs = (keyOrOptions, amountOrMap, optConfig) => {
    if ( isObject(keyOrOptions) && amountOrMap === undefined && optConfig === undefined ) {
        return { ...keyOrOptions };
    }
    if ( keyOrOptions === undefined && amountOrMap === undefined && optConfig === undefined ) {
        throw { message: 'Arguments are required', code: 'arguments_required' };
    }
    if ( isOptConfigShorthand(amountOrMap) && optConfig === undefined ) {
        optConfig = amountOrMap;
        amountOrMap = undefined;
    }
    return {
        key: keyOrOptions,
        pathAndAmountMap: !amountOrMap ? { '': 1 } : typeof amountOrMap === 'number' ? { '': amountOrMap } : amountOrMap,
        optConfig,
    };
};
