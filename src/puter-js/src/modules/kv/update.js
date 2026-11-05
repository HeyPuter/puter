import * as utils from '../../lib/utils.js';
import { isObject, parseTrailingArgs } from './lib/args.js';
import { assertKeyPresent, assertKeySize } from './lib/validate.js';

/** @typedef {import('./types.js').KVOptConfig} KVOptConfig */
/** @typedef {import('./types.js').KVUpdateObject} KVUpdateObject */
/** @typedef {import('./types.js').KVUpdatePath} KVUpdatePath */
/** @typedef {import('./types.js').KVValue} KVValue */

const updateDriverCall = (/** @type {import('./index.js').KVModule} */ kv, args) =>
    utils.makeDriverMethod({
        iface: 'puter-kvstore',
        method: 'update',
        argNames: ['key', 'pathAndValueMap', 'ttl'],
        puter: kv.puter,
        preprocess: (driverArgs) => {
            assertKeyPresent(driverArgs.key);
            assertKeySize(driverArgs.key);
            if ( driverArgs.pathAndValueMap === undefined || driverArgs.pathAndValueMap === null || Array.isArray(driverArgs.pathAndValueMap) || typeof driverArgs.pathAndValueMap !== 'object' ) {
                throw { message: 'pathAndValueMap must be an object', code: 'path_map_invalid' };
            }
            if ( Object.keys(driverArgs.pathAndValueMap).length === 0 ) {
                throw { message: 'pathAndValueMap cannot be empty', code: 'path_map_invalid' };
            }
            // Same rules as the store: '' and false keep the TTL, null clears it, anything else must be a finite number of seconds.
            if ( driverArgs.ttl === '' || driverArgs.ttl === false ) {
                delete driverArgs.ttl;
            } else if ( driverArgs.ttl !== undefined && driverArgs.ttl !== null ) {
                const ttl = typeof driverArgs.ttl === 'number' || (typeof driverArgs.ttl === 'string' && driverArgs.ttl.trim() !== '') ? Number(driverArgs.ttl) : NaN;
                if ( ! Number.isFinite(ttl) ) {
                    throw { message: 'ttl must be a number', code: 'ttl_invalid' };
                }
                driverArgs.ttl = ttl;
            }
            kv.guiCache.invalidate(driverArgs.key);
            return driverArgs;
        },
    })(args);

/**
 * @overload
 * @param {string} key
 * @param {KVUpdatePath} pathAndValueMap
 * @param {KVOptConfig} optConfig
 * @returns {Promise<KVValue>}
 */
/**
 * @overload
 * @param {string} key
 * @param {KVUpdatePath} pathAndValueMap
 * @param {number | null} [ttl] `ttl` may be a number or numeric string of seconds; `''` or `false` keeps the stored TTL, and anything else rejects with `ttl_invalid`.
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<KVValue>}
 */
/**
 * @overload
 * @param {KVUpdateObject} item
 * @returns {Promise<KVValue>}
 */
/**
 * Updates one or more dot-separated paths within the value stored at a key
 * without overwriting the entire value, returning the updated value. Rejects
 * with `invalid_path` when a path runs through something that isn't an
 * object or through a missing list element.
 *
 * Legacy positional success/error callbacks may trail the positional form.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | KVUpdateObject} keyOrObject
 * @param {KVUpdatePath} [pathAndValueMap]
 * @param {...(number | KVOptConfig | Function | null | undefined)} rest
 * @returns {Promise<KVValue>}
 */
export async function update (keyOrObject, pathAndValueMap, ...rest) {
    if ( isObject(keyOrObject) && pathAndValueMap === undefined && rest.length === 0 ) {
        return await updateDriverCall(this, keyOrObject);
    }

    let ttl;
    // Same shift rule as set()'s expireAt slot: anything but an object or a
    // callback here is the ttl; it's checked below and again by the store.
    if ( rest[0] !== undefined && !isObject(rest[0]) && typeof rest[0] !== 'function' ) {
        ttl = rest.shift();
    }
    const { optConfig, success, error } = parseTrailingArgs(rest);
    return await updateDriverCall(this, { key: keyOrObject, pathAndValueMap, ttl, optConfig, success, error });
}
