import { shareListQuery, sharesRequest } from './lib/shares.js';

/** @typedef {import('./types.js').KVShareListOptions} KVShareListOptions */
/** @typedef {import('./types.js').KVSharedWithMe} KVSharedWithMe */
/**
 * @template [T=unknown]
 * @typedef {import('../../lib/types.js').ListPage<T>} ListPage
 */

/**
 * @overload
 * @param {KVShareListOptions} [options]
 * @returns {Promise<ListPage<KVSharedWithMe>>}
 */
/**
 * Lists the live shares other users made with you, a page at a time. In an
 * app, only the shares of that app's data.
 *
 * @this {import('./index.js').KVModule}
 * @param {KVShareListOptions} [options]
 * @returns {Promise<ListPage<KVSharedWithMe>>}
 */
export async function listShared (options) {
    return await sharesRequest(this.puter, 'GET', '/kv/shares/with-me', {
        query: shareListQuery(options),
    });
}
