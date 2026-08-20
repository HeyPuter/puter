import { PuterJSError } from '../../../lib/PuterJSError.js';
import { req } from './req.js';

/**
 * Whether the caller holds every one of these permissions, without prompting.
 * All-or-nothing: a partly-granted set still needs its prompt.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {string[]} permissions
 * @returns {Promise<boolean>}
 */
export async function holdsPermissions (puter, permissions) {
    if ( permissions.length === 0 ) return false;

    const result = await req(puter, '/auth/check-permissions', { permissions });
    // Surfaced, not folded into `false`: "denied" and "never ran" differ.
    if ( result.error ) {
        throw new PuterJSError(
            /** @type {string} */ (result.message) ?? 'permission check failed',
            /** @type {string} */ (result.code) ?? 'unknown_error',
        );
    }

    const held = /** @type {Record<string, boolean>} */ (
        result.permissions ?? {}
    );
    return permissions.every((permission) => held[permission] === true);
}
