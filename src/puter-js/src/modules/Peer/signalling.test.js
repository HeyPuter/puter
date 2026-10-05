import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSignallingChannel } from './signalling.js';

class FakeWebSocket {
    static all = [];
    sent = [];
    closed = false;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

    constructor (url) {
        this.url = url;
        FakeWebSocket.all.push(this);
    }

    static get latest () {
        return FakeWebSocket.all.at(-1);
    }

    send (data) {
        this.sent.push(JSON.parse(data));
    }

    close () {
        this.closed = true;
    }

    /** The signaller says something. */
    reply (client) {
        this.onmessage({ data: JSON.stringify({ client }) });
    }
}

const origWebSocket = globalThis.WebSocket;
beforeEach(() => {
    FakeWebSocket.all = [];
    globalThis.WebSocket = FakeWebSocket;
    vi.useFakeTimers();
});
afterEach(() => {
    globalThis.WebSocket = origWebSocket;
    vi.useRealTimers();
});

/** A channel through its handshake: attached, holding a resume token. */
const attached = async () => {
    const channel = new ClientSignallingChannel({ signallerUrl: 'wss://signaller.test/', authToken: 'tok' });
    const events = [];
    channel.onattached = () => events.push('attached');
    channel.onusable = () => events.push('usable');
    channel.onunusable = () => events.push('unusable');
    const opening = channel.open('INV-1', { anonToken: 'anon-1' });
    FakeWebSocket.latest.onopen();
    await opening;
    FakeWebSocket.latest.reply({ connect: { success: true, owner: { username: 'h', uuid: 'h' }, resumeToken: 'rt-1' } });
    return { channel, events, first: FakeWebSocket.latest };
};

describe('ClientSignallingChannel reclaiming its session', () => {
    it('dials again with its resume token when the socket drops, and is usable once back', async () => {
        const { channel, events, first } = await attached();
        expect(channel.alive).toBe(true);

        first.onclose({});
        expect(channel.alive).toBe(false);
        expect(events).toEqual(['attached', 'unusable']);

        await vi.advanceTimersByTimeAsync(1000);
        const second = FakeWebSocket.latest;
        expect(second).not.toBe(first);
        // In the URL as well: the signaller fixes a socket's address on accept.
        expect(new URL(second.url).searchParams.get('resume')).toBe('rt-1');
        second.onopen();
        await vi.advanceTimersByTimeAsync(0);
        expect(second.sent).toEqual([
            { client: { connect: { authToken: 'tok', anonToken: 'anon-1', invitecode: 'INV-1', resume: 'rt-1' } } },
        ]);

        second.reply({ connect: { success: true, owner: { username: 'h', uuid: 'h' }, resumeToken: 'rt-1', resumed: true } });
        expect(channel.alive).toBe(true);
        expect(events).toEqual(['attached', 'unusable', 'usable']);
        // Signals go out on the new socket.
        expect(channel.sendCandidate({ candidate: 'c' })).toBe(true);
        expect(second.sent.at(-1)).toEqual({ client: { candidate: { candidate: { candidate: 'c' } } } });
    });

    it('strands itself when the reclaim is turned down, and stops dialing', async () => {
        const { channel, events, first } = await attached();
        first.onclose({});
        await vi.advanceTimersByTimeAsync(1000);
        FakeWebSocket.latest.onopen();
        await vi.advanceTimersByTimeAsync(0);
        FakeWebSocket.latest.reply({ connect: { success: false, error: 'Could not resume the session', resumeRefused: 'no_server' } });

        expect(channel.stranded).toBe(true);
        expect(channel.alive).toBe(false);
        expect(events.at(-1)).toBe('unusable');
        const count = FakeWebSocket.all.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.all.length).toBe(count);
    });

    it('gives the session up when closed on purpose, and does not come back', async () => {
        const { channel, first } = await attached();
        channel.close();
        expect(first.sent.at(-1)).toEqual({ client: { release: {} } });
        expect(first.closed).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.all).toHaveLength(1);
    });
});
