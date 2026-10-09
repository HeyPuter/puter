import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakePeerConnection } from './Peer/testFakes.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));
vi.mock('../lib/networkUtils.js', () => ({ fetchUrl: fetchUrlMock }));

const { PeerModule } = await import('./Peer/index.js');

const API_ORIGIN = 'https://api.test';

/** A `fetchUrl` response stub. */
const respond = (body, ok = true) => ({ ok, json: async () => body });

/** Routes stubbed responses by URL, so tests declare intent, not call order. */
const routeFetch = (routes) => {
    fetchUrlMock.mockImplementation(async (url, opts) => {
        for (const [fragment, responder] of Object.entries(routes)) {
            if (url.includes(fragment)) {
                return typeof responder === 'function'
                    ? responder(opts)
                    : responder;
            }
        }
        throw new Error(`unexpected request to ${url}`);
    });
};

/** The options `fetchUrl` was called with for the first URL that matches. */
const callTo = (fragment) =>
    fetchUrlMock.mock.calls.find(([url]) => url.includes(fragment));

const makePeer = ({ authToken = null, env = 'web' } = {}) => {
    const puter = {
        authToken,
        APIOrigin: API_ORIGIN,
        env,
        ui: { authenticateWithPuter: vi.fn(async () => {}) },
    };
    return { peer: new PeerModule(puter), puter };
};

const GUEST_SERVERS = [{ urls: 'turn:guest.test' }];

beforeEach(() => {
    fetchUrlMock.mockReset();
});

describe('ensureTurnRelays', () => {
    it('reuses credentials until their ttl expires', async () => {
        routeFetch({
            '/peer/guest-turn': respond({
                iceServers: GUEST_SERVERS,
                ttl: 600,
            }),
        });
        const { peer } = makePeer();
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        try {
            await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
            now.mockReturnValue(1_000_000 + 599_000);
            await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
            expect(fetchUrlMock).toHaveBeenCalledTimes(1);
            now.mockReturnValue(1_000_000 + 601_000);
            await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
        } finally {
            now.mockRestore();
        }

        expect(fetchUrlMock).toHaveBeenCalledTimes(2);
    });

    it('retries once a grant arrives after an unauthenticated failure', async () => {
        // The guest case: the first attempt has no session and no grant, so it
        // fails; holding a grant has to be a fresh start, not a cached refusal.
        routeFetch({
            '/peer/generate-turn': respond({}, false),
            '/peer/guest-turn': respond({
                iceServers: GUEST_SERVERS,
                ttl: 600,
            }),
        });
        const { peer } = makePeer();

        await expect(peer.ensureTurnRelays()).resolves.toBeUndefined();
        await expect(peer.ensureTurnRelays()).resolves.toBeUndefined();
        expect(fetchUrlMock).toHaveBeenCalledTimes(1);

        await expect(peer.ensureTurnRelays({ turnGrant: 'grant-1' })).resolves.toEqual(GUEST_SERVERS);
    });
});

// -- ICE configuration through connect() --

class FakeWebSocket {
    static latest = null;
    sent = [];
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

    constructor () {
        FakeWebSocket.latest = this;
        // Open on the next tick, the way a real socket resolves the handshake
        // after the caller has installed its handlers.
        queueMicrotask(() => this.onopen?.());
    }

    send (data) {
        this.sent.push(data);
    }

    close () {}
}

describe('connect as a guest', () => {
    const origWebSocket = globalThis.WebSocket;
    const origRTC = globalThis.RTCPeerConnection;

    beforeEach(() => {
        FakeWebSocket.latest = null;
        FakePeerConnection.instances = [];
        globalThis.WebSocket = FakeWebSocket;
        globalThis.RTCPeerConnection = FakePeerConnection;
    });

    afterEach(() => {
        globalThis.WebSocket = origWebSocket;
        globalThis.RTCPeerConnection = origRTC;
    });

    const signallerInfo = respond({
        url: 'ws://signaller.test/',
        fallbackIce: [{ urls: 'stun:fallback.test' }],
    });

    it('joins with a grant and no session, on the granted relays', async () => {
        routeFetch({
            '/peer/signaller-info': signallerInfo,
            '/peer/guest-turn': respond({
                iceServers: GUEST_SERVERS,
                ttl: 600,
            }),
        });
        const { peer, puter } = makePeer();

        await peer.connect('HOST-1234', {
            anonToken: '11111111-2222-3333-4444-555555555555',
            turnGrant: 'grant-1',
        });

        // No sign-in prompt, and the relays came from the host's grant.
        expect(puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
        expect(FakePeerConnection.instances.at(-1).config.iceServers).toEqual(
            GUEST_SERVERS,
        );

        const sent = JSON.parse(FakeWebSocket.latest.sent[0]);
        expect(sent.client.connect).toMatchObject({
            anonToken: '11111111-2222-3333-4444-555555555555',
            invitecode: 'HOST-1234',
        });
        // Nothing to authenticate with; the anon token is the identity.
        expect(sent.client.connect.authToken ?? null).toBeNull();
    });

    it('falls back to the public ICE servers when the relay request fails', async () => {
        // Relays are an optimisation: an unreachable endpoint must not stop a
        // connection that has usable fallback servers.
        routeFetch({
            '/peer/signaller-info': signallerInfo,
            '/peer/guest-turn': () => {
                throw new Error('network down');
            },
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { peer } = makePeer();
        try {
            await peer.connect('HOST-1234', {
                anonToken: '11111111-2222-3333-4444-555555555555',
                turnGrant: 'grant-1',
            });
        } finally {
            warn.mockRestore();
        }

        expect(FakePeerConnection.instances.at(-1).config.iceServers).toEqual([
            { urls: 'stun:fallback.test' },
        ]);
    });

    it('honors caller-supplied ICE servers without redeeming a grant', async () => {
        routeFetch({ '/peer/signaller-info': signallerInfo });
        const { peer } = makePeer();

        await peer.connect('HOST-1234', {
            anonToken: '11111111-2222-3333-4444-555555555555',
            iceServers: [{ urls: 'turn:mine.test' }],
        });

        expect(FakePeerConnection.instances.at(-1).config.iceServers).toEqual([
            { urls: 'turn:mine.test' },
        ]);
        expect(callTo('/peer/guest-turn')).toBeUndefined();
    });
});

describe('relay credentials under concurrency', () => {
    const SERVERS_A = [{ urls: 'turn:a.test' }];
    const SERVERS_B = [{ urls: 'turn:b.test' }];

    it('does not cache one grant’s credentials under another’s name', async () => {
        const pending = new Map();
        fetchUrlMock.mockImplementation((url, opts) => {
            const { grant } = JSON.parse(opts.body);
            return new Promise((resolve) => pending.set(grant, resolve));
        });
        const { peer } = makePeer();

        // Two guests load at once, and the later request answers first.
        const a = peer.ensureTurnRelays({ turnGrant: 'grant-a' });
        const b = peer.ensureTurnRelays({ turnGrant: 'grant-b' });
        pending.get('grant-b')(respond({ iceServers: SERVERS_B, ttl: 600 }));
        pending.get('grant-a')(respond({ iceServers: SERVERS_A, ttl: 600 }));

        await expect(a).resolves.toEqual(SERVERS_A);
        await expect(b).resolves.toEqual(SERVERS_B);

        // Whatever the cache ended up holding, it must belong to the grant it
        // is labelled with.
        fetchUrlMock.mockClear();
        await expect(
            peer.ensureTurnRelays({ turnGrant: 'grant-b' }),
        ).resolves.toEqual(SERVERS_B);
        expect(fetchUrlMock).not.toHaveBeenCalled();
    });
});
