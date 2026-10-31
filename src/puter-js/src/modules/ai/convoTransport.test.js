import { describe, expect, it, vi } from 'vitest';
import { RealtimeSession } from './convoTransport.js';

/** Just enough of a WebSocket to drive the session's listeners. */
const fakeSocket = () => {
    const target = new EventTarget();
    return Object.assign(target, {
        readyState: 1,
        sent: /** @type {string[]} */ ([]),
        send (data) {
            this.sent.push(data);
        },
        close: vi.fn(),
        /** @param {object} event */
        deliver (event) {
            this.deliverRaw(JSON.stringify(event));
        },
        /** @param {string} data */
        deliverRaw (data) {
            target.dispatchEvent(new MessageEvent('message', { data }));
        },
    });
};

const LIMIT = 4 * 1024 * 1024;
/** A serialized event of exactly `bytes` UTF-8 bytes, padded with `fill`. */
const eventOfBytes = (bytes, fill = 'x') => {
    const shell = JSON.stringify({ type: 'session.updated', pad: '' });
    const fillBytes = new TextEncoder().encode(fill).byteLength;
    const pad = fill.repeat(Math.floor((bytes - shell.length) / fillBytes));
    const json = JSON.stringify({ type: 'session.updated', pad });
    const short = bytes - new TextEncoder().encode(json).byteLength;
    return JSON.stringify({ type: 'session.updated', pad: pad + 'x'.repeat(short) });
};
const listen = (session) => {
    const typed = vi.fn();
    const all = vi.fn();
    session.on('session.updated', typed);
    session.on('*', all);
    return { typed, all };
};

describe('RealtimeSession', () => {
    it('dispatches server events by type and to "*"', () => {
        const socket = fakeSocket();
        const session = new RealtimeSession(/** @type {any} */ (socket));
        const typed = vi.fn();
        const all = vi.fn();
        session.on('response.done', typed);
        session.on('*', all);

        socket.deliver({ type: 'session.created' });
        socket.deliver({ type: 'response.done', response: {} });

        expect(typed).toHaveBeenCalledExactlyOnceWith({ type: 'response.done', response: {} });
        expect(all.mock.calls.map(([e]) => e.type)).toEqual(['session.created', 'response.done']);
    });

    it('stops calling a listener once removed', () => {
        const socket = fakeSocket();
        const session = new RealtimeSession(/** @type {any} */ (socket));
        const handler = vi.fn();
        const off = session.on('error', handler);
        off();
        socket.deliver({ type: 'error', error: {} });
        expect(handler).not.toHaveBeenCalled();
    });

    it('dispatches a valid event larger than an upload once and stays open', () => {
        const socket = fakeSocket();
        const { typed, all } = listen(new RealtimeSession(/** @type {any} */ (socket)));
        const data = eventOfBytes(256 * 1024);
        socket.deliverRaw(data);
        expect(typed).toHaveBeenCalledExactlyOnceWith(JSON.parse(data));
        expect(all).toHaveBeenCalledOnce();
        expect(socket.close).not.toHaveBeenCalled();
    });

    it('accepts an event of exactly 4 MiB and refuses one byte more with 4009', () => {
        const socket = fakeSocket();
        const { typed } = listen(new RealtimeSession(/** @type {any} */ (socket)));
        const exact = eventOfBytes(LIMIT);
        expect(new TextEncoder().encode(exact).byteLength).toBe(LIMIT);
        socket.deliverRaw(exact);
        expect(typed).toHaveBeenCalledOnce();
        expect(socket.close).not.toHaveBeenCalled();

        socket.deliverRaw(eventOfBytes(LIMIT + 1));
        expect(typed).toHaveBeenCalledOnce();
        expect(socket.close).toHaveBeenCalledExactlyOnceWith(4009, 'message too large');
    });

    it('counts encoded bytes, not characters', () => {
        const socket = fakeSocket();
        const { typed } = listen(new RealtimeSession(/** @type {any} */ (socket)));
        // Two bytes per character: under the limit in characters, over it in bytes.
        const data = eventOfBytes(LIMIT + 2, 'é');
        expect(data.length).toBeLessThan(LIMIT);
        socket.deliverRaw(data);
        expect(typed).not.toHaveBeenCalled();
        expect(socket.close).toHaveBeenCalledExactlyOnceWith(4009, 'message too large');
    });

    it('ignores malformed JSON and events without a usable type', () => {
        const socket = fakeSocket();
        const { all } = listen(new RealtimeSession(/** @type {any} */ (socket)));
        socket.deliverRaw('{"type":');
        socket.deliverRaw('[{"type":"session.updated"}]');
        socket.deliver({ type: '' });
        socket.deliver({ type: 'x'.repeat(129) });
        socket.deliver({ type: 42 });
        expect(all).not.toHaveBeenCalled();
        expect(socket.close).not.toHaveBeenCalled();
    });

    it('emits close with code and reason', () => {
        const socket = fakeSocket();
        const session = new RealtimeSession(/** @type {any} */ (socket));
        const handler = vi.fn();
        session.on('close', handler);
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1008, reason: 'model_not_found' }));
        expect(handler).toHaveBeenCalledWith({ type: 'close', code: 1008, reason: 'model_not_found' });
    });
});
