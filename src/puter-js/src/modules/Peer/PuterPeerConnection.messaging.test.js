import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { FakePeerConnection, LoopbackChannel, flush } from './testFakes.js';

const origRTCPeerConnection = globalThis.RTCPeerConnection;

/** The browser's own offer and answer, for callers driving SDP by hand. */
class ManualPeerConnection extends FakePeerConnection {
    async createOffer () {
        return { type: 'offer', sdp: 'manual-offer' };
    }

    async createAnswer () {
        return { type: 'answer', sdp: 'manual-answer' };
    }
}

/** A channel that can be dialled, as the connecting side's is. */
class DialChannel extends LoopbackChannel {
    dialled = [];

    async open (invitecode, options) {
        this.dialled.push([invitecode, options]);
    }
}

beforeEach(() => {
    FakePeerConnection.instances = [];
    globalThis.RTCPeerConnection = ManualPeerConnection;
});

afterEach(() => {
    globalThis.RTCPeerConnection = origRTCPeerConnection;
    vi.useRealTimers();
});

/** Records the connection's events as [type, detail] pairs. */
const record = (conn) => {
    const events = [];
    conn.addEventListener('open', () => events.push(['open']));
    conn.addEventListener('message', (e) => events.push(['message', e.data]));
    conn.addEventListener('error', (e) => events.push(['error', e.error]));
    conn.addEventListener('close', (e) => events.push(['close', e.reason]));
    return events;
};

/** A serving-side connection whose opening exchange is done; its data channel is not open yet. */
const makeConnection = async ({ channel = new LoopbackChannel('peer'), polite = true } = {}) => {
    const conn = new PuterPeerConnection({ iceServers: [] }, { polite, channel });
    const pc = FakePeerConnection.instances.at(-1);
    const events = record(conn);
    conn.acceptNegotiation();
    channel.onoffer({ type: 'offer', sdp: 'opening-offer' });
    await flush();
    return { conn, pc, channel, events, data: pc.channels[0] };
};

const byes = (channel) => channel.delivered.filter((payload) => payload.bye);

describe('messages', () => {
    it('holds messages sent before the channel opens, then sends them in order', async () => {
        const { conn, data, events } = await makeConnection();
        conn.send('first');
        conn.send('second');
        expect(data.sent).toEqual([]);
        expect(conn.connected).toBe(false);

        data.open();
        expect(conn.connected).toBe(true);
        expect(data.sent).toEqual(['first', 'second']);
        expect(events).toEqual([['open']]);

        conn.send('third');
        expect(data.sent).toEqual(['first', 'second', 'third']);
    });

    it('delivers the peer\'s messages to listeners still subscribed', async () => {
        const { conn, data, events } = await makeConnection();
        const removed = vi.fn();
        conn.addEventListener('message', removed);
        conn.removeEventListener('message', removed);
        data.open();
        data.onmessage({ data: 'hello' });
        data.onmessage({ data: new Uint8Array([1, 2]) });
        expect(events.slice(1)).toEqual([['message', 'hello'], ['message', new Uint8Array([1, 2])]]);
        expect(removed).not.toHaveBeenCalled();
    });
});

describe('closing', () => {
    it('tells the peer why, and closes the channel and the transport', async () => {
        const { conn, pc, channel, data, events } = await makeConnection();
        data.open();
        conn.close('done for today');

        expect(byes(channel)).toEqual([{ bye: { reason: 'done for today' } }]);
        expect(conn.closed).toBe(true);
        expect(conn.connected).toBe(false);
        expect(conn.linkState).toBe('closed');
        expect(data.readyState).toBe('closed');
        expect(pc.connectionState).toBe('closed');
        expect(events.at(-1)).toEqual(['close', 'done for today']);

        // Closing again says nothing more.
        conn.close('again');
        expect(byes(channel)).toHaveLength(1);
        expect(events.filter(([type]) => type === 'close')).toHaveLength(1);
    });

    it('treats the peer closing the data channel as a hangup, with no goodbye back', async () => {
        const { conn, channel, data, events } = await makeConnection();
        data.open();
        data.onclose();
        expect(conn.closed).toBe(true);
        expect(byes(channel)).toEqual([]);
        expect(events.at(-1)).toEqual(['close', undefined]);
    });

    it('reports a data channel error, then closes', async () => {
        const { conn, data, events } = await makeConnection();
        data.open();
        const failure = new Error('SCTP failure');
        data.onerror({ error: failure });
        expect(conn.closed).toBe(true);
        expect(events.slice(-2)).toEqual([['error', failure], ['close', undefined]]);
    });

    it('gives up when signalling drops before the peer connected', async () => {
        const { conn, channel, events } = await makeConnection();
        channel.onunusable();
        expect(conn.closed).toBe(true);
        expect(events).toEqual([['close', 'lost the signalling connection before the peer connected']]);
    });

    it('keeps an open connection when signalling drops', async () => {
        const { conn, channel, data } = await makeConnection();
        data.open();
        channel.onunusable();
        expect(conn.closed).toBe(false);
    });

    it('closes a connection whose peer left for good once the transport fails', async () => {
        vi.useFakeTimers();
        const { conn, pc, channel, data, events } = await makeConnection({ polite: false });
        data.open();
        pc.setConnectionState('connected');

        // Evidence, not proof: the data channel may still be working.
        channel.onpeergone('the peer went away', false);
        expect(conn.closed).toBe(false);

        pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(0);
        expect(conn.closed).toBe(true);
        expect(events.at(-1)).toEqual(['close', 'the peer hung up']);
        expect(pc.restarts).toBe(0);
    });
});

describe('connecting', () => {
    it('dials with the invite code, and makes the opening offer once attached', async () => {
        const channel = new DialChannel('peer');
        const conn = new PuterPeerConnection({ iceServers: [] }, { channel });
        await conn.connect('INV-1', { port: 3 });
        expect(channel.dialled).toEqual([['INV-1', { port: 3 }]]);
        expect(channel.delivered).toEqual([]);

        channel.onattached({ username: 'host', uuid: 'u-1' });
        await flush();
        expect(conn.owner).toEqual({ username: 'host', uuid: 'u-1' });
        expect(channel.delivered.filter((payload) => payload.offer)).toHaveLength(1);
    });

    it('reports a refused connect and closes', async () => {
        const channel = new DialChannel('peer');
        const conn = new PuterPeerConnection({ iceServers: [] }, { channel });
        const events = record(conn);
        await conn.connect('INV-1');
        const refusal = new Error('Invite code not found');
        channel.onrejected(refusal);
        expect(conn.closed).toBe(true);
        expect(events).toEqual([['error', refusal], ['close', undefined]]);
    });

    it('asks for relayed candidates only when told to force the relay', () => {
        new PuterPeerConnection({ iceServers: [{ urls: 'turn:relay.test' }], forceRelay: true }, { channel: new LoopbackChannel() });
        expect(FakePeerConnection.instances.at(-1).config).toEqual({
            iceTransportPolicy: 'relay',
            iceServers: [{ urls: 'turn:relay.test' }],
        });
        new PuterPeerConnection({ iceServers: [] }, { channel: new LoopbackChannel() });
        expect(FakePeerConnection.instances.at(-1).config.iceTransportPolicy).toBe('all');
    });
});

describe('driving SDP by hand', () => {
    it('applies the offer or answer it creates as the local description', async () => {
        const conn = new PuterPeerConnection({ iceServers: [] }, { channel: new LoopbackChannel() });
        const pc = FakePeerConnection.instances.at(-1);

        const offer = await conn.createOffer();
        expect(offer).toEqual({ type: 'offer', sdp: 'manual-offer' });
        expect(pc.localDescription).toBe(offer);

        await conn.setRemoteDescription({ type: 'answer', sdp: 'their-answer' });
        expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'their-answer' });
        await conn.addIceCandidate({ candidate: 'candidate:1' });
        expect(pc.candidates).toEqual([{ candidate: 'candidate:1' }]);

        await conn.setRemoteDescription({ type: 'offer', sdp: 'their-offer' });
        const answer = await conn.createAnswer();
        expect(answer).toEqual({ type: 'answer', sdp: 'manual-answer' });
        expect(pc.localDescription).toBe(answer);
        expect(pc.signalingState).toBe('stable');
    });
});
