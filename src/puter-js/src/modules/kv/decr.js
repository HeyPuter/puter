import * as utils from '../../lib/utils.js';
import { parseCounterArgs } from './lib/args.js';
import { assertKeyPresent, assertKeySize } from './lib/validate.js';

/** @typedef {import('./types.js').KVIncrementPath} KVIncrementPath */
/** @typedef {import('./types.js').KVOptConfig} KVOptConfig */
/** @typedef {import('./types.js').KVValue} KVValue */

/**
 * @template [T = KVValue]
 * @overload
 * @param {string} key
 * @param {KVIncrementPath} pathAndAmount
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<T>}
 */
/**
 * @overload
 * @param {string} key
 * @param {KVOptConfig} optConfig
 * @returns {Promise<number>}
 */
/**
 * @overload
 * @param {string} key
 * @param {number} [amount]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<number>}
 */
/**
 * Decrements the value of a key, returning the new value. If the key does
 * not exist — or has expired — it is initialized to `0` first and loses any
 * TTL the old value had.
 *
 * `amount` defaults to `1`, or maps dot-separated paths within an object
 * value to the amount to decrement each by; with a path map the call returns
 * the whole stored value, not just the changed field. Rejects with
 * `value_not_a_number` when the target — the whole value, or with a path map
 * the field at that path — isn't a number, and `invalid_path` when a path
 * runs through something that isn't an object or through a missing list
 * element.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | { key: string, pathAndAmountMap?: KVIncrementPath, optConfig?: KVOptConfig }} keyOrOptions
 * @param {number | KVIncrementPath | KVOptConfig} [amountOrMap]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<unknown>}
 */
export async function decr (keyOrOptions, amountOrMap, optConfig) {
    const options = parseCounterArgs(keyOrOptions, amountOrMap, optConfig);
    assertKeyPresent(options.key);
    assertKeySize(options.key);
    this.guiCache.invalidate(options.key);
    return await utils.makeDriverMethod({ iface: 'puter-kvstore', method: 'decr', argNames: ['key'], puter: this.puter })(options);
}
