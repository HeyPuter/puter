import * as utils from '../../lib/utils.js';
import { normalizeSubdomain } from './lib/args.js';

/**
 * Deletes a subdomain from the account; it is no longer served. The associated
 * directory is disconnected but not deleted. Rejects if the subdomain does not
 * exist.
 *
 * @this {import('./index.js').HostingModule}
 * @param {string} subdomain
 * @returns {Promise<{ success: boolean, uid: string }>}
 */
export async function del (subdomain) {
    const { puter } = this;

    const options = typeof subdomain === 'string'
        ? { id: { subdomain: normalizeSubdomain(subdomain) } }
        : {};

    return await utils.make_driver_method(['uid'], 'puter-subdomains', undefined, 'delete', { puter })(options);
}
