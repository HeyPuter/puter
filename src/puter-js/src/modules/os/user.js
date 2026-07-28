import * as utils from '../../lib/utils.js';
import { parseCallbackOptions } from './lib/args.js';

/** @typedef {import('../../../types/modules/auth').User} User */

/** @typedef {import('../../../types/shared').RequestCallbacks<User>} UserCallbacks */

/**
 * @overload
 * @param {UserCallbacks & { query?: Record<string, string> }} [options]
 * @returns {Promise<User>}
 */
/**
 * @overload
 * @param {(value: User) => void} success
 * @param {(reason: unknown) => void} [error]
 * @returns {Promise<User>}
 */
/**
 * Returns the currently authenticated user. Accepts an options object with an
 * optional `query` (forwarded as query-string params to `/whoami`) and
 * `success`/`error` callbacks, or trailing positional callbacks.
 *
 * @this {import('./index.js').OSModule}
 * @param {...unknown} args
 * @returns {Promise<User>}
 */
export function user (...args) {
    const { puter } = this;
    const options = parseCallbackOptions(args);

    let query = '';
    if ( options?.query ) {
        query = `?${new URLSearchParams(options.query).toString()}`;
    }

    return new Promise((resolve, reject) => {
        const xhr = utils.initXhr(`/whoami${query}`, puter.APIOrigin, puter.authToken, 'get');
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);
        xhr.send();
    });
}
