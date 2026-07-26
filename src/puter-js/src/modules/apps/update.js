import * as utils from '../../lib/utils.js';
import { addUserIteration } from './lib/appUsers.js';
import { toAppObject } from './lib/appObject.js';

/** @typedef {import('../../../types/modules/apps').App} App */
/** @typedef {import('../../../types/modules/apps').UpdateAppAttributes} UpdateAppAttributes */

/**
 * Updates attributes of the app with the given name.
 *
 * @this {import('./index.js').AppsModule}
 * @param {string} name
 * @param {UpdateAppAttributes} attributes
 * @returns {Promise<App>}
 */
export async function update (name, attributes) {
    const { puter } = this;

    let options = {};
    if ( typeof name === 'string' ) {
        options = { id: { name }, object: toAppObject(attributes ?? {}) };
    }

    const updated = await utils.makeDriverMethod({ iface: 'puter-apps', driver: 'es:app', method: 'update', argNames: ['object'], puter })(options);
    return addUserIteration(puter, updated);
}
