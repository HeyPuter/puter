import { fetchUrl } from './networkUtils.js';
import { PuterJSError } from './PuterJSError.js';

/** Fallback codes for a failure the server did not name itself. */
const STATUS_CODES = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    429: 'too_many_requests',
};

/**
 * Calls a REST route on the API origin with the caller's auth. Rejects with
 * the server's `{ message, code }` unchanged, and fills in a status-derived
 * code only when the server names none.
 *
 * @param {import('../index.js').Puter} puter
 * @param {string} method
 * @param {string} route
 * @param {{
 *     body?: Record<string, unknown>,
 *     query?: Record<string, unknown>,
 *     service: string,
 *     operation?: string,
 *     statusCodes?: Record<number, string>,
 * }} opts - `query` entries that are `null` or `undefined` are left out.
 *   `statusCodes` overrides the fallback code for a status.
 * @returns {Promise<unknown>}
 */
export async function routeRequest (puter, method, route, opts) {
    const { body, query, service, operation, statusCodes } = opts;

    const search = new URLSearchParams();
    for ( const [key, value] of Object.entries(query ?? {}) ) {
        if ( value !== undefined && value !== null ) search.set(key, String(value));
    }
    const qs = search.toString();

    let resp;
    try {
        resp = await fetchUrl(`${puter.APIOrigin}${route}${qs ? `?${qs}` : ''}`, {
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
        const fallback = statusCodes?.[resp.status] ?? STATUS_CODES[resp.status] ?? 'unknown_error';
        if ( isJSON && payload !== null && typeof payload === 'object' ) {
            const error = PuterJSError.from(payload);
            if ( error.code === undefined ) error.code = fallback;
            throw error;
        }
        throw new PuterJSError(
            typeof payload === 'string' && payload ? payload : `Request failed with status ${resp.status}`,
            fallback,
        );
    }

    return payload;
}
