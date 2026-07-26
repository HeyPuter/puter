import * as utils from '../../lib/utils.js';
import getAbsolutePathForApp from '../FileSystem/utils/getAbsolutePathForApp.js';
import { normalizeSubdomain } from './lib/args.js';

/** @typedef {import('../../../types/modules/hosting').Subdomain} Subdomain */

/**
 * @overload
 * @param {string} subdomain
 * @param {string} dirPath
 * @returns {Promise<Subdomain>}
 */
/**
 * @overload
 * @param {{ subdomain: string, root_dir: string }} options
 * @returns {Promise<Subdomain>}
 */
/**
 * Creates a new subdomain served from the given directory. Rejects if a
 * subdomain with that name already exists or the path does not exist.
 *
 * Accepts `create(subdomain)`, `create(subdomain, dirPath)`, or the object
 * form `create({ subdomain, root_dir })`. A full host (`sub.puter.site`) is
 * accepted in place of a bare subdomain and stripped to its label.
 *
 * @this {import('./index.js').HostingModule}
 * @param {string | { subdomain: string, root_dir?: string }} subdomainOrObject
 * @param {string} [dirPath]
 * @returns {Promise<Subdomain>}
 */
export async function create (subdomainOrObject, dirPath) {
    const { puter } = this;

    let object;
    if ( typeof subdomainOrObject === 'string' ) {
        const subdomain = normalizeSubdomain(subdomainOrObject);
        object = dirPath !== undefined
            ? { subdomain, root_dir: dirPath ? getAbsolutePathForApp(dirPath) : dirPath }
            : { subdomain };
    } else {
        object = subdomainOrObject;
    }

    return await utils.makeDriverMethod({ iface: 'puter-subdomains', method: 'create', argNames: ['object'], puter })({ object });
}
