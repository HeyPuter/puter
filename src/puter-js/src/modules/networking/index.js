import { initEpoxy } from './epoxy.js';
import { PSocket, PTLSSocket } from './PSocket.js';
import { pFetch } from './requests.js';

let cachedEpoxy = undefined;
/** @type {WeakMap<object, { transport: import('./types.js').RelayTransport }>} */
const epoxyEntries = new WeakMap();

// What wisp reports when the relay connection itself is dead or refused us, as
// opposed to one stream failing (refused port, DNS, TLS, HTTP).
const RELAY_FAILURE_PATTERN = new RegExp([
    'multiplexor',
    'websocket implementation error',
    'handshake timed out',
    'incompatible wisp protocol version',
    'protocol extension',
].join('|'), 'i');

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

export async function getEpoxyClient () {
    const nextKey = getClientCacheKey();

    // Concurrent callers share one attempt; a changed origin or token needs a
    // client of its own.
    if ( cachedEpoxy && cachedEpoxy.key === nextKey ) {
        return await cachedEpoxy.promise;
    }

    const transport = { sockets: new Set(), current: undefined, down: false, closed: false };
    const epoxy = { key: nextKey, transport };
    epoxy.promise = (async () => {
        try {
            const { wispToken, wispServer } = await getWispCredentials();
            const client = await initEpoxy({ wispToken, wispServer, transport });
            epoxyEntries.set(client, epoxy);
            return client;
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
 * Drops `client` from the cache and closes its relay websocket, but only when
 * `error` means the relay connection is unusable. A failure of one stream
 * leaves the shared client alone.
 *
 * @param {object | undefined} client
 * @param {unknown} error
 * @returns {boolean} whether it was a relay failure
 */
export function discardOnRelayFailure (client, error) {
    const entry = client && epoxyEntries.get(client);
    if ( ! entry ) {
        return false;
    }

    const { transport } = entry;
    const message = error instanceof Error ? error.message : String(error);
    if ( !transport.down && !RELAY_FAILURE_PATTERN.test(message) ) {
        return false;
    }

    if ( cachedEpoxy === entry ) {
        cachedEpoxy = undefined;
    }
    transport.closed = true;
    transport.down = true;
    for ( const ws of transport.sockets ) {
        try {
            ws.close();
        } catch {
            // ignored
        }
    }
    transport.sockets.clear();
    return true;
}

/**
 * The `puter.net` module.
 *
 * @type {import('./types.js').Networking}
 */
export let netAPI = {
    /**
     * Mints a relay URL (server + 24-hour token) for speaking the Wisp v1
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
