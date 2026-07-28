import * as utils from '../../lib/utils.js';
import { parseCallbackOptions } from './lib/args.js';

/** @typedef {Record<string, unknown>} VersionInfo */
/** @typedef {import('../../../types/shared').RequestCallbacks<VersionInfo>} VersionCallbacks */

/**
 * @overload
 * @param {VersionCallbacks} [options]
 * @returns {Promise<VersionInfo>}
 */
/**
 * @overload
 * @param {(value: VersionInfo) => void} success
 * @param {(reason: unknown) => void} [error]
 * @returns {Promise<VersionInfo>}
 */
/**
 * Returns version information about the Puter deployment. Accepts an options
 * object with `success`/`error` callbacks, or trailing positional callbacks.
 *
 * @this {import('./index.js').OSModule}
 * @param {...unknown} args
 * @returns {Promise<VersionInfo>}
 */
export function version (...args) {
    const { puter } = this;
    const options = parseCallbackOptions(args);

    return new Promise((resolve, reject) => {
        const xhr = utils.initXhr('/version', puter.APIOrigin, puter.authToken, 'get');
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);
        xhr.send();
    });
}
