import * as utils from '../../lib/utils.js';
import { isObject, isOptConfigShorthand } from './lib/args.js';
import { assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVAddPath} KVAddPath */
/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */
/** @typedef {import('../../../types/modules/kv').KVValue} KVValue */

/**
 * @overload
 * @param {string} key
 * @param {KVOptConfig} optConfig
 * @returns {Promise<KVValue>}
 */
/**
 * @overload
 * @param {string} key
 * @param {KVValue | KVAddPath} [value]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<KVValue>}
 */
/**
 * Adds values to an existing key, returning the updated value.
 *
 * `value` defaults to `1` when omitted, or maps dot-separated paths to the
 * value (or values) to add at each path.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | { key: string, pathAndValueMap?: KVAddPath, optConfig?: KVOptConfig }} keyOrOptions
 * @param {KVValue | KVAddPath | KVOptConfig} [valueOrMap]
 * @param {KVOptConfig} [optConfig]
 * @returns {Promise<KVValue>}
 */
export async function add (keyOrOptions, valueOrMap, optConfig) {
    let options;

    if ( isObject(keyOrOptions) && valueOrMap === undefined && optConfig === undefined ) {
        options = { ...keyOrOptions };
    } else {
        if ( keyOrOptions === undefined && valueOrMap === undefined && optConfig === undefined ) {
            throw { message: 'Arguments are required', code: 'arguments_required' };
        }

        let provided = valueOrMap;
        if ( isOptConfigShorthand(provided) && optConfig === undefined ) {
            optConfig = provided;
            provided = undefined;
        }

        const isPathMap = provided && typeof provided === 'object' && !Array.isArray(provided);
        options = {
            key: keyOrOptions,
            pathAndValueMap: provided === undefined ? { '': 1 } : isPathMap ? provided : { '': provided },
            optConfig,
        };
    }

    assertKeySize(options.key);
    return await utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'add', { puter: this.puter })(options);
}
