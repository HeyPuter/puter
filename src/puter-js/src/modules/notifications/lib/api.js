import { fetchUrl } from '../../../lib/networkUtils.js';
import { PuterJSError } from '../../../lib/PuterJSError.js';

const UNAVAILABLE_MESSAGE =
    "Push notifications aren't available on this deployment";

/**
 * One `/push` call; the server's `{ message, code }` passes through. A 404 the
 * device routes didn't answer themselves becomes `push_unavailable`.
 */
export async function request(puter, method, route, body) {
    const response = await fetchUrl(`${puter.APIOrigin}${route}`, {
        method,
        includePuterAuth: true,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const isJson = response.headers
        .get('content-type')
        ?.includes('application/json');
    const parsed = isJson ? await response.json() : null;

    // The device routes name a missing device `device_not_found`.
    if (response.status === 404 && (!parsed || parsed.code === 'not_found')) {
        throw new PuterJSError(UNAVAILABLE_MESSAGE, 'push_unavailable');
    }

    if (response.status !== 200) {
        const fallback = `The notifications request failed (HTTP ${response.status})`;
        if (!parsed) throw new PuterJSError(fallback, 'notifications_failed');
        const { message, error, code, ...rest } = parsed;
        throw new PuterJSError(
            typeof message === 'string'
                ? message
                : typeof error === 'string'
                  ? error
                  : fallback,
            typeof code === 'string' ? code : 'notifications_failed',
            rest,
        );
    }

    return parsed ?? {};
}
