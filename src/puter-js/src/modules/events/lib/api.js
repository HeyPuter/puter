import { fetchUrl } from '../../../lib/networkUtils.js';
import { PuterJSError } from '../../../lib/PuterJSError.js';

/**
 * The HTTP half of `puter.events`. The socket verbs carry session
 * subscriptions; everything that outlives a connection — durable
 * subscriptions and the handlers they bind — is a route.
 *
 * The server's `{ message, code }` is passed through untouched: its codes are
 * the API surface callers branch on, and re-wrapping them here would make the
 * SDK a second place they are defined.
 */

/** The failure shape for a response that carried no usable body. */
const requestFailed = (status) =>
    new PuterJSError(
        `The events request failed (HTTP ${status})`,
        'events_failed',
    );

/**
 * @param {import('../../../index.js').Puter} puter
 * @param {string} route
 * @param {Record<string, unknown>} [body] Present makes it a POST.
 * @param {Record<string, string | number | boolean>} [query]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function request (puter, route, body, query) {
    const search = new URLSearchParams();
    for ( const [key, value] of Object.entries(query ?? {}) ) {
        if ( value === undefined || value === null ) continue;
        search.set(key, String(value));
    }
    const suffix = search.toString();

    const response = await fetchUrl(
        `${puter.APIOrigin}${route}${suffix ? `?${suffix}` : ''}`,
        {
            method: body ? 'POST' : 'GET',
            includePuterAuth: true,
            headers: { 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        },
    );

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const parsed = isJson ? await response.json() : null;

    if ( response.status !== 200 ) {
        if ( ! parsed ) throw requestFailed(response.status);
        const { message, error, code, ...rest } = parsed;
        throw new PuterJSError(
            typeof message === 'string'
                ? message
                : typeof error === 'string'
                  ? error
                  : `The events request failed (HTTP ${response.status})`,
            typeof code === 'string' ? code : 'events_failed',
            rest,
        );
    }

    return parsed ?? {};
}
