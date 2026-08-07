import { fetchUrl } from '../../lib/networkUtils.js';
import { invalidRequest } from './lib/validate.js';

/** @typedef {import('../../../types/modules/apps').CheckAppNameResult} CheckAppNameResult */

/**
 * Checks whether an app name is available to the user.
 *
 * @this {import('./index.js').AppsModule}
 * @param {string} name
 * @returns {Promise<CheckAppNameResult>}
 */
export async function checkName (name) {
    const { puter } = this;

    if ( typeof name !== 'string' || name.length === 0 ) {
        throw invalidRequest('Name is required');
    }

    const resp = await fetchUrl(
        `${puter.APIOrigin}/apps/nameAvailable?name=${encodeURIComponent(name)}`,
        { includePuterAuth: true },
    );
    const result = await resp.json();
    if ( ! resp.ok ) throw result;
    return result;
}
