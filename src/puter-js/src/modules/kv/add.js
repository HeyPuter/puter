import * as utils from '../../lib/utils.js';
import { isObject, isOptConfigShorthand } from './lib/args.js';
import { assertKeyPresent, assertKeySize } from './lib/validate.js';

/** @typedef {import('./types.js').KVAddPath} KVAddPath */
/** @typedef {import('./types.js').KVOptConfig} KVOptConfig */
/** @typedef {import('./types.js').KVValue} KVValue */

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
 * value (or values) to add at each path. A plain object is always a path map,
 * so wrap an object in an array to append it. Rejects with `value_not_a_list`
 * when the target isn't a list, and `invalid_path` when a path runs through
 * something that isn't an object or through a missing list element.
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

    assertKeyPresent(options.key);
    assertKeySize(options.key);
    this.guiCache.invalidate(options.key);
    return await utils.makeDriverMethod({ iface: 'puter-kvstore', method: 'add', argNames: ['key'], puter: this.puter })(options);
}
