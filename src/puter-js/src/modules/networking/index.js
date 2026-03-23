import { initEpoxy } from './epoxy.js';
import { PSocket, PTLSSocket } from './PSocket.js';
import { pFetch } from './requests.js';

let cachedEpoxyClientPromise;
let cachedEpoxyClientKey;

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

function getClientCacheKey () {
    const puter = getPuterInstance();
    return `${puter.APIOrigin}::${puter.authToken || ''}`;
}

export async function getWispCredentials () {
    const puter = getPuterInstance();
    const response = await fetch(`${puter.APIOrigin}/wisp/relay-token/create`, {
        method: 'POST',
        headers: getWispRequestHeaders(),
        body: JSON.stringify({}),
    });

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
    if ( refresh || !cachedEpoxyClientPromise || cachedEpoxyClientKey !== nextKey ) {
        cachedEpoxyClientKey = nextKey;
        cachedEpoxyClientPromise = (async () => {
            const { wispToken, wispServer } = await getWispCredentials();
            return await initEpoxy({ wispToken, wispServer });
        })();

        cachedEpoxyClientPromise.catch(() => {
            if ( cachedEpoxyClientKey === nextKey ) {
                cachedEpoxyClientPromise = undefined;
                cachedEpoxyClientKey = undefined;
            }
        });
    }

    return await cachedEpoxyClientPromise;
}

export function clearEpoxyClientCache () {
    cachedEpoxyClientPromise = undefined;
    cachedEpoxyClientKey = undefined;
}

export let netAPI = {
    async generateWispV1URL () {
        return await generateWispV1URL();
    },
    Socket: PSocket,
    tls: {
        TLSSocket: PTLSSocket,
    },
    fetch: pFetch,
};
