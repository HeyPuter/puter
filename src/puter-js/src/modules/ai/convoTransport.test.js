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
            target.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
        },
    });
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

    it('emits close with code and reason', () => {
        const socket = fakeSocket();
        const session = new RealtimeSession(/** @type {any} */ (socket));
        const handler = vi.fn();
        session.on('close', handler);
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1008, reason: 'model_not_found' }));
        expect(handler).toHaveBeenCalledWith({ type: 'close', code: 1008, reason: 'model_not_found' });
    });
});
