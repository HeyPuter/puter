import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RUNTIME_URL = 'https://puter-net.b-cdn.net/epoxy/affd9f5/full.js';
const WASM_URL = 'https://puter-net.b-cdn.net/epoxy/affd9f5/full.wasm';

class FakeWebSocket extends EventTarget {
    static instances = [];

    constructor (url, protocols) {
        super();
        this.url = url;
        this.protocols = protocols;
        this.send = vi.fn();
        this.close = vi.fn();
        FakeWebSocket.instances.push(this);
    }
}

/** Stands in for the epoxy bundle served from the CDN; `init` instantiates the wasm. */
const makeRuntime = () => ({
    init: vi.fn(async () => {}),
    JsProtocolExtension: class {},
    JsProtocolExtensionBuilder: class {},
    JsProvider: class {
        constructor (dial) {
            this.dial = dial;
        }
    },
    WispSocketProvider: class {
        constructor (socketProvider, wispServer, options) {
            Object.assign(this, { socketProvider, wispServer, options });
        }
    },
    EpoxyClient: class {
        constructor (provider) {
            this.provider = provider;
        }
    },
});

const newTransport = () => ({ sockets: new Set(), current: undefined, down: false, closed: false });

let runtime;
let wasmResponse;
let fetched;

beforeEach(() => {
    FakeWebSocket.instances = [];
    runtime = makeRuntime();
    wasmResponse = { ok: true, status: 200, statusText: 'OK' };
    fetched = [];
    vi.resetModules();
    vi.doMock(RUNTIME_URL, () => runtime);
    vi.stubGlobal('fetch', async (url) => {
        fetched.push(url);
        return wasmResponse;
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
    vi.doUnmock(RUNTIME_URL);
    vi.unstubAllGlobals();
});

describe('initEpoxy', () => {
    it('loads the runtime and its wasm, and builds a client that authenticates with the relay token', async () => {
        const { initEpoxy } = await import('./epoxy.js');
        const transport = newTransport();
        const client = await initEpoxy({ wispToken: 'abc', wispServer: 'wss://relay.test/', transport });

        expect(fetched).toEqual([WASM_URL]);
        expect(runtime.init).toHaveBeenCalledWith({ module_or_path: wasmResponse });
        expect(client).toBeInstanceOf(runtime.EpoxyClient);
        expect(client.provider.wispServer).toBe('wss://relay.test/');

        const { builders, requiredExts } = client.provider.options();
        expect(requiredExts).toEqual([]);
        expect(Array.from(builders[0].buildToExtension().encode())).toEqual([0, 3, 0, 97, 98, 99]);
    });

    it('dials relay websockets on the transport it was given', async () => {
        const { initEpoxy } = await import('./epoxy.js');
        const transport = newTransport();
        const client = await initEpoxy({ wispToken: 'abc', wispServer: 'wss://relay.test/', transport });

        const opening = client.provider.socketProvider.dial('wss://relay.test/', 'wisp-v2');
        const [ws] = FakeWebSocket.instances;
        expect([ws.url, ws.protocols]).toEqual(['wss://relay.test/', ['wisp-v2']]);
        expect(transport.current).toBe(ws);
        ws.dispatchEvent(new Event('open'));
        expect(await opening).toHaveLength(2);
    });

    it('loads the runtime once for every client', async () => {
        const { initEpoxy } = await import('./epoxy.js');
        const options = { wispToken: 'abc', wispServer: 'wss://relay.test/', transport: newTransport() };
        const [first, second] = await Promise.all([initEpoxy(options), initEpoxy(options)]);
        await initEpoxy(options);

        expect(first).not.toBe(second);
        expect(fetched).toHaveLength(1);
        expect(runtime.init).toHaveBeenCalledTimes(1);
    });

    it('fails when the wasm cannot be fetched, and tries again on the next call', async () => {
        const { initEpoxy } = await import('./epoxy.js');
        const options = { wispToken: 'abc', wispServer: 'wss://relay.test/', transport: newTransport() };
        wasmResponse = { ok: false, status: 503, statusText: 'Service Unavailable' };
        await expect(initEpoxy(options)).rejects.toThrow('Failed to load epoxy wasm (HTTP 503 Service Unavailable).');
        expect(runtime.init).not.toHaveBeenCalled();

        wasmResponse = { ok: true, status: 200, statusText: 'OK' };
        expect(await initEpoxy(options)).toBeInstanceOf(runtime.EpoxyClient);
        expect(fetched).toHaveLength(2);
    });
});

describe('openRelaySocket streams', () => {
    const open = async () => {
        const { openRelaySocket } = await import('./epoxy.js');
        const opening = openRelaySocket('wss://relay.test/', undefined, newTransport());
        const [ws] = FakeWebSocket.instances;
        ws.dispatchEvent(new Event('open'));
        const [readable, writable] = await opening;
        return { ws, readable, writable };
    };

    it('offers no subprotocol when none is asked for', async () => {
        const { ws } = await open();
        expect(ws.protocols).toEqual([]);
    });

    it('closes the websocket when the reader gives up', async () => {
        const { ws, readable } = await open();
        await readable.cancel();
        expect(ws.close).toHaveBeenCalledTimes(1);
    });

    it('closes the websocket when the writer finishes', async () => {
        const { ws, writable } = await open();
        await writable.getWriter().close();
        expect(ws.close).toHaveBeenCalledTimes(1);
    });

    it('closes the websocket when the writer aborts', async () => {
        const { ws, writable } = await open();
        await writable.getWriter().abort(new Error('giving up'));
        expect(ws.close).toHaveBeenCalledTimes(1);
    });
});
