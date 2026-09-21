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
    channel.onoffer({ type: 'offer', sdp: 'opening-offer' });
    await flush();

    if ( connected ) pc.channels[0].open();

    return { conn, pc, channel, closes, errors };
};

/** Answers whatever offer the connection just made, settling negotiation. */
const answerOffer = async ( channel ) => {
    await flush();
    channel.onanswer({ type: 'answer', sdp: 'answer-sdp' });
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

    it('tries again when a restart goes unanswered', async () => {
        // A peer whose tab is throttled answers late, and the browser raises
        // no further state change while the transport stays failed, so one
        // silent restart must not end the connection.
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(20_000);

        expect(pc.restarts).toBeGreaterThan(1);
        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);
    });

    it('keeps trying for a peer that could still come back', async () => {
        // A lid closed for a minute is the ordinary case, and the side left
        // awake must still be there when the other one wakes up.
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(45_000);

        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);
    });

    it('gives the peer up once the budget is spent', async () => {
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(70_000);

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer stopped responding']);
    });

    it('waits for signalling rather than spending attempts it cannot send', async () => {
        vi.useFakeTimers();
        const { conn, pc, channel, closes } = await makeConnection();

        // The peer server's socket dropped; it is expected back on it.
        channel.kill();
        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(20_000);

        expect(pc.restarts).toBe(0);
        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);

        // It reclaimed its session, so the restart has somewhere to go.
        channel.revive();
        channel.onusable();
        await vi.advanceTimersByTimeAsync(100);

        expect(pc.restarts).toBeGreaterThan(0);
        expect(conn.closed).toBe(false);
    });

    it('does not bother restarting when the peer has hung up', async () => {
        const { conn, pc, channel, closes } = await makeConnection();

        channel.onpeergone('the peer went away', false);
        pc.setConnectionState('failed');
        await flush();

        expect(pc.restarts).toBe(0);
        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer hung up']);
    });

    it('keeps recovering when the peer only lost its signalling session', async () => {
        vi.useFakeTimers();
        const { conn, pc, channel, closes } = await makeConnection();

        channel.onpeergone('the peer server’s signalling dropped', true);
        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(10_000);

        expect(pc.restarts).toBeGreaterThan(0);
        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);
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

        channel.onbye('user left the room');
        await flush();

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['user left the room']);
    });

    it('does not bounce a goodbye back at a peer that just said one', async () => {
        const { channel } = await makeConnection();

        channel.onbye('bye');
        await flush();

        expect(channel.delivered.filter((s) => s.bye)).toEqual([]);
    });
});

describe('link state', () => {
    it('reports a wobble it is not acting on', async () => {
        const { conn, pc, closes } = await makeConnection();
        const seen = [];
        conn.addEventListener('linkstate', (e) => seen.push(e.state));

        pc.setConnectionState('disconnected');
        await flush();

        expect(seen).toEqual(['unstable']);
        expect(pc.restarts).toBe(0);
        expect(conn.linkState).toBe('unstable');
        expect(closes).toEqual([]);
    });

    it('reports each restart attempt', async () => {
        const { conn, pc, channel } = await makeConnection();
        const seen = [];
        conn.addEventListener('linkstate', (e) => seen.push([e.state, e.attempt]));

        pc.setConnectionState('failed');
        await answerOffer(channel);
        pc.setConnectionState('failed');
        await answerOffer(channel);

        expect(seen).toEqual([
            ['recovering', 1],
            ['recovering', 2],
        ]);
        expect(conn.linkState).toBe('recovering');
    });

    it('reports coming back, and forgets the attempts', async () => {
        const { conn, pc, channel } = await makeConnection();
        const seen = [];
        conn.addEventListener('linkstate', (e) => seen.push([e.state, e.attempt]));

        pc.setConnectionState('failed');
        await answerOffer(channel);
        pc.setConnectionState('connected');
        await flush();
        pc.setConnectionState('failed');
        await answerOffer(channel);

        expect(seen).toEqual([
            ['recovering', 1],
            ['connected', undefined],
            ['recovering', 1],
        ]);
    });

    it('settles on closed', async () => {
        const { conn, channel } = await makeConnection();
        const seen = [];
        conn.addEventListener('linkstate', (e) => seen.push(e.state));

        channel.onbye('done');
        await flush();

        expect(seen).toEqual(['closed']);
        expect(conn.linkState).toBe('closed');
    });
});
