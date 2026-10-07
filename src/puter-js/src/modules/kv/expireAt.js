import * as utils from '../../lib/utils.js';
import { assertKeyPresent, assertKeySize } from './lib/validate.js';

/** @typedef {import('./types.js').KVOptConfig} KVOptConfig */

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
 * A missing or already-expired key becomes an empty key with the TTL, rather
 * than staying absent. A timestamp at or before now, including `0`, expires
 * the key immediately.
 *
 * @this {import('./index.js').KVModule}
 * @param {string} key
 * @param {number} timestamp
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
export async function expireAt (key, timestamp, optConfig) {
    assertKeyPresent(key);
    assertKeySize(key);
    this.guiCache.invalidate(key);
    return await utils.makeDriverMethod({ iface: 'puter-kvstore', method: 'expireAt', argNames: ['key', 'timestamp'], puter: this.puter })({ key, timestamp, optConfig });
}
