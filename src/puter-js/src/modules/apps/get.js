import * as utils from '../../lib/utils.js';
import { addUserIteration } from './lib/appUsers.js';

/** @typedef {import('../../../types/modules/apps').App} App */
/** @typedef {import('../../../types/modules/apps').AppListOptions} AppListOptions */

/**
 * Returns the app with the given name. Rejects if the app does not exist.
 * The options object (`stats_period`, `icon_size`) may be passed as the second
 * argument, or as the sole argument.
 *
 * @this {import('./index.js').AppsModule}
 * @param {string | AppListOptions} nameOrOptions
 * @param {AppListOptions} [options]
 * @returns {Promise<App>}
 */
export async function get (nameOrOptions, options) {
    const { puter } = this;

    const driverArgs = {};
    if ( typeof nameOrOptions === 'string' ) {
        if ( typeof options === 'object' && options !== null ) driverArgs.params = options;
        driverArgs.id = { name: nameOrOptions };
    }
    if ( typeof nameOrOptions === 'object' && nameOrOptions !== null ) {
        driverArgs.params = nameOrOptions;
    }

    const app = await utils.makeDriverMethod({ iface: 'puter-apps', driver: 'es:app', method: 'read', argNames: ['uid'], puter, readonly: true })(driverArgs);
    return addUserIteration(puter, app);
}
