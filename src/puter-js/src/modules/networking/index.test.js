import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the relay-token exchange and the client cache are under test, so the
// wasm bundle is stubbed out: initEpoxy just hands back a marker object.
const mockInitEpoxy = vi.fn();
vi.mock('./epoxy.js', () => ({
    initEpoxy: (...args) => mockInitEpoxy(...args),
}));

const {
    clearEpoxyClientCache,
    discardOnRelayFailure,
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
            transport: expect.objectContaining({ down: false, closed: false }),
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

    // Swallowing the reason here used to hand callers an undefined client, so
    // a dead relay surfaced as "cannot read properties of undefined" instead.
    it('surfaces why the client could not be built', async () => {
        mockInitEpoxy.mockRejectedValue(new Error('wasm unavailable'));

        await expect(getEpoxyClient()).rejects.toThrow('wasm unavailable');
    });

    it('surfaces a credential failure the same way', async () => {
        mockFetch.mockImplementation(async () => relayResponse({ status: 500 }));

        await expect(getEpoxyClient()).rejects.toThrow(/HTTP 500/);
    });

    it('rejects every caller waiting on a failed attempt', async () => {
        mockInitEpoxy.mockRejectedValue(new Error('wasm unavailable'));

        const results = await Promise.allSettled([getEpoxyClient(), getEpoxyClient()]);

        expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
        expect(mockInitEpoxy).toHaveBeenCalledTimes(1);
    });

    // A failed attempt must not be cached, otherwise every later socket would
    // keep resolving the same broken client.
    it('does not cache a failed init, so the next caller retries', async () => {
        mockInitEpoxy.mockRejectedValueOnce(new Error('wasm unavailable'));

        await expect(getEpoxyClient()).rejects.toThrow('wasm unavailable');
        const retried = await getEpoxyClient();

        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
        expect(retried).toEqual({ client: 'epoxy' });
    });

    it('does not cache a failed credential fetch', async () => {
        mockFetch.mockImplementationOnce(async () => relayResponse({ status: 500 }));

        await expect(getEpoxyClient()).rejects.toThrow(/HTTP 500/);
        const retried = await getEpoxyClient();

        expect(retried).toEqual({ client: 'epoxy' });
    });

    it('starts a separate attempt when the token changes mid-init', async () => {
        const gate = deferred();
        mockInitEpoxy.mockImplementationOnce(() => gate.promise);

        const first = getEpoxyClient();
        globalThis.puter.authToken = 'different-tok';
        const second = getEpoxyClient();
        gate.resolve({ client: 'first' });

        expect(await first).toEqual({ client: 'first' });
        expect(await second).toEqual({ client: 'epoxy' });
        expect(mockInitEpoxy).toHaveBeenCalledTimes(2);
    });
});

describe('discardOnRelayFailure', () => {
    const transports = new Map();
    const transportOf = (client) => transports.get(client);

    beforeEach(() => {
        transports.clear();
        mockInitEpoxy.mockImplementation(async ({ transport }) => {
            const client = { client: 'epoxy' };
            transports.set(client, transport);
            return client;
        });
    });

    it.each([
        'connection refused',
        'IO: tls handshake eof',
        'Invalid DNS name: down.invalid',
        'Hyper: connection closed before message completed',
        'TLS: invalid peer certificate: UnknownIssuer',
    ])(
        'keeps the shared client after a stream failure (%s)',
        async (message) => {
            const client = await getEpoxyClient();

            expect(discardOnRelayFailure(client, new Error(message))).toBe(
                false,
            );
            expect(await getEpoxyClient()).toBe(client);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        'Wisp: Multiplexor task ended',
        'IO: Failed to send multiplexor message',
        'Wisp: Websocket implementation error: websocket closed',
        'Wisp: Handshake timed out',
        'Wisp: Password protocol extension: Invalid username/password',
        'Wisp: Incompatible Wisp protocol version: found 1.0 but needed 2.0',
    ])('drops the client on a relay failure (%s)', async (message) => {
        const client = await getEpoxyClient();

        expect(discardOnRelayFailure(client, new Error(message))).toBe(true);
        expect(await getEpoxyClient()).not.toBe(client);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('treats any failure as a relay failure once the relay websocket is down', async () => {
        const client = await getEpoxyClient();
        transportOf(client).down = true;

        expect(
            discardOnRelayFailure(client, new Error('connection reset')),
        ).toBe(true);
    });

    it("closes the dropped client's websockets and stops it redialling", async () => {
        const client = await getEpoxyClient();
        const transport = transportOf(client);
        const ws = { close: vi.fn() };
        transport.sockets.add(ws);

        discardOnRelayFailure(
            client,
            new Error('Wisp: Multiplexor task ended'),
        );

        expect(ws.close).toHaveBeenCalledTimes(1);
        expect(transport.closed).toBe(true);
        expect(transport.sockets.size).toBe(0);
    });

    it('leaves a newer cached client alone when a stale one fails', async () => {
        const stale = await getEpoxyClient();
        discardOnRelayFailure(stale, new Error('Wisp: Multiplexor task ended'));
        const fresh = await getEpoxyClient();

        expect(
            discardOnRelayFailure(
                stale,
                new Error('Wisp: Multiplexor task ended'),
            ),
        ).toBe(true);
        expect(await getEpoxyClient()).toBe(fresh);
        expect(transportOf(fresh).closed).toBe(false);
    });

    it('ignores a missing or unknown client', () => {
        const error = new Error('Wisp: Multiplexor task ended');

        expect(discardOnRelayFailure(undefined, error)).toBe(false);
        expect(discardOnRelayFailure({}, error)).toBe(false);
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

// The PSocket unit tests stub this module out, so nothing there would notice if
// the two drifted apart. These drive the real socket against the real client
// cache -- only the wasm bundle and the token endpoint are stubbed -- and pin
// the property that matters: a caller learns why the relay is unreachable.
describe('failure reporting through a real socket', () => {
    const listen = () => {
        const socket = new netAPI.Socket('example.com', 80);
        const events = { error: vi.fn(), close: vi.fn() };
        socket.on('error', events.error);
        socket.on('close', events.close);
        return events;
    };

    const closed = events =>
        vi.waitFor(() => expect(events.close).toHaveBeenCalled(), { interval: 1 });

    it('reports why the epoxy client could not be built', async () => {
        mockInitEpoxy.mockRejectedValue(new Error('wasm unavailable'));

        const events = listen();
        await closed(events);

        expect(events.error).toHaveBeenCalledTimes(1);
        const [reason] = events.error.mock.calls[0];
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toBe('wasm unavailable');
        expect(events.close).toHaveBeenCalledWith(true);
    });

    it('reports a refused port without building a second client', async () => {
        mockInitEpoxy.mockImplementation(async () => ({
            connect: async () => {
                throw new Error('connection refused');
            },
        }));

        const first = listen();
        await closed(first);
        const second = listen();
        await closed(second);

        expect(first.error.mock.calls[0][0].message).toBe('connection refused');
        expect(mockInitEpoxy).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('moves to a new client when the relay connection died', async () => {
        const stream = {
            read: new ReadableStream(),
            write: new WritableStream(),
        };
        const dead = {
            connect: vi.fn(async () => {
                throw new Error('Wisp: Multiplexor task ended');
            }),
        };
        const fresh = { connect: vi.fn(async () => stream) };
        mockInitEpoxy.mockResolvedValueOnce(dead).mockResolvedValueOnce(fresh);

        const socket = new netAPI.Socket('example.com', 80);
        const open = vi.fn();
        const error = vi.fn();
        socket.on('open', open);
        socket.on('error', error);
        await vi.waitFor(() => expect(open).toHaveBeenCalled(), {
            interval: 1,
        });

        expect(fresh.connect).toHaveBeenCalledWith('example.com', 80);
        expect(error).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(2);
        socket.close();
    });

    it('reports why the relay refused to mint a token', async () => {
        mockFetch.mockImplementation(async () => relayResponse({ status: 503 }));

        const events = listen();
        await closed(events);

        expect(events.error.mock.calls[0][0].message).toMatch(/HTTP 503/);
        expect(events.close).toHaveBeenCalledWith(true);
    });
});
