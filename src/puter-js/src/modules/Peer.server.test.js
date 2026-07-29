import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PuterPeerServer } from './Peer.js';

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
