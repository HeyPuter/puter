import { fetchAllPages, iteratePages } from '../../lib/pagination.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';

/** @typedef {import('./types.js').PersistentSubscription} PersistentSubscription */
/** @typedef {import('../../lib/types.js').ListPage<PersistentSubscription>} SubscriptionPage */

/**
 * @overload
 * @param {import('../../lib/types.js').ListStreamOptions} options
 * @returns {AsyncIterableIterator<SubscriptionPage>}
 */
/**
 * @overload
 * @param {import('../../lib/types.js').ListPaginationOptions & ({ cursor: string | null } | { includeTotal: true })} options
 * @returns {Promise<SubscriptionPage>}
 */
/**
 * @overload
 * @param {{ limit?: number }} [options]
 * @returns {Promise<PersistentSubscription[]>}
 */
/**
 * Lists the persistent subscriptions this caller holds, page by page under the
 * hood, resolving to a plain array. Passing any pagination param
 * (`cursor`/`includeTotal`) switches to a single-request page envelope, and
 * `stream: true` returns an async iterator of page envelopes.
 *
 * An app sees only the subscriptions it created. A session acting for the
 * account sees them all, including ones left behind by an app that is gone —
 * which is what makes the account the place a stray subscription is revoked
 * from. `context` values are never returned; a row reports its key names and a
 * hash instead.
 *
 * @this {import('./index.js').EventsModule}
 * @param {...unknown} args
 * @returns {Promise<PersistentSubscription[]> | Promise<SubscriptionPage> | AsyncIterableIterator<SubscriptionPage>}
 */
export function list (...args) {
    const { puter } = this;
    const opts = /** @type {Record<string, unknown>} */ (
        typeof args[0] === 'object' && args[0] !== null ? args[0] : {}
    );
    const { limit, cursor, includeTotal, stream } = opts;
    const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');

    const fetchPage = pageParams =>
        request(puter, '/events/subscriptions', undefined, {
            ...(limit !== undefined ? { limit } : {}),
            ...(pageParams.cursor ? { cursor: pageParams.cursor } : {}),
            ...(pageParams.includeTotal ? { includeTotal: true } : {}),
        });

    if ( stream === true ) {
        return iteratePages(fetchPage, {
            cursor: /** @type {string | null | undefined} */ (cursor),
            includeTotal: includeTotal === true,
        });
    }

    if ( hasCursor || includeTotal !== undefined ) {
        if ( includeTotal !== undefined && typeof includeTotal !== 'boolean' ) {
            throw new PuterJSError(
                '`includeTotal` must be a boolean',
                'invalid_request',
            );
        }
        return fetchPage({
            cursor: /** @type {string | null} */ (cursor ?? null),
            includeTotal: includeTotal === true,
        });
    }

    return fetchAllPages(fetchPage);
}
