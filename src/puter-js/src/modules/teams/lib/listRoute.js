import { fetchAllPages, iteratePages } from '../../../lib/pagination.js';
import { PuterJSError } from '../../../lib/PuterJSError.js';
import { req } from './req.js';

/**
 * The three list forms every `puter.teams` list method shares, over a `/teams`
 * route instead of a driver call: a plain array by default, the
 * `{ items, cursor? }` envelope once `cursor` or `includeTotal` is passed, and
 * an async iterator of envelopes under `stream: true`. Matches
 * `puter.apps.list()`.
 *
 * The `/teams` routes are keyset-only, so `offset` is refused rather than sent
 * and quietly ignored — a rejected call is easier to diagnose than page one
 * returned four times.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {string} route
 * @param {import('../../../lib/types.js').ListPaginationOptions | import('../../../lib/types.js').ListStreamOptions} [options]
 * @param {string} [operation]
 * @returns {Promise<unknown[]> | Promise<import('../../../lib/types.js').ListPage<unknown>> | AsyncIterableIterator<import('../../../lib/types.js').ListPage<unknown>>}
 */
export function listRoute (puter, route, options, operation) {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const { limit, offset, cursor, includeTotal, stream } = opts;
    const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');

    if ( offset !== undefined ) {
        throw new PuterJSError(
            '`offset` is not supported here; pass `cursor` to resume from a position.',
            'invalid_request',
        );
    }

    const toPage = result => (Array.isArray(result) ? { items: result } : (result ?? { items: [] }));
    const fetchPage = pageParams => req(puter, 'GET', route, {
        query: { limit, ...pageParams },
        operation,
    });

    if ( stream === true ) {
        return iteratePages(fetchPage, { cursor, includeTotal: includeTotal === true });
    }

    if ( hasCursor || includeTotal !== undefined ) {
        return (async () => toPage(await req(puter, 'GET', route, {
            query: {
                limit,
                ...(hasCursor ? { cursor } : {}),
                ...(includeTotal !== undefined ? { includeTotal } : {}),
            },
            operation,
        })))();
    }

    // `limit` alone still resolves to an array, capped at one page.
    if ( limit !== undefined ) {
        return (async () => toPage(await fetchPage({ cursor: null })).items)();
    }

    return fetchAllPages(fetchPage);
}
