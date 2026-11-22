import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconnectAfterServerDisconnect } from './socketReconnect.js';

const MAX_WAIT = 120_000;

const fakeSocket = () => {
    const handlers = {};
    return {
        connected: false,
        auth: { auth_token: 'old', acks: ['a'] },
        connect: vi.fn(),
        on (event, fn) {
            handlers[event] = fn;
        },
        fire (event, ...args) {
            handlers[event]?.(...args);
        },
    };
};

describe('reconnectAfterServerDisconnect', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reconnects with the current token after the server closes the socket', () => {
        const socket = fakeSocket();
        reconnectAfterServerDisconnect(socket, () => 'new');
        socket.fire('connect');
        socket.fire('disconnect', 'io server disconnect');
        vi.advanceTimersByTime(1000);
        expect(socket.connect).toHaveBeenCalledTimes(1);
        expect(socket.auth).toEqual({ auth_token: 'new', acks: ['a'] });
    });

    it('leaves other disconnects to socket.io', () => {
        const socket = fakeSocket();
        reconnectAfterServerDisconnect(socket, () => 'new');
        socket.fire('disconnect', 'transport close');
        socket.fire('disconnect', 'io client disconnect');
        vi.advanceTimersByTime(MAX_WAIT);
        expect(socket.connect).not.toHaveBeenCalled();
    });

    it('backs off while fresh connections keep being closed', () => {
        const socket = fakeSocket();
        reconnectAfterServerDisconnect(socket, () => 'new');
        socket.fire('connect');
        socket.fire('disconnect', 'io server disconnect');
        vi.advanceTimersByTime(1000);
        socket.fire('connect');
        socket.fire('disconnect', 'io server disconnect');
        vi.advanceTimersByTime(1999);
        expect(socket.connect).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(socket.connect).toHaveBeenCalledTimes(2);
    });
});
