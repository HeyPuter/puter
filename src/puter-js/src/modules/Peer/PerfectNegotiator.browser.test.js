import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIREFOX_AUDIO_OFFER, FIREFOX_OPENING_OFFER } from './firefoxOffers.fixture.js';

// What an engine does with another engine's offer is not something a fake can
// stand in for, so this runs the negotiator on a real RTCPeerConnection.
let browser;
let page;

/** Runs in the page: what the tests below share. */
const pageHelpers = () => {
    window.microphone = () => new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0];

    window.until = async (condition, what) => {
        const deadline = Date.now() + 5000;
        while ( ! condition() ) {
            if ( Date.now() > deadline ) throw new Error(`timed out waiting for ${what}`);
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    };

    /** One side of a connection; `lose` drops what it sends from then on. */
    window.makeSide = (polite) => {
        const pc = new RTCPeerConnection();
        pc.createDataChannel('channel-1', { negotiated: true, id: 2 });
        const side = { pc, errors: [], sent: [], lose: false, peer: null };
        const post = (kind, accept, ...signal) => {
            side.sent.push({ kind, description: signal[0] });
            if ( ! side.lose ) side.peer?.negotiator[accept](...signal);
            return true;
        };
        side.negotiator = new window.PerfectNegotiator(pc, {
            alive: true,
            sendOffer: (...signal) => post('offer', 'acceptOffer', ...signal),
            sendAnswer: (...signal) => post('answer', 'acceptAnswer', ...signal),
            sendCandidate: (...signal) => post('candidate', 'acceptCandidate', ...signal),
        }, { polite, onerror: (error) => side.errors.push(error.message) });
        return side;
    };

    /** A polite host and its guest, past their opening exchange. */
    window.makePair = async () => {
        const host = window.makeSide(true);
        const guest = window.makeSide(false);
        host.peer = guest;
        guest.peer = host;
        host.negotiator.enable();
        guest.negotiator.start();
        await window.until(() => guest.pc.currentRemoteDescription, 'the opening exchange');
        return { host, guest };
    };
};

beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    const source = await readFile(new URL('./PerfectNegotiator.js', import.meta.url), 'utf8');
    await page.addScriptTag({ type: 'module', content: `${source}\nwindow.PerfectNegotiator = PerfectNegotiator;` });
    await page.waitForFunction(() => typeof window.PerfectNegotiator === 'function');
    await page.evaluate(pageHelpers);
});

afterAll(async () => {
    await browser?.close();
});

describe('a polite side in Chromium, with a Firefox peer', () => {
    const offers = { opening: FIREFOX_OPENING_OFFER, withAudio: FIREFOX_AUDIO_OFFER };

    it('answers a Firefox offer that crosses its own', async () => {
        const result = await page.evaluate(async ({ opening, withAudio }) => {
            const side = window.makeSide(true);
            side.negotiator.enable();
            await side.negotiator.acceptOffer({ type: 'offer', sdp: opening });

            // Both sides add a microphone at once: ours is offered first...
            side.pc.addTrack(window.microphone());
            await window.until(() => side.sent.some(({ kind }) => kind === 'offer'), 'our offer');
            // ...and the peer's offer, made before it saw ours, arrives.
            await side.negotiator.acceptOffer({ type: 'offer', sdp: withAudio });

            return {
                errors: side.errors,
                state: side.pc.signalingState,
                answers: side.sent.filter(({ kind }) => kind === 'answer').map(({ description }) => description.sdp),
            };
        }, offers);

        expect(result.errors).toEqual([]);
        expect(result.state).toBe('stable');
        expect(result.answers).toHaveLength(2);
        // Our microphone goes out on the section the peer's offer introduced.
        expect(result.answers[1]).toMatch(/m=audio[\s\S]*a=sendrecv/);
    });

    // The test above proves nothing once Chromium takes these offers anyway.
    it('is tested with offers Chromium refuses once its own offer is applied', async () => {
        const refusal = await page.evaluate(async ({ opening, withAudio }) => {
            const pc = new RTCPeerConnection();
            pc.createDataChannel('channel-1', { negotiated: true, id: 2 });
            await pc.setRemoteDescription({ type: 'offer', sdp: opening });
            await pc.setLocalDescription();
            pc.addTrack(window.microphone());
            await pc.setLocalDescription();
            return pc.setRemoteDescription({ type: 'offer', sdp: withAudio }).then(() => null, (error) => error.message);
        }, offers);

        expect(refusal).toMatch(/RTP extension ID reassignment/);
    });
});

describe('a polite side in Chromium, with a peer in the same engine', () => {
    it('is answered again by a peer whose first answer was lost', async () => {
        const result = await page.evaluate(async () => {
            const { host, guest } = await window.makePair();
            // Offers wait for a connected transport, which is not under test here.
            Object.defineProperty(host.pc, 'connectionState', { value: 'connected' });

            guest.lose = true;
            host.pc.addTrack(window.microphone());
            await window.until(() => guest.sent.some(({ kind }) => kind === 'answer'), "the peer's answer");
            guest.lose = false;
            host.negotiator.signallingRestored();

            const [sending] = host.pc.getTransceivers();
            await window.until(() => sending.currentDirection || guest.errors.length > 0, 'the offer sent again to settle');
            return {
                errors: [...host.errors, ...guest.errors],
                sending: [sending.mid, sending.currentDirection],
                receiving: guest.pc.getTransceivers().map(({ mid, currentDirection }) => [mid, currentDirection]),
            };
        });

        expect(result.errors).toEqual([]);
        expect(result.sending[1]).toBe('sendonly');
        expect(result.receiving).toEqual([[result.sending[0], 'recvonly']]);
    });
});

// FakePeerConnection's `browserLike` copies these; if one stops holding, so
// does every test that leans on it.
describe('what the fake peer connection assumes of a browser', () => {
    it('numbers a new section differently in every offer until one is applied', async () => {
        const mids = await page.evaluate(async () => {
            const pc = new RTCPeerConnection();
            pc.addTrack(window.microphone());
            const mid = async () => (await pc.createOffer()).sdp.match(/^a=mid:(.+)$/m)[1];
            return [await mid(), await mid()];
        });

        expect(mids[1]).not.toBe(mids[0]);
    });

    it('raises the negotiation flag again after a rollback', async () => {
        const raised = await page.evaluate(async () => {
            const pc = new RTCPeerConnection();
            let raised = 0;
            pc.onnegotiationneeded = () => raised++;
            pc.addTrack(window.microphone());
            await window.until(() => raised === 1, 'the flag');
            await pc.setLocalDescription();
            await pc.setLocalDescription({ type: 'rollback' });
            await window.until(() => raised === 2, 'the flag after the rollback');
            return raised;
        });

        expect(raised).toBe(2);
    });
});
