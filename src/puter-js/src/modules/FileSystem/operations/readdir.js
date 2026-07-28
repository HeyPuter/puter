import { dedupe } from '../../../lib/networkUtils.js';
import { fetchAllPages, iteratePages } from '../../../lib/pagination.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import mapV2EntryToV1 from '../utils/mapV2EntryToV1.js';
import { fsRequest, parseOperationArgs } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').ReaddirOptions} ReaddirOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */
/** @typedef {import('../../../../types/shared').ListPage<FSItem>} FSItemPage */

// Listings larger than this are served but never cached.
const MAX_CACHE_SIZE = 100 * 1024 * 1024;

// Normalize each v2 entry to the v1 shape, in place, so the bare array and the
// `{items, cursor?, total?}` envelope both return the legacy shape and the
// cache is populated with it.
const normalizeEntries = (result) => {
    if ( Array.isArray(result) ) {
        return result.map(mapV2EntryToV1);
    }
    if ( result && Array.isArray(result.items) ) {
        return { ...result, items: result.items.map(mapV2EntryToV1) };
    }
    return result;
};

// One HTTP /readdir request. `pageParams` holds the pagination params for
// this page (cursor/includeTotal), if any. Resolves with the raw response:
// a bare array (legacy) or an `{items, cursor?, total?}` envelope.
const requestOnce = function (options, pageParams) {
    // Build request payload - support both path and uid parameters
    const body = {
        no_thumbs: options.no_thumbs,
        no_assocs: options.no_assocs,
        no_subdomains: options.no_subdomains,
        auth_token: this.authToken,
    };
    if ( options.limit !== undefined ) body.limit = options.limit;
    if ( options.offset !== undefined ) body.offset = options.offset;
    if ( options.sortBy !== undefined ) body.sortBy = options.sortBy;
    if ( options.sortOrder !== undefined ) body.sortOrder = options.sortOrder;
    if ( options.recursive !== undefined ) body.recursive = options.recursive;
    if ( options.depth !== undefined ) body.depth = options.depth;
    if ( pageParams ) {
        body.cursor = pageParams.cursor ?? null;
        if ( pageParams.includeTotal !== undefined ) {
            body.includeTotal = pageParams.includeTotal;
        }
    }

    if ( options.uid ) {
        body.uid = options.uid;
    } else if ( options.path ) {
        body.path = getAbsolutePathForApp(options.path);
    }

    return fsRequest.call(this, {
        // Backend serves readdir on the v2 `/fs/readdir` route, which returns
        // camelCase entries; we normalize them to the v1 shape so existing
        // callers see an unchanged response.
        endpoint: '/fs/readdir',
        // The token travels in the payload rather than the auth header.
        authHeader: false,
        body,
        transform: (result) => {
            const normalized = normalizeEntries(result);
            // set each individual item's cache
            const entries = Array.isArray(normalized) ? normalized : (normalized?.items ?? []);
            for ( const item of entries ) {
                puter._cache.set(`item:${ item.path}`, item);
            }
            return normalized;
        },
    });
};

// The promise-returning forms of readdir: the legacy full array, a single
// limit/offset slice, or one page of the `{items, cursor?, total?}` envelope.
const readdirPaged = async function (options) {
    // consistency levels
    if ( ! options.consistency ) {
        options.consistency = 'strong';
    }

    // Either path or uid is required
    if ( !options.path && !options.uid ) {
        throw { message: 'Either path or uid must be provided.', code: 'NO_PATH_OR_UID' };
    }

    // Presence of `cursor` (null = first page) or `includeTotal` opts
    // into the paginated `{items, cursor?, total?}` envelope.
    const paginated =
        Object.prototype.hasOwnProperty.call(options, 'cursor') ||
        options.includeTotal === true;

    // Unbound listings (no pagination params at all) are fetched page by
    // page under the hood and returned as the legacy full array.
    const unbound = ! paginated &&
        options.limit === undefined &&
        options.offset === undefined;

    // Generate cache key based on path. Only full listings are cached —
    // pages and limit/offset-truncated results never are. Recursive
    // listings are never cached (they'd collide with the direct listing).
    let cacheKey;
    if ( options.path && unbound && ! options.recursive ) {
        cacheKey = `readdir:${ options.path}`;
    }

    if ( options.consistency === 'eventual' && cacheKey ) {
        const cachedResult = await puter._cache.get(cacheKey);
        if ( cachedResult ) {
            return cachedResult;
        }
    }

    // Requests made with the same parameters share one backend call.
    const deduplicationKey = 'fs:readdir:' + JSON.stringify({
        path: options.path,
        uid: options.uid,
        no_thumbs: options.no_thumbs,
        no_assocs: options.no_assocs,
        no_subdomains: options.no_subdomains,
        consistency: options.consistency,
        limit: options.limit,
        offset: options.offset,
        cursor: paginated ? (options.cursor ?? null) : undefined,
        includeTotal: options.includeTotal,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        recursive: options.recursive,
        depth: options.depth,
    });

    const requestPromise = dedupe(deduplicationKey, async () => {
        if ( ! unbound ) {
            // Single request: legacy limit/offset form, or one page of the
            // envelope when the caller passed cursor/includeTotal.
            const pageParams = paginated
                ? { cursor: options.cursor, includeTotal: options.includeTotal }
                : undefined;
            return await requestOnce.call(this, options, pageParams);
        }

        const fetchPage = pageParams => requestOnce.call(this, options, pageParams);
        const result = await fetchAllPages(fetchPage);

        if ( cacheKey && JSON.stringify(result).length <= MAX_CACHE_SIZE ) {
            puter._cache.set(cacheKey, result);
        }

        return result;
    });

    // Legacy callbacks fire once, for the caller that initiated the
    // request (dedup-reused and cache-served calls never fired them).
    requestPromise.then(
        result => { if ( typeof options.success === 'function' ) options.success(result); },
        err => { if ( typeof options.error === 'function' ) options.error(err); },
    );

    return await requestPromise;
};

/**
 * @typedef {{
 *   (options: ReaddirOptions & { stream: true }): AsyncIterableIterator<FSItemPage>,
 *   (options: ReaddirOptions & ({ cursor: string | null } | { includeTotal: true })): Promise<FSItemPage>,
 *   (options: ReaddirOptions): Promise<FSItem[]>,
 *   (
 *     path: string,
 *     options?: ReaddirOptions,
 *     success?: (value: FSItem[]) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem[]>,
 *   (
 *     path: string,
 *     success?: (value: FSItem[]) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem[]>,
 * }} ReaddirOperation
 */

/**
 * Lists the contents of a directory, addressed by `path` (relative paths
 * resolve against the app's root directory) or by `uid`.
 *
 * By default the whole listing is returned as an array. Passing `cursor` or
 * `includeTotal` returns one `{items, cursor?, total?}` page instead, and
 * `stream: true` returns an async iterator over those pages.
 *
 * @type {ReaddirOperation}
 */
const readdir = /** @type {ReaddirOperation} */ (function (...args) {
    const options = parseOperationArgs(args, ['path']);

    // Streaming form: an async iterator of `{items, cursor?, total?}` pages.
    // No listing cache and no dedup — a generator can't be shared between
    // consumers — and no legacy callbacks.
    if ( options.stream === true ) {
        if ( options.offset !== undefined ) {
            throw { message: '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.', code: 'invalid_request' };
        }
        if ( !options.path && !options.uid ) {
            throw { message: 'Either path or uid must be provided.', code: 'NO_PATH_OR_UID' };
        }
        const fetchPage = pageParams => requestOnce.call(this, options, pageParams);
        return iteratePages(fetchPage, {
            cursor: /** @type {string | null | undefined} */ (options.cursor),
            includeTotal: options.includeTotal === true,
        });
    }

    return readdirPaged.call(this, options);
});

export default readdir;
