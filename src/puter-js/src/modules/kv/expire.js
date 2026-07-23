import * as utils from '../../lib/utils.js';
import { assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */

/**
 * @overload
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
/**
 * Sets the time-to-live for a key, in seconds; after that the key is
 * deleted. Prefer this over `expireAt` when the timestamp should be set by
 * the server, to avoid issues with clock drift.
 *
 * @this {import('./index.js').KVModule}
 * @param {string} key
 * @param {number} ttl
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
export async function expire (key, ttl, optConfig) {
    assertKeySize(key);
    return await utils.make_driver_method(['key', 'ttl'], 'puter-kvstore', undefined, 'expire', { puter: this.puter })({ key, ttl, optConfig });
}
