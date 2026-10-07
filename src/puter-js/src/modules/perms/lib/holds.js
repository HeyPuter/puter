import { PuterJSError } from '../../../lib/PuterJSError.js';
import { req } from './req.js';

/** The route's cap; a longer list is split rather than refused. */
const MAX_PER_REQUEST = 16;

/**
 * Which of these permissions the caller holds, without prompting. Asks in
 * batches of `MAX_PER_REQUEST`, so any length of list is answerable.
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
    /** @type {Record<string, boolean>} */
    const held = {};
    for ( let i = 0 ; i < permissions.length ; i += MAX_PER_REQUEST ) {
        const batch = permissions.slice(i, i + MAX_PER_REQUEST);
        const result = await req(puter, '/auth/check-permissions', { permissions: batch });
        if ( result.error ) {
            throw new PuterJSError(
                /** @type {string} */ (result.message) ?? 'permission check failed',
                /** @type {string} */ (result.code) ?? 'unknown_error',
            );
        }
        Object.assign(held, result.permissions ?? {});
    }
    return held;
}
