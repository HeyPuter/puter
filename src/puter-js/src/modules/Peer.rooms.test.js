import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterPeerConnection, PuterPeerServer, isRoomName } from './Peer.js';

/*
 * Room names and the signaller-side plumbing around them: a server that
 * claims a name, dials on the room's own signaller connection, hands its
 * guest grant over, comes back after losing its socket, and stands down when
 * a newer server of its own took the name; a connection that dials a name
 * the same way and redeems the grant the server left.
 */

class FakeWebSocket {
    static instances = [];
    static get latest () {
        return FakeWebSocket.instances.at(-1) ?? null;
    }
    sent = [];
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    readyState = 1;
    closedBy = null;

    constructor (url) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    send (data) {
        this.sent.push(data);
    }

    close (code, reason) {
        this.readyState = 3;
        this.closedBy = { code, reason };
    }

    /** Messages sent so far, parsed. */
    get messages () {
        return this.sent.map((raw) => {
            try {
                return JSON.parse(raw);
            } catch {
                return raw;
            }
        });
    }

    async deliver (message) {
        await this.onmessage({ data: JSON.stringify(message) });
    }
}

class FakeRTCPeerConnection {
    static instances = [];
    constructor (config) {
        this.config = config;
        this.configurations = [];
        this.onicecandidate = null;
        FakeRTCPeerConnection.instances.push(this);
    }
    createDataChannel () {
        return { onmessage: null, onopen: null, onclose: null, onerror: null, close () {}, send () {} };
    }
    setConfiguration (config) {
        this.configurations.push(config);
    }
    async createOffer () {
        return { type: 'offer', sdp: 'v=0' };
    }
    async setLocalDescription () {}
    async setRemoteDescription () {}
    async addIceCandidate () {}
    close () {}
}

const origWebSocket = globalThis.WebSocket;
const origRTC = globalThis.RTCPeerConnection;

beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeRTCPeerConnection.instances = [];
    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakeRTCPeerConnection;
});

afterEach(() => {
    globalThis.WebSocket = origWebSocket;
    globalThis.RTCPeerConnection = origRTC;
    vi.useRealTimers();
});

const flush = async (n = 4) => {
    for ( let i = 0; i < n; i++ ) await Promise.resolve();
};

const SIGNALLER = 'wss://signaller.test/';

/** Open the latest fake socket and let the code under test install its handlers. */
const open = async () => {
    FakeWebSocket.latest.onopen();
    await flush();
    return FakeWebSocket.latest;
};

/** start() a server and answer its create; resolves to [server, ws]. */
const startServer = async (options = {}, reply = { success: true, invitecode: options.name ?? 'AB-123456' }) => {
    const server = new PuterPeerServer({ signallerUrl: SIGNALLER, authToken: 'token' });
    const started = server.start(options);
    const ws = await open();
    await ws.deliver({ server: { create: reply } });
    await started;
    return [server, ws];
};

describe('isRoomName', () => {
    it('accepts lowercase names of letters, digits and hyphens', () => {
        expect(isRoomName('abc-defg-hij')).toBe(true);
        expect(isRoomName('room1')).toBe(true);
        expect(isRoomName('a1-')).toBe(false);
        expect(isRoomName('-ab')).toBe(false);
        expect(isRoomName('ab')).toBe(false);
        expect(isRoomName('a'.repeat(65))).toBe(false);
        expect(isRoomName('Has-Caps')).toBe(false);
        expect(isRoomName('has space')).toBe(false);
        expect(isRoomName('')).toBe(false);
        expect(isRoomName(null)).toBe(false);
    });

    it('never mistakes a generated invite code for a name', () => {
        expect(isRoomName('NJ-7F3A9C')).toBe(false);
        expect(isRoomName('-7F3A9C')).toBe(false);
        // All-digit codes are the one shape both grammars admit; codes win.
        expect(isRoomName('1234-123456')).toBe(false);
    });
});

describe('PuterPeerServer with a room name', () => {
    it('dials the room connection, asks for the name, and takes it as the invite code', async () => {
        const [server, ws] = await startServer({ name: 'abc-defg-hij', guestGrant: 'pg1.grant', anonToken: 'u-1' });
        expect(new URL(ws.url).searchParams.get('room')).toBe('abc-defg-hij');
        const create = ws.messages[0].server.create;
        expect(create.name).toBe('abc-defg-hij');
        expect(create.grant).toBe('pg1.grant');
        expect(create.anonToken).toBe('u-1');
        expect(server.inviteCode).toBe('abc-defg-hij');
    });

    it('dials the plain connection for a generated code', async () => {
        const [server, ws] = await startServer();
        expect(new URL(ws.url).searchParams.has('room')).toBe(false);
        expect(ws.messages[0].server.create.name).toBeUndefined();
        expect(server.inviteCode).toBe('AB-123456');
    });

    it('rejects start() with the signaller’s code when the name is held', async () => {
        const server = new PuterPeerServer({ signallerUrl: SIGNALLER, authToken: 'token' });
        const started = server.start({ name: 'abc-defg-hij' });
        const ws = await open();
        await ws.deliver({ server: { create: { success: false, error: 'Name in use', code: 'name_in_use' } } });
        await expect(started).rejects.toMatchObject({ message: 'Name in use', code: 'name_in_use' });
        expect(ws.closedBy).not.toBeNull();
        // A registration that never succeeded has nothing to reconnect.
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('sends a renewed guest grant to the signaller', async () => {
        const [server, ws] = await startServer({ name: 'abc-defg-hij', guestGrant: 'pg1.one' });
        server.setGuestGrant('pg1.two');
        expect(ws.messages.at(-1)).toEqual({ server: { grant: { grant: 'pg1.two' } } });
        server.setGuestGrant(null);
        expect(ws.messages.at(-1)).toEqual({ server: { grant: { grant: null } } });
    });

    it('keeps the socket warm with pings', async () => {
        vi.useFakeTimers();
        const [, ws] = await startServer({ name: 'abc-defg-hij' });
        const before = ws.sent.length;
        vi.advanceTimersByTime(30_000);
        expect(ws.sent.slice(before)).toEqual(['{"ping":1}']);
        // The reply is not a protocol message; it must be ignored, not thrown on.
        await expect(ws.onmessage({ data: '{"pong":1}' })).resolves.toBeUndefined();
    });
});

describe('PuterPeerServer losing its signaller socket', () => {
    it('re-registers under the same name and says so', async () => {
        vi.useFakeTimers();
        const [server, ws] = await startServer({ name: 'abc-defg-hij', guestGrant: 'pg1.grant' });
        const events = [];
        server.addEventListener('reconnect', (e) => events.push(['reconnect', e.inviteCode]));
        server.addEventListener('close', (e) => events.push(['close', e.reason]));

        ws.onclose({ code: 1006 });
        expect(FakeWebSocket.instances).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        const ws2 = await open();
        expect(new URL(ws2.url).searchParams.get('room')).toBe('abc-defg-hij');
        const create = ws2.messages[0].server.create;
        expect(create.name).toBe('abc-defg-hij');
        expect(create.grant).toBe('pg1.grant');
        await ws2.deliver({ server: { create: { success: true, invitecode: 'abc-defg-hij' } } });
        await flush();
        expect(events).toEqual([['reconnect', 'abc-defg-hij']]);
        expect(server.inviteCode).toBe('abc-defg-hij');
    });

    it('carries the renewed grant, not the original, into the re-registration', async () => {
        vi.useFakeTimers();
        const [server, ws] = await startServer({ name: 'abc-defg-hij', guestGrant: 'pg1.one' });
        server.setGuestGrant('pg1.two');
        ws.onclose({ code: 1006 });
        await vi.advanceTimersByTimeAsync(1_000);
        const ws2 = await open();
        expect(ws2.messages[0].server.create.grant).toBe('pg1.two');
    });

    it('takes the new code a re-registration hands a codeless server', async () => {
        vi.useFakeTimers();
        const [server, ws] = await startServer();
        const codes = [];
        server.addEventListener('reconnect', (e) => codes.push(e.inviteCode));
        ws.onclose({ code: 1006 });
        await vi.advanceTimersByTimeAsync(1_000);
        const ws2 = await open();
        await ws2.deliver({ server: { create: { success: true, invitecode: 'AB-654321' } } });
        await flush();
        expect(codes).toEqual(['AB-654321']);
        expect(server.inviteCode).toBe('AB-654321');
    });

    it('backs off and keeps trying while the signaller is unreachable', async () => {
        vi.useFakeTimers();
        const [, ws] = await startServer({ name: 'abc-defg-hij' });
        ws.onclose({ code: 1006 });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        // The attempt fails outright: no reconnect for a while, then another.
        FakeWebSocket.latest.onclose({ code: 1006 });
        await flush();
        await vi.advanceTimersByTimeAsync(900);
        expect(FakeWebSocket.instances).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1_200);
        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('stands down without retrying when a newer server of ours took the name', async () => {
        vi.useFakeTimers();
        const [server, ws] = await startServer({ name: 'abc-defg-hij' });
        const events = [];
        server.addEventListener('close', (e) => events.push(e.reason));
        ws.onclose({ code: 4001, reason: 'Replaced by a newer server for this room' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(events).toEqual(['replaced']);
    });

    it('gives the name up after someone else keeps holding it', async () => {
        vi.useFakeTimers();
        const [server, ws] = await startServer({ name: 'abc-defg-hij' });
        const events = [];
        server.addEventListener('close', (e) => events.push(e.reason));
        ws.onclose({ code: 1006 });
        for ( let attempt = 0; attempt < 6; attempt++ ) {
            await vi.advanceTimersByTimeAsync(30_000);
            const next = await open();
            await next.deliver({ server: { create: { success: false, error: 'Name in use', code: 'name_in_use' } } });
            await flush();
        }
        expect(events).toEqual(['name_in_use']);
        const sockets = FakeWebSocket.instances.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.instances).toHaveLength(sockets);
    });

    it('does not reconnect after close()', async () => {
        vi.useFakeTimers();
        const [server, ws] = await startServer({ name: 'abc-defg-hij' });
        server.close();
        expect(ws.closedBy).not.toBeNull();
        ws.onclose?.({ code: 1000 });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});

describe('PuterPeerConnection dialling', () => {
    const config = (extra = {}) => ({
        signallerUrl: SIGNALLER,
        authToken: undefined,
        iceServers: [{ urls: 'stun:fallback' }],
        ...extra,
    });

    it('dials a room name on the room connection', async () => {
        const conn = new PuterPeerConnection(config());
        const connecting = conn.connect('abc-defg-hij', { anonToken: 'u-1' });
        const ws = await open();
        await connecting;
        expect(new URL(ws.url).searchParams.get('room')).toBe('abc-defg-hij');
        expect(ws.messages[0].client.connect).toMatchObject({ anonToken: 'u-1', invitecode: 'abc-defg-hij' });
    });

    it('dials an invite code on the plain connection', async () => {
        const conn = new PuterPeerConnection(config());
        const connecting = conn.connect('NJ-7F3A9C', { anonToken: 'u-1' });
        const ws = await open();
        await connecting;
        expect(new URL(ws.url).searchParams.has('room')).toBe(false);
    });

    it('redeems the grant the server left before making its offer', async () => {
        const relays = [{ urls: 'turn:relay.test', username: 'u', credential: 'c' }];
        const iceServersFor = vi.fn(async () => relays);
        const conn = new PuterPeerConnection(config({ iceServersFor }));
        const connecting = conn.connect('abc-defg-hij', { anonToken: 'u-1' });
        const ws = await open();
        await connecting;
        await ws.deliver({ client: { connect: { success: true, owner: { username: 'host', uuid: 'h' }, grant: 'pg1.grant', room: 'abc-defg-hij' } } });
        await flush(8);
        expect(iceServersFor).toHaveBeenCalledWith({ turnGrant: 'pg1.grant' });
        const pc = FakeRTCPeerConnection.instances.at(-1);
        expect(pc.configurations).toEqual([{ iceTransportPolicy: 'all', iceServers: relays }]);
        expect(ws.messages.at(-1).client.offer).toBeDefined();
        expect(conn.owner).toEqual({ username: 'host', uuid: 'h' });
        expect(conn.room).toBe('abc-defg-hij');
    });

    it('leaves relays alone for a guest that brought its own grant', async () => {
        const iceServersFor = vi.fn(async () => []);
        const conn = new PuterPeerConnection(config({ iceServersFor }));
        const connecting = conn.connect('abc-defg-hij', { anonToken: 'u-1', turnGrant: 'pg1.mine' });
        const ws = await open();
        await connecting;
        await ws.deliver({ client: { connect: { success: true, owner: {}, grant: 'pg1.theirs' } } });
        await flush(8);
        expect(iceServersFor).not.toHaveBeenCalled();
        expect(ws.messages.at(-1).client.offer).toBeDefined();
    });

    it('leaves relays alone for a signed-in caller, who has its own', async () => {
        const iceServersFor = vi.fn(async () => []);
        const conn = new PuterPeerConnection(config({ iceServersFor, authToken: 'token' }));
        const connecting = conn.connect('abc-defg-hij');
        const ws = await open();
        await connecting;
        await ws.deliver({ client: { connect: { success: true, owner: {}, grant: 'pg1.theirs' } } });
        await flush(8);
        expect(iceServersFor).not.toHaveBeenCalled();
    });

    it('still offers when the grant cannot be redeemed', async () => {
        const iceServersFor = vi.fn(async () => {
            throw new Error('relay service down');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const conn = new PuterPeerConnection(config({ iceServersFor }));
        const connecting = conn.connect('abc-defg-hij', { anonToken: 'u-1' });
        const ws = await open();
        await connecting;
        await ws.deliver({ client: { connect: { success: true, owner: {}, grant: 'pg1.grant' } } });
        await flush(8);
        expect(ws.messages.at(-1).client.offer).toBeDefined();
        warn.mockRestore();
    });

    it('surfaces the signaller’s refusal with its code', async () => {
        const conn = new PuterPeerConnection(config());
        const errors = [];
        const closes = [];
        conn.addEventListener('error', (e) => errors.push(e.error));
        conn.addEventListener('close', (e) => closes.push(e.reason));
        const connecting = conn.connect('abc-defg-hij', { anonToken: 'u-1' });
        const ws = await open();
        await connecting;
        await ws.deliver({ client: { connect: { success: false, error: 'No host', code: 'no_host' } } });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(Error);
        expect(errors[0].message).toBe('No host');
        expect(errors[0].code).toBe('no_host');
        expect(closes).toHaveLength(1);
        expect(conn.closed).toBe(true);
        // The signaller closes the socket after refusing; that must not fire a second close.
        ws.onclose?.({ code: 1000 });
        expect(closes).toHaveLength(1);
    });

    it('ignores keepalive replies on the way', async () => {
        const conn = new PuterPeerConnection(config());
        const connecting = conn.connect('abc-defg-hij', { anonToken: 'u-1' });
        const ws = await open();
        await connecting;
        await expect(ws.onmessage({ data: '{"pong":1}' })).resolves.toBeUndefined();
        await expect(ws.onmessage({ data: 'not json' })).resolves.toBeUndefined();
        expect(conn.closed).toBe(false);
    });
});
