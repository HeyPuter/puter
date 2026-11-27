import { describe, expect, it } from 'vitest';
import { PerfectNegotiator } from './PerfectNegotiator.js';
import { FakePeerConnection, LoopbackChannel, flush } from './testFakes.js';

// A written-out sequence covers one ordering. These play many orderings of
// publishes, deliveries, lost signals and restored paths, each from a seed
// that replays it, and hold every one to the same outcome.

/** A seeded generator (mulberry32). */
const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A polite host and its guest, whose signals wait in an inbox until delivered. */
const makeWorld = ({ strictHost }) => {
    const make = (name, polite) => {
        const pc = new FakePeerConnection({});
        pc.browserLike = true;
        pc.strictRemoteOffer = polite && strictHost;
        const channel = new LoopbackChannel(name);
        const side = { name, pc, channel, errors: [], inbox: [] };
        side.negotiator = new PerfectNegotiator(pc, channel, {
            polite,
            onerror: (error) => side.errors.push(error.message),
        });
        channel.onoffer = (description, names, gen) => side.negotiator.acceptOffer(description, names, gen);
        channel.onanswer = (description, names, re) => side.negotiator.acceptAnswer(description, names, re);
        return side;
    };
    const host = make('host', true);
    const guest = make('guest', false);
    host.channel.peer = { receive: (signal) => guest.inbox.push(signal) };
    guest.channel.peer = { receive: (signal) => host.inbox.push(signal) };
    return { host, guest, sides: [host, guest] };
};

const deliver = async (side) => {
    side.channel.receive(side.inbox.shift());
    await flush();
};

/** Delivers everything, restoring both paths after a loss, until nothing moves. */
const settle = async ({ sides }, lost) => {
    for ( let round = 0; round < 20; round++ ) {
        while ( sides.some((side) => side.inbox.length > 0) ) {
            for ( const side of sides ) if ( side.inbox.length > 0 ) await deliver(side);
        }
        if ( ! lost ) return;
        lost = false;
        for ( const side of sides ) side.negotiator.signallingRestored();
        await flush();
    }
};

const offersSent = ({ sides }) => sides.reduce(
    (count, side) => count + side.channel.delivered.filter((signal) => signal.offer).length,
    0,
);

/** Plays the schedule a seed stands for, then lets it settle. */
const play = async (seed, engines) => {
    const random = seeded(seed);
    const world = makeWorld(engines);
    const { host, guest, sides } = world;
    host.negotiator.enable();
    guest.negotiator.start();
    await flush();
    await settle(world, false);
    for ( const side of sides ) side.pc.setConnectionState('connected');
    const opening = offersSent(world);

    const log = [];
    let lost = false;
    for ( let step = 0; step < 14; step++ ) {
        const side = sides[Math.floor(random() * 2)];
        const roll = random();
        const signal = side.inbox[0] && Object.keys(side.inbox[0])[0];
        if ( roll < 0.3 ) {
            log.push(`${side.name} publishes`);
            side.pc.addTrack({ kind: 'audio', id: `track-${step}` }, { id: `stream-${step}` });
        } else if ( roll < 0.75 && signal ) {
            log.push(`${side.name} receives ${signal}`);
            await deliver(side);
        } else if ( roll < 0.88 && signal ) {
            log.push(`${side.name} loses ${signal}`);
            lost = true;
            side.inbox.shift();
        } else if ( roll >= 0.88 ) {
            log.push(`${side.name}'s path is restored`);
            side.negotiator.signallingRestored();
        }
        await flush();
    }
    await settle(world, lost);
    return { ...world, log, offers: offersSent(world) - opening };
};

const expectAgreement = async (engines) => {
    for ( let seed = 1; seed <= 400; seed++ ) {
        const { host, guest, sides, log, offers } = await play(seed, engines);
        const schedule = `seed ${seed}: ${log.join('; ')}`;

        expect(sides.flatMap((side) => side.errors), schedule).toEqual([]);
        expect(sides.map((side) => side.pc.signalingState), schedule).toEqual(['stable', 'stable']);
        // Each side holds the description the other applied last.
        expect(host.pc.remoteDescription, schedule).toBe(guest.pc.localDescription);
        expect(guest.pc.remoteDescription, schedule).toBe(host.pc.localDescription);
        // Everything published has been negotiated.
        expect(sides.flatMap((side) => side.pc.getTransceivers().map((t) => t.mid)), schedule).not.toContain(null);
        // A step costs a few offers at most; a retry loop costs hundreds.
        expect(offers, schedule).toBeLessThanOrEqual(3 * log.length + 2);
    }
};

describe('any schedule of publishes, deliveries, lost signals and restored paths', () => {
    it('ends with both sides agreed and everything published negotiated', async () => {
        await expectAgreement({ strictHost: false });
    });

    it('ends the same way when the host\'s engine refuses a peer\'s offer once its own is applied', async () => {
        await expectAgreement({ strictHost: true });
    });
});
