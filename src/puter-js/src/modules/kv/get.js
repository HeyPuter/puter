import * as utils from '../../lib/utils.js';
import { isObject, parseOptConfigThenCallbacks } from './lib/args.js';
import { assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */

const getDriverCall = (puter, args) =>
    utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'get', {
        puter,
        preprocess: (driverArgs) => {
            assertKeySize(driverArgs.key);
            return driverArgs;
        },
    })(args);

/**
 * @template [T = unknown]
 * @overload
 * @param {string} key
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<T | undefined>}
 */
/**
 * Returns the key's value, or `undefined` if the key does not exist.
 *
 * Also accepts the object form `get({ key, optConfig })` and legacy trailing
 * success/error callbacks.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | { key: string, optConfig?: KVOptConfig }} keyOrObject
 * @param {...(KVOptConfig | Function | undefined)} rest
 * @returns {Promise<unknown>}
 */
export async function get (keyOrObject, ...rest) {
    const { puter } = this;

    if ( isObject(keyOrObject) && rest.length === 0 ) {
        return await getDriverCall(puter, keyOrObject);
    }

    const key = keyOrObject;
    const { optConfig, success, error } = parseOptConfigThenCallbacks(rest);

    // The GUI's boot-time reads are served from one batched request.
    if ( !optConfig && this.guiCache.serves(key) ) {
        return await this.guiCache.lookup(/** @type {string} */ (key));
    }

    return await getDriverCall(puter, { key, optConfig, success, error });
}
