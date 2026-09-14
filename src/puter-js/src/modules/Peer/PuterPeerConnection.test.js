import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { FakePeerConnection, LoopbackChannel, flush } from './testFakes.js';

/**
 * ICE failure looks the same whether the peer hung up or the path between the
 * two broke, so recovery probes over signalling instead of guessing.
 */

const origRTCPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
    FakePeerConnection.instances = [];
    globalThis.RTCPeerConnection = FakePeerConnection;
});

afterEach(() => {
    globalThis.RTCPeerConnection = origRTCPeerConnection;
    vi.useRealTimers();
});

const makeConnection = async ({ connected = true } = {}) => {
    const channel = new LoopbackChannel('peer');
    const conn = new PuterPeerConnection({ iceServers: [] }, { polite: true, channel });
    const pc = FakePeerConnection.instances.at(-1);
    conn.acceptNegotiation();

    const closes = [];
    const errors = [];
    conn.addEventListener('close', (e) => closes.push(e.reason));
    conn.addEventListener('error', (e) => errors.push(e.error));

    // The opening exchange: the connecting side offers, this side answers.
    channel.deliver({ description: { type: 'offer', sdp: 'opening-offer' } });
    await flush();

    if ( connected ) pc.channels[0].open();

    return { conn, pc, channel, closes, errors };
};

/** Answers whatever offer the connection just made, settling negotiation. */
const answerOffer = async ( channel ) => {
    await flush();
    channel.deliver({ description: { type: 'answer', sdp: 'answer-sdp' } });
    await flush();
};

describe('ICE recovery', () => {
    it('rides out a transient disconnect without restarting or closing', async () => {
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('disconnected');
        await flush();

        expect(pc.restarts).toBe(0);
        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);
    });

    it('restarts ICE when the connection actually fails', async () => {
        const { conn, pc, channel } = await makeConnection();

        pc.setConnectionState('failed');
        await answerOffer(channel);

        expect(pc.restarts).toBe(1);
        expect(conn.closed).toBe(false);
    });

    it('forgets earlier restarts once the connection recovers', async () => {
        const { pc, channel } = await makeConnection();

        pc.setConnectionState('failed');
        await answerOffer(channel);
        pc.setConnectionState('connected');
        await flush();

        pc.setConnectionState('failed');
        await answerOffer(channel);

        expect(pc.restarts).toBe(2);
    });

    it('gives up after the restart budget runs out', async () => {
        const { conn, pc, channel, closes } = await makeConnection();

        for ( let i = 0; i < 4; i++ ) {
            pc.setConnectionState('failed');
            await answerOffer(channel);
        }

        expect(pc.restarts).toBe(3);
        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['could not restore the connection']);
    });

    it('treats an unanswered restart as the peer having gone', async () => {
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(8000);
        await flush();

        expect(pc.restarts).toBe(1);
        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer stopped responding']);
    });

    it('does not bother restarting when the peer is known to be gone', async () => {
        const { conn, pc, channel, closes } = await makeConnection();

        channel.onpeergone('the peer went away');
        pc.setConnectionState('failed');
        await flush();

        expect(pc.restarts).toBe(0);
        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer is no longer reachable']);
    });
});

describe('signalling loss', () => {
    it('keeps an open data channel alive when signalling drops', async () => {
        const { conn, closes, channel } = await makeConnection();

        channel.onunusable();
        await flush();

        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);
    });

    it('closes if signalling drops before the peer ever connected', async () => {
        const { conn, channel, closes } = await makeConnection({ connected: false });

        channel.onunusable();
        await flush();

        expect(conn.closed).toBe(true);
        expect(closes).toEqual([
            'lost the signalling connection before the peer connected',
        ]);
    });

    it('closes on peer disconnect only while the handshake is unfinished', async () => {
        const { conn, channel, closes } = await makeConnection({ connected: false });

        channel.onpeergone('the peer server went away');
        await flush();

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer server went away']);
    });
});

describe('hangups', () => {
    it('tells the peer why it is closing', async () => {
        const { conn, channel } = await makeConnection();

        conn.close('done with you');
        await flush();

        expect(channel.delivered).toContainEqual({ bye: { reason: 'done with you' } });
    });

    it('reports the reason a peer gave for hanging up', async () => {
        const { conn, channel, closes } = await makeConnection();

        channel.deliver({ bye: { reason: 'user left the room' } });
        await flush();

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['user left the room']);
    });

    it('does not bounce a goodbye back at a peer that just said one', async () => {
        const { channel } = await makeConnection();

        channel.deliver({ bye: { reason: 'bye' } });
        await flush();

        expect(channel.delivered.filter((s) => s.bye)).toEqual([]);
    });
});
