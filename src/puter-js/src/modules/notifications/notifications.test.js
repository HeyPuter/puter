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
    it('delivers the desktop broadcast as { uid, target, data }', () => {
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

    it('delivers a click that came before the first handler, once', () => {
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

        expect(first).toEqual([{ uid: 'n-9', target: '/x', data: [1] }]);
        expect(second).toEqual([]);
        expect(notifications.puter.ui.on).toHaveBeenCalledTimes(1);
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

    it('with since, delivers only newer notifications', async () => {
        const events = makeEvents({
            pages: [
                {
                    items: [
                        event('n-1', {}, { ts: 100 }),
                        event('n-2', {}, { ts: 200 }),
                    ],
                },
            ],
        });
        const notifications = makeModule({ events });
        const seen = [];

        await notifications.onNotification((n) => seen.push(n.uid), {
            since: 100,
        });
        expect(seen).toEqual(['n-2']);
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

    it('rejects a handler that is not a function', async () => {
        const error = await rejects(() => makeModule().onNotification('x'));
        expect(error.code).toBe('invalid_handler');
    });
});

describe('requestPermission and hasPermission', () => {
    it('asks for notifications:push through puter.perms', async () => {
        const notifications = makeModule();
        expect(await notifications.requestPermission()).toBe(true);
        expect(notifications.puter.perms.request).toHaveBeenCalledWith(
            'notifications:push',
        );
    });

    it('resolves false when the user declines', async () => {
        const notifications = makeModule({
            perms: { request: vi.fn(async () => false), check: vi.fn() },
        });
        expect(await notifications.requestPermission()).toBe(false);
    });

    it('checks notifications:push without prompting', async () => {
        const notifications = makeModule({
            perms: { request: vi.fn(), check: vi.fn(async () => false) },
        });
        expect(await notifications.hasPermission()).toBe(false);
        expect(notifications.puter.perms.check).toHaveBeenCalledWith(
            'notifications:push',
        );
        expect(notifications.puter.perms.request).not.toHaveBeenCalled();
    });
});

describe('devices', () => {
    const device = {
        uid: 'd-1',
        platform: 'web',
        label: 'Laptop',
        user_agent: 'UA',
        created_at: 10,
        last_seen_at: 20,
        current: true,
    };
    const mapped = {
        uid: 'd-1',
        platform: 'web',
        label: 'Laptop',
        userAgent: 'UA',
        createdAt: 10,
        lastSeenAt: 20,
        current: true,
    };

    it('registers with POST /push/devices', async () => {
        mockFetchUrl.mockResolvedValue(jsonResponse({ device }));
        const result = await makeModule().registerDevice({
            platform: 'web',
            token: 'tok',
            label: 'Laptop',
        });

        expect(result).toEqual(mapped);
        const [url, init] = mockFetchUrl.mock.calls[0];
        expect(url).toBe('https://api.test/push/devices');
        expect(init).toMatchObject({ method: 'POST', includePuterAuth: true });
        expect(JSON.parse(init.body)).toEqual({
            platform: 'web',
            token: 'tok',
            label: 'Laptop',
        });
    });

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

    it('passes a token conflict through as push_device_conflict', async () => {
        mockFetchUrl.mockResolvedValue(
            jsonResponse(
                {
                    error: 'This device is registered to another user',
                    message: 'This device is registered to another user',
                    code: 'push_device_conflict',
                },
                409,
            ),
        );

        const error = await rejects(() =>
            makeModule().registerDevice({
                platform: 'ios',
                token: 'tok',
            }),
        );
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.code).toBe('push_device_conflict');
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

    it('rejects a missing uid before calling the server', async () => {
        const error = await rejects(() => makeModule().removeDevice(''));
        expect(error.code).toBe('invalid_argument');
        expect(mockFetchUrl).not.toHaveBeenCalled();
    });
});
