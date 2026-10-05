import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { FakePeerConnection, LoopbackChannel, flush } from './testFakes.js';

const origRTCPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
    FakePeerConnection.instances = [];
    globalThis.RTCPeerConnection = FakePeerConnection;
});

afterEach(() => {
    globalThis.RTCPeerConnection = origRTCPeerConnection;
    vi.useRealTimers();
});

/**
 * A connection past its opening exchange. Impolite by default, since that is
 * the side that restarts ICE; the polite side waits for its restarts.
 */
const makeConnection = async ({ polite = false, recoveryTimeout } = {}) => {
    const channel = new LoopbackChannel('peer');
    const conn = new PuterPeerConnection({ iceServers: [] }, { polite, channel, recoveryTimeout });
    const pc = FakePeerConnection.instances.at(-1);
    conn.acceptNegotiation();

    const closes = [];
    conn.addEventListener('close', (e) => closes.push(e.reason));

    // The opening exchange: the connecting side offers, this side answers.
    channel.onoffer({ type: 'offer', sdp: 'opening-offer' });
    await flush();

    pc.channels[0].open();

    return { conn, pc, channel, closes };
};

/** Answers whatever offer the connection just made, settling negotiation. */
const answerOffer = async ( channel ) => {
    await flush();
    channel.onanswer({ type: 'answer', sdp: 'answer-sdp' });
    await flush();
};

describe('renegotiation across a signalling outage', () => {
    const camera = { kind: 'video', id: 'cam', readyState: 'live', addEventListener () {} };
    const stream = { getTracks: () => [camera] };
    const offersSent = (channel) => channel.delivered.filter((p) => p.offer).length;

    it('makes again an offer that went out as the path died, once the peer is back', async () => {
        const { conn, pc, channel } = await makeConnection({ polite: true });
        pc.setConnectionState('connected');
        await flush();

        conn.publish('camera', stream);
        await flush();
        const before = offersSent(channel);
        expect(pc.signalingState).toBe('have-local-offer'); // never answered

        channel.onpeerback();
        await flush();
        expect(offersSent(channel)).toBe(before + 1);
    });

    it('holds the offer while the transport is down, and makes it once it is up', async () => {
        // A polite offer crossing the impolite side's ICE restart is what
        // froze video once; it waits for the link instead.
        const { conn, pc, channel } = await makeConnection({ polite: true });
        pc.setConnectionState('disconnected');
        await flush();
        const before = offersSent(channel);

        channel.kill();
        conn.publish('camera', stream);
        await flush();
        channel.revive();
        channel.onusable();
        await flush();
        expect(offersSent(channel)).toBe(before);

        pc.setConnectionState('connected');
        await flush();
        expect(offersSent(channel)).toBe(before + 1);
    });
});

describe('ICE recovery', () => {
    it('retries unanswered restarts until the recovery deadline', async () => {
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(45_000);
        expect(pc.restarts).toBeGreaterThan(1);
        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);

        await vi.advanceTimersByTimeAsync(16_000);

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer stopped responding']);
    });

    it('keeps one budget when an unanswered restart knocks the state back', async () => {
        // Chrome reports 'disconnected' as soon as an unanswered restart offer
        // is applied, and 'failed' again some 15s later. Each 'failed' must
        // not start a fresh budget, or a vanished peer is never given up.
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();
        const restartIce = pc.restartIce.bind(pc);
        pc.restartIce = () => {
            restartIce();
            queueMicrotask(() => pc.setConnectionState('disconnected'));
            setTimeout(() => pc.setConnectionState('failed'), 15_000);
        };

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(100);
        expect(conn.linkState).toBe('recovering');
        await vi.advanceTimersByTimeAsync(74_900);

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer stopped responding']);
    });

    it('counts the budget from the first sign of trouble, not from failure', async () => {
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection();

        pc.setConnectionState('disconnected');
        await vi.advanceTimersByTimeAsync(15_000);
        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(46_000);

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer stopped responding']);
    });

    it('leaves restarting to the impolite side when it is the polite one', async () => {
        // Restart offers from both sides, held up together by the outage,
        // collide once it ends; the polite side rolling its own back leaves
        // Chrome sending it no video. It answers the impolite side instead.
        vi.useFakeTimers();
        const { conn, pc, channel, closes } = await makeConnection({ polite: true });
        const seen = [];
        conn.addEventListener('linkstate', (e) => seen.push(e.state));

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(20_000);
        expect(pc.restarts).toBe(0);
        expect(seen).toEqual(['recovering']);
        expect(conn.closed).toBe(false);

        channel.onoffer({ type: 'offer', sdp: 'restart-offer' });
        await flush();
        pc.setConnectionState('connected');
        await vi.advanceTimersByTimeAsync(100);

        expect(conn.linkState).toBe('connected');
        expect(closes).toEqual([]);
    });

    it('closes on time even when the link never gets past disconnected', async () => {
        // Browsers can leave a dead link in 'disconnected' for a long while,
        // or for good; recovery proper only starts at 'failed'.
        vi.useFakeTimers();
        const { conn, pc, closes } = await makeConnection({ recoveryTimeout: 100 });

        pc.setConnectionState('disconnected');
        await vi.advanceTimersByTimeAsync(99);
        expect(conn.closed).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['could not restore the connection']);
    });

    it('lets a link that recovers by itself off the deadline', async () => {
        vi.useFakeTimers();
        const { conn, pc } = await makeConnection();

        pc.setConnectionState('disconnected');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(conn.linkState).toBe('unstable');
        expect(pc.restarts).toBe(0);
        pc.setConnectionState('connected');
        await vi.advanceTimersByTimeAsync(120_000);

        expect(conn.closed).toBe(false);
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

    it('stops waiting on a peer whose signalling never comes back', async () => {
        // Nothing it offers can be answered until that session returns, so
        // spending the whole budget only holds up whoever is waiting on this
        // connection to close before they act.
        vi.useFakeTimers();
        const { conn, pc, channel, closes } = await makeConnection();

        channel.onpeergone('the peer server’s signalling dropped', true);
        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(15_000);

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer is no longer reachable']);
    });

    it('gets the full budget back when the peer reclaims its session', async () => {
        vi.useFakeTimers();
        const { conn, pc, channel, closes } = await makeConnection();

        channel.onpeergone('the peer server’s signalling dropped', true);
        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(5_000);

        channel.onpeerback();
        await vi.advanceTimersByTimeAsync(20_000);

        expect(conn.closed).toBe(false);
        expect(closes).toEqual([]);
        expect(pc.restarts).toBeGreaterThan(1);
    });
});

describe('hangups', () => {
    it('closes with the remote hangup reason without echoing a goodbye', async () => {
        const { conn, channel, closes } = await makeConnection();

        channel.onbye('user left the room');
        await flush();

        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['user left the room']);
        expect(conn.linkState).toBe('closed');
        expect(channel.delivered.filter((payload) => payload.bye)).toEqual([]);
    });
});

describe('link state', () => {
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
});
