import * as utils from '../../lib/utils.js';
import { fetchAllPages, iteratePages } from '../../lib/pagination.js';
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

// Page size the SDK uses when it pages on the caller's behalf (full listings
// and `stream` without an explicit `limit`). A cursor-only request would make
// the backend produce the entire listing in one response, so the SDK always
// sends a limit when it drives the paging; `fetchUntilFull` keeps pages full
// when expired keys are filtered out.
const SDK_PAGE_LIMIT = 1000;

// One-time-per-instance developer nudges: totals and unbounded scans are
// metered and their cost grows with the store, so expensive query shapes get
// flagged without spamming the console. Keyed on the module instance so each
// SDK instance warns independently.
const nudgesShown = new WeakMap();
const nudgeOnce = (kv, key, message) => {
    const seen = nudgesShown.get(kv) ?? nudgesShown.set(kv, new Set()).get(kv);
    if ( seen.has(key) ) return;
    seen.add(key);
    try {
        console.warn(`puter.kv.list: ${message}`);
    } catch (e) {
        // console may be unavailable in exotic embeddings
    }
};

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
 * @param {KVListOptions & { stream: true, returnValues?: false }} options
 * @returns {AsyncIterableIterator<KVListPage<string>>}
 */
/**
 * @template [T = unknown]
 * @overload
 * @param {KVListOptions & { stream: true, returnValues: true }} options
 * @returns {AsyncIterableIterator<KVListPage<KVPair<T>>>}
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
 * `includeTotal`, `fetchUntilFull`) is used. With `stream: true` it instead
 * returns an async iterator of `KVListPage`s for `for await ... of`.
 * Full (non-paginated) listings are fetched page by page under the hood,
 * but still read the entire store — every page is metered, so prefer
 * `stream`/`limit` with a narrow `pattern` on large stores. `includeTotal`
 * is likewise a metered count over every matching key.
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
 *     | (KVListOptions & Partial<KVListPaginationOptions> & { returnValues?: boolean, stream?: boolean })
 *     | (KVListOptions & { [key: string]: unknown })} [patternOrOptions]
 * @param {boolean | KVOptConfig} [returnValuesOrOptConfig]
 * @param {KVOptConfig} [maybeOptConfig]
 * @returns {Promise<string[] | KVPair[] | KVListPage> | AsyncIterableIterator<KVListPage>}
 */
export function list (patternOrOptions, returnValuesOrOptConfig, maybeOptConfig) {
    const options = {};
    let pattern;
    let returnValues = false;
    let stream = false;
    let cursor;
    let includeTotal = false;
    let paginated = false;

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
        stream = input.stream === true;
        if ( isObject(input.optConfig) ) {
            options.optConfig = input.optConfig;
        } else if ( isOptConfigShorthand(input) ) {
            if ( stream ) {
                const optConfig = { ...input };
                delete optConfig.stream;
                options.optConfig = optConfig;
            } else {
                options.optConfig = input;
            }
        }
        for ( const name of ['limit', 'cursor', 'offset', 'includeTotal', 'fetchUntilFull'] ) {
            if ( input[name] !== undefined ) {
                options[name] = input[name];
                paginated = true;
            }
        }
        cursor = input.cursor;
        includeTotal = input.includeTotal === true;
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

    if ( includeTotal ) {
        nudgeOnce(this, 'includeTotal', '`includeTotal` runs a metered count over every key matching the query, so its cost grows with the store. Request the total once — on the first page — and avoid it in hot paths; to know whether more pages exist, check for `cursor` instead.');
    }

    const callList = utils.make_driver_method([], 'puter-kvstore', undefined, 'list', { puter: this.puter });

    if ( stream ) {
        if ( options.offset !== undefined ) {
            throw { message: '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.', code: 'invalid_request' };
        }
        const base = { ...options };
        delete base.cursor;
        delete base.includeTotal;
        if ( base.limit === undefined ) {
            base.limit = SDK_PAGE_LIMIT;
            base.fetchUntilFull = true;
        }
        const fetchPage = pageParams => callList({ ...base, ...pageParams });
        return iteratePages(fetchPage, { cursor, includeTotal });
    }

    // Any pagination option keeps the single-request behavior: one
    // `KVListPage` exactly as the backend returns it.
    if ( paginated ) {
        return callList(options);
    }

    // Unbound listing: fetch page by page under the hood so no single
    // request carries the whole result, then return the legacy array.
    const fetchPage = pageParams => {
        if ( pageParams.cursor !== null ) {
            nudgeOnce(this, 'unbound-scan', 'a full listing spanned multiple pages; unbounded scans are metered and get slower as the store grows. Prefer `stream: true`, `limit`/`cursor` pages, or a narrower `pattern`.');
        }
        return callList({
            ...options,
            limit: SDK_PAGE_LIMIT,
            fetchUntilFull: true,
            ...pageParams,
        });
    };
    return fetchAllPages(fetchPage);
}
