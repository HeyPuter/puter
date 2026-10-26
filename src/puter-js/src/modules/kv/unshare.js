import { PuterJSError } from '../../lib/PuterJSError.js';
import { sharesRequest } from './lib/shares.js';

/** @typedef {import('./types.js').KVUnshareResult} KVUnshareResult */

/**
 * @overload
 * @param {string} handle
 * @returns {Promise<KVUnshareResult>}
 */
/**
 * Stops a share. The owner revokes it for the holder; the holder removes
 * their own access. Stopping a share that already stopped resolves the same
 * way again.
 *
 * @this {import('./index.js').KVModule}
 * @param {string} handle
 * @returns {Promise<KVUnshareResult>}
 */
export async function unshare (handle) {
    if ( typeof handle !== 'string' || handle.trim() === '' ) {
        throw new PuterJSError('`handle` is required', 'invalid_request');
    }
    return await sharesRequest(this.puter, 'DELETE', `/kv/shares/${encodeURIComponent(handle)}`);
}
