import { shareListQuery, sharesRequest } from './lib/shares.js';

/** @typedef {import('./types.js').KVSharedByMeListOptions} KVSharedByMeListOptions */
/** @typedef {import('./types.js').KVSharedByMe} KVSharedByMe */
/**
 * @template [T=unknown]
 * @typedef {import('../../lib/types.js').ListPage<T>} ListPage
 */

/**
 * @overload
 * @param {KVSharedByMeListOptions} [options]
 * @returns {Promise<ListPage<KVSharedByMe>>}
 */
/**
 * Lists the shares you made, a page at a time, including ones that stopped
 * unless `state` narrows it. In an app, only the shares of that app's data.
 *
 * @this {import('./index.js').KVModule}
 * @param {KVSharedByMeListOptions} [options]
 * @returns {Promise<ListPage<KVSharedByMe>>}
 */
export async function listSharedByMe (options) {
    return await sharesRequest(this.puter, 'GET', '/kv/shares', {
        query: shareListQuery(options),
    });
}
