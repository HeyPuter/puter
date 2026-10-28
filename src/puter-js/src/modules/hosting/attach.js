import { PuterJSError } from '../../lib/PuterJSError.js';
import { normalizeSubdomain } from './lib/args.js';

/** @typedef {import('./types.js').CustomDomain} CustomDomain */

/**
 * @overload
 * @param {string} subdomain The site to attach a domain to, e.g. `example` for
 * `example.puter.site`.
 * @returns {Promise<CustomDomain | null>}
 */
/**
 * Opens a Puter dialog in which the user picks one of their custom domains, or
 * adds a new one, to serve `subdomain`. Needs no permission: the user decides
 * in the dialog, and only the domain they chose is returned.
 *
 * Resolves `null` when the user closes the dialog without choosing. Rejects
 * with `invalid_argument` for a missing subdomain, `not_available` where no
 * dialog can be shown (node, workers, the Puter desktop itself), and
 * `not_supported` inside an older Puter desktop that has no such dialog.
 *
 * @this {import('./index.js').HostingModule}
 * @param {string} subdomain
 * @returns {Promise<CustomDomain | null>}
 */
export async function attach (subdomain) {
    if ( typeof subdomain !== 'string' || subdomain.trim() === '' ) {
        throw new PuterJSError('A subdomain is required', 'invalid_argument');
    }
    const name = /** @type {string} */ (normalizeSubdomain(subdomain.trim()));
    return await this.puter.ui.attachCustomDomain_(name);
}
