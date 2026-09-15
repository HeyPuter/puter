import { apiRequest, requireSegment } from '../../../lib/apiRequest.js';

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
    return apiRequest(puter, method, route, { service: 'teams', ...opts });
}

export { requireSegment };
