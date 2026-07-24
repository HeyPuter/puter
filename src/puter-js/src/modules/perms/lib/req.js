import { fetchUrl } from '../../../lib/networkUtils.js';

/**
 * Shared request helper for the grant/revoke/group endpoints. These endpoints
 * return a parsed result object (with `error: true` set on failure) rather
 * than rejecting — preserved for backward compatibility, so callers keep
 * inspecting `result.error` instead of catching.
 *
 * @param {import('../../../../types/puter').Puter} puter
 * @param {string} route
 * @param {Record<string, unknown>} [body] - When present the request is a POST.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function req (puter, route, body) {
    try {
        const resp = await fetchUrl(puter.APIOrigin + route, {
            method: body ? 'POST' : 'GET',
            includePuterAuth: true,
            headers: {
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if ( resp.headers.get('content-type')?.includes('application/json') ) {
            const jsonResult = await resp.json();
            if ( resp.status !== 200 ) {
                jsonResult.error = true;
            }
            return jsonResult;
        }
        return { error: true, message: await resp.text(), code: 'unknown_error' };
    } catch (e) {
        return { error: true, message: e.message, code: 'internal_error' };
    }
}
