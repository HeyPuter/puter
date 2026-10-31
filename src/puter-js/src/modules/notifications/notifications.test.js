import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDriverCall = vi.fn();
const mockFetchUrl = vi.fn();
vi.mock('../../lib/networkUtils.js', () => ({
    driverCall: (...args) => mockDriverCall(...args),
    fetchUrl: (...args) => mockFetchUrl(...args),
}));

const { NotificationsModule } = await import('./index.js');
const { PuterJSError } = await import('../../lib/PuterJSError.js');

const jsonResponse = (body, status = 200) => ({
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
});

/** Like `puter.ui`: a new listener is handed the last broadcast first. */
const makeUI = () => {
    const listeners = new Map();
    const last = new Map();
    return {
        on: vi.fn((name, handler) => {
            listeners.set(name, [...(listeners.get(name) ?? []), handler]);
            if (last.has(name)) handler(last.get(name));
        }),
        broadcast: (name, data) => {
            for (const handler of listeners.get(name) ?? []) handler(data);
            last.set(name, data);
        },
    };
};

/** `fetch` answers from `pages` in order, repeating the last one. */
const makeEvents = ({ pages = [{ items: [] }], subscribeError } = {}) => {
    const state = { push: null, onError: null, offs: 0, fetches: [] };
    const queue = [...pages];
    return {
        state,
        onLocal: vi.fn(async (subject, handler, options) => {
            if (subscribeError) throw subscribeError;
            state.push = (event) => handler({ event });
            state.onError = options?.onError;
            return {
                off: async () => {
                    state.offs++;
                },
            };
        }),
        fetch: vi.fn(async (options) => {
            state.fetches.push(options);
            return queue.length > 1 ? queue.shift() : queue[0];
        }),
    };
};

const makeModule = (over = {}) => {
    const puter = {
        env: 'app',
        authToken: 'token-1',
        APIOrigin: 'https://api.test',
        args: {},
        getAppIDFromAuthToken: vi.fn((token) => (token ? 'app-1' : null)),
        authListeners: new Set(),
        onAuthStateChanged(listener) {
            this.authListeners.add(listener);
            return () => this.authListeners.delete(listener);
        },
        setAuthToken(token) {
            this.authToken = token;
            for (const listener of this.authListeners) listener();
        },
        ui: makeUI(),
        events: makeEvents(),
        perms: {
            request: vi.fn(async () => true),
            check: vi.fn(async () => true),
        },
        ...over,
    };
    return new NotificationsModule(puter);
};

const event = (uid, fields = {}, extra = {}) => ({
    id: uid,
    subject: 'notif:app-1:app-user',
    op: 'post',
    uid,
    type: 'app.message',
    audience: 'app-user',
    appUid: 'app-1',
    notification: {
        title: `title ${uid}`,
        priority: 'normal',
        ttl: 3600,
        ...fields,
    },
    self: true,
    ts: 1_000,
    seq: 0,
    ...extra,
});

const rejects = async (run) => {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    mockDriverCall.mockReset();
    mockFetchUrl.mockReset();
});

describe('notify', () => {
    it('creates an app.message through the notification driver', async () => {
        mockDriverCall.mockResolvedValue({ uid: 'n-1', value: {} });
        const notifications = makeModule();

        const uid = await notifications.notify({
            title: 'Hi',
            text: 'There',
            target: '/chats/1',
            data: { id: 1 },
            icon: undefined,
        });

        expect(uid).toBe('n-1');
        expect(mockDriverCall).toHaveBeenCalledTimes(1);
        const [call] = mockDriverCall.mock.calls[0];
        expect(call).toMatchObject({
            iface: 'puter-notifications',
            driver: 'es:notification',
            method: 'create',
            args: {
                object: {
                    value: {
                        type: 'app.message',
                        title: 'Hi',
                        text: 'There',
                        target: '/chats/1',
                        data: { id: 1 },
                    },
                },
            },
        });
        expect(call.args.object.value).not.toHaveProperty('icon');
        expect(call.puter).toBe(notifications.puter);
    });

    it('sends app.message whatever type the caller passes', async () => {
        mockDriverCall.mockResolvedValue({ uid: 'n-2' });
        await makeModule().notify({ title: 'Hi', type: 'share.received' });
        expect(mockDriverCall.mock.calls[0][0].args.object.value.type).toBe(
            'app.message',
        );
    });

    it.each([
        ['no argument', undefined],
        ['a string', 'Hi'],
        ['no title', { text: 'x' }],
        ['a blank title', { title: '  ' }],
    ])('rejects %s before calling the server', async (_label, input) => {
        const error = await rejects(() => makeModule().notify(input));
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.code).toBe('invalid_argument');
        expect(mockDriverCall).not.toHaveBeenCalled();
    });

    it('passes the server refusal through as a PuterJSError', async () => {
        mockDriverCall.mockRejectedValue({
            error: 'Only apps can create app.message',
            message: 'Only apps can create app.message',
            code: 'forbidden',
            errorCode: 'notification_type_not_allowed',
        });

        const error = await rejects(() => makeModule().notify({ title: 'Hi' }));
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.code).toBe('forbidden');
        expect(error.errorCode).toBe('notification_type_not_allowed');
        expect(error.message).toBe('Only apps can create app.message');
    });

    it('unwraps the nested driver envelope', async () => {
        mockDriverCall.mockRejectedValue({
            success: false,
            error: {
                message: 'Too many notifications from this app.',
                code: 'too_many_requests',
            },
        });

        const error = await rejects(() => makeModule().notify({ title: 'Hi' }));
        expect(error.code).toBe('too_many_requests');
        expect(error.message).toBe('Too many notifications from this app.');
    });

    it('rejects when the server answers without a uid', async () => {
        mockDriverCall.mockResolvedValue(null);
        const error = await rejects(() => makeModule().notify({ title: 'Hi' }));
        expect(error.code).toBe('notifications_failed');
    });
});

describe("on('click')", () => {
    it('delivers the desktop broadcast as { uid, target, data }', async () => {
        const notifications = makeModule();
        const clicks = [];
        notifications.on('click', (click) => clicks.push(click));

        notifications.puter.ui.broadcast('notificationClick', {
            uid: 'n-1',
            target: '/a',
            data: { id: 1 },
            extra: 'dropped',
        });
        notifications.puter.ui.broadcast('notificationClick', { uid: 'n-2' });
        await flush();

        expect(clicks).toEqual([
            { uid: 'n-1', target: '/a', data: { id: 1 } },
            { uid: 'n-2', target: null, data: null },
        ]);
    });

    it('ignores a broadcast that names no notification', () => {
        const notifications = makeModule();
        const clicks = [];
        notifications.on('click', (click) => clicks.push(click));

        notifications.puter.ui.broadcast('notificationClick', { target: '/a' });
        notifications.puter.ui.broadcast('notificationClick', null);

        expect(clicks).toEqual([]);
    });

    it('stops delivering after off()', () => {
        const notifications = makeModule();
        const clicks = [];
        const handler = (click) => clicks.push(click);
        notifications.on('click', handler);
        notifications.off('click', handler);

        notifications.puter.ui.broadcast('notificationClick', { uid: 'n-1' });
        expect(clicks).toEqual([]);
    });

    it('delivers a click that came before the first handler, once', async () => {
        const notifications = makeModule();
        notifications.puter.ui.broadcast('notificationClick', {
            uid: 'n-9',
            target: '/x',
            data: [1],
        });
        const first = [];
        const second = [];

        notifications.on('click', (click) => first.push(click));
        notifications.on('click', (click) => second.push(click));
        await flush();

        expect(first).toEqual([{ uid: 'n-9', target: '/x', data: [1] }]);
        expect(second).toEqual([]);
        expect(notifications.puter.ui.on).toHaveBeenCalledTimes(1);
    });

    it('runs a replayed click after on() returns', async () => {
        const notifications = makeModule();
        notifications.puter.ui.broadcast('notificationClick', { uid: 'n-9' });
        const order = [];

        notifications.on('click', () => order.push('handler'));
        order.push('returned');
        await flush();

        expect(order).toEqual(['returned', 'handler']);
    });

    it('does not listen to the desktop before a click handler is added', () => {
        const notifications = makeModule();
        expect(notifications.puter.ui.on).not.toHaveBeenCalled();
    });

    it('ignores launch arguments', async () => {
        const notifications = makeModule({
            args: { notificationClick: { uid: 'n-9' } },
        });
        const clicks = [];
        notifications.on('click', (click) => clicks.push(click));
        await flush();
        expect(clicks).toEqual([]);
    });
});

describe('onNotification', () => {
    it('subscribes to the app slice and maps each notification', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n));
        events.state.push(
            event(
                'n-1',
                {
                    text: 'body',
                    icon: 'https://x.test/i.png',
                    target: '/a',
                    data: { id: 1 },
                    group: 'g',
                    channel: 'messages',
                    app: { uid: 'app-1', name: 'Chat' },
                },
                { ts: 1234 },
            ),
        );

        expect(events.onLocal).toHaveBeenCalledWith(
            'notif:app-user',
            expect.any(Function),
            expect.any(Object),
        );
        expect(seen).toEqual([
            {
                uid: 'n-1',
                title: 'title n-1',
                text: 'body',
                icon: 'https://x.test/i.png',
                target: '/a',
                data: { id: 1 },
                group: 'g',
                channel: 'messages',
                sensitive: false,
                createdAt: 1234,
                app: { uid: 'app-1', name: 'Chat' },
            },
        ]);
    });

    it('fills absent fields with null', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const seen = [];
        await notifications.onNotification((n) => seen.push(n));

        events.state.push(event('n-1'));
        expect(seen[0]).toMatchObject({
            text: null,
            icon: null,
            target: null,
            data: null,
            group: null,
            channel: null,
            app: null,
        });
    });

    it('catches up oldest first across pages, then delivers live', async () => {
        const events = makeEvents({
            pages: [
                { items: [event('n-1'), event('n-2')], cursor: 'c-1' },
                { items: [event('n-3')] },
            ],
        });
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid));
        events.state.push(event('n-4'));

        expect(seen).toEqual(['n-1', 'n-2', 'n-3', 'n-4']);
        expect(events.state.fetches).toEqual([
            { subject: 'notif:app-user', limit: 200 },
            { subject: 'notif:app-user', limit: 200, cursor: 'c-1' },
        ]);
    });

    it('hands a notification over once when it arrives both ways', async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const events = makeEvents();
        events.fetch = vi.fn(async () => {
            await gate;
            return { items: [event('n-1'), event('n-2')] };
        });
        const notifications = makeModule({ events });
        const seen = [];

        const started = notifications.onNotification((n) => seen.push(n.uid));
        await flush();
        // Live while catching up: held until the read is done.
        events.state.push(event('n-2'));
        events.state.push(event('n-3'));
        expect(seen).toEqual([]);
        release();
        await started;
        events.state.push(event('n-3'));

        expect(seen).toEqual(['n-1', 'n-2', 'n-3']);
    });

    it('reads what it missed after a reconnect, from the last cursor', async () => {
        const events = makeEvents({
            pages: [
                { items: [event('n-1')], cursor: 'c-1' },
                { items: [] },
                { items: [event('n-1'), event('n-2')] },
            ],
        });
        const notifications = makeModule({ events });
        const seen = [];
        await notifications.onNotification((n) => seen.push(n.uid));

        events.state.push({
            id: 'g',
            subject: 'notif:app-user',
            op: 'gap',
            reason: 'reconnect',
            ts: 1,
        });
        await flush();

        expect(seen).toEqual(['n-1', 'n-2']);
        expect(events.state.fetches.at(-1)).toEqual({
            subject: 'notif:app-user',
            limit: 200,
            cursor: 'c-1',
        });
    });

    it('with catchUp: false, skips what was there but not what arrives', async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const events = makeEvents();
        let calls = 0;
        events.fetch = vi.fn(async () => {
            calls++;
            if (calls === 1) {
                await gate;
                return { items: [event('n-1'), event('n-2')] };
            }
            return { items: [event('n-1'), event('n-2'), event('n-3')] };
        });
        const notifications = makeModule({ events });
        const seen = [];

        const started = notifications.onNotification((n) => seen.push(n.uid), {
            catchUp: false,
        });
        await flush();
        // Sent while the existing ones were being read: it is new.
        events.state.push(event('n-2'));
        release();
        await started;
        events.state.push({ op: 'gap', reason: 'reconnect' });
        await flush();

        expect(seen).toEqual(['n-2', 'n-3']);
    });

    it('with since, filters fetched rows to the second, inclusive', async () => {
        const events = makeEvents({
            pages: [
                {
                    items: [
                        event('n-1', {}, { ts: 4_999 }),
                        event('n-2', {}, { ts: 5_000 }),
                        event('n-3', {}, { ts: 5_400 }),
                        event('n-4', {}, { ts: 9_000 }),
                    ],
                },
            ],
        });
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid), {
            since: 5_700,
        });
        expect(seen).toEqual(['n-2', 'n-3', 'n-4']);
    });

    it('never filters live notifications by since', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid), {
            since: 10_000,
        });
        events.state.push(event('n-1', {}, { ts: 1_000 }));
        expect(seen).toEqual(['n-1']);
    });

    it.each([
        ['catching up', {}],
        ['marking what is there', { catchUp: false }],
    ])(
        'reads again after a gap that came while %s',
        async (_label, options) => {
            let release;
            const gate = new Promise((resolve) => {
                release = resolve;
            });
            const events = makeEvents();
            const pages = [
                async () => {
                    await gate;
                    return { items: [event('n-1')] };
                },
                async () => ({ items: [event('n-1'), event('n-2')] }),
            ];
            events.fetch = vi.fn(async () =>
                (pages.shift() ?? (async () => ({ items: [] })))(),
            );
            const notifications = makeModule({ events });
            const seen = [];

            const started = notifications.onNotification(
                (n) => seen.push(n.uid),
                options,
            );
            await flush();
            events.state.push({ op: 'gap', reason: 'reconnect' });
            events.state.push(event('n-3'));
            release();
            await started;
            await flush();

            expect(events.fetch).toHaveBeenCalledTimes(2);
            expect(seen).toEqual(
                options.catchUp === false
                    ? ['n-2', 'n-3']
                    : ['n-1', 'n-2', 'n-3'],
            );
        },
    );

    it('stops with auth_changed when the token changes', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const seen = [];
        const onError = vi.fn();

        await notifications.onNotification((n) => seen.push(n.uid), {
            onError,
        });
        notifications.puter.setAuthToken('token-1');
        expect(onError).not.toHaveBeenCalled();

        notifications.puter.setAuthToken('token-2');
        events.state.push(event('n-1'));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(PuterJSError);
        expect(onError.mock.calls[0][0].code).toBe('auth_changed');
        expect(events.state.offs).toBe(1);
        expect(seen).toEqual([]);
    });

    it('rejects without onError when the token changes while starting', async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const events = makeEvents();
        events.fetch = vi.fn(async () => {
            await gate;
            throw new PuterJSError('down', 'events_failed');
        });
        const notifications = makeModule({ events });
        const onError = vi.fn();

        const started = notifications.onNotification(() => {}, { onError });
        await flush();
        notifications.puter.setAuthToken('token-2');
        release();
        const error = await rejects(() => started);

        expect(error.code).toBe('auth_changed');
        expect(onError).not.toHaveBeenCalled();
        expect(events.state.offs).toBe(1);
    });

    it('remembers every live uid since the last read', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const seen = [];
        await notifications.onNotification((n) => seen.push(n.uid));

        for (let i = 0; i < 5300; i++) events.state.push(event(`n-${i}`));
        events.fetch = vi.fn(async () => ({ items: [event('n-0')] }));
        events.state.push({ op: 'gap', reason: 'reconnect' });
        await flush();

        expect(seen).toHaveLength(5300);
    });

    it('stops watching the token after off()', async () => {
        const notifications = makeModule();
        const onError = vi.fn();
        const listener = await notifications.onNotification(() => {}, {
            onError,
        });
        await listener.off();

        notifications.puter.setAuthToken('token-2');
        expect(onError).not.toHaveBeenCalled();
        expect(notifications.puter.authListeners.size).toBe(0);
    });

    it('stops before onError when reading after a gap fails', async () => {
        const events = makeEvents();
        let calls = 0;
        events.fetch = vi.fn(async () => {
            calls++;
            if (calls === 1) return { items: [] };
            throw new PuterJSError('down', 'events_failed');
        });
        const notifications = makeModule({ events });
        const seen = [];
        const onError = vi.fn(() => {
            events.state.push(event('n-1'));
        });

        await notifications.onNotification((n) => seen.push(n.uid), {
            onError,
        });
        events.state.push({ op: 'gap', reason: 'reconnect' });
        await flush();
        events.state.push(event('n-2'));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].code).toBe('events_failed');
        expect(events.state.offs).toBe(1);
        expect(seen).toEqual([]);
    });

    it('pages until the cursor runs out', async () => {
        const pages = Array.from({ length: 120 }, (_, i) => ({
            items: [event(`n-${i}`)],
            ...(i < 119 ? { cursor: `c-${i}` } : {}),
        }));
        const events = makeEvents({ pages });
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid));
        expect(seen).toHaveLength(120);
        expect(seen.at(-1)).toBe('n-119');
    });

    it('skips other notification types and gaps', async () => {
        const events = makeEvents({
            pages: [{ items: [event('n-1', {}, { type: 'share.received' })] }],
        });
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid));
        events.state.push(event('n-2', {}, { type: 'app.worker.deployed' }));
        expect(seen).toEqual([]);
    });

    it('stops delivering after off()', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const seen = [];

        const listener = await notifications.onNotification((n) =>
            seen.push(n.uid),
        );
        await listener.off();
        await listener.off();
        events.state.push(event('n-1'));

        expect(seen).toEqual([]);
        expect(events.state.offs).toBe(1);
    });

    it('keeps delivering when a handler throws', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const seen = [];

        await notifications.onNotification((n) => {
            seen.push(n.uid);
            throw new Error('handler bug');
        });
        events.state.push(event('n-1'));
        events.state.push(event('n-2'));

        expect(seen).toEqual(['n-1', 'n-2']);
        expect(errors).toHaveBeenCalledTimes(2);
        errors.mockRestore();
    });

    it('reports a lapsed subscription to onError', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const onError = vi.fn();
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid), {
            onError,
        });
        const lapse = new PuterJSError('gone', 'reauth_required');
        events.state.onError(lapse);
        events.state.push(event('n-1'));

        expect(onError).toHaveBeenCalledWith(lapse);
        expect(seen).toEqual([]);
    });

    it.each([
        ['events_disabled', 'Events are not enabled on this server'],
        ['invalid_subject', 'Subject family not subscribable yet: notif'],
    ])(
        'rejects events_disabled when subscribing answers %s',
        async (code, message) => {
            const events = makeEvents({
                subscribeError: new PuterJSError(message, code),
            });
            const error = await rejects(() =>
                makeModule({ events }).onNotification(() => {}),
            );

            expect(error).toBeInstanceOf(PuterJSError);
            expect(error.code).toBe('events_disabled');
            expect(error.message).toBe(
                'Live notifications are not enabled on this server',
            );
        },
    );

    it('ends the subscription when the first read fails', async () => {
        const events = makeEvents();
        events.fetch = vi.fn(async () => {
            throw new PuterJSError(
                'Events are not enabled on this server',
                'events_disabled',
            );
        });

        const error = await rejects(() =>
            makeModule({ events }).onNotification(() => {}),
        );
        expect(error.code).toBe('events_disabled');
        expect(events.state.offs).toBe(1);
    });

    it('passes any other failure through', async () => {
        const events = makeEvents({
            subscribeError: new PuterJSError('nope', 'forbidden'),
        });
        const error = await rejects(() =>
            makeModule({ events }).onNotification(() => {}),
        );
        expect(error.code).toBe('forbidden');
    });

    it('rejects app_required without an app token', async () => {
        const events = makeEvents();
        const notifications = makeModule({
            events,
            getAppIDFromAuthToken: vi.fn(() => null),
        });

        const error = await rejects(() =>
            notifications.onNotification(() => {}),
        );
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.code).toBe('app_required');
        expect(notifications.puter.getAppIDFromAuthToken).toHaveBeenCalledWith(
            'token-1',
        );
        expect(events.onLocal).not.toHaveBeenCalled();
    });

    it('signs a website visitor in before checking for an app', async () => {
        const notifications = makeModule({ env: 'web', authToken: null });
        notifications.puter.ui.authenticateWithPuter = vi.fn(async () => {
            notifications.puter.authToken = 'app-token';
        });

        const listener = await notifications.onNotification(() => {});
        await listener.off();

        expect(notifications.puter.ui.authenticateWithPuter).toHaveBeenCalled();
        expect(notifications.puter.getAppIDFromAuthToken).toHaveBeenCalledWith(
            'app-token',
        );
    });

    it('rejects a handler that is not a function', async () => {
        const error = await rejects(() => makeModule().onNotification('x'));
        expect(error.code).toBe('invalid_handler');
    });
});

describe('receipts', () => {
    const received = (over = {}) => ({
        received: true,
        visibilityState: 'unknown',
        focused: false,
        showsOwn: false,
        ...over,
    });

    it('acknowledges a notification a feed already received', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        await notifications.onNotification(() => {});
        events.state.push(event('n-1'));

        const ack = vi.fn();
        notifications._answerReceipt({ uid: 'n-1' }, ack);

        expect(ack).toHaveBeenCalledWith(received());
    });

    it('acknowledges a notification the desktop noted on its own socket', () => {
        const notifications = makeModule();
        notifications._noteReceived('n-1');

        const ack = vi.fn();
        notifications._answerReceipt({ uid: 'n-1' }, ack);

        expect(ack).toHaveBeenCalledWith(received());
    });

    it('acknowledges when the notification arrives after the ask, before handlers run', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const order = [];
        await notifications.onNotification(() => {
            order.push('handler');
            throw new Error('handler bug');
        });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        notifications._answerReceipt({ uid: 'n-1' }, () => order.push('ack'));
        expect(order).toEqual([]);
        events.state.push(event('n-1'));

        expect(order).toEqual(['ack', 'handler']);
        errors.mockRestore();
    });

    it('answers every socket that asks about the same notification', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        await notifications.onNotification(() => {});
        const first = vi.fn();
        const second = vi.fn();

        notifications._answerReceipt({ uid: 'n-1' }, first);
        notifications._answerReceipt({ uid: 'n-1' }, second);
        events.state.push(event('n-1'));

        expect(first).toHaveBeenCalledWith(received());
        expect(second).toHaveBeenCalledWith(received());
    });

    it('sends the page visibility and focus with the acknowledgement', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        await notifications.onNotification(() => {});
        events.state.push(event('n-1'));
        vi.stubGlobal('document', {
            visibilityState: 'hidden',
            hasFocus: () => true,
        });

        const ack = vi.fn();
        try {
            notifications._answerReceipt({ uid: 'n-1' }, ack);
        } finally {
            vi.unstubAllGlobals();
        }

        expect(ack).toHaveBeenCalledWith(
            received({ visibilityState: 'hidden', focused: true }),
        );
    });

    it('says the desktop never shows its own browser notification', () => {
        const notifications = makeModule({ env: 'gui' });
        vi.stubGlobal('document', {
            visibilityState: 'visible',
            hasFocus: () => false,
        });
        const ack = vi.fn();
        try {
            notifications._noteReceived('n-1');
            notifications._answerReceipt({ uid: 'n-1' }, ack);
        } finally {
            vi.unstubAllGlobals();
        }
        expect(ack).toHaveBeenCalledWith(
            received({ visibilityState: 'visible', focused: false }),
        );
    });

    it('answers received: false once a notification it never got stops being waited for', async () => {
        vi.useFakeTimers();
        try {
            const events = makeEvents();
            const notifications = makeModule({ events });
            const ack = vi.fn();

            notifications._answerReceipt({ uid: 'n-1' }, ack);
            await notifications.onNotification(() => {});
            events.state.push(event('n-2'));
            events.state.push(event('n-3', {}, { type: 'kv.share.received' }));
            notifications._answerReceipt({ uid: 'n-3' }, ack);
            expect(ack).not.toHaveBeenCalled();
            vi.advanceTimersByTime(10_000);
            events.state.push(event('n-1'));

            expect(ack.mock.calls).toEqual([
                [{ received: false }],
                [{ received: false }],
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('answers received: false at once past the asks it holds', () => {
        const notifications = makeModule();
        const held = vi.fn();
        for (let i = 0; i < 100; i++)
            notifications._answerReceipt({ uid: `n-${i}` }, held);
        const over = vi.fn();
        notifications._answerReceipt({ uid: 'n-100' }, over);

        expect(held).not.toHaveBeenCalled();
        expect(over).toHaveBeenCalledWith({ received: false });
        notifications._noteReceived('n-0');
        expect(held).toHaveBeenCalledWith(received());
    });

    it('acknowledges nothing a stopped feed would have received', async () => {
        const events = makeEvents();
        const notifications = makeModule({ events });
        const listener = await notifications.onNotification(() => {});
        await listener.off();
        const ack = vi.fn();

        notifications._answerReceipt({ uid: 'n-1' }, ack);
        events.state.push(event('n-1'));

        expect(ack).not.toHaveBeenCalled();
    });

    it('answers an ask without a uid with received: false', () => {
        const notifications = makeModule();
        expect(() =>
            notifications._answerReceipt({ uid: 'n-1' }),
        ).not.toThrow();
        const ack = vi.fn();
        notifications._answerReceipt({}, ack);
        notifications._answerReceipt(null, ack);
        expect(ack.mock.calls).toEqual([
            [{ received: false }],
            [{ received: false }],
        ]);
    });
});

describe('requestPermission and hasPermission', () => {
    it('asks for the pushNotifications resource through puter.perms', async () => {
        const notifications = makeModule();
        expect(await notifications.requestPermission()).toBe(true);
        expect(notifications.puter.perms.request).toHaveBeenCalledWith(
            'pushNotifications',
        );
    });

    it('resolves false when the user declines', async () => {
        const notifications = makeModule({
            perms: { request: vi.fn(async () => false), check: vi.fn() },
        });
        expect(await notifications.requestPermission()).toBe(false);
    });

    it('checks the pushNotifications resource without prompting', async () => {
        const notifications = makeModule({
            perms: { request: vi.fn(), check: vi.fn(async () => false) },
        });
        expect(await notifications.hasPermission()).toBe(false);
        expect(notifications.puter.perms.check).toHaveBeenCalledWith(
            'pushNotifications',
        );
        expect(notifications.puter.perms.request).not.toHaveBeenCalled();
    });
});

describe('enablePush', () => {
    it('offers to turn on the browser through puter.ui', async () => {
        const ui = { ...makeUI(), enablePush: vi.fn(async () => true) };
        const { enablePush } = makeModule({ ui });
        expect(await enablePush()).toBe(true);
        expect(ui.enablePush).toHaveBeenCalledTimes(1);
    });

    it('resolves false when the browser stays off', async () => {
        const ui = { ...makeUI(), enablePush: vi.fn(async () => false) };
        expect(await makeModule({ ui }).enablePush()).toBe(false);
    });

    it('resolves false where there is no desktop or popup to ask', async () => {
        expect(await makeModule({ ui: makeUI() }).enablePush()).toBe(false);
    });
});

describe('disable inside the desktop', () => {
    it('has the desktop revoke the app`s push permission', async () => {
        const ui = { ...makeUI(), disablePush_: vi.fn(async () => true) };
        expect(await makeModule({ ui }).disable()).toBe(true);
        expect(ui.disablePush_).toHaveBeenCalledTimes(1);
    });

    it('resolves false from a desktop that can`t', async () => {
        expect(await makeModule({ ui: makeUI() }).disable()).toBe(false);
    });
});

describe('status inside the desktop', () => {
    it('answers what the desktop says', async () => {
        const ui = { ...makeUI(), pushStatus_: vi.fn(async () => 'on') };
        expect(await makeModule({ ui }).status()).toBe('on');
        expect(ui.pushStatus_).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a desktop that can`t answer', async () => null],
        ['an answer it doesn`t know', async () => 'maybe'],
        [
            'a failed answer',
            async () => {
                throw new Error('ipc_handler_failed');
            },
        ],
    ])('is unavailable for %s', async (_, pushStatus_) => {
        const ui = { ...makeUI(), pushStatus_: vi.fn(pushStatus_) };
        expect(await makeModule({ ui }).status()).toBe('unavailable');
    });
});

describe('devices', () => {
    const device = {
        uid: 'd-1',
        platform: 'webpush',
        label: 'Laptop',
        user_agent: 'UA',
        created_at: 10,
        last_seen_at: 20,
        current: true,
    };
    const mapped = {
        uid: 'd-1',
        platform: 'webpush',
        label: 'Laptop',
        userAgent: 'UA',
        createdAt: 10,
        lastSeenAt: 20,
        current: true,
    };

    it('lists with GET /push/devices', async () => {
        mockFetchUrl.mockResolvedValue(jsonResponse({ devices: [device] }));
        expect(await makeModule().listDevices()).toEqual([mapped]);

        const [url, init] = mockFetchUrl.mock.calls[0];
        expect(url).toBe('https://api.test/push/devices');
        expect(init).toMatchObject({ method: 'GET', includePuterAuth: true });
        expect(init).not.toHaveProperty('body');
    });

    it('removes with DELETE /push/devices/:uid', async () => {
        mockFetchUrl.mockResolvedValue(jsonResponse({ removed: true }));
        await expect(makeModule().removeDevice('d/1')).resolves.toBeUndefined();

        const [url, init] = mockFetchUrl.mock.calls[0];
        expect(url).toBe('https://api.test/push/devices/d%2F1');
        expect(init).toMatchObject({
            method: 'DELETE',
            includePuterAuth: true,
        });
    });

    it('passes the server error through', async () => {
        mockFetchUrl.mockResolvedValue(
            jsonResponse(
                {
                    error: 'Devices can only be managed from a signed-in Puter session',
                    message:
                        'Devices can only be managed from a signed-in Puter session',
                    code: 'forbidden',
                },
                403,
            ),
        );

        const error = await rejects(() => makeModule().listDevices());
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.code).toBe('forbidden');
        expect(error.message).toBe(
            'Devices can only be managed from a signed-in Puter session',
        );
    });

    it('names the status when the error has no body', async () => {
        mockFetchUrl.mockResolvedValue({
            status: 502,
            headers: { get: () => 'text/html' },
        });
        const error = await rejects(() => makeModule().listDevices());
        expect(error.code).toBe('notifications_failed');
        expect(error.message).toContain('502');
    });

    const coreNotFound = () =>
        jsonResponse(
            { error: 'Not Found', message: 'Not Found', code: 'not_found' },
            404,
        );

    it.each([
        ['listDevices', (m) => m.listDevices()],
        ['removeDevice', (m) => m.removeDevice('d-1')],
    ])(
        '%s rejects with push_unavailable when no route answers',
        async (_name, call) => {
            mockFetchUrl.mockResolvedValue(coreNotFound());
            const error = await rejects(() => call(makeModule()));
            expect(error).toBeInstanceOf(PuterJSError);
            expect(error.code).toBe('push_unavailable');
            expect(error.message).toBe(
                "Push notifications aren't available on this deployment",
            );
        },
    );

    it('treats a 404 with no JSON body as push_unavailable', async () => {
        mockFetchUrl.mockResolvedValue({
            status: 404,
            headers: { get: () => 'text/html' },
        });
        const error = await rejects(() => makeModule().listDevices());
        expect(error.code).toBe('push_unavailable');
    });

    it('passes a missing device through as device_not_found', async () => {
        mockFetchUrl.mockResolvedValue(
            jsonResponse(
                {
                    error: 'Device not found',
                    message: 'Device not found',
                    code: 'device_not_found',
                },
                404,
            ),
        );
        const error = await rejects(() => makeModule().removeDevice('d-1'));
        expect(error.code).toBe('device_not_found');
        expect(error.message).toBe('Device not found');
    });

    it('rejects a missing uid before calling the server', async () => {
        const error = await rejects(() => makeModule().removeDevice(''));
        expect(error.code).toBe('invalid_argument');
        expect(mockFetchUrl).not.toHaveBeenCalled();
    });
});
