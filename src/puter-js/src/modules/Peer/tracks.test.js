import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { FakePeerConnection, LoopbackChannel, flush } from './testFakes.js';

/**
 * A slot's name travels with the description that introduces its m-sections,
 * so an arriving track is named on the spot rather than guessed at or waited
 * on - which is the whole reason the name is not sent in-band.
 */

const origRTCPeerConnection = globalThis.RTCPeerConnection;
const origMediaStream = globalThis.MediaStream;

class FakeMediaStream {
    #tracks;
    constructor (tracks = []) {
        this.#tracks = [...tracks];
        this.id = `stream-${Math.random().toString(36).slice(2)}`;
    }
    getTracks () { return [...this.#tracks]; }
    addTrack (track) { if ( ! this.#tracks.includes(track) ) this.#tracks.push(track); }
    removeTrack (track) { this.#tracks = this.#tracks.filter((t) => t !== track); }
}

const track = (kind, id = kind) => ({
    kind,
    id,
    readyState: 'live',
    addEventListener () {},
});

beforeEach(() => {
    FakePeerConnection.instances = [];
    globalThis.RTCPeerConnection = FakePeerConnection;
    globalThis.MediaStream = FakeMediaStream;
});

afterEach(() => {
    globalThis.RTCPeerConnection = origRTCPeerConnection;
    globalThis.MediaStream = origMediaStream;
});

/** A connection past its opening exchange, so either side may renegotiate. */
const makeConnection = async () => {
    const channel = new LoopbackChannel('peer');
    const conn = new PuterPeerConnection({ iceServers: [] }, { polite: true, channel });
    const pc = FakePeerConnection.instances.at(-1);
    conn.acceptNegotiation();
    channel.onoffer({ type: 'offer', sdp: 'opening' }, {});
    await flush();
    return { conn, pc, channel };
};

/** The names map carried by the most recent description this side sent. */
const sentNames = (channel) => {
    const last = channel.delivered.filter((p) => p.offer || p.answer).at(-1);
    return (last.offer ?? last.answer).names;
};

describe('publishing', () => {
    it('adds a sender per kind and names it by m-section', async () => {
        const { conn, pc, channel } = await makeConnection();

        const stream = new FakeMediaStream([track('audio'), track('video')]);
        conn.publish('camera', stream);
        await flush();

        expect(pc.transceivers).toHaveLength(2);
        expect(conn.publications.get('camera').getTracks()).toHaveLength(2);
        expect(sentNames(channel)).toEqual({ 0: 'camera', 1: 'camera' });
    });

    it('swaps a republished name in place without adding senders', async () => {
        const { conn, pc } = await makeConnection();

        conn.publish('camera', new FakeMediaStream([track('video', 'v1')]));
        await flush();
        const before = pc.transceivers.length;

        const replacement = track('video', 'v2');
        conn.publish('camera', new FakeMediaStream([replacement]));
        await flush();

        expect(pc.transceivers).toHaveLength(before);
        expect(pc.transceivers[0].sender.track).toBe(replacement);
    });

    it('keeps the sender when a kind goes away, so it can come back free', async () => {
        const { conn, pc } = await makeConnection();

        conn.publish('camera', new FakeMediaStream([track('video')]));
        await flush();

        conn.publish('camera', new FakeMediaStream([]));
        await flush();

        expect(pc.transceivers).toHaveLength(1);
        expect(pc.transceivers[0].sender.track).toBe(null);
    });

    it('removes senders on unpublish', async () => {
        const { conn, pc } = await makeConnection();

        conn.publish('screen', new FakeMediaStream([track('video')]));
        await flush();
        conn.unpublish('screen');
        await flush();

        expect(pc.transceivers[0].sender.removed).toBe(true);
        expect(conn.publications.has('screen')).toBe(false);
    });

    it('keeps sending when a pause is undone before it lands', async () => {
        // replaceTrack lands a turn later, so the resume comes while the
        // sender still shows the old track and the pause is in flight.
        const { conn, pc } = await makeConnection();
        const camera = track('video');

        conn.publish('camera', new FakeMediaStream([camera]));
        await flush();
        conn.publish('camera', null);
        conn.publish('camera', new FakeMediaStream([camera]));
        await flush();

        const { sender } = pc.transceivers[0];
        expect(sender.replacements).toEqual([null, camera]);
        expect(sender.track).toBe(camera);
    });

    it('reports a replacement the browser refused, and tries it again when asked to', async () => {
        const { conn, pc } = await makeConnection();
        const errors = [];
        conn.addEventListener('error', (e) => errors.push(e.error));
        const first = track('video', 'first');
        const original = new FakeMediaStream([first]);
        conn.publish('camera', original);
        await flush();
        const { sender } = pc.transceivers[0];
        const replaceTrack = sender.replaceTrack.bind(sender);
        let refuse = true;
        const calls = [];
        sender.replaceTrack = (t) => {
            calls.push(t);
            if ( refuse ) return Promise.reject(new Error('refused'));
            return replaceTrack(t);
        };

        const second = track('video', 'second');
        const replacement = new FakeMediaStream([second]);
        conn.publish('camera', replacement);
        await flush();
        expect(errors.map((e) => e.message)).toEqual(['refused']);
        expect(sender.track).toBe(first);
        expect(conn.publications.get('camera')).toBe(original);

        refuse = false;
        conn.publish('camera', replacement);
        await flush();
        expect(calls).toEqual([second, second]);
        expect(sender.track).toBe(second);
        expect(conn.publications.get('camera')).toBe(replacement);
    });

    it('renegotiates a replacement the sender cannot carry as it stands', async () => {
        const { conn, pc } = await makeConnection();
        conn.publish('camera', new FakeMediaStream([track('video', 'first')]));
        await flush();
        const { sender } = pc.transceivers[0];
        sender.replaceTrack = () => Promise.reject(Object.assign(new Error('no'), { name: 'InvalidModificationError' }));

        const second = track('video', 'second');
        conn.publish('camera', new FakeMediaStream([second]));
        await flush();

        expect(pc.transceivers).toHaveLength(2);
        expect(pc.transceivers[0].direction).toBe('recvonly');
        expect(pc.transceivers[1].sender.track).toBe(second);
    });

    it('ends a paused publication at the far end when it is unpublished', async () => {
        // removeTrack does nothing for a sender with no track; the peer
        // must still hear the name has gone.
        const { conn, pc, channel } = await makeConnection();

        conn.publish('camera', new FakeMediaStream([track('video')]));
        await flush();
        expect(sentNames(channel)).toEqual({ 0: 'camera' });
        conn.publish('camera', null);
        await flush();

        const offers = channel.delivered.filter((p) => p.offer).length;
        conn.unpublish('camera');
        await flush();

        expect(pc.transceivers[0].direction).toBe('recvonly');
        expect(channel.delivered.filter((p) => p.offer).length).toBe(offers + 1);
        expect(sentNames(channel)).toEqual({});
    });
});

describe('encoding limits', () => {
    it('applies what was asked for, and re-applies after a negotiation', async () => {
        const { conn, pc, channel } = await makeConnection();

        conn.publish('camera', new FakeMediaStream([track('video')]), {
            video: { maxBitrate: 700_000, degradationPreference: 'maintain-framerate' },
        });
        await flush();

        const sender = pc.transceivers[0].sender;
        expect(sender.encoding.maxBitrate).toBe(700_000);
        expect(sender.degradationPreference).toBe('maintain-framerate');

        // A negotiation wipes encodings. Settling the one our publish started
        // has to put them back.
        sender.setParameters({ encodings: [{}] });
        channel.onanswer({ type: 'answer', sdp: 'answered' });
        await flush();

        expect(pc.signalingState).toBe('stable');
        expect(sender.encoding.maxBitrate).toBe(700_000);
    });

    it('changes limits without republishing', async () => {
        const { conn, pc } = await makeConnection();
        conn.publish('camera', new FakeMediaStream([track('video')]), {
            video: { maxBitrate: 700_000 },
        });
        await flush();

        conn.configure('camera', { video: { maxBitrate: 250_000 } });
        await flush();

        expect(pc.transceivers[0].sender.encoding.maxBitrate).toBe(250_000);
    });
});

describe('receiving', () => {
    it('names an arriving track from the description that introduced it', async () => {
        const { conn, pc, channel } = await makeConnection();
        const seen = [];
        conn.addEventListener('media', (e) => seen.push([e.name, e.track.kind]));

        channel.onoffer({ type: 'offer', sdp: 'with-media' }, { 0: 'screen' });
        await flush();
        pc.receiveTrack(track('video'), '0');

        expect(seen).toEqual([['screen', 'video']]);
    });

    it('keeps one stream per name as further tracks arrive', async () => {
        const { conn, pc, channel } = await makeConnection();
        const streams = [];
        conn.addEventListener('media', (e) => streams.push(e.stream));

        channel.onoffer({ type: 'offer', sdp: 'two' }, { 0: 'camera', 1: 'camera' });
        await flush();
        pc.receiveTrack(track('video'), '0');
        pc.receiveTrack(track('audio'), '1');

        expect(streams).toHaveLength(2);
        expect(streams[0]).toBe(streams[1]);
        expect(conn.media.get('camera').getTracks()).toHaveLength(2);
    });

    it('ends a name the peer stops publishing, without waiting on the track', async () => {
        const { conn, pc, channel } = await makeConnection();
        const ended = [];
        conn.addEventListener('mediaended', (e) => ended.push(e.name));

        channel.onoffer({ type: 'offer', sdp: 'a' }, { 0: 'screen' });
        await flush();
        pc.receiveTrack(track('video'), '0');
        expect(conn.media.has('screen')).toBe(true);

        channel.onoffer({ type: 'offer', sdp: 'b' }, {});
        await flush();

        expect(ended).toEqual(['screen']);
        expect(conn.media.has('screen')).toBe(false);
    });

    it('surfaces an unnamed track rather than dropping it', async () => {
        const { conn, pc } = await makeConnection();
        const seen = [];
        conn.addEventListener('media', (e) => seen.push(e.name));

        // A peer on an older SDK sends no names at all.
        pc.receiveTrack(track('video'), '0');

        expect(seen).toEqual(['0']);
    });

    it('moves a name republished on a new m-section onto its new track', async () => {
        // Unpublished and published again, a name comes back on a fresh
        // transceiver; the old track stays live but silent, and a <video>
        // on the stream would keep showing it.
        const { conn, pc, channel } = await makeConnection();
        const ended = [];
        conn.addEventListener('mediaended', (e) => ended.push(e.name));
        const before = track('video', 'before');
        const after = track('video', 'after');

        channel.onoffer({ type: 'offer', sdp: 'first' }, { 0: 'camera' });
        await flush();
        pc.receiveTrack(before, '0');
        const stream = conn.media.get('camera');

        channel.onoffer({ type: 'offer', sdp: 'again' }, { 1: 'camera' });
        await flush();
        pc.receiveTrack(after, '1');

        expect(conn.media.get('camera')).toBe(stream);
        expect(stream.getTracks()).toEqual([after]);
        expect(ended).toEqual([]);
    });

    it('does not end an unnamed track because a description leaves it out', async () => {
        // A raw addTrack next to named media: the names map lists only the
        // named slot, and never will list the raw one.
        const { conn, pc, channel } = await makeConnection();
        const ended = [];
        conn.addEventListener('mediaended', (e) => ended.push(e.name));

        channel.onoffer({ type: 'offer', sdp: 'mixed' }, { 0: 'camera' });
        await flush();
        pc.receiveTrack(track('video', 'cam'), '0');
        pc.receiveTrack(track('video', 'raw'), '1');
        channel.onoffer({ type: 'offer', sdp: 'again' }, { 0: 'camera' });
        await flush();

        expect(ended).toEqual([]);
        expect([...conn.media.keys()]).toEqual(['camera', '1']);
    });
});

describe('remote names and a rejected description', () => {
    it('keeps media the peer is still sending when the description fails', async () => {
        const { conn, pc, channel } = await makeConnection();
        const ended = [];
        conn.addEventListener('mediaended', (e) => ended.push(e.name));

        channel.onoffer({ type: 'offer', sdp: 'a' }, { 0: 'screen' });
        await flush();
        pc.receiveTrack(track('video'), '0');
        expect(conn.media.has('screen')).toBe(true);

        // The names say the peer dropped 'screen', but the description they
        // arrived with never applies - so the peer is still sending it.
        pc.failRemoteDescription = true;
        channel.onoffer({ type: 'offer', sdp: 'b' }, {});
        await flush();

        expect(ended).toEqual([]);
        expect(conn.media.has('screen')).toBe(true);

        // The name map is the one the live description established, so the
        // next track on that m-section is still named.
        pc.receiveTrack(track('audio', 'a2'), '0');
        expect(conn.media.has('screen')).toBe(true);
    });
});

describe('publishing to a closed connection', () => {
    it('is ignored rather than thrown, so one dead link cannot stop the others', async () => {
        const { conn } = await makeConnection();
        conn.close();
        expect(() => conn.publish('camera', new FakeMediaStream([track('video')]))).not.toThrow();
        expect(conn.publications.size).toBe(0);
    });
});
