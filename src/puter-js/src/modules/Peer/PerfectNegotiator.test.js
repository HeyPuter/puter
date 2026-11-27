import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerfectNegotiator } from './PerfectNegotiator.js';
import { FakePeerConnection, LoopbackChannel, flush, linkChannels } from './testFakes.js';

const makePair = () => {
    const impolite = {
        pc: new FakePeerConnection({}),
        channel: new LoopbackChannel('impolite'),
        errors: [],
    };
    const polite = {
        pc: new FakePeerConnection({}),
        channel: new LoopbackChannel('polite'),
        errors: [],
    };
    linkChannels(impolite.channel, polite.channel);

    for ( const [side, isPolite] of [[impolite, false], [polite, true]] ) {
        side.negotiator = new PerfectNegotiator(side.pc, side.channel, {
            polite: isPolite,
            onerror: (error) => side.errors.push(error),
        });
        side.channel.onoffer = (d, n, gen) => side.negotiator.acceptOffer(d, n, gen);
        side.channel.onanswer = (d, n, re) => side.negotiator.acceptAnswer(d, n, re);
        side.channel.oncandidate = (c) => side.negotiator.acceptCandidate(c);
    }

    return { impolite, polite };
};

beforeEach(() => {
    FakePeerConnection.instances = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('PerfectNegotiator collisions', () => {
    it('settles when both sides offer at once, keeping the impolite offer', async () => {
        const { impolite, polite } = makePair();

        impolite.negotiator.start();
        polite.negotiator.start();
        await flush();

        expect(impolite.pc.signalingState).toBe('stable');
        expect(polite.pc.signalingState).toBe('stable');

        expect(impolite.pc.localDescription.type).toBe('offer');
        expect(polite.pc.localDescription.type).toBe('answer');
        expect(polite.pc.remoteDescription.sdp).toBe(impolite.pc.localDescription.sdp);

        expect(impolite.errors).toEqual([]);
        expect(polite.errors).toEqual([]);
    });

    it('leaves the impolite side able to negotiate after a failed offer', async () => {
        const { impolite, polite } = makePair();

        // A send that throws, or an SDP failure, used to strand makingOffer at
        // true and make the impolite side ignore every later offer.
        impolite.pc.failLocalDescription = true;
        impolite.negotiator.start();
        await flush();
        expect(impolite.errors).toHaveLength(1);

        polite.negotiator.start();
        await flush();

        expect(impolite.pc.remoteDescription.sdp).toBe(polite.pc.localDescription.sdp);
        expect(impolite.pc.localDescription.type).toBe('answer');
        expect(impolite.pc.signalingState).toBe('stable');
    });
});

describe('PerfectNegotiator candidates', () => {
    it('applies candidates after the description they belong to', async () => {
        const { impolite, polite } = makePair();
        polite.negotiator.start();

        // Both arrive in the same tick, candidate first.
        impolite.negotiator.acceptCandidate({ candidate: 'late' });
        await flush();

        expect(impolite.pc.candidates).toHaveLength(1);
        expect(impolite.errors).toEqual([]);
    });
});

describe('answers that arrive late', () => {
    /** One side on its own, its offers recorded rather than delivered. */
    const alone = async () => {
        const pc = new FakePeerConnection({});
        const channel = new LoopbackChannel('alone');
        const negotiator = new PerfectNegotiator(pc, channel, { polite: false, onerror: () => {} });
        negotiator.start();
        await flush();
        negotiator.acceptAnswer({ type: 'answer', sdp: 'opening-answer' }, {}, 1);
        await flush();
        return { pc, channel, negotiator };
    };
    const lastOffer = (channel) => channel.delivered.filter((p) => p.offer).at(-1).offer;

    it('ignores an answer to an offer a newer one replaced', async () => {
        vi.useFakeTimers();
        const { pc, channel, negotiator } = await alone();

        // A restart whose answer is held up, then another in its place.
        const first = expect(negotiator.restartIce(1000)).rejects.toThrow('The peer did not answer');
        await flush();
        const firstGeneration = lastOffer(channel).gen;
        await vi.advanceTimersByTimeAsync(1000);
        await first;
        let settled = false;
        const second = negotiator.restartIce(1000).then(() => (settled = true));
        await flush();
        const secondGeneration = lastOffer(channel).gen;
        expect(secondGeneration).not.toBe(firstGeneration);

        // The first restart's answer turns up now.
        negotiator.acceptAnswer({ type: 'answer', sdp: 'stale' }, {}, firstGeneration);
        await flush();
        expect(pc.signalingState).toBe('have-local-offer');
        expect(pc.remoteDescription.sdp).not.toBe('stale');
        expect(settled).toBe(false);

        negotiator.acceptAnswer({ type: 'answer', sdp: 'current' }, {}, secondGeneration);
        await second;
        expect(pc.remoteDescription.sdp).toBe('current');
        expect(pc.signalingState).toBe('stable');
    });

    it('takes an answer that names no offer as the answer to the one outstanding', async () => {
        // An older peer, or a signaller that does not pass the number on.
        const { pc, negotiator } = await alone();
        const restarted = negotiator.restartIce(1000);
        await flush();

        negotiator.acceptAnswer({ type: 'answer', sdp: 'unnumbered' });
        await restarted;
        expect(pc.remoteDescription.sdp).toBe('unnumbered');
    });
});

describe('PerfectNegotiator.restartIce', () => {
    it('fails a pending restart when the connection stops', async () => {
        const { impolite, polite } = makePair();
        impolite.negotiator.start();
        polite.negotiator.enable();
        await flush();

        impolite.channel.peer = null;
        const restarted = impolite.negotiator.restartIce(5000);
        const assertion = expect(restarted).rejects.toThrow('closed while negotiating');
        await flush();
        expect(impolite.pc.signalingState).toBe('have-local-offer');
        impolite.negotiator.stop();
        await assertion;
    });
});

describe('PerfectNegotiator negotiation identity', () => {
    it('does not let an unrelated negotiation answer a pending restart', async () => {
        vi.useFakeTimers();
        try {
            const pc = new FakePeerConnection({});
            // Nothing on the far end: whatever is sent goes unanswered.
            const channel = new LoopbackChannel('polite');
            const errors = [];
            const negotiator = new PerfectNegotiator(pc, channel, {
                polite: true,
                onerror: (error) => errors.push(error),
            });

            negotiator.start();
            await flush();
            negotiator.acceptAnswer({ type: 'answer', sdp: 'opening-answer' });
            await flush();

            const restarted = negotiator.restartIce(5000);
            const assertion = expect(restarted).rejects.toThrow('did not answer');
            await flush();
            // The restart offer is out, held rather than applied.
            expect(channel.delivered.filter((payload) => payload.offer)).toHaveLength(2);
            expect(pc.signalingState).toBe('stable');

            // The peer offers a track of its own. The polite side drops its
            // restart offer to answer it, so that exchange reaches 'stable'
            // without the restart ever having been answered.
            negotiator.acceptOffer({ type: 'offer', sdp: 'their-track' });
            await flush();

            // The dropped restart is re-offered rather than reported done.
            const offers = channel.delivered.filter((payload) => payload.offer);
            expect(offers).toHaveLength(3);
            expect(pc.signalingState).toBe('stable');

            await vi.advanceTimersByTimeAsync(5000);
            await assertion;
            expect(errors).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rolls an offer back when signalling could not carry it', async () => {
        const { impolite } = makePair();
        impolite.negotiator.start();
        await flush();

        impolite.channel.failSend = true;
        const restarted = impolite.negotiator.restartIce(5000);
        const assertion = expect(restarted).rejects.toThrow('signalling connection is unavailable');
        await flush();

        // An offer nobody received must not leave the connection waiting for
        // an answer to it.
        expect(impolite.pc.signalingState).toBe('stable');
        await assertion;
    });
});

describe('a polite side holds its offer', () => {
    /** A polite side on its own, its offers recorded rather than delivered. */
    const politeAlone = async () => {
        const pc = new FakePeerConnection({});
        const channel = new LoopbackChannel('polite');
        const errors = [];
        const negotiator = new PerfectNegotiator(pc, channel, {
            polite: true,
            onerror: (error) => errors.push(error),
        });
        negotiator.start();
        await flush();
        return { pc, channel, negotiator, errors };
    };
    const offers = (channel) => channel.delivered.filter((payload) => payload.offer);

    it('answers a colliding offer from an engine that refuses one after its own was applied', async () => {
        const { impolite, polite } = makePair();
        polite.pc.strictRemoteOffer = true;

        impolite.negotiator.start();
        polite.negotiator.start();
        await flush();

        expect(polite.errors).toEqual([]);
        expect(polite.pc.signalingState).toBe('stable');
        expect(impolite.pc.signalingState).toBe('stable');
        expect(polite.pc.localDescription.type).toBe('answer');
    });

    it('leaves its offer unapplied until the answer arrives', async () => {
        const { pc, channel, negotiator } = await politeAlone();
        const { offer, gen } = channel.delivered.at(-1).offer;
        expect(pc.signalingState).toBe('stable');
        expect(pc.localDescription).toBe(null);

        negotiator.acceptAnswer({ type: 'answer', sdp: 'their-answer' }, {}, gen);
        await flush();

        expect(pc.localDescription).toBe(offer);
        expect(pc.remoteDescription.sdp).toBe('their-answer');
        expect(pc.signalingState).toBe('stable');
    });

    it('ignores an answer to a held offer that a newer one replaced', async () => {
        const { pc, channel, negotiator } = await politeAlone();
        const first = channel.delivered.at(-1).offer.gen;
        pc.fire('negotiationneeded');
        await flush();
        const second = channel.delivered.at(-1).offer.gen;
        expect(second).not.toBe(first);

        negotiator.acceptAnswer({ type: 'answer', sdp: 'stale' }, {}, first);
        await flush();
        expect(pc.remoteDescription).toBe(null);

        negotiator.acceptAnswer({ type: 'answer', sdp: 'current' }, {}, second);
        await flush();
        expect(pc.remoteDescription.sdp).toBe('current');
    });

    it('drops its held offer to answer the peer, with nothing to roll back', async () => {
        const { pc, channel, negotiator, errors } = await politeAlone();

        negotiator.acceptOffer({ type: 'offer', sdp: 'their-offer' }, {}, 7);
        await flush();

        expect(channel.delivered.at(-1).answer.re).toBe(7);
        expect(pc.signalingState).toBe('stable');
        expect(errors).toEqual([]);
    });

    it('ignores a late answer to the offer it dropped for the peer\'s', async () => {
        const { pc, channel, negotiator, errors } = await politeAlone();
        const dropped = channel.delivered.at(-1).offer.gen;
        negotiator.acceptOffer({ type: 'offer', sdp: 'their-offer' }, {}, 7);
        await flush();

        negotiator.acceptAnswer({ type: 'answer', sdp: 'late' }, {}, dropped);
        await flush();

        expect(pc.remoteDescription.sdp).toBe('their-offer');
        expect(pc.localDescription.type).toBe('answer');
        expect(errors).toEqual([]);
    });

    it('ignores an answer that arrives after it stopped', async () => {
        const { pc, channel, negotiator, errors } = await politeAlone();
        negotiator.stop();
        pc.close();

        negotiator.acceptAnswer({ type: 'answer', sdp: 'late' }, {}, channel.delivered.at(-1).offer.gen);
        await flush();

        expect(errors).toEqual([]);
    });

    it('reports a held offer it can no longer apply, and makes no other', async () => {
        const { pc, channel, negotiator, errors } = await politeAlone();
        pc.failLocalDescription = true;

        negotiator.acceptAnswer({ type: 'answer', sdp: 'their-answer' }, {}, channel.delivered.at(-1).offer.gen);
        await flush();

        // The peer applied the offer it answered; a new one would renumber it.
        expect(errors).toHaveLength(1);
        expect(offers(channel)).toHaveLength(1);
        expect(pc.signalingState).toBe('stable');
    });

    it('reports an answer to its held offer that it cannot apply, and makes no other offer', async () => {
        const { pc, channel, negotiator, errors } = await politeAlone();
        // Something is left to offer, which is what a rollback would raise again.
        pc.browserLike = true;
        pc.addTrack({ kind: 'audio', id: 'mic' }, { id: 'stream' });
        await flush();
        const sent = offers(channel).length;
        pc.failRemoteDescription = true;

        negotiator.acceptAnswer({ type: 'answer', sdp: 'unusable' }, {}, offers(channel).at(-1).offer.gen);
        await flush();

        expect(errors).toHaveLength(1);
        expect(offers(channel)).toHaveLength(sent);
    });

    it('sends its held offer again when the signalling path comes back', async () => {
        const { pc, channel, negotiator } = await politeAlone();
        pc.setConnectionState('connected');

        negotiator.signallingRestored();
        await flush();

        const [first, second] = offers(channel).map((payload) => payload.offer);
        expect(second.offer).toBe(first.offer);
        expect(second.gen).not.toBe(first.gen);
        expect(pc.signalingState).toBe('stable');
    });

    it('still takes the answer to its held offer after sending it again failed', async () => {
        const { pc, channel, negotiator } = await politeAlone();
        const { offer, gen } = channel.delivered.at(-1).offer;
        pc.setConnectionState('connected');
        channel.failSend = true;
        negotiator.signallingRestored();
        await flush();

        negotiator.acceptAnswer({ type: 'answer', sdp: 'their-answer' }, {}, gen);
        await flush();

        expect(pc.localDescription).toBe(offer);
        expect(pc.remoteDescription.sdp).toBe('their-answer');
    });

    it('is answered by a peer that had already applied the offer when its answer was lost', async () => {
        const { impolite, polite } = makePair();
        polite.pc.browserLike = true;
        impolite.negotiator.start();
        polite.negotiator.enable();
        await flush();
        polite.pc.setConnectionState('connected');

        // The peer applies the offer and answers, and the answer goes nowhere.
        impolite.channel.peer = null;
        polite.pc.addTrack({ kind: 'audio', id: 'mic' }, { id: 'stream' });
        await flush();
        expect(impolite.pc.signalingState).toBe('stable');
        expect(polite.pc.getTransceivers()[0].mid).toBe(null);

        impolite.channel.peer = polite.channel;
        polite.negotiator.signallingRestored();
        await flush();

        expect(impolite.errors).toEqual([]);
        expect(polite.errors).toEqual([]);
        expect(polite.pc.localDescription.type).toBe('offer');
        expect(polite.pc.getTransceivers()[0].mid).toBe('0');
        expect(polite.pc.signalingState).toBe('stable');
    });

    it('does not count a held offer sent again as carrying an ICE restart asked for since', async () => {
        vi.useFakeTimers();
        const { pc, channel, negotiator } = await politeAlone();
        let restarted = false;
        negotiator.restartIce(5000).then(() => {
            restarted = true;
        });
        await flush();
        expect(offers(channel)).toHaveLength(2);

        negotiator.acceptAnswer({ type: 'answer', sdp: 'to-the-held-offer' }, {}, offers(channel).at(-1).offer.gen);
        await flush();
        expect(restarted).toBe(false);

        // Stable again, the browser raises the flag for the restart itself.
        pc.fire('negotiationneeded');
        await flush();
        negotiator.acceptAnswer({ type: 'answer', sdp: 'to-the-restart' }, {}, offers(channel).at(-1).offer.gen);
        await flush();
        expect(restarted).toBe(true);
    });

    it('keeps an offer it could not send for later, without touching the connection', async () => {
        const pc = new FakePeerConnection({});
        const channel = new LoopbackChannel('polite');
        channel.failSend = true;
        const negotiator = new PerfectNegotiator(pc, channel, { polite: true, onerror: () => {} });
        negotiator.start();
        await flush();
        expect(pc.signalingState).toBe('stable');
        expect(pc.localDescription).toBe(null);

        channel.failSend = false;
        pc.setConnectionState('connected');
        negotiator.signallingRestored();
        await flush();

        expect(offers(channel)).toHaveLength(1);
    });
});
