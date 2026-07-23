import * as utils from '../../lib/utils.js';
import { assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */

/**
 * @overload
 * @param {string} key
 * @param {number} timestampSeconds
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
/**
 * Sets the expiration for a key as a UNIX timestamp in seconds; after that
 * time the key is deleted. Clients whose clock is out of sync with the
 * server may see keys expire early or late — prefer `expire` for a
 * server-relative TTL.
 *
 * @this {import('./index.js').KVModule}
 * @param {string} key
 * @param {number} timestamp
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
export async function expireAt (key, timestamp, optConfig) {
    assertKeySize(key);
    return await utils.make_driver_method(['key', 'timestamp'], 'puter-kvstore', undefined, 'expireAt', { puter: this.puter })({ key, timestamp, optConfig });
}
