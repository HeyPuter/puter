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

export async function pFetch (...args) {
    const params = getFetchLogParams(args);
    let usedEpoxyClient = false;

    try {
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
