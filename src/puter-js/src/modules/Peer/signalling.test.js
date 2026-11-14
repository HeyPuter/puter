import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSignallingChannel, ServerSignallingChannel } from './signalling.js';

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
        this.sent.push(JSON.parse(data));
    }

    close () {
        this.closed = true;
    }

    /** The signaller says something. */
    reply (client) {
        this.onmessage({ data: JSON.stringify({ client }) });
    }
}

const origWebSocket = globalThis.WebSocket;
beforeEach(() => {
    FakeWebSocket.all = [];
    globalThis.WebSocket = FakeWebSocket;
    vi.useFakeTimers();
});
afterEach(() => {
    globalThis.WebSocket = origWebSocket;
    vi.useRealTimers();
});

/** A channel through its handshake: attached, holding a resume token. */
const attached = async () => {
    const channel = new ClientSignallingChannel({ signallerUrl: 'wss://signaller.test/', authToken: 'tok' });
    const events = [];
    channel.onattached = () => events.push('attached');
    channel.onusable = () => events.push('usable');
    channel.onunusable = () => events.push('unusable');
    const opening = channel.open('INV-1', { anonToken: 'anon-1' });
    FakeWebSocket.latest.onopen();
    await opening;
    FakeWebSocket.latest.reply({ connect: { success: true, owner: { username: 'h', uuid: 'h' }, resumeToken: 'rt-1' } });
    return { channel, events, first: FakeWebSocket.latest };
};

describe('ClientSignallingChannel reclaiming its session', () => {
    it('dials again with its resume token when the socket drops, and is usable once back', async () => {
        const { channel, events, first } = await attached();
        expect(channel.alive).toBe(true);

        first.onclose({});
        expect(channel.alive).toBe(false);
        expect(events).toEqual(['attached', 'unusable']);

        await vi.advanceTimersByTimeAsync(1000);
        const second = FakeWebSocket.latest;
        expect(second).not.toBe(first);
        // In the URL as well: the signaller fixes a socket's address on accept.
        expect(new URL(second.url).searchParams.get('resume')).toBe('rt-1');
        second.onopen();
        await vi.advanceTimersByTimeAsync(0);
        expect(second.sent).toEqual([
            { client: { connect: { authToken: 'tok', anonToken: 'anon-1', invitecode: 'INV-1', resume: 'rt-1' } } },
        ]);

        second.reply({ connect: { success: true, owner: { username: 'h', uuid: 'h' }, resumeToken: 'rt-1', resumed: true } });
        expect(channel.alive).toBe(true);
        expect(events).toEqual(['attached', 'unusable', 'usable']);
        // Signals go out on the new socket.
        expect(channel.sendCandidate({ candidate: 'c' })).toBe(true);
        expect(second.sent.at(-1)).toEqual({ client: { candidate: { candidate: { candidate: 'c' } } } });
    });

    it('strands itself when the reclaim is turned down, and stops dialing', async () => {
        const { channel, events, first } = await attached();
        first.onclose({});
        await vi.advanceTimersByTimeAsync(1000);
        FakeWebSocket.latest.onopen();
        await vi.advanceTimersByTimeAsync(0);
        FakeWebSocket.latest.reply({ connect: { success: false, error: 'Could not resume the session', resumeRefused: 'no_server' } });

        expect(channel.stranded).toBe(true);
        expect(channel.alive).toBe(false);
        expect(events.at(-1)).toBe('unusable');
        const count = FakeWebSocket.all.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.all.length).toBe(count);
    });

    it('gives the session up when closed on purpose, and does not come back', async () => {
        const { channel, first } = await attached();
        channel.close();
        expect(first.sent.at(-1)).toEqual({ client: { release: {} } });
        expect(first.closed).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.all).toHaveLength(1);
    });
});

/** A channel whose socket is open and whose connect request is away, unanswered. */
const dialled = async () => {
    const channel = new ClientSignallingChannel({ signallerUrl: 'wss://signaller.test/', authToken: 'tok' });
    const opening = channel.open('INV-1', { port: 7 });
    const socket = FakeWebSocket.latest;
    socket.onopen();
    await opening;
    return { channel, socket };
};

/** Records every handler call on `channel` as [name, ...args]. */
const recordSignals = (channel) => {
    const heard = [];
    for ( const name of ['onoffer', 'onanswer', 'oncandidate', 'onbye', 'onpeergone', 'onpeerback'] ) {
        channel[name] = (...args) => heard.push([name, ...args]);
    }
    return heard;
};

describe('ClientSignallingChannel handshake', () => {
    it('sends the connect request once the socket opens', async () => {
        const { channel, socket } = await dialled();
        expect(socket.url).toBe('wss://signaller.test/');
        expect(socket.sent).toEqual([
            { client: { connect: { authToken: 'tok', invitecode: 'INV-1', port: 7 } } },
        ]);
        expect(channel.alive).toBe(false);
    });

    it('reports the peer server\'s owner once the signaller accepts', async () => {
        const { channel, socket } = await dialled();
        const owners = [];
        channel.onattached = owner => owners.push(owner);
        socket.reply({ connect: { success: true, owner: { username: 'host', uuid: 'u-1' } } });
        expect(owners).toEqual([{ username: 'host', uuid: 'u-1' }]);
        expect(channel.alive).toBe(true);
    });

    it('reports a refused connect, and has no session to come back to', async () => {
        const { channel, socket } = await dialled();
        const rejections = [];
        channel.onrejected = error => rejections.push(error.message);
        socket.reply({ connect: { success: false, error: 'Invite code not found' } });
        expect(rejections).toEqual(['Invite code not found']);
        expect(channel.alive).toBe(false);
        expect(channel.stranded).toBe(false);

        socket.onclose({});
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.all).toHaveLength(1);
    });

    it.each([
        ['an error', 'onerror', 'Could not reach the signalling server'],
        ['a close', 'onclose', 'Connection closed unexpectedly'],
    ])('fails to open when the socket ends in %s before opening', async (_name, handler, message) => {
        const channel = new ClientSignallingChannel({ signallerUrl: 'wss://signaller.test/', authToken: 'tok' });
        const opening = expect(channel.open('INV-1')).rejects.toThrow(message);
        FakeWebSocket.latest[handler]({});
        await opening;
        expect(FakeWebSocket.latest.sent).toEqual([]);
    });
});

describe('ClientSignallingChannel relaying', () => {
    const offer = { type: 'offer', sdp: 'offer-sdp' };
    const answer = { type: 'answer', sdp: 'answer-sdp' };

    it('hands each relayed signal to its handler', async () => {
        const { channel, first } = await attached();
        const heard = recordSignals(channel);
        first.reply({ offer: { offer, names: { camera: '0' }, gen: 3 } });
        first.reply({ answer: { answer, names: {}, re: 3 } });
        first.reply({ candidate: { candidate: { candidate: 'candidate:1' } } });
        first.reply({ bye: { reason: 'done for today' } });
        first.reply({ reconnect: {} });
        first.reply({ disconnect: { reason: 'socket dropped', resumable: true } });
        first.reply({ disconnect: { reason: 'left' } });

        expect(heard).toEqual([
            ['onoffer', offer, { camera: '0' }, 3],
            ['onanswer', answer, {}, 3],
            ['oncandidate', { candidate: 'candidate:1' }],
            ['onbye', 'done for today'],
            ['onpeerback'],
            ['onpeergone', 'socket dropped', true],
            ['onpeergone', 'left', false],
        ]);
    });

    it('drops an offer number that is not one, and an end-of-candidates marker', async () => {
        const { channel, first } = await attached();
        const heard = recordSignals(channel);
        first.reply({ offer: { offer, gen: -1 } });
        first.reply({ answer: { answer, re: '3' } });
        first.reply({ candidate: { candidate: null } });
        expect(heard).toEqual([
            ['onoffer', offer, undefined, undefined],
            ['onanswer', answer, undefined, undefined],
        ]);
    });

    it('ignores what it cannot read, and anything from a socket it has replaced', async () => {
        const { channel, first } = await attached();
        const heard = recordSignals(channel);
        first.onmessage({ data: 'not json' });
        first.onmessage({ data: JSON.stringify({ server: { bye: {} } }) });
        first.reply({});

        first.onclose({});
        await vi.advanceTimersByTimeAsync(1000);
        first.reply({ bye: { reason: 'late' } });
        expect(heard).toEqual([]);
    });

    it('sends each signal in the client envelope, and says whether it left', async () => {
        const { channel, first } = await attached();
        first.sent.length = 0;
        expect(channel.sendOffer(offer, { camera: '0' }, 2)).toBe(true);
        expect(channel.sendAnswer(answer, {}, 2)).toBe(true);
        expect(channel.sendBye('done for today')).toBe(true);
        expect(first.sent).toEqual([
            { client: { offer: { offer, names: { camera: '0' }, gen: 2 } } },
            { client: { answer: { answer, names: {}, re: 2 } } },
            { client: { bye: { reason: 'done for today' } } },
        ]);

        // The socket closed underneath a send.
        first.send = () => {
            throw new Error('socket is closing');
        };
        expect(channel.sendBye('again')).toBe(false);
    });

    it('sends nothing before the signaller has accepted the connect', async () => {
        const { channel, socket } = await dialled();
        expect(channel.sendOffer(offer)).toBe(false);
        expect(socket.sent).toHaveLength(1);
    });
});

describe('ClientSignallingChannel redialling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('backs off between attempts while the signaller stays unreachable', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const { first } = await attached();
        first.onclose({});

        // With no jitter each wait is half the backoff, which doubles up to 4s.
        const waits = [];
        for ( let attempt = 0; attempt < 5; attempt++ ) {
            const before = FakeWebSocket.all.length;
            let waited = 0;
            while ( FakeWebSocket.all.length === before ) {
                await vi.advanceTimersByTimeAsync(250);
                waited += 250;
            }
            waits.push(waited);
            FakeWebSocket.latest.onerror({});
        }
        expect(waits).toEqual([250, 500, 1000, 2000, 2000]);
    });

    it('does not reclaim the session when closed while a redial is opening', async () => {
        const { channel, first } = await attached();
        first.onclose({});
        await vi.advanceTimersByTimeAsync(1000);
        const second = FakeWebSocket.latest;

        channel.close();
        second.onopen();
        await vi.advanceTimersByTimeAsync(0);
        expect(second.sent).toEqual([]);
        expect(second.closed).toBe(true);
    });
});

describe('ServerSignallingChannel', () => {
    const offer = { type: 'offer', sdp: 'offer-sdp' };
    const answer = { type: 'answer', sdp: 'answer-sdp' };
    /** The peer server whose socket the channel borrows. */
    const fakeServer = () => ({ signallingAlive: true, relayed: [], relay (payload) {
        this.relayed.push(payload);
        return true;
    } });

    it('tags every signal with its connection id and sends it through the server', () => {
        const server = fakeServer();
        const channel = new ServerSignallingChannel(server, 'conn-1');
        expect(channel.sendOffer(offer, { camera: '0' }, 4)).toBe(true);
        expect(channel.sendAnswer(answer, {}, 4)).toBe(true);
        expect(channel.sendCandidate({ candidate: 'candidate:1' })).toBe(true);
        expect(channel.sendBye('closing')).toBe(true);
        expect(server.relayed).toEqual([
            { offer: { offer, names: { camera: '0' }, gen: 4, id: 'conn-1' } },
            { answer: { answer, names: {}, re: 4, id: 'conn-1' } },
            { candidate: { candidate: { candidate: 'candidate:1' }, id: 'conn-1' } },
            { bye: { reason: 'closing', id: 'conn-1' } },
        ]);
    });

    it('sends nothing while the server\'s socket is down', () => {
        const server = fakeServer();
        const channel = new ServerSignallingChannel(server, 'conn-1');
        server.signallingAlive = false;
        expect(channel.alive).toBe(false);
        expect(channel.sendOffer(offer)).toBe(false);
        expect(server.relayed).toEqual([]);
    });

    it('is unusable for good once stranded, and says so once', () => {
        const server = fakeServer();
        const channel = new ServerSignallingChannel(server, 'conn-1');
        const unusable = vi.fn();
        channel.onunusable = unusable;
        channel.strand();
        channel.strand();
        expect(unusable).toHaveBeenCalledTimes(1);
        expect(channel.stranded).toBe(true);
        expect(channel.alive).toBe(false);
        expect(channel.sendBye('closing')).toBe(false);
        expect(server.relayed).toEqual([]);
    });
});
