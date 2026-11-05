import { PuterJSError } from '../../../lib/PuterJSError.js';
import { routeRequest } from '../../../lib/routeRequest.js';

/** `puter.teams` has always named an unnamed 403 this way. */
const STATUS_CODES = { 403: 'permission_denied' };

/**
 * Request helper for the `/teams` routes. Unlike `perms/lib/req.js` these
 * reject on failure rather than resolving `{ error: true }` — nothing depends
 * on the older shape here, so the module throws like the rest of the SDK.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {string} method
 * @param {string} route
 * @param {{ body?: Record<string, unknown>, query?: Record<string, unknown>, operation?: string }} [opts]
 * @returns {Promise<unknown>}
 */
export async function req (puter, method, route, opts = {}) {
    return await routeRequest(puter, method, route, {
        ...opts,
        service: 'teams',
        statusCodes: STATUS_CODES,
    });
}

/**
 * Rejects a blank or non-string path segment before it reaches the wire, where
 * an empty `uid` or `username` would silently address a different route.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
export function requireSegment (value, name) {
    if ( typeof value !== 'string' || value.trim() === '' ) {
        throw new PuterJSError(`\`${name}\` is required`, 'invalid_request');
    }
    return encodeURIComponent(value);
}
