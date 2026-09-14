import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PuterPeerServer } from './PuterPeerServer.js';
import { FakePeerConnection, flush } from './testFakes.js';

/**
 * Orphan offers (unknown connection id) used to call createAnswer on
 * undefined after the setRemoteDescription guard, producing an unhandled
 * rejection on the signalling websocket.
 */

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

beforeEach(() => {
    FakeWebSocket.latest = null;
    globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
    globalThis.WebSocket = origWebSocket;
});

const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

const startServer = async () => {
    const server = new PuterPeerServer({
        signallerUrl: 'ws://signaller.test/',
        authToken: 'token',
    });
    const started = server.start();
    // Resolve the open handshake, then let start() install onmessage.
    FakeWebSocket.latest.onopen();
    await flushMicrotasks();
    await FakeWebSocket.latest.onmessage({
        data: JSON.stringify({
            server: { create: { success: true, invitecode: 'invite-1' } },
        }),
    });
    await started;
    return server;
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

describe('PuterPeerServer connections', () => {
    const origRTCPeerConnection = globalThis.RTCPeerConnection;

    beforeEach(() => {
        FakePeerConnection.instances = [];
        globalThis.RTCPeerConnection = FakePeerConnection;
    });

    afterEach(() => {
        globalThis.RTCPeerConnection = origRTCPeerConnection;
    });

    const connectClient = async (server, id = 'conn-1') => {
        const ws = FakeWebSocket.latest;
        await ws.onmessage({
            data: JSON.stringify({
                server: { connect: { id, user: { username: 'bob', uuid: 'u1' } } },
            }),
        });
        await flush();
        return { ws, conn: server.connections.get(id) };
    };

    it('waits for the client to offer instead of offering first', async () => {
        const server = await startServer();
        const before = FakeWebSocket.latest.sent.length;

        const { ws } = await connectClient(server);

        // The serving side answers; offering here only collides with the
        // client's opening offer and costs a wasted round trip.
        expect(ws.sent.length).toBe(before);
    });

    it('answers an offer addressed to one of its connections', async () => {
        const server = await startServer();
        const { ws } = await connectClient(server);

        await ws.onmessage({
            data: JSON.stringify({
                server: {
                    offer: { id: 'conn-1', offer: { type: 'offer', sdp: 'client-sdp' } },
                },
            }),
        });
        await flush();

        const answer = ws.sent
            .map((s) => JSON.parse(s))
            .find((m) => m.server?.answer);
        expect(answer.server.answer.id).toBe('conn-1');
        expect(answer.server.answer.answer.type).toBe('answer');
    });

    it('tells a connection when its client\'s signalling session ends', async () => {
        const server = await startServer();
        const { ws, conn } = await connectClient(server);
        const closes = [];
        conn.addEventListener('close', (e) => closes.push(e.reason));

        await ws.onmessage({
            data: JSON.stringify({ server: { disconnect: { id: 'conn-1' } } }),
        });
        await flush();

        // Nothing was connected yet, so the disconnect settles it outright.
        expect(closes).toEqual(['the peer went away']);
        expect(server.connections.has('conn-1')).toBe(false);
    });

    it('keeps established connections when its own socket drops', async () => {
        const server = await startServer();
        const { ws, conn } = await connectClient(server);
        FakePeerConnection.instances.at(-1).channels[0].open();

        ws.onclose();
        await flush();

        expect(conn.closed).toBe(false);
        expect(server.signallingAlive).toBe(false);
    });

    it('ignores relayed payloads for connections it does not have', async () => {
        const server = await startServer();
        await connectClient(server);
        const ws = FakeWebSocket.latest;
        const before = ws.sent.length;

        await ws.onmessage({
            data: JSON.stringify({
                server: {
                    candidate: { id: 'nobody', candidate: { candidate: 'x' } },
                },
            }),
        });
        await flush();

        expect(ws.sent.length).toBe(before);
    });
});
