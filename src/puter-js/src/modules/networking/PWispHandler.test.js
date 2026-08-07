import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTINUE, DATA, createWispPacket, parseIncomingPacket } from './parsers.js';
import { PWispHandler } from './PWispHandler.js';

// Fake WebSocket standing in for the relay connection. Records every instance
// so reconnects are observable, and every frame sent so writes are.
class FakeWebSocket {
    static instances = [];

    constructor (url) {
        this.url = url;
        this.sent = [];
        this.readyState = 0;
        FakeWebSocket.instances.push(this);
    }

    send (data) {
        this.sent.push(data);
    }

    close () {}
}

const latest = () => FakeWebSocket.instances.at(-1);

// Hand a wisp packet to the handler the way the browser would.
const deliver = (packet) => latest().onmessage({ data: packet.buffer });

const handshake = (remainingBuffer = 4) =>
    deliver(createWispPacket({ packetType: CONTINUE, streamID: 0, remainingBuffer }));

const origWebSocket = globalThis.WebSocket;

beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = origWebSocket;
});

describe('PWispHandler handshake', () => {
    it('signals ready once the relay answers CONTINUE on stream 0', () => {
        const handler = new PWispHandler('wss://relay.test/', 'token');
        const onReady = vi.fn();
        handler.onReady = onReady;

        handshake(7);

        expect(onReady).toHaveBeenCalledTimes(1);
        expect(handler._bufferMax).toBe(7);
    });

    // Without an `onerror` handler a failed connection left every caller
    // waiting on the handshake hanging forever.
    it('reports a connection error to onError', () => {
        const handler = new PWispHandler('wss://relay.test/', 'token');
        const onError = vi.fn();
        handler.onError = onError;

        expect(typeof latest().onerror).toBe('function');
        latest().onerror(new Event('error'));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('reports a close that happens before the handshake completes', () => {
        const handler = new PWispHandler('wss://relay.test/', 'token');
        const onError = vi.fn();
        handler.onError = onError;

        latest().onclose();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].message).toMatch(/before the handshake/);
    });

    it('reports a connection failure only once', () => {
        const handler = new PWispHandler('wss://relay.test/', 'token');
        const onError = vi.fn();
        handler.onError = onError;

        latest().onerror(new Event('error'));
        latest().onclose();

        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('PWispHandler reconnect', () => {
    // `setTimeout(setup(), 1000)` reconnected synchronously and scheduled
    // `undefined`, so the 1s backoff never applied.
    it('reconnects one second after an established connection drops', () => {
        new PWispHandler('wss://relay.test/', 'token');
        handshake();
        expect(FakeWebSocket.instances).toHaveLength(1);

        latest().onclose();

        // Nothing yet: the reconnect is scheduled, not immediate.
        expect(FakeWebSocket.instances).toHaveLength(1);

        vi.advanceTimersByTime(1000);

        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(latest().url).toBe('wss://relay.test/');
    });

    it('does not reconnect when the handshake never completed', () => {
        new PWispHandler('wss://relay.test/', 'token');

        latest().onclose();
        vi.advanceTimersByTime(5000);

        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});

describe('PWispHandler backpressure', () => {
    // `this._continue()` was called with no argument, so the drain path did
    // `streamMap.get(undefined).queue` and threw.
    it('drains the queue for the stream the CONTINUE names', () => {
        const handler = new PWispHandler('wss://relay.test/', 'token');
        handshake(1);

        const streamID = handler.register('example.com', 80, {
            dataCallBack: vi.fn(), closeCallBack: vi.fn(),
        });
        const sentAfterRegister = latest().sent.length;

        // Exhaust the credit, so the next write is queued rather than sent.
        handler.write(streamID, new Uint8Array([1]));
        handler.write(streamID, new Uint8Array([2]));
        expect(handler.streamMap.get(streamID).queue).toHaveLength(1);
        expect(latest().sent).toHaveLength(sentAfterRegister + 1);

        expect(() => deliver(createWispPacket({
            packetType: CONTINUE, streamID, remainingBuffer: 4,
        }))).not.toThrow();

        expect(handler.streamMap.get(streamID).queue).toHaveLength(0);
        const flushed = parseIncomingPacket(latest().sent.at(-1));
        expect(flushed.packetType).toBe(DATA);
        expect(flushed.streamID).toBe(streamID);
        expect(Array.from(flushed.payload)).toEqual([2]);
    });
});
