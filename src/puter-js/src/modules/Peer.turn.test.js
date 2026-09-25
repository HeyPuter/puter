import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Relay-credential plumbing for `puter.peer`: an authenticated caller mints
 * its own, a guest redeems a host's grant. `fetchUrl` is the HTTP boundary, so
 * that is what's stubbed; everything above it is the real module.
 */

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));
vi.mock('../lib/networkUtils.js', () => ({ fetchUrl: fetchUrlMock }));

const { PeerModule } = await import('./Peer.js');

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

const HOST_SERVERS = [{ urls: 'turn:host.test' }];
const GUEST_SERVERS = [{ urls: 'turn:guest.test' }];

beforeEach(() => {
    fetchUrlMock.mockReset();
});

describe('createGuestGrant', () => {
    it('mints a grant against the caller session', async () => {
        routeFetch({
            '/peer/turn-grant': respond({
                grant: 'pg1.payload.sig',
                expiresAt: 1_700_000_900,
            }),
        });
        const { peer } = makePeer({ authToken: 'host-token' });

        await expect(peer.createGuestGrant()).resolves.toEqual({
            grant: 'pg1.payload.sig',
            expiresAt: 1_700_000_900,
        });

        const [url, opts] = callTo('/peer/turn-grant');
        expect(url).toBe(`${API_ORIGIN}/peer/turn-grant`);
        expect(opts.method).toBe('POST');
        expect(opts.includePuterAuth).toBe(true);
    });

    it('throws when the grant is refused', async () => {
        routeFetch({ '/peer/turn-grant': respond({}, false) });
        const { peer } = makePeer({ authToken: 'host-token' });

        await expect(peer.createGuestGrant()).rejects.toThrow(
            'Failed to create a guest grant.',
        );
    });
});

describe('ensureTurnRelays', () => {
    it('uses the authenticated endpoint when no grant is given', async () => {
        routeFetch({
            '/peer/generate-turn': respond({
                iceServers: HOST_SERVERS,
                ttl: 3600,
            }),
        });
        const { peer } = makePeer({ authToken: 'host-token' });

        await peer.ensureTurnRelays();

        const [, opts] = callTo('/peer/generate-turn');
        expect(opts.includePuterAuth).toBe(true);
        expect(opts.body).toBeUndefined();
        expect(callTo('/peer/guest-turn')).toBeUndefined();
    });

    it('redeems a grant at the guest endpoint, without sending a session', async () => {
        routeFetch({
            '/peer/guest-turn': respond({
                iceServers: GUEST_SERVERS,
                ttl: 600,
            }),
        });
        const { peer } = makePeer();

        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });

        const [url, opts] = callTo('/peer/guest-turn');
        expect(url).toBe(`${API_ORIGIN}/peer/guest-turn`);
        expect(opts.method).toBe('POST');
        expect(opts.includePuterAuth).toBeUndefined();
        expect(JSON.parse(opts.body)).toEqual({ grant: 'grant-1' });
        expect(callTo('/peer/generate-turn')).toBeUndefined();
    });

    it('reuses credentials within their ttl', async () => {
        routeFetch({
            '/peer/guest-turn': respond({
                iceServers: GUEST_SERVERS,
                ttl: 600,
            }),
        });
        const { peer } = makePeer();

        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });

        expect(fetchUrlMock).toHaveBeenCalledTimes(1);
    });

    it('re-mints once the ttl has passed', async () => {
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
            now.mockReturnValue(1_000_000 + 601_000);
            await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
        } finally {
            now.mockRestore();
        }

        expect(fetchUrlMock).toHaveBeenCalledTimes(2);
    });

    it('does not throw when relays are unavailable', async () => {
        routeFetch({ '/peer/guest-turn': respond({}, false) });
        const { peer } = makePeer();

        await expect(
            peer.ensureTurnRelays({ turnGrant: 'grant-1' }),
        ).resolves.toBeUndefined();
    });

    it('stops asking after a failure for the same source', async () => {
        routeFetch({ '/peer/guest-turn': respond({}, false) });
        const { peer } = makePeer();

        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });

        expect(fetchUrlMock).toHaveBeenCalledTimes(1);
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

        await peer.ensureTurnRelays();
        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });

        expect(callTo('/peer/generate-turn')).toBeDefined();
        expect(callTo('/peer/guest-turn')).toBeDefined();
    });

    it('re-mints when the grant changes', async () => {
        routeFetch({
            '/peer/guest-turn': respond({
                iceServers: GUEST_SERVERS,
                ttl: 600,
            }),
        });
        const { peer } = makePeer();

        await peer.ensureTurnRelays({ turnGrant: 'grant-1' });
        await peer.ensureTurnRelays({ turnGrant: 'grant-2' });

        expect(fetchUrlMock).toHaveBeenCalledTimes(2);
        expect(
            JSON.parse(fetchUrlMock.mock.calls.at(-1)[1].body),
        ).toEqual({ grant: 'grant-2' });
    });
});

// -- Guest join, end to end through connect() --------------------------

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

class FakeRTCPeerConnection {
    static latest = null;

    constructor (config) {
        this.config = config;
        FakeRTCPeerConnection.latest = this;
    }

    createDataChannel () {
        return {
            onmessage: null,
            onopen: null,
            onclose: null,
            onerror: null,
            send () {},
            close () {},
        };
    }

    async createOffer () {
        return { type: 'offer', sdp: 'v=0' };
    }

    async setLocalDescription () {}
    async setRemoteDescription () {}
    async addIceCandidate () {}
    close () {}
}

/** Polls until `pred` holds, for handshakes that resolve across microtasks. */
const waitFor = async (pred, tries = 50) => {
    for ( let i = 0; i < tries; i++ ) {
        if ( pred() ) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('condition never became true');
};

describe('serve as a host', () => {
    const origWebSocket = globalThis.WebSocket;

    beforeEach(() => {
        FakeWebSocket.latest = null;
        globalThis.WebSocket = FakeWebSocket;
    });

    afterEach(() => {
        globalThis.WebSocket = origWebSocket;
    });

    const signaller = respond({
        url: 'ws://signaller.test/',
        fallbackIce: [{ urls: 'stun:fallback.test' }],
    });

    /** Drives the signaller's create handshake and resolves the invite code. */
    const startServing = async (peer, options) => {
        const started = peer.serve(options);
        await waitFor(() => FakeWebSocket.latest?.onmessage);
        await FakeWebSocket.latest.onmessage({
            data: JSON.stringify({
                server: { create: { success: true, invitecode: 'HOST-1234' } },
            }),
        });
        return await started;
    };

    it('mints relays against the host session', async () => {
        routeFetch({
            '/peer/signaller-info': signaller,
            '/peer/generate-turn': respond({
                iceServers: HOST_SERVERS,
                ttl: 3600,
            }),
        });
        const { peer, puter } = makePeer({ authToken: 'host-token' });

        const server = await startServing(peer);

        expect(server.inviteCode).toBe('HOST-1234');
        expect(puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
        expect(callTo('/peer/generate-turn')).toBeDefined();
        expect(callTo('/peer/guest-turn')).toBeUndefined();

        const sent = JSON.parse(FakeWebSocket.latest.sent[0]);
        expect(sent.server.create.authToken).toBe('host-token');
    });

    it('prompts an unauthenticated host to sign in', async () => {
        routeFetch({
            '/peer/signaller-info': signaller,
            '/peer/generate-turn': respond({
                iceServers: HOST_SERVERS,
                ttl: 3600,
            }),
        });
        const { peer, puter } = makePeer();

        await startServing(peer);

        expect(puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
    });

    it('hosts anonymously without relays of its own', async () => {
        // An anonymous host has no account to attribute relay usage to, so it
        // gets the public ICE servers and no sign-in prompt.
        routeFetch({
            '/peer/signaller-info': signaller,
            '/peer/generate-turn': respond({}, false),
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { peer, puter } = makePeer();
        try {
            await startServing(peer, {
                anonToken: '11111111-2222-3333-4444-555555555555',
            });
        } finally {
            warn.mockRestore();
        }

        expect(puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
        const sent = JSON.parse(FakeWebSocket.latest.sent[0]);
        expect(sent.server.create.anonToken).toBe(
            '11111111-2222-3333-4444-555555555555',
        );
    });
});

describe('connect as a guest', () => {
    const origWebSocket = globalThis.WebSocket;
    const origRTC = globalThis.RTCPeerConnection;

    beforeEach(() => {
        FakeWebSocket.latest = null;
        FakeRTCPeerConnection.latest = null;
        globalThis.WebSocket = FakeWebSocket;
        globalThis.RTCPeerConnection = FakeRTCPeerConnection;
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
        expect(FakeRTCPeerConnection.latest.config.iceServers).toEqual(
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

    it('falls back to the public ICE servers when the grant is refused', async () => {
        routeFetch({
            '/peer/signaller-info': signallerInfo,
            '/peer/guest-turn': respond({}, false),
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { peer } = makePeer();
        try {
            await peer.connect('HOST-1234', {
                anonToken: '11111111-2222-3333-4444-555555555555',
                turnGrant: 'expired-grant',
            });
        } finally {
            warn.mockRestore();
        }

        expect(FakeRTCPeerConnection.latest.config.iceServers).toEqual([
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

        expect(FakeRTCPeerConnection.latest.config.iceServers).toEqual([
            { urls: 'turn:mine.test' },
        ]);
        expect(callTo('/peer/guest-turn')).toBeUndefined();
    });

    it('still mints against the session for an authenticated caller', async () => {
        routeFetch({
            '/peer/signaller-info': signallerInfo,
            '/peer/generate-turn': respond({
                iceServers: HOST_SERVERS,
                ttl: 3600,
            }),
        });
        const { peer } = makePeer({ authToken: 'user-token' });

        await peer.connect('HOST-1234');

        expect(FakeRTCPeerConnection.latest.config.iceServers).toEqual(
            HOST_SERVERS,
        );
        const sent = JSON.parse(FakeWebSocket.latest.sent[0]);
        expect(sent.client.connect.authToken).toBe('user-token');
        expect(callTo('/peer/guest-turn')).toBeUndefined();
    });
});
