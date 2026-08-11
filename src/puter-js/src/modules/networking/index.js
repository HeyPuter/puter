import { initEpoxy } from './epoxy.js';
import { PSocket, PTLSSocket } from './PSocket.js';
import { pFetch } from './requests.js';

let cachedEpoxy = undefined;

function getPuterInstance () {
    const puter = globalThis.puter;
    if ( ! puter ) {
        throw new Error('Puter runtime is not initialized yet.');
    }
    return puter;
}

function getWispRequestHeaders () {
    const puter = getPuterInstance();
    const headers = {
        'Content-Type': 'application/json',
    };

    if ( puter.authToken ) {
        headers.Authorization = `Bearer ${puter.authToken}`;
    }

    return headers;
}

async function ensureWispAuthentication () {
    const puter = getPuterInstance();
    if ( puter.authToken ) {
        return;
    }

    await puter.ui.authenticateWithPuter();
}

function getClientCacheKey () {
    const puter = getPuterInstance();
    return `${puter.APIOrigin}::${puter.authToken || ''}`;
}

export async function getWispCredentials (retryAuth = true) {
    const puter = getPuterInstance();
    await ensureWispAuthentication();

    const response = await fetch(`${puter.APIOrigin}/wisp/relay-token/create`, {
        method: 'POST',
        headers: getWispRequestHeaders(),
        body: JSON.stringify({}),
    });

    if ( response.status === 401 && retryAuth ) {
        if ( typeof puter.resetAuthToken === 'function' ) {
            puter.resetAuthToken();
        }
        await ensureWispAuthentication();
        return await getWispCredentials(false);
    }

    if ( ! response.ok ) {
        throw new Error(
            `Failed to create relay token (HTTP ${response.status} ${response.statusText}).`,
        );
    }

    const { token: wispToken, server: wispServer } = await response.json();
    if ( !wispToken || !wispServer ) {
        throw new Error('Relay token endpoint returned an invalid response.');
    }

    return { wispToken, wispServer };
}

export async function generateWispV1URL () {
    const { wispServer, wispToken } = await getWispCredentials();
    return `${wispServer}/${wispToken}/`;
}

export async function getEpoxyClient ({ refresh = false } = {}) {
    const nextKey = getClientCacheKey();

    // Concurrent callers share one attempt, but only while it is still the
    // attempt they asked for: a `refresh` exists to replace the cached entry,
    // and a changed origin or token needs a client of its own.
    if ( ! refresh && cachedEpoxy && cachedEpoxy.key === nextKey ) {
        return await cachedEpoxy.promise;
    }

    const epoxy = { key: nextKey };
    epoxy.promise = (async () => {
        try {
            const { wispToken, wispServer } = await getWispCredentials();
            return await initEpoxy({ wispToken, wispServer });
        } catch ( error ) {
            // Never cache a failed attempt, or every later caller would keep
            // resolving the same broken client. The reason is re-thrown so
            // callers report why the relay is unreachable instead of tripping
            // over an undefined client.
            if ( cachedEpoxy === epoxy ) {
                cachedEpoxy = undefined;
            }
            throw error;
        }
    })();

    cachedEpoxy = epoxy;

    return await epoxy.promise;
}

export function clearEpoxyClientCache () {
    cachedEpoxy = undefined;
}

/**
 * The `puter.net` module.
 *
 * @type {import('../../../types/modules/networking').Networking}
 */
export let netAPI = {
    /**
     * Mints a relay URL (server + single-use token) for speaking the Wisp v1
     * protocol directly, which is what the sockets below do for you.
     *
     * @returns {Promise<string>}
     */
    async generateWispV1URL () {
        return await generateWispV1URL();
    },
    Socket: PSocket,
    tls: {
        TLSSocket: PTLSSocket,
    },
    fetch: pFetch,
};
