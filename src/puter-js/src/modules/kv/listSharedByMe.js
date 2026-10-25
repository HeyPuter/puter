import { shareListQuery, sharesRequest } from './lib/shares.js';

/** @typedef {import('./types.js').KVShareListOptions} KVShareListOptions */
/** @typedef {import('./types.js').KVSharedByMe} KVSharedByMe */
/**
 * @template [T=unknown]
 * @typedef {import('../../lib/types.js').ListPage<T>} ListPage
 */

/**
 * @overload
 * @param {KVShareListOptions} [options]
 * @returns {Promise<ListPage<KVSharedByMe>>}
 */
/**
 * Lists the shares you made, a page at a time, including ones that stopped.
 * In an app, only the shares of that app's data.
 *
 * @this {import('./index.js').KVModule}
 * @param {KVShareListOptions} [options]
 * @returns {Promise<ListPage<KVSharedByMe>>}
 */
export async function listSharedByMe (options) {
    return await sharesRequest(this.puter, 'GET', '/kv/shares', {
        query: shareListQuery(options),
    });
}
