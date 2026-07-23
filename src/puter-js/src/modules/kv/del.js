import * as utils from '../../lib/utils.js';
import { isObject, parseOptConfigThenCallbacks } from './lib/args.js';
import { assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */

const delDriverCall = (puter, args) =>
    utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'del', {
        puter,
        preprocess: (driverArgs) => {
            assertKeySize(driverArgs.key);
            return driverArgs;
        },
    })(args);

/**
 * @overload
 * @param {string} key
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
/**
 * Removes a key. Resolves to `true` even when the key does not exist.
 *
 * Also accepts the object form `del({ key, optConfig })` and legacy trailing
 * success/error callbacks.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | { key: string, optConfig?: KVOptConfig }} keyOrObject
 * @param {...(KVOptConfig | Function | undefined)} rest
 * @returns {Promise<boolean>}
 */
export async function del (keyOrObject, ...rest) {
    const { puter } = this;

    if ( isObject(keyOrObject) && rest.length === 0 ) {
        return await delDriverCall(puter, keyOrObject);
    }

    const { optConfig, success, error } = parseOptConfigThenCallbacks(rest);
    return await delDriverCall(puter, { key: keyOrObject, optConfig, success, error });
}
