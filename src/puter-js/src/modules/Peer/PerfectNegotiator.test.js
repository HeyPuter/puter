import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerfectNegotiator } from './PerfectNegotiator.js';
import { FakePeerConnection, LoopbackChannel, flush, linkChannels } from './testFakes.js';

/**
 * Two peers may both decide to renegotiate at the same instant - that is the
 * normal case for an ICE restart, since both ends see the path fail together.
 */

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
        side.channel.onoffer = (d, n) => side.negotiator.acceptOffer(d, n);
        side.channel.onanswer = (d, n) => side.negotiator.acceptAnswer(d, n);
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

    it('resolves a collision raised by a simultaneous ICE restart', async () => {
        const { impolite, polite } = makePair();
        impolite.negotiator.start();
        polite.negotiator.enable();
        await flush();

        impolite.pc.restartIce();
        polite.pc.restartIce();
        await flush();

        expect(impolite.pc.restarts).toBe(1);
        expect(polite.pc.restarts).toBe(1);
        expect(impolite.pc.signalingState).toBe('stable');
        expect(polite.pc.signalingState).toBe('stable');
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

    it('swallows candidates belonging to an offer it ignored', async () => {
        const { impolite, polite } = makePair();

        impolite.negotiator.start();
        polite.negotiator.start();
        await flush();

        // A second offer from the polite side, colliding with one of ours.
        impolite.pc.signalingState = 'have-local-offer';
        impolite.negotiator.acceptOffer({ type: 'offer', sdp: 'ignored' });
        impolite.negotiator.acceptCandidate({ candidate: 'orphan' });
        await flush();

        expect(impolite.errors).toEqual([]);
    });
});

describe('PerfectNegotiator.restartIce', () => {
    it('resolves once the peer negotiates back', async () => {
        const { impolite, polite } = makePair();
        impolite.negotiator.start();
        polite.negotiator.enable();
        await flush();

        const restarted = impolite.negotiator.restartIce(1000);
        await flush();
        await expect(restarted).resolves.toBeUndefined();
    });

    it('rejects when the peer never answers', async () => {
        vi.useFakeTimers();
        try {
            const { impolite, polite } = makePair();
            impolite.negotiator.start();
            polite.negotiator.enable();
            await flush();

            // The peer is gone: nothing it sends can reach us any more.
            polite.channel.kill();
            impolite.channel.kill();

            const restarted = impolite.negotiator.restartIce(5000);
            const assertion = expect(restarted).rejects.toThrow('did not answer');
            await vi.advanceTimersByTimeAsync(5000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails a pending restart when the connection stops', async () => {
        const { impolite, polite } = makePair();
        impolite.negotiator.start();
        polite.negotiator.enable();
        await flush();

        impolite.channel.kill();
        const restarted = impolite.negotiator.restartIce(5000);
        const assertion = expect(restarted).rejects.toThrow('closed while negotiating');
        impolite.negotiator.stop();
        await assertion;
    });
});
