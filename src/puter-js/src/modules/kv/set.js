import * as utils from '../../lib/utils.js';
import { isBatchSetItem, isObject, parseTrailingArgs } from './lib/args.js';
import { assertKeyPresent, assertKeySize, assertValueSize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */
/** @typedef {import('../../../types/modules/kv').KVScalar} KVScalar */
/**
 * @template [T=KVScalar]
 * @typedef {import('../../../types/modules/kv').KVSetBatch<T>} KVSetBatch
 */
/**
 * @template [T=KVScalar]
 * @typedef {import('../../../types/modules/kv').KVSetItem<T>} KVSetItem
 */
/**
 * @template [T=KVScalar]
 * @typedef {import('../../../types/modules/kv').KVSetObject<T>} KVSetObject
 */

const setSingle = (puter, args) =>
    utils.make_driver_method(['key', 'value', 'expireAt'], 'puter-kvstore', undefined, 'set', {
        puter,
        preprocess: (driverArgs) => {
            assertKeyPresent(driverArgs.key);
            assertKeySize(driverArgs.key);
            assertValueSize(driverArgs.value);
            return driverArgs;
        },
    })(args);

const setBatch = (puter, args) =>
    utils.make_driver_method(['items'], 'puter-kvstore', undefined, 'batchPut', {
        puter,
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
 * @param {number} [expireAt]
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
    const { puter } = this;

    if ( Array.isArray(keyOrItems) ) {
        const trailing = [value, ...rest];
        const { optConfig, success, error } = parseTrailingArgs(trailing);
        return await setBatch(puter, { items: keyOrItems, optConfig, success, error });
    }

    if ( isObject(keyOrItems) && value === undefined && rest.length === 0 ) {
        if ( Array.isArray(keyOrItems.items) ) {
            return await setBatch(puter, keyOrItems);
        }
        return await setSingle(puter, keyOrItems);
    }

    let expireAt;
    if ( typeof rest[0] === 'number' || rest[0] === null ) {
        expireAt = rest.shift();
    }
    const { optConfig, success, error } = parseTrailingArgs(rest);
    return await setSingle(puter, { key: keyOrItems, value, expireAt, optConfig, success, error });
}
