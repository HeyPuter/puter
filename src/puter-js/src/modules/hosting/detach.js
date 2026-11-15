import { PuterJSError } from '../../lib/PuterJSError.js';
import { normalizeSubdomain } from './lib/args.js';

/** @typedef {import('./types.js').CustomDomain} CustomDomain */

/**
 * @overload
 * @param {string} subdomain The site to remove domains from, e.g. `example` for
 * `example.puter.site`.
 * @returns {Promise<CustomDomain[]>}
 */
/**
 * Opens a Puter dialog that lists the custom domains of `subdomain`, in which
 * the user can remove them from their account. Needs no permission: the user
 * decides in the dialog, and only the domains they removed are returned.
 *
 * Resolves an empty array when the user closes the dialog without removing
 * any. Rejects with `invalid_argument` for a missing subdomain,
 * `not_available` where no dialog can be shown (node, workers, the Puter
 * desktop itself), and `not_supported` inside an older Puter desktop that has
 * no such dialog.
 *
 * @this {import('./index.js').HostingModule}
 * @param {string} subdomain
 * @returns {Promise<CustomDomain[]>}
 */
export async function detach (subdomain) {
    if ( typeof subdomain !== 'string' || subdomain.trim() === '' ) {
        throw new PuterJSError('A subdomain is required', 'invalid_argument');
    }
    const name = /** @type {string} */ (normalizeSubdomain(subdomain.trim()));
    return await this.puter.ui.detachCustomDomain_(name);
}
