import * as utils from '../../lib/utils.js';
import { fetchAllPages, iteratePages } from '../../lib/pagination.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { addUserIterationToApps } from './lib/appUsers.js';

/** @typedef {import('../../../types/modules/apps').App} App */
/** @typedef {import('../../../types/modules/apps').AppListOptions} AppListOptions */

/**
 * @overload
 * @param {AppListOptions & import('../../../types/shared').ListStreamOptions} options
 * @returns {AsyncIterableIterator<import('../../../types/shared').ListPage<App>>}
 */
/**
 * @overload
 * @param {AppListOptions & import('../../../types/shared').ListPaginationOptions & ({ cursor: string | null } | { offset: number } | { includeTotal: true })} options
 * @returns {Promise<import('../../../types/shared').ListPage<App>>}
 */
/**
 * @overload
 * @param {AppListOptions & { limit?: number }} [options]
 * @returns {Promise<App[]>}
 */
/**
 * Returns the apps the caller can access, fetching page by page under the hood
 * and resolving to a plain array. Non-pagination options (`stats_period`,
 * `icon_size`) are forwarded as `params`. Any pagination param
 * (`cursor`/`offset`/`includeTotal`) switches to a single-request page
 * envelope, and `stream: true` returns an async iterator of page envelopes.
 *
 * @this {import('./index.js').AppsModule}
 * @param {AppListOptions & (import('../../../types/shared').ListPaginationOptions | import('../../../types/shared').ListStreamOptions)} [options]
 * @returns {Promise<App[]> | Promise<import('../../../types/shared').ListPage<App>> | AsyncIterableIterator<import('../../../types/shared').ListPage<App>>}
 */
export function list (options) {
    const { puter } = this;

    const isObjectForm = typeof options === 'object' && options !== null;
    const opts = isObjectForm ? options : {};
    const { limit, offset, cursor, includeTotal, stream, ...params } = opts;
    const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');

    const select = utils.makeDriverMethod({ iface: 'puter-apps', driver: 'es:app', method: 'select', argNames: ['uid'], puter, readonly: true });
    const base = { predicate: ['user-can-edit'] };
    if ( isObjectForm ) base.params = params;
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
                addUserIterationToApps(puter, page.items ?? []);
                yield page;
            }
        })();
    }

    // Any pagination param keeps the single-request behavior: a bare (possibly
    // limit-capped) array, or the page envelope once the request opts into
    // pagination via cursor/offset/includeTotal.
    if ( limit !== undefined || offset !== undefined || hasCursor || includeTotal !== undefined ) {
        return (async () => {
            const driverArgs = { ...base };
            if ( offset !== undefined ) driverArgs.offset = offset;
            if ( hasCursor ) driverArgs.cursor = cursor ?? null;
            if ( includeTotal !== undefined ) driverArgs.includeTotal = includeTotal;
            const result = await select(driverArgs);
            if ( result && !Array.isArray(result) && Array.isArray(result.items) ) {
                addUserIterationToApps(puter, result.items);
                return result;
            }
            return addUserIterationToApps(puter, result);
        })();
    }

    // Unbound listing: fetch page by page under the hood so no single request
    // carries the whole result, then return the legacy array.
    return fetchAllPages(fetchPage).then(items => addUserIterationToApps(puter, items));
}
