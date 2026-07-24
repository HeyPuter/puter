import * as utils from '../../lib/utils.js';
import { parseCallbackOptions } from './lib/args.js';

/**
 * Returns version information about the Puter deployment. Accepts an options
 * object with `success`/`error` callbacks, or trailing positional callbacks.
 *
 * @this {import('./index.js').OSModule}
 * @param {...(((value: Record<string, unknown>) => void) | { success?: Function, error?: Function })} args
 * @returns {Promise<Record<string, unknown>>}
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
