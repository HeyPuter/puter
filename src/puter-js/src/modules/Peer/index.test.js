import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Load the dual-export XHR adapter natively; Vite treats its CommonJS branch as a module mutation.
const { default: XMLHttpRequestShim } = createRequire(import.meta.url)('../../lib/polyfills/xhrshim.js');
import { PeerModule, PuterPeerConnection, PuterPeerServer } from './index.js';
import { FakePeerConnection } from './testFakes.js';

class FakeWebSocket {
    static all = [];
    sent = [];
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

    constructor (url) {
        this.url = url;
        FakeWebSocket.all.push(this);
    }

    send (data) {
        this.sent.push(JSON.parse(data));
    }

    close () {}
}

const TURN = [{ urls: 'turn:relay.test', username: 'u', credential: 'c' }];
const FALLBACK = [{ urls: 'stun:stun.test' }];

let api;
let origin;
/** URL path -> `{ status?, body? }` the Puter API answers with. */
let routes;
let requests;
let sdk;
let peer;

beforeEach(async () => {
    routes = {
        '/peer/signaller-info': { body: { url: 'ws://signaller.test/', fallbackIce: FALLBACK } },
        '/peer/generate-turn': { body: { iceServers: TURN, ttl: 3600 } },
    };
    requests = [];
    api = createServer(async (req, res) => {
        const chunks = [];
        for await ( const chunk of req ) chunks.push(chunk);
        requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
        const reply = routes[req.url] ?? { status: 404 };
        res.statusCode = reply.status ?? 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(reply.body ?? {}));
    });
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${api.address().port}`;

    FakeWebSocket.all = [];
    FakePeerConnection.instances = [];
    sdk = {
        env: 'app',
        authToken: 'session-token',
        APIOrigin: origin,
        ui: { authenticateWithPuter: vi.fn(async () => {}) },
    };
    peer = new PeerModule(sdk);
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequestShim);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    vi.stubGlobal('puter', sdk);
});

afterEach(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const sent = url => requests.filter(request => request.url === url);

/** The signalling socket the module dials once its API calls are done. */
const signallerSocket = async () => {
    for ( let i = 0; i < 500 && FakeWebSocket.all.length === 0; i++ ) {
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    const [ws] = FakeWebSocket.all;
    ws.onopen();
    // The request goes out a turn after the socket opens.
    for ( let i = 0; i < 500 && ws.sent.length === 0; i++ ) {
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    return ws;
};

/** Serves through the module, with the signaller accepting the registration. */
const serve = async (options) => {
    const serving = peer.serve(options);
    const ws = await signallerSocket();
    ws.onmessage({ data: JSON.stringify({ server: { create: { success: true, invitecode: 'invite-1' } } }) });
    return { server: await serving, ws };
};

/** The ICE configuration of the connection a served client gets. */
const clientIceConfig = (ws) => {
    ws.onmessage({ data: JSON.stringify({ server: { connect: { id: 'c1', user: {} } } }) });
    return FakePeerConnection.instances.at(-1).config;
};

describe('puter.peer.serve', () => {
    it('registers with the signaller Puter names, on relays Puter issues', async () => {
        const { server, ws } = await serve({ port: 4 });
        expect(server).toBeInstanceOf(PuterPeerServer);
        expect(server.inviteCode).toBe('invite-1');
        expect(ws.url).toBe('ws://signaller.test/');
        expect(ws.sent).toEqual([{ server: { create: { authToken: 'session-token', port: 4 } } }]);
        expect(sent('/peer/generate-turn')[0]).toMatchObject({
            method: 'POST',
            headers: { authorization: 'Bearer session-token' },
        });
        expect(clientIceConfig(ws)).toEqual({ iceTransportPolicy: 'all', iceServers: TURN });
        expect(sdk.ui.authenticateWithPuter).not.toHaveBeenCalled();
    });

    it('uses the ICE servers it is given without asking for relays', async () => {
        const iceServers = [{ urls: 'turn:own.test' }];
        const { ws } = await serve({ iceServers, forceRelay: true });
        expect(sent('/peer/generate-turn')).toEqual([]);
        expect(clientIceConfig(ws)).toEqual({ iceTransportPolicy: 'relay', iceServers });
    });

    it('falls back to the default ICE servers when relays cannot be issued, and does not ask again', async () => {
        routes['/peer/generate-turn'] = { status: 500 };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { ws } = await serve();
        expect(clientIceConfig(ws).iceServers).toEqual(FALLBACK);
        expect(warn).toHaveBeenCalledWith('Unable to use TURN relays. Some connections may fail.');

        expect(await peer.ensureTurnRelays()).toBeUndefined();
        expect(sent('/peer/generate-turn')).toHaveLength(1);
    });

    it('fails when Puter cannot say where the signaller is', async () => {
        routes['/peer/signaller-info'] = { status: 500 };
        await expect(peer.serve()).rejects.toThrow('Failed to get signaller info from Puter.');
        expect(FakeWebSocket.all).toEqual([]);
    });
});

describe('puter.peer sign-in on a web page', () => {
    beforeEach(() => {
        sdk.env = 'web';
        sdk.authToken = null;
    });

    it('signs the user in before serving', async () => {
        sdk.ui.authenticateWithPuter.mockImplementation(async () => {
            sdk.authToken = 'fresh-token';
        });
        const { ws } = await serve();
        expect(sdk.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(ws.sent[0].server.create.authToken).toBe('fresh-token');
    });

    it.each([
        ['serve', () => peer.serve(), 'Need authentication to create a server but failed to authenticate with Puter.'],
        ['connect', () => peer.connect('invite-1'), 'Need authentication to connect to a server but failed to authenticate with Puter.'],
    ])('refuses to %s when the sign-in is declined', async (_name, act, message) => {
        sdk.ui.authenticateWithPuter.mockRejectedValue(new Error('declined'));
        await expect(act()).rejects.toThrow(message);
        expect(requests).toEqual([]);
    });

    it('serves a guest holding an anonymous token without a sign-in', async () => {
        const { ws } = await serve({ anonToken: 'anon-1', iceServers: [] });
        expect(sdk.ui.authenticateWithPuter).not.toHaveBeenCalled();
        expect(ws.sent[0].server.create).toEqual({ authToken: null, anonToken: 'anon-1' });
    });
});

describe('puter.peer.connect', () => {
    it('dials the signaller with the invite code and resolves the connection', async () => {
        const connecting = peer.connect('invite-1', { port: 4 });
        const ws = await signallerSocket();
        const conn = await connecting;

        expect(conn).toBeInstanceOf(PuterPeerConnection);
        expect(ws.url).toBe('ws://signaller.test/');
        expect(ws.sent).toEqual([
            { client: { connect: { authToken: 'session-token', invitecode: 'invite-1', port: 4 } } },
        ]);
        expect(FakePeerConnection.instances.at(-1).config).toEqual({ iceTransportPolicy: 'all', iceServers: TURN });
        conn.close();
    });
});

describe('puter.peer.createGuestGrant', () => {
    it('asks Puter for a grant as the signed-in user', async () => {
        routes['/peer/turn-grant'] = { body: { grant: 'grant-1', expiresAt: 1_900_000_000 } };
        expect(await peer.createGuestGrant()).toEqual({ grant: 'grant-1', expiresAt: 1_900_000_000 });
        expect(sent('/peer/turn-grant')[0]).toMatchObject({
            method: 'POST',
            headers: { authorization: 'Bearer session-token' },
        });
    });

    it('fails when Puter refuses the grant', async () => {
        routes['/peer/turn-grant'] = { status: 403, body: { message: 'Not allowed' } };
        await expect(peer.createGuestGrant()).rejects.toThrow('Failed to create a guest grant.');
    });

    it('lets a guest load relays with the grant', async () => {
        routes['/peer/guest-turn'] = { body: { iceServers: TURN, ttl: 600 } };
        expect(await peer.ensureTurnRelays({ turnGrant: 'grant-1' })).toEqual(TURN);
        expect(JSON.parse(sent('/peer/guest-turn')[0].body)).toEqual({ grant: 'grant-1' });
        expect(sent('/peer/guest-turn')[0].headers.authorization).toBeUndefined();

        // Cached for its lifetime.
        expect(await peer.ensureTurnRelays({ turnGrant: 'grant-1' })).toEqual(TURN);
        expect(sent('/peer/guest-turn')).toHaveLength(1);
    });
});
