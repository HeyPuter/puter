import * as utils from '../../lib/utils.js';
import { normalizeSubdomain } from './lib/args.js';

/** @typedef {import('../../../types/modules/hosting').Subdomain} Subdomain */

/**
 * Retrieves a subdomain by name. Rejects if the subdomain does not exist.
 *
 * @this {import('./index.js').HostingModule}
 * @param {string} subdomain
 * @returns {Promise<Subdomain>}
 */
export async function get (subdomain) {
    const { puter } = this;

    const options = typeof subdomain === 'string'
        ? { id: { subdomain: normalizeSubdomain(subdomain) } }
        : {};

    return await utils.makeDriverMethod({ iface: 'puter-subdomains', method: 'read', argNames: ['uid'], puter, readonly: true })(options);
}
