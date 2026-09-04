import { fetchUrl } from '../../../lib/networkUtils.js';
import { PuterJSError } from '../../../lib/PuterJSError.js';

/** Fallback codes for a failure the backend did not name itself. */
const STATUS_CODES = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'permission_denied',
    404: 'not_found',
    409: 'conflict',
    429: 'too_many_requests',
};

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
    const { body, query, operation } = opts;

    const search = new URLSearchParams();
    for ( const [key, value] of Object.entries(query ?? {}) ) {
        if ( value !== undefined && value !== null ) search.set(key, String(value));
    }
    const qs = search.toString();

    let resp;
    try {
        resp = await fetchUrl(puter.APIOrigin + route + (qs ? `?${qs}` : ''), {
            method,
            includePuterAuth: true,
            headers: { 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
            logContext: { service: 'teams', operation: operation ?? `${method} ${route}`, params: {} },
        });
    } catch (e) {
        throw PuterJSError.from(e);
    }

    const isJSON = resp.headers.get('content-type')?.includes('application/json');
    const payload = isJSON ? await resp.json() : await resp.text();

    if ( resp.status < 200 || resp.status >= 300 ) {
        const fallback = STATUS_CODES[resp.status] ?? 'unknown_error';
        if ( isJSON && payload !== null && typeof payload === 'object' ) {
            // Backend errors pass through unchanged; only a missing code is filled in.
            const error = PuterJSError.from(payload);
            if ( error.code === undefined ) error.code = fallback;
            throw error;
        }
        throw new PuterJSError(typeof payload === 'string' && payload ? payload : `Request failed with status ${resp.status}`, fallback);
    }

    return payload;
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
