import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterPeerServer } from './PuterPeerServer.js';
import { FakePeerConnection, flush } from './testFakes.js';

class FakeWebSocket {
    static all = [];
    sent = [];
    closed = false;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

    constructor (url) {
        this.url = url;
        FakeWebSocket.all.push(this);
    }

    static get latest () {
        return FakeWebSocket.all.at(-1);
    }

    send (data) {
        this.sent.push(JSON.parse(data).server);
    }

    close () {
        this.closed = true;
    }

    /** The signaller says something to the server. */
    async say (server) {
        await this.onmessage({ data: JSON.stringify({ server }) });
        await flush();
    }
}

const origWebSocket = globalThis.WebSocket;
const origRTCPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
    FakeWebSocket.all = [];
    FakePeerConnection.instances = [];
    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;
    vi.useFakeTimers();
});

afterEach(() => {
    globalThis.WebSocket = origWebSocket;
    globalThis.RTCPeerConnection = origRTCPeerConnection;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const CREATED = { success: true, invitecode: 'invite-1', resumeToken: 'tok-1' };

/** A server whose socket is open and whose registration is away, unanswered. */
const registering = async (options) => {
    const server = new PuterPeerServer({ signallerUrl: 'ws://signaller.test/', authToken: 'token' });
    const started = server.start(options);
    const ws = FakeWebSocket.latest;
    ws.onopen();
    await flush();
    return { server, started, ws };
};

const startServer = async (options) => {
    const { server, started, ws } = await registering(options);
    await ws.say({ create: CREATED });
    await started;
    return { server, ws };
};

/** A client the signaller attaches, with its close reasons. */
const attachClient = async (server, ws, id) => {
    await ws.say({ connect: { id, user: { username: id } } });
    const conn = server.connections.get(id);
    const closes = [];
    conn.addEventListener('close', (e) => closes.push(e.reason));
    return { conn, closes, pc: FakePeerConnection.instances.at(-1) };
};

describe('PuterPeerServer registration', () => {
    it('registers with its credentials and resolves the invite code', async () => {
        const { server, started, ws } = await registering({ anonToken: 'anon-1', port: 9 });
        expect(ws.url).toBe('ws://signaller.test/');
        expect(ws.sent).toEqual([{ create: { authToken: 'token', anonToken: 'anon-1', port: 9 } }]);
        expect(server.signallingAlive).toBe(true);

        await ws.say({ create: CREATED });
        expect(await started).toBe('invite-1');
        expect(server.inviteCode).toBe('invite-1');
    });

    it('rejects and shuts down when the signaller refuses the registration', async () => {
        const { server, started, ws } = await registering();
        const refused = expect(started).rejects.toThrow('Not allowed to serve');
        await ws.say({ create: { success: false, error: 'Not allowed to serve' } });
        await refused;
        expect(ws.closed).toBe(true);
        expect(server.signallingAlive).toBe(false);
    });

    it('rejects when the signaller does not answer the registration in time', async () => {
        const { server, started, ws } = await registering();
        const timedOut = expect(started).rejects.toThrow('Server creation timed out');
        await vi.advanceTimersByTimeAsync(14_999);
        expect(ws.closed).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await timedOut;
        expect(ws.closed).toBe(true);
        expect(server.signallingAlive).toBe(false);
    });

    it('rejects a registration still in flight when the server is closed', async () => {
        const { server, started, ws } = await registering();
        const closed = expect(started).rejects.toThrow('The server was closed');
        server.close();
        await closed;
        expect(ws.closed).toBe(true);
    });

    it('rejects when the signaller cannot be reached', async () => {
        const server = new PuterPeerServer({ signallerUrl: 'ws://signaller.test/', authToken: 'token' });
        const unreachable = expect(server.start()).rejects.toThrow('Could not reach the signaller');
        FakeWebSocket.latest.onerror({});
        await unreachable;
        expect(FakeWebSocket.latest.sent).toEqual([]);
    });
});

describe('PuterPeerServer clients', () => {
    it('announces each client the signaller attaches, to listeners still subscribed', async () => {
        const { server, ws } = await startServer();
        const announced = [];
        const removed = vi.fn();
        server.addEventListener('connection', (e) => announced.push([e.conn, e.user]));
        server.addEventListener('connection', removed);
        server.removeEventListener('connection', removed);

        await ws.say({ connect: { id: 'c1', user: { username: 'alice' } } });
        expect(announced).toEqual([[server.connections.get('c1'), { username: 'alice' }]]);
        expect(removed).not.toHaveBeenCalled();
    });

    it.each([
        [true, 'the peer\'s signalling dropped'],
        [false, 'the peer went away'],
    ])('drops a client that leaves before connecting (resumable: %s)', async (resumable, reason) => {
        const { server, ws } = await startServer();
        const { conn, closes } = await attachClient(server, ws, 'c1');
        const other = await attachClient(server, ws, 'c2');

        await ws.say({ disconnect: { id: 'c1', resumable } });
        expect(conn.closed).toBe(true);
        expect(closes).toEqual([reason]);
        expect([...server.connections.keys()]).toEqual(['c2']);
        expect(other.conn.closed).toBe(false);
    });

    it('waits out a connected client whose signalling dropped, until the client is back', async () => {
        const { server, ws } = await startServer();
        const away = await attachClient(server, ws, 'c1');
        const back = await attachClient(server, ws, 'c2');
        for ( const { pc } of [away, back] ) {
            pc.channels[0].open();
            pc.setConnectionState('connected');
        }

        await ws.say({ disconnect: { id: 'c1', resumable: true } });
        await ws.say({ disconnect: { id: 'c2', resumable: true } });
        expect([away.conn.closed, back.conn.closed]).toEqual([false, false]);
        await ws.say({ reconnect: { id: 'c2' } });

        // The transport fails for both; only the client still away is given up on.
        away.pc.setConnectionState('failed');
        back.pc.setConnectionState('failed');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(away.closes).toEqual(['the peer is no longer reachable']);
        expect(back.conn.closed).toBe(false);
    });

    it('ignores messages it cannot read or that name no client', async () => {
        const { server, ws } = await startServer();
        const { conn } = await attachClient(server, ws, 'c1');
        await ws.onmessage({ data: 'not json' });
        await ws.onmessage({ data: JSON.stringify({ client: { bye: {} } }) });
        await ws.say({ disconnect: { id: 'nobody', resumable: false } });
        await ws.say({ reconnect: { id: 'nobody' } });
        expect(conn.closed).toBe(false);
        expect([...server.connections.keys()]).toEqual(['c1']);
    });

    it('gives the invite code up and closes every client when closed', async () => {
        const { server, ws } = await startServer();
        const { conn } = await attachClient(server, ws, 'c1');
        server.close();
        expect(ws.sent.slice(-2)).toEqual([{ release: {} }, { bye: { id: 'c1' } }]);
        expect(ws.closed).toBe(true);
        expect(conn.closed).toBe(true);
        expect(server.connections.size).toBe(0);
        expect(server.signallingAlive).toBe(false);
    });
});

describe('PuterPeerServer relay', () => {
    it('says whether an envelope left', async () => {
        const { server, ws } = await startServer();
        expect(server.relay({ bye: { id: 'c1' } })).toBe(true);
        expect(ws.sent.at(-1)).toEqual({ bye: { id: 'c1' } });

        // The socket closed underneath a send.
        ws.send = () => {
            throw new Error('socket is closing');
        };
        expect(server.relay({ bye: { id: 'c1' } })).toBe(false);

        ws.onclose({});
        expect(server.signallingAlive).toBe(false);
        expect(server.relay({ bye: { id: 'c1' } })).toBe(false);
    });
});

describe('PuterPeerServer re-registering', () => {
    it('keeps redialling while the signaller is unreachable or refuses, then reports being back', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const { server, ws } = await startServer();
        const reconnects = [];
        server.addEventListener('reconnect', (e) => reconnects.push([e.inviteCode, e.resumed, e.refused]));
        ws.onclose({});

        // Unreachable.
        await vi.advanceTimersByTimeAsync(250);
        const second = FakeWebSocket.latest;
        expect(second).not.toBe(ws);
        second.onerror({});

        // Reachable, but the registration is refused.
        await vi.advanceTimersByTimeAsync(500);
        const third = FakeWebSocket.latest;
        expect(third).not.toBe(second);
        third.onopen();
        await flush();
        expect(third.sent).toEqual([{ create: { authToken: 'token', resume: 'tok-1' } }]);
        await third.say({ create: { success: false, error: 'Try again later' } });
        expect(third.closed).toBe(true);
        expect(server.signallingAlive).toBe(false);
        expect(reconnects).toEqual([]);

        await vi.advanceTimersByTimeAsync(1000);
        const fourth = FakeWebSocket.latest;
        expect(fourth).not.toBe(third);
        fourth.onopen();
        await flush();
        await fourth.say({ create: { ...CREATED, resumed: true } });
        expect(server.signallingAlive).toBe(true);
        expect(reconnects).toEqual([['invite-1', true, undefined]]);
    });

    it('stops redialling once closed', async () => {
        const { server, ws } = await startServer();
        ws.onclose({});
        server.close();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.all).toHaveLength(1);
    });
});
