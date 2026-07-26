import * as utils from '../../lib/utils.js';
import getAbsolutePathForApp from '../FileSystem/utils/getAbsolutePathForApp.js';
import { normalizeSubdomain } from './lib/args.js';

/** @typedef {import('../../../types/modules/hosting').Subdomain} Subdomain */

/**
 * Updates a subdomain to point at a new directory. Rejects if the subdomain
 * or the path does not exist. Passing no `dirPath` disconnects the directory.
 *
 * @this {import('./index.js').HostingModule}
 * @param {string} subdomain
 * @param {string} [dirPath]
 * @returns {Promise<Subdomain>}
 */
export async function update (subdomain, dirPath) {
    const { puter } = this;

    let options = {};
    if ( typeof subdomain === 'string' ) {
        const rootDir = dirPath ? getAbsolutePathForApp(dirPath) : (dirPath ?? null);
        options = { id: { subdomain: normalizeSubdomain(subdomain) }, object: { root_dir: rootDir } };
    }

    return await utils.makeDriverMethod({ iface: 'puter-subdomains', method: 'update', argNames: ['object'], puter })(options);
}
