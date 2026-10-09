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
            expect(pc.signalingState).toBe('have-local-offer');

            // The peer offers a track of its own. The polite side rolls its
            // restart offer back to answer it, so that exchange reaches
            // 'stable' without the restart ever having been answered.
            negotiator.acceptOffer({ type: 'offer', sdp: 'their-track' });
            await flush();

            // The rolled-back restart is re-offered rather than reported done.
            const offers = channel.delivered.filter((payload) => payload.offer);
            expect(offers).toHaveLength(3);
            expect(pc.signalingState).toBe('have-local-offer');

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
