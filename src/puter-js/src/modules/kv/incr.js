import * as utils from '../../lib/utils.js';
import { parseCounterArgs } from './lib/args.js';
import { assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVIncrementPath} KVIncrementPath */
/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */

/**
 * @overload
 * @param {string} key
 * @param {KVOptConfig} optConfig
 * @returns {Promise<number>}
 */
/**
 * @overload
 * @param {string} key
 * @param {number | KVIncrementPath} [amount]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<number>}
 */
/**
 * Increments the value of a key, returning the new value. If the key does
 * not exist it is initialized to `0` first.
 *
 * `amount` defaults to `1`, or maps dot-separated paths within an object
 * value to the amount to increment each by.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | { key: string, pathAndAmountMap?: KVIncrementPath, optConfig?: KVOptConfig }} keyOrOptions
 * @param {number | KVIncrementPath | KVOptConfig} [amountOrMap]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<number>}
 */
export async function incr (keyOrOptions, amountOrMap, optConfig) {
    const options = parseCounterArgs(keyOrOptions, amountOrMap, optConfig);
    assertKeySize(options.key);
    return await utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'incr', { puter: this.puter })(options);
}
