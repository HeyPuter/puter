import * as utils from '../../lib/utils.js';
import { fetchAllPages, iteratePages } from '../../lib/pagination.js';
import { PuterJSError } from '../../lib/PuterJSError.js';

/** @typedef {import('../../../types/modules/hosting').Subdomain} Subdomain */

// Older backends include worker-backed subdomain rows in select results;
// current ones exclude them server-side. Filtering here keeps the SDK's output
// stable across both.
const withoutWorkerRows = (items) =>
    items.filter(e => !e.subdomain.startsWith('workers.puter.'));

/**
 * @overload
 * @param {import('../../../types/shared').ListStreamOptions} options
 * @returns {AsyncIterableIterator<import('../../../types/shared').ListPage<Subdomain>>}
 */
/**
 * @overload
 * @param {import('../../../types/shared').ListPaginationOptions & ({ cursor: string | null } | { includeTotal: true })} options
 * @returns {Promise<import('../../../types/shared').ListPage<Subdomain>>}
 */
/**
 * @overload
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<Subdomain[]>}
 */
/**
 * Lists the subdomains the app can access, fetching page by page under the
 * hood and resolving to a plain array. Passing any pagination param
 * (`cursor`/`offset`/`includeTotal`) switches to a single-request page
 * envelope, and `stream: true` returns an async iterator of page envelopes.
 *
 * Legacy callback forms `list(success, error)` and `list({ success, error })`
 * are still honored: the callback fires once with the full result.
 *
 * @this {import('./index.js').HostingModule}
 * @param {...unknown} args
 * @returns {Promise<Subdomain[]> | Promise<import('../../../types/shared').ListPage<Subdomain>> | AsyncIterableIterator<import('../../../types/shared').ListPage<Subdomain>>}
 */
export function list (...args) {
    const { puter } = this;
    const select = utils.makeDriverMethod({ iface: 'puter-subdomains', method: 'select', puter, readonly: true });

    const opts = (typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const { limit, offset, cursor, includeTotal, stream, success, error, ...rest } = opts;
    const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');

    const base = { ...rest };
    if ( limit !== undefined ) base.limit = limit;
    const fetchPage = pageParams => select({ ...base, ...pageParams });

    if ( stream === true ) {
        if ( offset !== undefined ) {
            throw new PuterJSError(
                '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.',
                'invalid_request',
            );
        }
        return (async function* () {
            for await ( const page of iteratePages(fetchPage, { cursor, includeTotal: includeTotal === true }) ) {
                yield { ...page, items: withoutWorkerRows(page.items ?? []) };
            }
        })();
    }

    // Any pagination param keeps the single-request behavior (envelope once
    // the request opts in via cursor/includeTotal).
    if ( limit !== undefined || offset !== undefined || hasCursor || includeTotal !== undefined ) {
        return (async () => {
            const result = await select(opts);
            if ( result && !Array.isArray(result) && Array.isArray(result.items) ) {
                return result;
            }
            return withoutWorkerRows(result);
        })();
    }

    // Unbound listing: fetch page by page under the hood so no single request
    // carries the whole result, then return the legacy array.
    const promise = fetchAllPages(fetchPage).then(items => withoutWorkerRows(items));

    // Legacy callback forms: mirror handle_resp — the callback fires once with
    // the full result and the returned promise still settles the same way.
    const successCb = typeof args[0] === 'function' ? args[0] : success;
    const errorCb = typeof args[0] === 'function' ? args[1] : error;
    if ( typeof successCb === 'function' || typeof errorCb === 'function' ) {
        promise.then(
            result => { if ( typeof successCb === 'function' ) successCb(result); },
            err => { if ( typeof errorCb === 'function' ) errorCb(err); },
        );
    }
    return promise;
}
