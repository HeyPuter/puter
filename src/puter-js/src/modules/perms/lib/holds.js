import { PuterJSError } from '../../../lib/PuterJSError.js';
import { req } from './req.js';

/**
 * Which of these permissions the caller holds, without prompting. One round
 * trip however many are asked about, so a whole batch pools into one call.
 *
 * Failures are thrown, not folded into "not held": "denied" and "never ran"
 * differ, and a caller that can't tell them apart would prompt someone who has
 * already granted it.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {string[]} permissions
 * @returns {Promise<Record<string, boolean>>}
 */
export async function checkPermissions (puter, permissions) {
    const result = await req(puter, '/auth/check-permissions', { permissions });
    if ( result.error ) {
        throw new PuterJSError(
            /** @type {string} */ (result.message) ?? 'permission check failed',
            /** @type {string} */ (result.code) ?? 'unknown_error',
        );
    }
    return /** @type {Record<string, boolean>} */ (result.permissions ?? {});
}
