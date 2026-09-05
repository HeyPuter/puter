import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One fake connection per `io()` call, so the tests can drive the socket
// lifecycle the server would otherwise drive: acks, drops, reconnects.
const sockets = [];

class FakeSocket {
    constructor (url, options) {
        this.url = url;
        this.options = options;
        this.handlers = new Map();
        this.sent = [];
        this.connected = true;
        this.active = true;
        this.disconnected = false;
        sockets.push(this);
    }

    on (name, handler) {
        const existing = this.handlers.get(name) ?? [];
        existing.push(handler);
        this.handlers.set(name, existing);
        return this;
    }

    fire (name, ...args) {
        for ( const handler of [...(this.handlers.get(name) ?? [])] ) handler(...args);
    }

    emit (verb, payload, ack) {
        this.sent.push({ verb, payload, ack });
        return this;
    }

    /** Answer the most recent send of `verb`. */
    answer (verb, response) {
        const call = [...this.sent].reverse().find(sent => sent.verb === verb);
        if ( ! call ) throw new Error(`nothing was sent for ${verb}`);
        call.ack(response);
    }

    removeAllListeners () {
        this.handlers.clear();
        return this;
    }

    disconnect () {
        this.disconnected = true;
        this.connected = false;
        return this;
    }
}

vi.mock('socket.io-client', () => ({
    io: (url, options) => new FakeSocket(url, options),
}));

const { EventsModule } = await import('./index.js');

const okSub = (subId, subject) => ({
    ok: true,
    sub: {
        subId,
        subject,
        anchor: { uid: 'anchor-uid', path: '/user/Documents' },
        match: null,
        op: null,
    },
});

const projected = (subId, path) => ({
    subId,
    event: {
        id: `evt-${path}`,
        subject: 'fs:anchor-uid:add',
        op: 'add',
        uid: 'node-uid',
        path,
        self: true,
        ts: 1,
        seq: 0,
    },
});

let authStateListeners = [];

const makeModule = () => {
    const puter = {
        env: 'web',
        authToken: 'token-1',
        APIOrigin: 'https://api.test',
        onAuthStateChanged: listener => authStateListeners.push(listener),
    };
    return new EventsModule(puter);
};

/** Subscribe and answer the ack the server would send. */
const subscribed = async (events, subject, handler, options, subId = 'sub-1') => {
    const pending = events.onLocal(subject, handler, options);
    await Promise.resolve();
    sockets.at(-1).answer('events.subscribe', okSub(subId, subject));
    return await pending;
};

beforeEach(() => {
    sockets.length = 0;
    authStateListeners = [];
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('connection lifetime', () => {
    it('does not connect until something subscribes', async () => {
        const events = makeModule();
        expect(sockets).toHaveLength(0);

        await subscribed(events, 'fs:~/Documents', () => {});
        expect(sockets).toHaveLength(1);
        expect(sockets[0].url).toBe('https://api.test');
        expect(sockets[0].options.auth).toEqual({ auth_token: 'token-1' });
    });

    it('carries several subscriptions on one socket, and closes with the last', async () => {
        const events = makeModule();
        const first = await subscribed(events, 'fs:~/a', () => {}, {}, 'sub-a');
        const second = await subscribed(events, 'fs:~/b', () => {}, {}, 'sub-b');

        expect(sockets).toHaveLength(1);

        const firstOff = first.off();
        sockets[0].answer('events.unsubscribe', { ok: true });
        await firstOff;
        expect(sockets[0].disconnected).toBe(false);

        const secondOff = second.off();
        sockets[0].answer('events.unsubscribe', { ok: true });
        await secondOff;
        expect(sockets[0].disconnected).toBe(true);
    });

    it('leaves no connection behind when the first subscribe fails', async () => {
        const events = makeModule();
        const pending = events.onLocal('fs:~/nope', () => {});
        await Promise.resolve();
        sockets.at(-1).answer('events.subscribe', {
            ok: false,
            error: { code: 'subject_does_not_exist', message: 'No such entry' },
        });

        await expect(pending).rejects.toMatchObject({
            code: 'subject_does_not_exist',
            message: 'No such entry',
        });
        expect(sockets[0].disconnected).toBe(true);
    });
});

describe('delivery routing', () => {
    it('routes an event to the subscription it names', async () => {
        const events = makeModule();
        const mine = [];
        const theirs = [];
        await subscribed(events, 'fs:~/a', ({ event }) => mine.push(event), {}, 'sub-a');
        await subscribed(events, 'fs:~/b', ({ event }) => theirs.push(event), {}, 'sub-b');

        sockets[0].fire('events.delivery', projected('sub-a', '/user/a/one.txt'));

        expect(mine).toHaveLength(1);
        expect(mine[0].path).toBe('/user/a/one.txt');
        expect(theirs).toEqual([]);
    });

    it('ignores an event for a subscription that was already ended', async () => {
        const events = makeModule();
        const seen = [];
        const sub = await subscribed(events, 'fs:~/a', ({ event }) => seen.push(event));

        const off = sub.off();
        sockets[0].answer('events.unsubscribe', { ok: true });
        await off;

        sockets[0].fire('events.delivery', projected('sub-1', '/user/a/late.txt'));
        expect(seen).toEqual([]);
    });

    it('keeps delivering after a handler throws', async () => {
        const events = makeModule();
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        let calls = 0;
        await subscribed(events, 'fs:~/a', () => {
            calls++;
            throw new Error('handler bug');
        });

        sockets[0].fire('events.delivery', projected('sub-1', '/user/a/one.txt'));
        sockets[0].fire('events.delivery', projected('sub-1', '/user/a/two.txt'));

        expect(calls).toBe(2);
        expect(errors).toHaveBeenCalled();
    });
});

describe('reconnect', () => {
    it('re-subscribes on reconnect and keeps the same handle', async () => {
        const events = makeModule();
        const seen = [];
        const sub = await subscribed(events, 'fs:~/a', ({ event }) => seen.push(event));

        sockets[0].fire('disconnect');
        expect(sub.subId).toBe(null);

        sockets[0].fire('connect');
        sockets[0].answer('events.subscribe', okSub('sub-2', 'fs:~/a'));
        await Promise.resolve();

        expect(sub.subId).toBe('sub-2');
        sockets[0].fire('events.delivery', projected('sub-2', '/user/a/after.txt'));
        expect(seen).toHaveLength(1);
    });

    it('ends the subscription and reports it when re-subscribing fails', async () => {
        const events = makeModule();
        const lapses = [];
        const seen = [];
        const sub = await subscribed(
            events,
            'fs:~/a',
            ({ event }) => seen.push(event),
            { onError: error => lapses.push(error) },
        );

        sockets[0].fire('disconnect');
        sockets[0].fire('connect');
        sockets[0].answer('events.subscribe', {
            ok: false,
            error: { code: 'subject_does_not_exist', message: 'gone' },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(lapses).toHaveLength(1);
        expect(lapses[0].code).toBe('subject_does_not_exist');
        expect(sub.subId).toBe(null);
        // Nothing routes to a lapsed subscription.
        sockets[0].fire('events.delivery', projected('sub-1', '/user/a/x.txt'));
        expect(seen).toEqual([]);
    });

    it('keeps the subscription when the connection dies mid-resubscribe', async () => {
        const events = makeModule();
        const lapses = [];
        const sub = await subscribed(events, 'fs:~/a', () => {}, {
            onError: error => lapses.push(error),
        });

        sockets[0].fire('disconnect');
        sockets[0].fire('connect');
        // The re-subscribe is in flight when the connection drops again.
        sockets[0].fire('disconnect');
        await Promise.resolve();
        await Promise.resolve();

        expect(lapses).toEqual([]);
        expect(sub.subId).toBe(null);

        sockets[0].fire('connect');
        sockets[0].answer('events.subscribe', okSub('sub-3', 'fs:~/a'));
        await Promise.resolve();
        expect(sub.subId).toBe('sub-3');
    });

    it('rebuilds the connection when auth state changes', async () => {
        const events = makeModule();
        await subscribed(events, 'fs:~/a', () => {});

        events.puter.authToken = 'token-2';
        for ( const listener of authStateListeners ) listener();

        expect(sockets).toHaveLength(2);
        expect(sockets[0].disconnected).toBe(true);
        expect(sockets[1].options.auth).toEqual({ auth_token: 'token-2' });
    });

    it('off() after the connection dropped resolves without asking the server', async () => {
        const events = makeModule();
        const sub = await subscribed(events, 'fs:~/a', () => {});

        sockets[0].fire('disconnect');
        sockets[0].connected = false;

        await expect(sub.off()).resolves.toBeUndefined();
        expect(sockets[0].sent.filter(s => s.verb === 'events.unsubscribe')).toHaveLength(0);
    });

    it('drops a subscription off()\'d mid-resubscribe, without misrouting its id to the survivor', async () => {
        const events = makeModule();
        const survivorSeen = [];
        const droppedSeen = [];

        const survivor = await subscribed(events, 'fs:~/a', ({ event }) => survivorSeen.push(event), {}, 'sub-a');
        const dropped = await subscribed(events, 'fs:~/b', ({ event }) => droppedSeen.push(event), {}, 'sub-b');

        sockets[0].fire('disconnect');
        sockets[0].fire('connect');
        // Both resubscribes are in flight now, oldest first — grab each send
        // directly, since `answer()` only ever reaches the most recent one.
        const [survivorResend, droppedResend] = sockets[0].sent
            .filter(s => s.verb === 'events.subscribe')
            .slice(-2);

        // End `dropped` before its resubscribe ack comes back.
        const off = dropped.off();
        // The server had already minted a new id for it by the time the ack
        // arrives — nothing points at it any more.
        droppedResend.ack(okSub('sub-b2', 'fs:~/b'));
        await off;
        await Promise.resolve();
        await Promise.resolve();

        // The orphaned id is handed straight back to the server...
        expect(
            sockets[0].sent.filter(s => s.verb === 'events.unsubscribe' && s.payload.subId === 'sub-b2'),
        ).toHaveLength(1);

        // ...and the survivor's own remap is unaffected.
        survivorResend.ack(okSub('sub-a2', 'fs:~/a'));
        await Promise.resolve();
        expect(survivor.subId).toBe('sub-a2');

        // A stray delivery on the dropped id must be dropped, not misrouted
        // to whichever handler happens to be listening.
        sockets[0].fire('events.delivery', projected('sub-b2', '/user/b/late.txt'));
        sockets[0].fire('events.delivery', projected('sub-a2', '/user/a/one.txt'));

        expect(droppedSeen).toEqual([]);
        expect(survivorSeen).toHaveLength(1);
        expect(survivorSeen[0].path).toBe('/user/a/one.txt');
    });

    it('ends every subscription when the server closes the connection', async () => {
        const events = makeModule();
        const lapses = [];
        const sub = await subscribed(events, 'fs:~/a', () => {}, {
            onError: error => lapses.push(error),
        });

        // A server-side disconnect is final: socket.io will not reconnect it.
        sockets[0].active = false;
        sockets[0].fire('disconnect', 'io server disconnect');

        expect(lapses).toHaveLength(1);
        expect(lapses[0].code).toBe('events_connection_failed');
        expect(sub.subId).toBe(null);
        expect(sockets[0].disconnected).toBe(true);

        // The next subscribe starts over on a fresh connection.
        await subscribed(events, 'fs:~/b', () => {}, {}, 'sub-2');
        expect(sockets).toHaveLength(2);
    });

    it('closes the connection when the last subscription lapses', async () => {
        const events = makeModule();
        await subscribed(events, 'fs:~/a', () => {}, { onError: () => {} });

        sockets[0].fire('disconnect');
        sockets[0].fire('connect');
        sockets[0].answer('events.subscribe', {
            ok: false,
            error: { code: 'subject_does_not_exist', message: 'gone' },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(sockets[0].disconnected).toBe(true);
        expect(events.channel.socket).toBe(null);
    });

    it('retries a re-subscribe that was turned away for rate limiting', async () => {
        vi.useFakeTimers();
        try {
            const events = makeModule();
            const lapses = [];
            const sub = await subscribed(events, 'fs:~/a', () => {}, {
                onError: error => lapses.push(error),
            });

            sockets[0].fire('disconnect');
            sockets[0].fire('connect');
            sockets[0].answer('events.subscribe', {
                ok: false,
                error: { code: 'too_many_requests', message: 'slow down' },
            });
            await Promise.resolve();
            await Promise.resolve();

            expect(lapses).toEqual([]);
            expect(sub.subId).toBe(null);
            const sent = () => sockets[0].sent.filter(s => s.verb === 'events.subscribe').length;
            const before = sent();

            await vi.advanceTimersByTimeAsync(10000);
            expect(sent()).toBe(before + 1);
            sockets[0].answer('events.subscribe', okSub('sub-2', 'fs:~/a'));
            await Promise.resolve();
            expect(sub.subId).toBe('sub-2');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('persistent delivery routing', () => {
    /** One durable envelope, as the server addresses it at a room. */
    const durable = (subId, path, over = {}) => ({
        ...projected(subId, path),
        ...over,
    });

    it('runs the handler on a delivery the server sends here', async () => {
        const events = makeModule();
        const seen = [];
        events.channel.registerDurable(
            'app-1#sub',
            delivery => seen.push(delivery),
            { label: 'ingest' },
        );

        sockets[0].fire('events.delivery', durable('app-1#sub', '/user/a/one.txt'));

        expect(seen).toHaveLength(1);
        expect(seen[0].event.path).toBe('/user/a/one.txt');
        expect(seen[0].ctx).toEqual({ label: 'ingest' });
        expect(Object.isFrozen(seen[0].ctx)).toBe(true);
        // A broadcast has no `ack`, but still runs with the worker's `user`
        // and `fetch` — the same environment every consumer gets.
        expect(seen[0].user).toBe(events.puter);
        expect(typeof seen[0].fetch).toBe('function');
        expect(seen[0].ack).toBeUndefined();
        // Nothing to acknowledge: everyone connected gets a copy of this one.
        expect(sockets[0].sent.filter(s => s.verb === 'events.ack')).toEqual([]);
    });

    it('hands a delivery owed to one consumer the environment its worker gets', async () => {
        const events = makeModule();
        let handed;
        events.channel.registerDurable('app-1#sub', delivery => {
            handed = delivery;
            return delivery.ack();
        });

        sockets[0].fire(
            'events.delivery',
            durable('app-1#sub', '/user/a/one.txt', {
                ackRequired: true,
                ackId: 'entry-1',
            }),
        );
        await Promise.resolve();

        expect(handed.user).toBe(events.puter);
        expect(typeof handed.fetch).toBe('function');
        expect(sockets[0].sent.filter(s => s.verb === 'events.ack')).toMatchObject([
            { payload: { subId: 'app-1#sub', id: 'entry-1' } },
        ]);
    });

    it('acknowledges a handler that returns without doing so itself', async () => {
        const events = makeModule();
        events.channel.registerDurable('app-1#sub', async () => 'done');

        sockets[0].fire(
            'events.delivery',
            durable('app-1#sub', '/user/a/one.txt', {
                ackRequired: true,
                ackId: 'entry-2',
            }),
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(sockets[0].sent.filter(s => s.verb === 'events.ack')).toMatchObject([
            { payload: { subId: 'app-1#sub', id: 'entry-2' } },
        ]);
    });

    it('acknowledges nothing when the handler throws, so it is delivered again', async () => {
        const events = makeModule();
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        events.channel.registerDurable('app-1#sub', async () => {
            throw new Error('handler bug');
        });

        sockets[0].fire(
            'events.delivery',
            durable('app-1#sub', '/user/a/one.txt', {
                ackRequired: true,
                ackId: 'entry-3',
            }),
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(sockets[0].sent.filter(s => s.verb === 'events.ack')).toEqual([]);
        expect(errors).toHaveBeenCalled();
    });

    it('keeps routing across a reconnect without subscribing again', async () => {
        const events = makeModule();
        const seen = [];
        events.channel.registerDurable('app-1#sub', ({ event }) => seen.push(event));

        sockets[0].fire('disconnect');
        sockets[0].fire('connect');

        expect(sockets[0].sent.filter(s => s.verb === 'events.subscribe')).toEqual([]);

        sockets[0].fire('events.delivery', durable('app-1#sub', '/user/a/back.txt'));
        expect(seen).toHaveLength(1);
    });

    it('stops routing once the subscription is let go, and closes with the last', async () => {
        const events = makeModule();
        const seen = [];
        events.channel.registerDurable('app-1#sub', ({ event }) => seen.push(event));

        events.channel.deregisterDurable('app-1#sub');
        sockets[0].fire('events.delivery', durable('app-1#sub', '/user/a/late.txt'));

        expect(seen).toEqual([]);
        expect(sockets[0].disconnected).toBe(true);
    });
});

describe('ack timeout', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects a subscribe after 30s with no ack, by default', async () => {
        vi.useFakeTimers();
        const events = makeModule();

        const pending = events.onLocal('fs:~/a', () => {});
        const assertion = expect(pending).rejects.toMatchObject({ code: 'events_connection_failed' });
        await vi.advanceTimersByTimeAsync(30000);
        await assertion;
    });

    it('honors a per-call timeout shorter than the 30s default', async () => {
        vi.useFakeTimers();
        const events = makeModule();

        const pending = events.onLocal('fs:~/a', () => {}, { timeout: 5000 });
        const assertion = expect(pending).rejects.toMatchObject({ code: 'events_connection_failed' });
        await vi.advanceTimersByTimeAsync(5000);
        await assertion;
    });
});

describe('client-side validation', () => {
    it('rejects a missing subject or handler before connecting', async () => {
        const events = makeModule();

        await expect(events.onLocal('', () => {})).rejects.toMatchObject({
            code: 'invalid_subject',
        });
        await expect(events.onLocal('fs:~/a', null)).rejects.toMatchObject({
            code: 'invalid_handler',
        });
        expect(sockets).toHaveLength(0);
    });
});
