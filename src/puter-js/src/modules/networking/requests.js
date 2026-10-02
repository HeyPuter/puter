import { clearEpoxyClientCache, getEpoxyClient } from './index.js';

function logFetchResult ({ params, result, error }) {
    if ( ! globalThis.puter?.apiCallLogger?.isEnabled() ) {
        return;
    }

    globalThis.puter.apiCallLogger.logRequest({
        service: 'network',
        operation: 'pFetch',
        params,
        result,
        error,
    });
}

function normalizeErrorMessage (error) {
    if ( error instanceof Error ) {
        return error.message;
    }

    return String(error);
}

function getFetchLogParams (args) {
    const [resource, init] = args;

    let url;
    if ( typeof resource === 'string' ) {
        url = resource;
    } else if ( resource instanceof URL ) {
        url = resource.toString();
    } else if ( resource && typeof resource.url === 'string' ) {
        url = resource.url;
    }

    let method;
    if ( init && typeof init.method === 'string' ) {
        method = init.method;
    } else if ( resource && typeof resource.method === 'string' ) {
        method = resource.method;
    } else {
        method = 'GET';
    }

    return {
        url,
        method,
    };
}

/**
 * Rejects a request that cannot be made, before a relay connection is dialled.
 * Epoxy reports a bad request as an opaque wasm value from deep inside the
 * transport, so the checks the pre-epoxy client made client-side are still made
 * here, and reject with what they always rejected with: a `TypeError` from
 * `new Request` for a malformed request, and these two strings otherwise.
 *
 * @param {[input: RequestInfo | URL, init?: RequestInit]} args
 * @returns {Promise<void>}
 */
async function assertRequestIsFetchable (args) {
    const [input, init] = args;

    // Building a Request from a Request disturbs the original's body, and the
    // original is what gets handed to epoxy -- so validate against a clone.
    const request = new Request(
        input instanceof Request ? input.clone() : input,
        init,
    );

    const { protocol } = new URL(request.url);
    if ( protocol !== 'http:' && protocol !== 'https:' ) {
        throw `Failed to fetch. URL scheme "${protocol}" is not supported.`;
    }

    const declaredLength = request.headers.get('content-length');
    if ( declaredLength === null || ! request.body ) {
        return;
    }

    const { byteLength } = await request.clone().arrayBuffer();
    if ( declaredLength !== String(byteLength) ) {
        throw 'Content-Length header does not match the body length. Please check your request.';
    }
}

/**
 * `puter.net.fetch`: fetches an http/https resource over a raw socket rather
 * than the browser's HTTP stack, so it is not subject to CORS. Takes the same
 * arguments as `fetch` and resolves to a `Response`.
 *
 * @type {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>}
 */
export async function pFetch (...args) {
    const params = getFetchLogParams(args);
    let usedEpoxyClient = false;

    try {
        await assertRequestIsFetchable(args);

        const client = await getEpoxyClient();
        usedEpoxyClient = true;
        const response = await client.fetch(...args);

        logFetchResult({
            params,
            result: {
                status: response.status,
                statusText: response.statusText,
            },
        });

        return response;
    } catch ( error ) {
        if ( usedEpoxyClient ) {
            clearEpoxyClientCache();
        }

        logFetchResult({
            params,
            error: {
                message: normalizeErrorMessage(error),
                stack: error?.stack,
            },
        });
        throw error;
    }
}
