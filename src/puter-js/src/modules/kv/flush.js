import * as utils from '../../lib/utils.js';
import { isObject, parseOptConfigThenCallbacks } from './lib/args.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */

const flushDriverCall = (puter, args) =>
    utils.make_driver_method([], 'puter-kvstore', undefined, 'flush', { puter })(args);

/**
 * @overload
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<boolean>}
 */
/**
 * Removes all key-value pairs from the store for the current app. Resolves
 * to `true` even when the store is already empty. Exposed as both
 * `puter.kv.flush()` and its alias `puter.kv.clear()`.
 *
 * Also accepts the object form `flush({ optConfig, success, error })` and
 * legacy positional success/error callbacks.
 *
 * @this {import('./index.js').KVModule}
 * @param {KVOptConfig | { optConfig?: KVOptConfig, success?: Function, error?: Function } | Function} [optConfigOrCallback]
 * @param {...(Function | undefined)} rest
 * @returns {Promise<boolean>}
 */
export async function flush (optConfigOrCallback, ...rest) {
    const { puter } = this;

    if ( isObject(optConfigOrCallback) && rest.length === 0 ) {
        const input = optConfigOrCallback;
        if (
            Object.prototype.hasOwnProperty.call(input, 'optConfig') ||
            Object.prototype.hasOwnProperty.call(input, 'success') ||
            Object.prototype.hasOwnProperty.call(input, 'error')
        ) {
            return await flushDriverCall(puter, input);
        }

        return await flushDriverCall(puter, { optConfig: input });
    }

    const { optConfig, success, error } = parseOptConfigThenCallbacks([optConfigOrCallback, ...rest]);
    return await flushDriverCall(puter, { optConfig, success, error });
}
