import * as utils from '../../lib/utils.js';

/**
 * Deletes the app with the given name. Resolves to `{ success: true, uid }`
 * with the `uid` of the deleted app.
 *
 * @this {import('./index.js').AppsModule}
 * @param {string} name
 * @returns {Promise<{ success: boolean, uid: string }>}
 */
export async function del (name) {
    const { puter } = this;

    const options = typeof name === 'string' ? { id: { name } } : {};
    return await utils.make_driver_method(['uid'], 'puter-apps', 'es:app', 'delete', { puter })(options);
}
