import * as utils from '../../lib/utils.js';
import { addUserIteration } from './lib/appUsers.js';
import { toAppObject } from './lib/appObject.js';
import { invalidRequest } from './lib/validate.js';

/** @typedef {import('../../../types/modules/apps').CreateAppOptions} CreateAppOptions */
/** @typedef {import('../../../types/modules/apps').CreateAppResult} CreateAppResult */

/**
 * @overload
 * @param {string} name
 * @param {string} indexURL
 * @param {string} [title]
 * @returns {Promise<CreateAppResult>}
 */
/**
 * @overload
 * @param {CreateAppOptions} options
 * @returns {Promise<CreateAppResult>}
 */
/**
 * Creates a Puter app. The name must be unique to the user's apps (rejects
 * otherwise) and `indexURL` must start with `http://` or `https://`. Accepts
 * either positional `create(name, indexURL, title?)` or an options object.
 *
 * @this {import('./index.js').AppsModule}
 * @param {string | CreateAppOptions} nameOrOptions
 * @param {string} [indexURL]
 * @param {string} [title]
 * @returns {Promise<CreateAppResult>}
 */
export async function create (nameOrOptions, indexURL, title) {
    const { puter } = this;

    let options;
    if ( typeof nameOrOptions === 'string' ) {
        options = {
            object: {
                name: nameOrOptions,
                index_url: indexURL,
                // title is optional; fall back to the name when omitted.
                title: title ?? nameOrOptions,
            },
        };
    } else if ( typeof nameOrOptions === 'object' && nameOrOptions !== null ) {
        options = {
            object: { ...toAppObject(nameOrOptions), title: nameOrOptions.title ?? nameOrOptions.name },
            options: { dedupe_name: nameOrOptions.dedupeName ?? false },
        };
    } else {
        options = { object: {} };
    }

    // name and indexURL are required
    if ( ! options.object.name ) throw invalidRequest('Name is required');
    if ( ! options.object.index_url ) throw invalidRequest('Index URL is required');

    const created = await utils.makeDriverMethod({ iface: 'puter-apps', driver: 'es:app', method: 'create', argNames: ['object'], puter })(options);
    return addUserIteration(puter, created);
}
