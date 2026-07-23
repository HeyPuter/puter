import * as utils from '../../lib/utils.js';
import { isObject } from './lib/args.js';
import { assertKeyPresent, assertKeySize } from './lib/validate.js';

/** @typedef {import('../../../types/modules/kv').KVOptConfig} KVOptConfig */
/** @typedef {import('../../../types/modules/kv').KVValue} KVValue */

/**
 * Removes values from a key by one or more dot-separated paths (e.g.
 * `"profile.bio"`), returning the updated value. An `optConfig` object may
 * trail the paths.
 *
 * @this {import('./index.js').KVModule}
 * @param {string} key
 * @param {...(string | KVOptConfig)} pathsAndOptConfig
 * @returns {Promise<KVValue>}
 */
export async function remove (key, ...pathsAndOptConfig) {
    if ( pathsAndOptConfig.length === 0 ) {
        throw { message: 'At least one path is required', code: 'arguments_required' };
    }

    const paths = [...pathsAndOptConfig];
    let optConfig;

    if ( isObject(paths[paths.length - 1]) ) {
        optConfig = paths.pop();
    }

    if ( Array.isArray(paths[0]) && paths.length === 1 ) {
        throw { message: 'Paths must be provided as separate arguments', code: 'paths_invalid' };
    }

    assertKeyPresent(key);
    assertKeySize(key);

    if ( paths.length === 0 ) {
        throw { message: 'At least one path is required', code: 'arguments_required' };
    }

    if ( paths.some((path) => typeof path !== 'string') ) {
        throw { message: 'All paths must be strings', code: 'paths_invalid' };
    }

    return await utils.make_driver_method(['key', 'paths'], 'puter-kvstore', undefined, 'remove', { puter: this.puter })({ key, paths, optConfig });
}
