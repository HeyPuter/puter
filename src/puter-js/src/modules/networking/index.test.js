import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the relay-token exchange and the client cache are under test, so the
// wasm bundle is stubbed out: initEpoxy just hands back a marker object.
const mockInitEpoxy = vi.fn();
vi.mock('./epoxy.js', () => ({
    initEpoxy: (...args) => mockInitEpoxy(...args),
}));

const {
    clearEpoxyClientCache,
    generateWispV1URL,
    getEpoxyClient,
    getWispCredentials,
    netAPI,
} = await import('./index.js');

const CREDENTIALS = { token: 'wisp-token', server: 'wss://relay.test' };

function relayResponse ({ status = 200, body = CREDENTIALS } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => body,
    };
}

// A promise whose settlement the test controls, for overlapping callers.
function deferred () {
    let resolve;
    const promise = new Promise(res => {
        resolve = res;
    });
    return { promise, resolve };
}

const origPuter = globalThis.puter;
const origFetch = globalThis.fetch;

let mockFetch;

beforeEach(() => {
    clearEpoxyClientCache();

    mockInitEpoxy.mockReset()
        .mockImplementation(async () => ({ client: 'epoxy' }));

    mockFetch = vi.fn(async () => relayResponse());
    globalThis.fetch = mockFetch;

    globalThis.puter = {
        APIOrigin: 'https://api.test',
        authToken: 'tok',
        // Production clears the stored token, which is what makes the code
        // under test prompt for sign-in again on the retry.
        resetAuthToken: vi.fn(() => {
            globalThis.puter.authToken = null;
        }),
        ui: { authenticateWithPuter: vi.fn(async () => {}) },
    };
});

afterEach(() => {
    clearEpoxyClientCache();
    globalThis.puter = origPuter;
    globalThis.fetch = origFetch;
});

describe('getWispCredentials', () => {
    it('posts to the relay-token endpoint with the bearer token', async () => {
        const credentials = await getWispCredentials();

        expect(credentials).toEqual({
            wispToken: CREDENTIALS.token,
            wispServer: CREDENTIALS.server,
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.test/wisp/relay-token/create');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer tok');
        expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('throws when the puter runtime is not up yet', async () => {
        globalThis.puter = undefined;

        await expect(getWispCredentials()).rejects.toThrow(/not initialized/);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('prompts for sign-in before requesting a token when there is none', async () => {
        globalThis.puter.authToken = undefined;

        await getWispCredentials();

        expect(globalThis.puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
    });

    it('sends the token the sign-in prompt just established', async () => {
        globalThis.puter.authToken = undefined;
        globalThis.puter.ui.authenticateWithPuter.mockImplementation(async () => {
            globalThis.puter.authToken = 'fresh-tok';
        });

        await getWispCredentials();

        const [, init] = mockFetch.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer fresh-tok');
    });

    it('omits the auth header entirely when no token could be obtained', async () => {
        globalThis.puter.authToken = undefined;

        await getWispCredentials();

        const [, init] = mockFetch.mock.calls[0];
        expect(init.headers).not.toHaveProperty('Authorization');
    });

    it('discards a rejected token, re-authenticates, and retries once', async () => {
        mockFetch
            .mockImplementationOnce(async () => relayResponse({ status: 401 }))
            .mockImplementationOnce(async () => relayResponse());
        globalThis.puter.ui.authenticateWithPuter.mockImplementation(async () => {
            globalThis.puter.authToken = 'fresh-tok';
        });

        const credentials = await getWispCredentials();

        expect(credentials.wispToken).toBe(CREDENTIALS.token);
        expect(globalThis.puter.resetAuthToken).toHaveBeenCalledTimes(1);
        expect(globalThis.puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        // The retry has to carry the newly minted token, not the rejected one.
        const [, retryInit] = mockFetch.mock.calls[1];
        expect(retryInit.headers.Authorization).toBe('Bearer fresh-tok');
    });

    // The retry passes retryAuth=false, so a second 401 must surface rather
    // than recurse into an endless re-auth loop.
    it('gives up after a second 401 instead of looping', async () => {
        mockFetch.mockImplementation(async () => relayResponse({ status: 401 }));

        await expect(getWispCredentials()).rejects.toThrow(/HTTP 401/);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('reports the status when the endpoint fails outright', async () => {
        mockFetch.mockImplementation(async () => relayResponse({ status: 500 }));

        await expect(getWispCredentials()).rejects.toThrow(/HTTP 500/);
        // 500 is not a re-auth case, so there is no retry.
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an empty body', {}],
        ['a missing server', { token: 'only-token' }],
        ['a missing token', { server: 'wss://relay.test' }],
    ])('rejects %s from the relay-token endpoint', async (_label, body) => {
        mockFetch.mockImplementation(async () => relayResponse({ body }));

        await expect(getWispCredentials()).rejects.toThrow(/invalid response/);
    });
});

describe('generateWispV1URL', () => {
    it('joins the relay server and token into a wisp url', async () => {
        await expect(generateWispV1URL()).resolves.toBe('wss://relay.test/wisp-token/');
    });

    it('is reachable through the public net API', async () => {
        await expect(netAPI.generateWispV1URL()).resolves.toBe('wss://relay.test/wisp-token/');
    });
});

describe('getEpoxyClient', () => {
    it('builds a client from freshly minted credentials', async () => {
        const client = await getEpoxyClient();

        expect(client).toEqual({ client: 'epoxy' });
        expect(mockInitEpoxy).toHaveBeenCalledWith({
            wispToken: CREDENTIALS.token,
            wispServer: CREDENTIALS.server,
        });
    });

    it('reuses the cached client for the same origin and token', async () => {
        const first = await getEpoxyClient();
        const second = await getEpoxyClient();

        expect(second).toBe(first);
        expect(mockInitEpoxy).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('rebuilds the client when the auth token changes', async () => {
        await getEpoxyClient();
        globalThis.puter.authToken = 'different-tok';
        await getEpoxyClient();

        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
    });

    it('rebuilds the client when the API origin changes', async () => {
        await getEpoxyClient();
        globalThis.puter.APIOrigin = 'https://other.test';
        await getEpoxyClient();

        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
    });

    it('rebuilds the client when a refresh is requested', async () => {
        await getEpoxyClient();
        await getEpoxyClient({ refresh: true });

        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
    });

    it('shares one in-flight init between concurrent callers', async () => {
        const gate = deferred();
        mockInitEpoxy.mockImplementation(() => gate.promise);

        const both = Promise.all([getEpoxyClient(), getEpoxyClient()]);
        gate.resolve({ client: 'epoxy' });
        const [first, second] = await both;

        expect(first).toBe(second);
        expect(mockInitEpoxy).toHaveBeenCalledTimes(1);
    });

    it('drops the cache after clearEpoxyClientCache', async () => {
        await getEpoxyClient();
        clearEpoxyClientCache();
        await getEpoxyClient();

        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
    });

    // A failed init must not be cached, otherwise every later socket would keep
    // resolving the same broken attempt.
    it('does not cache a failed init, so the next caller retries', async () => {
        mockInitEpoxy.mockRejectedValueOnce(new Error('wasm unavailable'));

        await getEpoxyClient();
        const retried = await getEpoxyClient();

        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
        expect(retried).toEqual({ client: 'epoxy' });
    });

    // Credential failures are swallowed the same way an init failure is.
    it('does not cache a failed credential fetch', async () => {
        mockFetch.mockImplementationOnce(async () => relayResponse({ status: 500 }));

        await getEpoxyClient();
        const retried = await getEpoxyClient();

        expect(retried).toEqual({ client: 'epoxy' });
    });
});

describe('netAPI surface', () => {
    it('exposes the socket constructors and fetch the docs promise', () => {
        expect(typeof netAPI.Socket).toBe('function');
        expect(typeof netAPI.tls.TLSSocket).toBe('function');
        expect(typeof netAPI.fetch).toBe('function');
        expect(typeof netAPI.generateWispV1URL).toBe('function');
    });
});
