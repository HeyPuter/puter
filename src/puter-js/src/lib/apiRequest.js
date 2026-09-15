/** @typedef {import('../index.js').Puter} Puter */

import { fetchUrl } from './networkUtils.js';
import { PuterJSError } from './PuterJSError.js';

const STATUS_CODES = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'permission_denied',
    404: 'not_found',
    409: 'conflict',
    429: 'too_many_requests',
};

/**
 * JSON request against the API origin with Puter auth attached. Backend
 * errors pass through unchanged; only a missing `code` is filled in from the
 * status.
 *
 * @param {Puter} puter
 * @param {string} method
 * @param {string} route
 * @param {{
 *     service: string;
 *     body?: unknown;
 *     query?: Record<string, unknown>;
 *     operation?: string;
 * }} opts
 * @returns {Promise<any>}
 */
export async function apiRequest (puter, method, route, opts) {
    const { service, body, query, operation } = opts;

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
            logContext: { service, operation: operation ?? `${method} ${route}`, params: {} },
        });
    } catch (e) {
        throw PuterJSError.from(e);
    }

    const isJSON = resp.headers.get('content-type')?.includes('application/json');
    const payload = isJSON ? await resp.json() : await resp.text();

    if ( resp.status < 200 || resp.status >= 300 ) {
        const fallback = STATUS_CODES[resp.status] ?? 'unknown_error';
        if ( isJSON && payload !== null && typeof payload === 'object' ) {
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
