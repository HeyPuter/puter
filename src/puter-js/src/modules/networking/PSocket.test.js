import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The relay handshake is the thing under test, so both the token fetch and the
// wisp handler are stubbed: no network, no websocket.
const mockFetchUrl = vi.fn();
vi.mock('../../lib/networkUtils.js', () => ({
    fetchUrl: (...args) => mockFetchUrl(...args),
}));

const handlerInstances = [];
class FakeWispHandler {
    onReady = undefined;
    onError = undefined;

    constructor (url, auth) {
        this.url = url;
        this.auth = auth;
        this.write = vi.fn();
        this.close = vi.fn();
        this.register = vi.fn(() => 7);
        handlerInstances.push(this);
    }
}
vi.mock('./PWispHandler.js', () => ({
    PWispHandler: class {
        constructor (...args) {
            return new FakeWispHandler(...args);
        }
    },
}));

const { PSocket, wispInfo } = await import('./PSocket.js');

const tokenResponse = () => Promise.resolve({
    json: () => Promise.resolve({ token: 'wisp-token', server: 'wss://relay.test/' }),
});

// Lets a test act after the constructor's async body has reached its await.
const flush = () => new Promise(r => setTimeout(r, 0));

const origPuter = globalThis.puter;

beforeEach(() => {
    handlerInstances.length = 0;
    mockFetchUrl.mockReset().mockImplementation(tokenResponse);
    wispInfo.handler = undefined;
    globalThis.puter = { authToken: 'tok', APIOrigin: 'https://api.test', env: 'nodejs' };
});

afterEach(() => {
    wispInfo.handler = undefined;
    globalThis.puter = origPuter;
});

describe('PSocket relay handshake', () => {
    it('opens once the handler reports ready', async () => {
        const socket = new PSocket('example.com', 80);
        const onOpen = vi.fn();
        socket.on('open', onOpen);

        await flush();
        handlerInstances[0].onReady();
        // `open` is emitted from a setTimeout of its own, one tick after the
        // constructor body resumes.
        await flush();
        await flush();

        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(handlerInstances[0].register).toHaveBeenCalledWith(
            'example.com', 80, expect.any(Object),
        );
    });

    // The reject parameter was typo'd `req` and never called, so a failed
    // handshake hung instead of surfacing.
    it('emits error instead of hanging when the handshake fails', async () => {
        const socket = new PSocket('example.com', 80);
        const onError = vi.fn();
        const onClose = vi.fn();
        socket.on('error', onError);
        socket.on('close', onClose);

        await flush();
        handlerInstances[0].onError(new Error('relay unreachable'));
        await flush();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(onError.mock.calls[0][0].message).toBe('relay unreachable');
        expect(onClose).toHaveBeenCalledWith(true);
        // The stream is never registered on a relay that failed to open.
        expect(handlerInstances[0].register).not.toHaveBeenCalled();
    });

    it('drops the dead handler so a later socket redials', async () => {
        const first = new PSocket('example.com', 80);
        first.on('error', () => {});
        await flush();
        handlerInstances[0].onError(new Error('relay unreachable'));
        await flush();

        expect(wispInfo.handler).toBeUndefined();

        const second = new PSocket('example.com', 80);
        second.on('error', () => {});
        await flush();

        expect(handlerInstances).toHaveLength(2);
    });
});

describe('PSocket write', () => {
    const connected = async () => {
        const socket = new PSocket('example.com', 80);
        socket.on('error', () => {});
        await flush();
        handlerInstances[0].onReady();
        await flush();
        return socket;
    };

    it('writes a typed array through the relay handler', async () => {
        const socket = await connected();
        const payload = new Uint8Array([1, 2, 3]);

        socket.write(payload);

        expect(handlerInstances[0].write).toHaveBeenCalledWith(7, payload);
    });

    // This branch called `data.write(...)` — a method ArrayBuffers do not have
    // — so every ArrayBuffer write threw instead of reaching the relay.
    it('writes an ArrayBuffer through the relay handler', async () => {
        const socket = await connected();
        const buffer = new Uint8Array([4, 5, 6]).buffer;
        const callback = vi.fn();

        expect(() => socket.write(buffer, callback)).not.toThrow();

        expect(handlerInstances[0].write).toHaveBeenCalledTimes(1);
        const [streamID, sent] = handlerInstances[0].write.mock.calls[0];
        expect(streamID).toBe(7);
        expect(Array.from(sent)).toEqual([4, 5, 6]);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('encodes a string before writing', async () => {
        const socket = await connected();

        socket.write('hi');

        const [, sent] = handlerInstances[0].write.mock.calls[0];
        expect(Array.from(sent)).toEqual([104, 105]);
    });

    it('throws on an unsupported data type', async () => {
        const socket = await connected();

        expect(() => socket.write(42)).toThrow(/Invalid data type/);
    });
});
