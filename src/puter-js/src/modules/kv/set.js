import * as utils from '../../lib/utils.js';
import { isBatchSetItem, isObject, parseTrailingArgs } from './lib/args.js';
import { assertKeyPresent, assertKeySize, assertValueSize } from './lib/validate.js';

/** @typedef {import('./types.js').KVOptConfig} KVOptConfig */
/** @typedef {import('./types.js').KVScalar} KVScalar */
/**
 * @template [T=KVScalar]
 * @typedef {import('./types.js').KVSetBatch<T>} KVSetBatch
 */
/**
 * @template [T=KVScalar]
 * @typedef {import('./types.js').KVSetItem<T>} KVSetItem
 */
/**
 * @template [T=KVScalar]
 * @typedef {import('./types.js').KVSetObject<T>} KVSetObject
 */

/** @typedef {import('./index.js').KVModule} KVModule */

const setSingle = (/** @type {KVModule} */ kv, args) =>
    utils.makeDriverMethod({
        iface: 'puter-kvstore',
        method: 'set',
        argNames: ['key', 'value', 'expireAt'],
        puter: kv.puter,
        preprocess: (driverArgs) => {
            assertKeyPresent(driverArgs.key);
            assertKeySize(driverArgs.key);
            assertValueSize(driverArgs.value);
            kv.guiCache.invalidate(driverArgs.key);
            return driverArgs;
        },
    })(args);

const setBatch = (/** @type {KVModule} */ kv, args) =>
    utils.makeDriverMethod({
        iface: 'puter-kvstore',
        method: 'batchPut',
        argNames: ['items'],
        puter: kv.puter,
        preprocess: (driverArgs) => {
            if ( !Array.isArray(driverArgs.items) || driverArgs.items.length === 0 ) {
                throw { message: 'Items are required', code: 'items_required' };
            }

            const items = driverArgs.items.map((item) => {
                if ( ! isBatchSetItem(item) ) {
                    throw { message: 'Each item must include a key', code: 'invalid_item' };
                }

                const key = String(item.key);
                if ( key.length === 0 ) {
                    throw { message: 'Key cannot be undefined', code: 'key_undefined' };
                }
                assertKeySize(key);
                assertValueSize(item.value);

                return {
                    key,
                    value: item.value,
                    ...(item.expireAt !== undefined ? { expireAt: item.expireAt } : {}),
                };
            });
            kv.guiCache.invalidate(...items.map((item) => item.key));

            return {
                ...driverArgs,
                items,
            };
        },
    })(args);

/**
 * @template [T = KVScalar]
 * @overload
 * @param {string} key
 * @param {T} value
 * @param {KVOptConfig} optConfig
 * @returns {Promise<boolean>}
 */
/**
 * @template [T = KVScalar]
 * @overload
 * @param {string} key
 * @param {T} value
 * @param {number | null} [expireAt]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
/**
 * @template [T = KVScalar]
 * @overload
 * @param {KVSetObject<T>} item
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {KVSetItem[]} items
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {KVSetBatch} batch
 * @returns {Promise<boolean>}
 */
/**
 * Documented forms:
 *   set(key, value)
 *   set(key, value, expireAt)
 *   set(key, value, [expireAt], [optConfig])
 *   set({ key, value, expireAt })
 *   set([ { key, value, expireAt }, ... ], [optConfig])
 *   set({ items: [ ... ], optConfig })
 *
 * Legacy positional success/error callbacks may trail any positional form.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | KVSetObject | KVSetBatch | KVSetItem[]} keyOrItems
 * @param {unknown} [value]
 * @param {...(number | KVOptConfig | Function | null | undefined)} rest
 * @returns {Promise<boolean>}
 */
export async function set (keyOrItems, value, ...rest) {
    if ( Array.isArray(keyOrItems) ) {
        const trailing = [value, ...rest];
        const { optConfig, success, error } = parseTrailingArgs(trailing);
        return await setBatch(this, { items: keyOrItems, optConfig, success, error });
    }

    if ( isObject(keyOrItems) && value === undefined && rest.length === 0 ) {
        if ( Array.isArray(keyOrItems.items) ) {
            return await setBatch(this, keyOrItems);
        }
        return await setSingle(this, keyOrItems);
    }

    let expireAt;
    // Whatever sits in the expiry slot is sent as the expiry, as the object
    // form does, so the store is the one place that validates it.
    if ( rest[0] !== undefined && !isObject(rest[0]) && typeof rest[0] !== 'function' ) {
        expireAt = rest.shift();
    }
    const { optConfig, success, error } = parseTrailingArgs(rest);
    return await setSingle(this, { key: keyOrItems, value, expireAt, optConfig, success, error });
}
