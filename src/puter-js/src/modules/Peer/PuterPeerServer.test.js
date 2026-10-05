import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterPeerServer } from './PuterPeerServer.js';
import { FakePeerConnection, flush } from './testFakes.js';

class FakeWebSocket {
    static latest = null;
    sent = [];
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

    constructor () {
        FakeWebSocket.latest = this;
    }

    send (data) {
        this.sent.push(data);
    }

    close () {}
}

const origWebSocket = globalThis.WebSocket;
const origRTCPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
    FakeWebSocket.latest = null;
    FakePeerConnection.instances = [];
    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;
});

afterEach(() => {
    globalThis.WebSocket = origWebSocket;
    globalThis.RTCPeerConnection = origRTCPeerConnection;
    vi.useRealTimers();
});

const startServer = async () => {
    const server = new PuterPeerServer({
        signallerUrl: 'ws://signaller.test/',
        authToken: 'token',
    });
    const started = server.start();
    // Resolve the open handshake, then let start() install onmessage.
    FakeWebSocket.latest.onopen();
    await flush();
    await FakeWebSocket.latest.onmessage({
        data: JSON.stringify({
            server: {
                create: { success: true, invitecode: 'invite-1', resumeToken: 'tok-1' },
            },
        }),
    });
    await started;
    return server;
};

/** The `create` request the most recent socket sent. */
const createRequest = (ws) =>
    JSON.parse(ws.sent.find((raw) => JSON.parse(raw).server?.create)).server.create;

/** Completes the open handshake, so the `create` request goes out. */
const openSocket = async (ws) => {
    ws.onopen();
    await flush();
};

/** Answers the registration in flight on `ws`. */
const answerCreate = async (ws, create) => {
    await ws.onmessage({ data: JSON.stringify({ server: { create } }) });
    await flush();
};

describe('PuterPeerServer orphan offers', () => {
    it('ignores offers for unknown connection ids without throwing', async () => {
        await startServer();
        const ws = FakeWebSocket.latest;
        const sentBefore = ws.sent.length;

        await expect(ws.onmessage({
            data: JSON.stringify({
                server: {
                    offer: {
                        id: 'missing-connection',
                        offer: { type: 'offer', sdp: 'v=0' },
                    },
                },
            }),
        })).resolves.toBeUndefined();

        expect(ws.sent.length).toBe(sentBefore);
    });
});

describe('PuterPeerServer reclaiming a dropped session', () => {
    it('presents its resume token and keeps the invite code it was reclaiming', async () => {
        vi.useFakeTimers();
        const server = await startServer();
        const reconnects = [];
        server.addEventListener('reconnect', (e) => reconnects.push([e.inviteCode, e.resumed]));

        FakeWebSocket.latest.onclose({});
        await vi.advanceTimersByTimeAsync(1_000);

        const second = FakeWebSocket.latest;
        await openSocket(second);
        expect(createRequest(second).resume).toBe('tok-1');

        await answerCreate(second, {
            success: true,
            invitecode: 'invite-1',
            resumeToken: 'tok-1',
            resumed: true,
        });

        expect(server.inviteCode).toBe('invite-1');
        expect(server.signallingAlive).toBe(true);
        expect(reconnects).toEqual([['invite-1', true]]);

        server.close();
        expect(second.sent.map((raw) => JSON.parse(raw))).toContainEqual({ server: { release: {} } });
        second.onclose?.({});
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.latest).toBe(second);
    });

    it('strands the connections a fresh registration left unroutable', async () => {
        // The signaller has no route to them any more, so a link that kept
        // trying would only wait out every timeout it has before dying.
        vi.useFakeTimers();
        const server = await startServer();
        const ws = FakeWebSocket.latest;
        await ws.onmessage({
            data: JSON.stringify({ server: { connect: { id: 'c1', user: {} } } }),
        });
        const conn = server.connections.get('c1');
        const pc = FakePeerConnection.instances.at(-1);
        // Up and carrying traffic: a link that never came up closes on the
        // socket alone, which is not what this is about.
        pc.channels[0].open();
        const closes = [];
        conn.addEventListener('close', (e) => closes.push(e.reason));

        ws.onclose({});
        await vi.advanceTimersByTimeAsync(1_000);
        await openSocket(FakeWebSocket.latest);
        await answerCreate(FakeWebSocket.latest, {
            success: true,
            invitecode: 'invite-2',
            resumeToken: 'tok-2',
            resumed: false,
        });

        pc.setConnectionState('failed');
        await flush();

        expect(pc.restarts).toBe(0);
        expect(conn.closed).toBe(true);
        expect(closes).toEqual(['the peer is no longer reachable']);
    });

    it('gives a server whose first registration failed up, rather than reconnecting it', async () => {
        // start() rejecting hands the caller no server to close, so nothing
        // of it may keep running.
        vi.useFakeTimers();
        const server = new PuterPeerServer({ signallerUrl: 'ws://signaller.test/', authToken: 'token' });
        const started = server.start();
        const first = FakeWebSocket.latest;
        await openSocket(first);
        first.onclose({});
        await expect(started).rejects.toThrow('Connection closed unexpectedly');

        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.latest).toBe(first);
        expect(server.signallingAlive).toBe(false);
    });
});

describe('a link already recovering when the session is lost', () => {
    it('gives up as soon as the reclaim fails, not when its budget runs out', async () => {
        // The order a network switch produces: ICE dies first, recovery is
        // already under way, and only then does the socket come back under
        // a session that cannot reach this client any more.
        vi.useFakeTimers();
        const server = await startServer();
        const ws = FakeWebSocket.latest;
        await ws.onmessage({
            data: JSON.stringify({ server: { connect: { id: 'c1', user: {} } } }),
        });
        const conn = server.connections.get('c1');
        const pc = FakePeerConnection.instances.at(-1);
        pc.channels[0].open();
        const closes = [];
        conn.addEventListener('close', (e) => closes.push(e.reason));

        // ICE goes first; recovery starts while the socket is still up.
        pc.setConnectionState('failed');
        await flush();

        // Then the socket dies and comes back without the session.
        ws.onclose({});
        await vi.advanceTimersByTimeAsync(1_000);
        await openSocket(FakeWebSocket.latest);
        await answerCreate(FakeWebSocket.latest, {
            success: true,
            invitecode: 'invite-2',
            resumeToken: 'tok-2',
            resumed: false,
        });
        await vi.advanceTimersByTimeAsync(1_000);

        expect(closes).toEqual(['the peer is no longer reachable']);
    });
});
