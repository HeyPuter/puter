// Request helper for the `/kv/shares` routes behind `puter.kv.share()` and its
// siblings. The other `puter.kv` methods are driver calls; sharing is a route.

import { PuterJSError } from '../../../lib/PuterJSError.js';
import { routeRequest } from '../../../lib/routeRequest.js';
import { needsSignIn, signInVisitor } from '../../events/lib/signIn.js';

/**
 * Signs a signed-out website visitor in first, as the driver calls do, and
 * rejects with the server's `{ message, code }` unchanged.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {'GET' | 'POST' | 'DELETE'} method
 * @param {string} route
 * @param {{ body?: Record<string, unknown>, query?: Record<string, unknown> }} [opts]
 * @returns {Promise<any>}
 */
export async function sharesRequest (puter, method, route, { body, query } = {}) {
    if ( needsSignIn(puter) ) await signInVisitor(puter);
    return await routeRequest(puter, method, route, { body, query, service: 'kv' });
}

/**
 * Refuses an email address before it reaches the wire, with the server's code,
 * so an address can later mean what it means for file shares.
 *
 * @param {unknown} recipient
 * @returns {unknown}
 */
export const assertUsernameRecipient = (recipient) => {
    const named = typeof recipient === 'string'
        ? recipient
        : /** @type {{ username?: unknown } | null | undefined} */ (recipient)?.username;
    if ( typeof named === 'string' && named.includes('@') ) {
        throw new PuterJSError('`recipient` must be a username, not an email address', 'invalid_recipient');
    }
    return recipient;
};

/**
 * The query a share listing sends. The server reads `includeTotal` only as the
 * string `'true'`.
 *
 * @param {import('../types.js').KVShareListOptions} [options]
 * @returns {Record<string, unknown>}
 */
export const shareListQuery = (options = {}) => ({
    limit: options.limit,
    cursor: options.cursor,
    includeTotal: options.includeTotal === true ? 'true' : undefined,
});
