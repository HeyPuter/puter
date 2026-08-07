import * as utils from '../../lib/utils.js';

/** @typedef {Record<string, unknown>} DeveloperProfile */
/** @typedef {import('../../../types/shared').RequestCallbacks<DeveloperProfile>} ProfileCallbacks */

/**
 * @overload
 * @param {ProfileCallbacks} [options]
 * @returns {Promise<DeveloperProfile>}
 */
/**
 * @overload
 * @param {(value: DeveloperProfile) => void} success
 * @param {(reason: unknown) => void} [error]
 * @returns {Promise<DeveloperProfile>}
 */
/**
 * Fetches the caller's developer profile. Accepts either an options object
 * (`{ success, error }`) or trailing positional `success`/`error` callbacks;
 * either way the returned promise settles with the profile.
 *
 * @this {import('./index.js').AppsModule}
 * @param {...unknown} args
 * @returns {Promise<DeveloperProfile>}
 */
export function getDeveloperProfile (...args) {
    const { puter } = this;

    const options = (typeof args[0] === 'object' && args[0] !== null)
        ? args[0]
        : { success: args[0], error: args[1] };

    return new Promise((resolve, reject) => {
        const xhr = utils.initXhr('/get-dev-profile', puter.APIOrigin, puter.authToken, 'get');
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);
        xhr.send();
    });
}
