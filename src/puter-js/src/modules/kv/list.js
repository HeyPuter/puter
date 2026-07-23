import * as utils from '../../lib/utils.js';
import { isObject, isOptConfigShorthand } from './lib/args.js';

/** @typedef {import('../../../types/modules/kv').KVListOptions} KVListOptions */
/**
 * @template [T=unknown]
 * @typedef {import('../../../types/modules/kv').KVListPage<T>} KVListPage
 */
/** @typedef {import('../../../types/modules/kv').KVListPaginationOptions} KVListPaginationOptions */
/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */
/**
 * @template [T=unknown]
 * @typedef {import('../../../types/modules/kv').KVPair<T>} KVPair
 */

// The wire pattern is a bare prefix: a trailing `*` wildcard is stripped, and
// a pattern matching everything (`*`, empty, whitespace) is omitted entirely.
const normalizeListPattern = (pattern) => {
    if ( typeof pattern !== 'string' ) {
        return undefined;
    }
    const trimmed = pattern.trim();
    if ( trimmed === '' ) {
        return undefined;
    }
    if ( trimmed.endsWith('*') ) {
        const prefix = trimmed.slice(0, -1);
        return prefix === '' ? undefined : prefix;
    }
    return trimmed;
};

/**
 * @overload
 * @param {string} [pattern]
 * @param {false} [returnValues]
 * @returns {Promise<string[]>}
 */
/**
 * @template [T = unknown]
 * @overload
 * @param {string} pattern
 * @param {true} returnValues
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<KVPair<T>[]>}
 */
/**
 * @template [T = unknown]
 * @overload
 * @param {true} returnValues
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<KVPair<T>[]>}
 */
/**
 * @overload
 * @param {string} pattern
 * @param {KVOptConfig} optConfig
 * @returns {Promise<string[]>}
 */
/**
 * @overload
 * @param {KVListOptions & KVListPaginationOptions & { returnValues?: false }} options
 * @returns {Promise<KVListPage<string>>}
 */
/**
 * @template [T = unknown]
 * @overload
 * @param {KVListOptions & KVListPaginationOptions & { returnValues: true }} options
 * @returns {Promise<KVListPage<KVPair<T>>>}
 */
/**
 * @overload
 * @param {KVListOptions & { returnValues?: false }} options
 * @returns {Promise<string[]>}
 */
/**
 * @template [T = unknown]
 * @overload
 * @param {KVListOptions & { returnValues: true }} options
 * @returns {Promise<KVPair<T>[]>}
 */
/**
 * Lists keys in the store for the current app, sorted lexicographically.
 * Returns just the keys, `KVPair` objects when `returnValues` is `true`, or
 * a `KVListPage` when any pagination option (`limit`, `cursor`, `offset`,
 * `includeTotal`, `fetchUntilFull`) is used.
 *
 * Documented forms:
 *   list()
 *   list(pattern)
 *   list(returnValues)
 *   list(pattern, returnValues)
 *   list(options)
 *
 * An `optConfig` object may trail any positional form.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | boolean
 *     | (KVListOptions & Partial<KVListPaginationOptions> & { returnValues?: boolean })
 *     | (KVListOptions & { [key: string]: unknown })} [patternOrOptions]
 * @param {boolean | KVOptConfig} [returnValuesOrOptConfig]
 * @param {KVOptConfig} [maybeOptConfig]
 * @returns {Promise<string[] | KVPair[] | KVListPage>}
 */
export async function list (patternOrOptions, returnValuesOrOptConfig, maybeOptConfig) {
    const options = {};
    let pattern;
    let returnValues = false;

    const isOptionsObject =
        isObject(patternOrOptions) &&
        returnValuesOrOptConfig === undefined &&
        maybeOptConfig === undefined;

    if ( isOptionsObject ) {
        const input = patternOrOptions;
        if ( typeof input.pattern === 'string' ) {
            pattern = input.pattern;
        }
        returnValues = !!input.returnValues;
        if ( isObject(input.optConfig) ) {
            options.optConfig = input.optConfig;
        } else if ( isOptConfigShorthand(input) ) {
            options.optConfig = input;
        }
        for ( const name of ['limit', 'cursor', 'offset', 'includeTotal', 'fetchUntilFull'] ) {
            if ( input[name] !== undefined ) {
                options[name] = input[name];
            }
        }
    } else {
        if ( typeof patternOrOptions === 'string' ) {
            pattern = patternOrOptions;
        } else if ( patternOrOptions === true ) {
            returnValues = true;
        }

        if ( returnValuesOrOptConfig === true ) {
            returnValues = true;
        } else if ( isObject(returnValuesOrOptConfig) ) {
            options.optConfig = returnValuesOrOptConfig;
        }

        if ( isObject(maybeOptConfig) ) {
            options.optConfig = maybeOptConfig;
        }
    }

    if ( ! returnValues ) {
        options.as = 'keys';
    }

    const normalizedPattern = normalizeListPattern(pattern);
    if ( normalizedPattern ) {
        options.pattern = normalizedPattern;
    }

    return await utils.make_driver_method([], 'puter-kvstore', undefined, 'list', { puter: this.puter })(options);
}
