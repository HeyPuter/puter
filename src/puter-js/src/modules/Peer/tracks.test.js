import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { FakePeerConnection, LoopbackChannel, flush } from './testFakes.js';

const origRTCPeerConnection = globalThis.RTCPeerConnection;
const origMediaStream = globalThis.MediaStream;

class FakeMediaStream {
    #tracks;
    constructor (tracks = []) {
        this.#tracks = [...tracks];
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

    it('renegotiates the name removal when a paused publication is unpublished', async () => {
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
        expect(conn.publications.has('camera')).toBe(false);
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

        conn.configure('camera', { video: { maxBitrate: 250_000 } });
        await flush();
        expect(sender.encoding.maxBitrate).toBe(250_000);

        // Simulate encoding parameters being reset during negotiation.
        await sender.setParameters({ encodings: [{}] });
        channel.onanswer({ type: 'answer', sdp: 'answered' });
        await flush();

        expect(pc.signalingState).toBe('stable');
        expect(sender.encoding.maxBitrate).toBe(250_000);
        expect(sender.degradationPreference).toBe('maintain-framerate');
    });
});

describe('receiving', () => {
    it('groups tracks by name while their remote description is being applied', async () => {
        const { conn, pc, channel } = await makeConnection();
        const streams = [];
        conn.addEventListener('media', (e) => streams.push(e.stream));
        const video = track('video');
        const audio = track('audio');
        const setRemoteDescription = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = async (description) => {
            await setRemoteDescription(description);
            pc.receiveTrack(video, '0');
            pc.receiveTrack(audio, '1');
        };

        channel.onoffer({ type: 'offer', sdp: 'two' }, { 0: 'camera', 1: 'camera' });
        await flush();

        expect(streams).toHaveLength(2);
        expect(streams[0]).toBe(streams[1]);
        expect(conn.media.get('camera').getTracks()).toEqual([video, audio]);
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
        const audio = track('audio', 'a2');
        pc.receiveTrack(audio, '0');
        expect([...conn.media.keys()]).toEqual(['screen']);
        expect(conn.media.get('screen').getTracks()).toContain(audio);
    });
});
