import * as utils from '../../lib/utils.js';
import { isObject, parseTrailingArgs } from './lib/args.js';
import { assertKeyPresent, assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */
/** @typedef {import('../../../types/modules/kv').KVUpdateObject} KVUpdateObject */
/** @typedef {import('../../../types/modules/kv').KVUpdatePath} KVUpdatePath */
/** @typedef {import('../../../types/modules/kv').KVValue} KVValue */

const updateDriverCall = (puter, args) =>
    utils.make_driver_method(['key', 'pathAndValueMap', 'ttl'], 'puter-kvstore', undefined, 'update', {
        puter,
        preprocess: (driverArgs) => {
            assertKeyPresent(driverArgs.key);
            assertKeySize(driverArgs.key);
            if ( driverArgs.pathAndValueMap === undefined || driverArgs.pathAndValueMap === null || Array.isArray(driverArgs.pathAndValueMap) || typeof driverArgs.pathAndValueMap !== 'object' ) {
                throw { message: 'pathAndValueMap must be an object', code: 'path_map_invalid' };
            }
            if ( Object.keys(driverArgs.pathAndValueMap).length === 0 ) {
                throw { message: 'pathAndValueMap cannot be empty', code: 'path_map_invalid' };
            }
            if ( driverArgs.ttl !== undefined && driverArgs.ttl !== null ) {
                const ttl = Number(driverArgs.ttl);
                if ( Number.isNaN(ttl) ) {
                    throw { message: 'ttl must be a number', code: 'ttl_invalid' };
                }
                driverArgs.ttl = ttl;
            }
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
 * @param {number} [ttl]
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
 * without overwriting the entire value, returning the updated value.
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
    const { puter } = this;

    if ( isObject(keyOrObject) && pathAndValueMap === undefined && rest.length === 0 ) {
        return await updateDriverCall(puter, keyOrObject);
    }

    let ttl;
    if ( typeof rest[0] === 'number' || rest[0] === null ) {
        ttl = rest.shift();
    }
    const { optConfig, success, error } = parseTrailingArgs(rest);
    return await updateDriverCall(puter, { key: keyOrObject, pathAndValueMap, ttl, optConfig, success, error });
}
