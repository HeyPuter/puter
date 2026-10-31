import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('./lib/api.js', () => ({
    request: (...args) => mockRequest(...args),
}));
/** The IndexedDB stores, as `store:key`; `broken` makes every call fail. */
const store = new Map();
const storage = { broken: false };
vi.mock('./lib/pushStore.js', () => {
    const stored = (fn) =>
        vi.fn(async (...args) => {
            if (storage.broken) throw new Error('IndexedDB is not available');
            return fn(...args);
        });
    const optIn = (uuid) => `handlers:puter:opt-in:${uuid}`;
    return {
        HANDLERS_STORE: 'handlers',
        CLICKS_STORE: 'clicks',
        SERVER_KEY_ENTRY: 'puter:server-key',
        idbGet: stored(async (s, k) => store.get(`${s}:${k}`)),
        idbPut: stored(async (s, k, v) => void store.set(`${s}:${k}`, v)),
        idbDelete: stored(async (s, k) => void store.delete(`${s}:${k}`)),
        hasOptIn: stored(async (uuid) => store.get(optIn(uuid)) === true),
        setOptIn: stored(async (uuid, on) =>
            on
                ? void store.set(optIn(uuid), true)
                : void store.delete(optIn(uuid)),
        ),
        forgetPushState: stored(async () => {
            for (const key of [...store.keys()]) {
                if (key.startsWith(optIn('')) || key.startsWith('clicks:'))
                    store.delete(key);
            }
        }),
    };
});

const { syncWebPush, removeWebPush, fromBase64Url, workerFor } =
    await import('./lib/webPush.js');
const { NotificationsModule, tapUrl } = await import('./index.js');
const { PuterJSError } = await import('../../lib/PuterJSError.js');
const { shownFrom } = await import('./onPush.js');

const ORIGIN = 'https://app.example';
const SCRIPT = `${ORIGIN}/puter-sw.js`;
// 65 bytes, 0x04 first, as base64url.
const KEY = Buffer.from([4, ...Array(64).fill(7)]).toString('base64url');
const OLD_KEY = Buffer.from([4, ...Array(64).fill(3)]).toString('base64url');
const OPT_IN = 'handlers:puter:opt-in:u-1';

const makeSubscription = (
    key = fromBase64Url(KEY),
    endpoint = 'https://push.example/send/abc',
) => ({
    endpoint,
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'p', auth: 'a' },
    }),
    unsubscribe: vi.fn(async () => true),
});

/** A worker still installing; `activate()` moves it to `activated`. */
const makeWorker = (scriptURL = SCRIPT) => {
    const listeners = new Set();
    return {
        scriptURL,
        state: 'installing',
        addEventListener: (type, fn) => listeners.add(fn),
        removeEventListener: (type, fn) => listeners.delete(fn),
        activate() {
            this.state = 'activated';
            for (const fn of [...listeners]) fn();
        },
    };
};

const makeNav = ({
    existing = null,
    installing = null,
    waiting = null,
    active = installing || waiting ? null : { scriptURL: SCRIPT },
} = {}) => {
    const listeners = new Set();
    const pushManager = {
        getSubscription: vi.fn(async () => existing),
        subscribe: vi.fn(async () => makeSubscription()),
    };
    const registration = {
        active,
        installing,
        waiting,
        pushManager,
        scope: `${ORIGIN}/`,
    };
    return {
        pushManager,
        registration,
        post: (data, source) => {
            for (const fn of [...listeners]) fn({ data, source });
        },
        serviceWorker: {
            register: vi.fn(async () => registration),
            getRegistration: vi.fn(async () => registration),
            addEventListener: (type, fn) => listeners.add(fn),
            removeEventListener: (type, fn) => listeners.delete(fn),
            startMessages: vi.fn(),
        },
    };
};

const puter = {
    env: 'web',
    authToken: 't',
    APIOrigin: 'https://api.test',
    whoami: { uuid: 'u-1' },
};
const worker = workerFor('web');

const withBrowser = (nav, permission = 'granted') => {
    globalThis.PushManager = function PushManager() {};
    globalThis.Notification = {
        permission,
        requestPermission: vi.fn(async () => 'granted'),
    };
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
        value: nav.serviceWorker,
        configurable: true,
    });
};

/** Answers the key, then `answer(route, body)` for everything else. */
const server = (answer = () => ({ status: 'active', device: { uid: 'd1' } })) =>
    mockRequest.mockImplementation(async (_p, method, route, body) =>
        route === '/push/web/key' ? { publicKey: KEY } : answer(route, body),
    );

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    mockRequest.mockReset();
    store.clear();
    storage.broken = false;
    globalThis.location = { href: `${ORIGIN}/`, origin: ORIGIN };
});

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.PushManager;
    delete globalThis.Notification;
    delete globalThis.location;
});

describe('syncWebPush', () => {
    it('refreshes a subscription the server already has', async () => {
        const nav = makeNav({ existing: makeSubscription() });
        server();
        await expect(syncWebPush(puter, { worker, nav })).resolves.toEqual({
            uid: 'd1',
        });
        expect(nav.serviceWorker.register).toHaveBeenCalledWith(
            '/puter-sw.js',
            {
                updateViaCache: 'none',
            },
        );
        expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
        expect(mockRequest).toHaveBeenCalledWith(
            puter,
            'POST',
            '/push/web/subscriptions',
            {
                subscription: {
                    endpoint: 'https://push.example/send/abc',
                    keys: { p256dh: 'p', auth: 'a' },
                },
            },
        );
        expect(store.get('handlers:puter:server-key')).toBe(KEY);
    });

    it('confirms a new subscription with the challenge the worker hands back', async () => {
        const nav = makeNav();
        server((route, body) => {
            if (route === '/push/web/subscriptions') {
                queueMicrotask(() =>
                    nav.post({
                        type: 'puter-push-challenge',
                        challenge: 'c.sig',
                    }),
                );
                return { status: 'pending' };
            }
            return { device: { uid: 'd2', challenge: body.challenge } };
        });
        await expect(syncWebPush(puter, { worker, nav })).resolves.toEqual({
            uid: 'd2',
            challenge: 'c.sig',
        });
        expect(nav.pushManager.subscribe).toHaveBeenCalledWith({
            userVisibleOnly: true,
            applicationServerKey: fromBase64Url(KEY),
        });
    });

    it('replaces a subscription made with Puter`s earlier key', async () => {
        store.set('handlers:puter:server-key', OLD_KEY);
        const stale = makeSubscription(fromBase64Url(OLD_KEY));
        const nav = makeNav({ existing: stale });
        server();
        await syncWebPush(puter, { worker, nav });
        expect(stale.unsubscribe).toHaveBeenCalled();
        expect(nav.pushManager.subscribe).toHaveBeenCalled();
        expect(store.get('handlers:puter:server-key')).toBe(KEY);
    });

    it('leaves a subscription another service on the site made, and says so', async () => {
        const theirs = makeSubscription(new Uint8Array([4, 1, 2]));
        const nav = makeNav({ existing: theirs });
        server();
        await expect(syncWebPush(puter, { worker, nav })).rejects.toMatchObject(
            { code: 'push_subscription_conflict' },
        );
        expect(theirs.unsubscribe).not.toHaveBeenCalled();
        expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
    });

    it('replaces any other subscription on the GUI`s own worker', async () => {
        const stale = makeSubscription(new Uint8Array([4, 1, 2]));
        const nav = makeNav({
            existing: stale,
            active: { scriptURL: `${ORIGIN}/sw.js` },
        });
        server();
        await syncWebPush(
            { ...puter, env: 'gui' },
            { worker: workerFor('gui'), nav },
        );
        expect(stale.unsubscribe).toHaveBeenCalled();
    });

    it('fails with push_unavailable when the server has no key', async () => {
        const nav = makeNav();
        mockRequest.mockResolvedValue({});
        await expect(syncWebPush(puter, { worker, nav })).rejects.toMatchObject(
            {
                code: 'push_unavailable',
            },
        );
    });

    it('subscribes once the worker is active', async () => {
        const installing = makeWorker();
        const nav = makeNav({ installing });
        server(() => ({ status: 'active', device: { uid: 'd4' } }));
        const pending = syncWebPush(puter, { worker, nav });
        await flush();
        expect(nav.serviceWorker.register).toHaveBeenCalled();
        expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
        installing.activate();
        await expect(pending).resolves.toEqual({ uid: 'd4' });
        expect(nav.pushManager.subscribe).toHaveBeenCalledTimes(1);
    });

    it('takes over from another worker once its own activates', async () => {
        const waiting = makeWorker();
        const nav = makeNav({
            waiting,
            active: { scriptURL: `${ORIGIN}/sw.js` },
        });
        server();
        const pending = syncWebPush(puter, { worker, nav });
        await flush();
        waiting.activate();
        await expect(pending).resolves.toEqual({ uid: 'd1' });
    });

    it('rejects push_worker_conflict while another worker keeps its pages', async () => {
        vi.useFakeTimers();
        const nav = makeNav({
            waiting: makeWorker(),
            active: { scriptURL: `${ORIGIN}/sw.js` },
        });
        server();
        const settled = expect(
            syncWebPush(puter, { worker, nav }),
        ).rejects.toMatchObject({
            code: 'push_worker_conflict',
            message: expect.stringContaining('importScripts'),
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await settled;
        expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
    });

    it('rejects push_worker_conflict when no worker of its own is there', async () => {
        const nav = makeNav({ active: { scriptURL: `${ORIGIN}/sw.js` } });
        server();
        await expect(syncWebPush(puter, { worker, nav })).rejects.toMatchObject(
            { code: 'push_worker_conflict' },
        );
    });

    it('never registers over the site`s own worker at that scope', async () => {
        const nav = makeNav({ active: { scriptURL: `${ORIGIN}/sw.js` } });
        server();
        await expect(syncWebPush(puter, { worker, nav })).rejects.toMatchObject(
            { code: 'push_worker_conflict' },
        );
        expect(nav.serviceWorker.getRegistration).toHaveBeenCalledWith(
            `${ORIGIN}/`,
        );
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    });

    it('registers a worker in a folder beside the site`s root worker', async () => {
        const nav = makeNav({
            existing: makeSubscription(),
            active: { scriptURL: `${ORIGIN}/puter/puter-sw.js` },
        });
        nav.serviceWorker.getRegistration.mockResolvedValueOnce({
            scope: `${ORIGIN}/`,
            active: { scriptURL: `${ORIGIN}/sw.js` },
        });
        server();
        await expect(
            syncWebPush(puter, {
                worker: workerFor('web', '/puter/puter-sw.js'),
                nav,
            }),
        ).resolves.toEqual({ uid: 'd1' });
        expect(nav.serviceWorker.getRegistration).toHaveBeenCalledWith(
            `${ORIGIN}/puter/`,
        );
        expect(nav.serviceWorker.register).toHaveBeenCalledWith(
            '/puter/puter-sw.js',
            { updateViaCache: 'none' },
        );
    });

    it('lets the GUI replace an older worker of its own', async () => {
        const nav = makeNav({
            existing: makeSubscription(),
            active: { scriptURL: `${ORIGIN}/sw.js` },
        });
        nav.serviceWorker.getRegistration.mockResolvedValue({
            scope: `${ORIGIN}/`,
            active: { scriptURL: `${ORIGIN}/old-sw.js` },
        });
        server();
        await expect(
            syncWebPush(
                { ...puter, env: 'gui' },
                { worker: workerFor('gui'), nav },
            ),
        ).resolves.toEqual({ uid: 'd1' });
        expect(nav.serviceWorker.register).toHaveBeenCalled();
    });

    it('names a subscription the browser refused push_subscribe_failed, with its message', async () => {
        const nav = makeNav();
        const refusal = new Error('Registration failed - push service error');
        refusal.name = 'AbortError';
        nav.pushManager.subscribe.mockRejectedValue(refusal);
        server();
        let error;
        try {
            await syncWebPush(puter, { worker, nav });
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error).toMatchObject({
            code: 'push_subscribe_failed',
            message: 'Registration failed - push service error',
        });
    });

    it.each(['push_subscription_invalid', 'push_endpoint_revoked'])(
        'replaces a subscription refused with %s, once',
        async (code) => {
            const first = makeSubscription(undefined, 'https://push.example/1');
            const second = makeSubscription(
                undefined,
                'https://push.example/2',
            );
            const nav = makeNav();
            nav.pushManager.subscribe
                .mockResolvedValueOnce(first)
                .mockResolvedValueOnce(second);
            let announced = 0;
            server((route, body) => {
                if (route === '/push/web/subscriptions') {
                    if (announced++ === 0)
                        throw new PuterJSError('refused', code);
                    queueMicrotask(() =>
                        nav.post({
                            type: 'puter-push-challenge',
                            challenge: 'c.sig',
                        }),
                    );
                    return { status: 'pending' };
                }
                return {
                    device: {
                        uid: 'd5',
                        endpoint: body.subscription.endpoint,
                    },
                };
            });
            await expect(syncWebPush(puter, { worker, nav })).resolves.toEqual({
                uid: 'd5',
                endpoint: 'https://push.example/2',
            });
            expect(first.unsubscribe).toHaveBeenCalledTimes(1);
            expect(second.unsubscribe).not.toHaveBeenCalled();
            expect(nav.pushManager.subscribe).toHaveBeenCalledTimes(2);
            expect(announced).toBe(2);
        },
    );

    it.each(['push_subscription_invalid', 'push_endpoint_revoked'])(
        'rejects with %s when the fresh subscription is refused too',
        async (code) => {
            const nav = makeNav();
            server(() => {
                throw new PuterJSError('refused', code);
            });
            await expect(
                syncWebPush(puter, { worker, nav }),
            ).rejects.toMatchObject({ code });
            expect(nav.pushManager.subscribe).toHaveBeenCalledTimes(2);
            expect(mockRequest).toHaveBeenCalledTimes(3);
        },
    );
});

describe('removeWebPush', () => {
    it('tells the server, then ends the subscription', async () => {
        const subscription = makeSubscription();
        const nav = makeNav({ existing: subscription });
        mockRequest.mockResolvedValue({ removed: true });
        await expect(removeWebPush(puter, { worker, nav })).resolves.toBe(true);
        expect(mockRequest).toHaveBeenCalledWith(
            puter,
            'DELETE',
            '/push/web/subscriptions',
            { endpoint: subscription.endpoint },
            { authToken: undefined },
        );
        expect(subscription.unsubscribe).toHaveBeenCalled();
    });
});

describe('workerFor', () => {
    it('uses the GUI worker on the GUI and the app`s own elsewhere', () => {
        expect(workerFor('gui')).toEqual({ url: '/sw.js', scope: '/' });
        expect(workerFor('web')).toEqual({ url: '/puter-sw.js' });
        expect(workerFor('web', '/js/sw.js')).toEqual({ url: '/js/sw.js' });
    });
});

describe('shownFrom', () => {
    const notification = {
        uid: 'n1',
        title: 'Hi',
        text: 'body',
        icon: null,
        target: '/chat/1',
        group: null,
        app: { uid: 'app-1', name: 'Chat' },
    };

    it('defaults to the notification`s own fields', () => {
        expect(shownFrom(notification, undefined)).toEqual({
            title: 'Hi',
            body: 'body',
            tag: 'n1',
            url: '/chat/1',
        });
    });

    it('takes only the shown fields a handler returns as strings', () => {
        expect(
            shownFrom(notification, { title: 'New', body: 7, onclick: 'x' }),
        ).toEqual({ title: 'New', body: 'body', tag: 'n1', url: '/chat/1' });
    });

    it('tags a grouped notification as the server tags its push', () => {
        expect(shownFrom({ ...notification, group: 'room-1' }).tag).toBe(
            'app-1:room-1',
        );
    });

    it('falls back to the app`s icon', () => {
        const app = { ...notification.app, icon: 'https://cdn.test/app.png' };
        expect(shownFrom({ ...notification, app }).icon).toBe(
            'https://cdn.test/app.png',
        );
    });

    it('names only the app for a sensitive notification, whatever the handler says', () => {
        expect(
            shownFrom(
                { ...notification, group: 'room-1', sensitive: true },
                { title: 'Secret', body: 'secret' },
            ),
        ).toEqual({
            title: 'Chat',
            body: 'New notification from Chat',
            tag: 'n1',
        });
    });
});

describe('tapUrl', () => {
    it('reads relative paths from the worker`s scope and stays on its origin', () => {
        const scope = `${ORIGIN}/app/`;
        expect(tapUrl(undefined, scope)).toBe(`${ORIGIN}/app/`);
        expect(tapUrl('chat/1', scope)).toBe(`${ORIGIN}/app/chat/1`);
        expect(tapUrl('/chat/1', scope)).toBe(`${ORIGIN}/chat/1`);
        expect(tapUrl('https://elsewhere.example/x', scope)).toBe(
            `${ORIGIN}/app/`,
        );
    });
});

/** A module with a stand-in feed: `feed.deliver` hands it a notification. */
const makeModule = (over = {}) => {
    const authListeners = new Set();
    const host = {
        ...puter,
        onAuthStateChanged: (listener) => {
            authListeners.add(listener);
            return () => authListeners.delete(listener);
        },
        setAuthToken(token) {
            this.authToken = token;
            for (const listener of [...authListeners]) listener();
        },
        ...over,
    };
    const module = new NotificationsModule(host);
    const feed = { deliver: null, onError: null, opened: 0, off: vi.fn() };
    module.onNotification = vi.fn(async (handler, options) => {
        feed.deliver = handler;
        feed.onError = options.onError;
        feed.opened++;
        return { off: feed.off };
    });
    return { module, feed, host };
};

describe('onPush', () => {
    it('rejects a key the server would not accept as a channel', async () => {
        const { module } = makeModule();
        await expect(module.onPush('Chat!', () => {})).rejects.toMatchObject({
            code: 'invalid_argument',
        });
    });

    it('saves the handler for the worker and runs it for its channel only', async () => {
        const { module, feed } = makeModule();
        const chat = vi.fn();
        const listener = await module.onPush('chat', chat);
        expect(store.get('handlers:chat')).toBe(chat.toString());
        expect(module.onNotification).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ catchUp: false }),
        );

        await feed.deliver({ uid: 'n1', channel: 'other' });
        await feed.deliver({ uid: 'n2', channel: 'chat' });
        expect(chat).toHaveBeenCalledTimes(1);
        expect(chat).toHaveBeenCalledWith({ uid: 'n2', channel: 'chat' });

        await listener.off();
        await listener.off();
        expect(store.has('handlers:chat')).toBe(false);
        expect(feed.off).toHaveBeenCalledTimes(1);
    });

    it('keeps the saved handler while another listener for the key remains', async () => {
        const { module } = makeModule();
        const first = await module.onPush('chat', () => {});
        await module.onPush('chat', () => {});
        await first.off();
        expect(store.has('handlers:chat')).toBe(true);
    });

    it('keeps the handler a quick remount saved while the last one left', async () => {
        const { module } = makeModule();
        const first = await module.onPush('chat', (n) => n.title);
        const second = (n) => ({ title: n.text });
        const leaving = first.off();
        const back = module.onPush('chat', second);
        await Promise.all([leaving, back]);
        expect(store.get('handlers:chat')).toBe(second.toString());
    });

    it('leaves a handler another page saved for the key since', async () => {
        const { module } = makeModule();
        const listener = await module.onPush('chat', () => {});
        store.set('handlers:chat', '() => ({ title: "other tab" })');
        await listener.off();
        expect(store.get('handlers:chat')).toBe(
            '() => ({ title: "other tab" })',
        );
    });

    it.each([
        [
            'a method',
            {
                chat(n) {
                    return n;
                },
            }.chat,
        ],
        [
            'a bound function',
            function chat(n) {
                return n;
            }.bind(null),
        ],
        ['a built-in function', Math.max],
    ])('rejects %s, which the worker could not rebuild', async (_, handler) => {
        const { module } = makeModule();
        await expect(module.onPush('chat', handler)).rejects.toMatchObject({
            code: 'invalid_handler',
        });
        expect(module.onNotification).not.toHaveBeenCalled();
    });

    it('takes the handler as written where the page blocks eval', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        function Blocked() {
            throw new EvalError('Refused to evaluate a string as JavaScript');
        }
        Blocked.prototype = Function.prototype;
        vi.stubGlobal('Function', Blocked);
        try {
            const { module } = makeModule();
            await expect(
                module.onPush('chat', { chat() {} }.chat),
            ).resolves.toBeDefined();
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
            warn.mockRestore();
        }
    });

    it('takes any function inside the Puter desktop, which saves none', async () => {
        const { module } = makeModule({ env: 'app' });
        await expect(
            module.onPush('chat', { chat() {} }.chat),
        ).resolves.toBeDefined();
        expect(store.size).toBe(0);
    });

    it('starts one feed for every key', async () => {
        const { module } = makeModule();
        await module.onPush('chat', () => {});
        await module.onPush('mail', () => {});
        expect(module.onNotification).toHaveBeenCalledTimes(1);
    });

    it('still delivers live when IndexedDB is unavailable, warning once', async () => {
        storage.broken = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { module, feed } = makeModule();
        const chat = vi.fn();
        await module.onPush('chat', chat);
        await module.onPush('mail', () => {});
        await feed.deliver({ uid: 'n1', channel: 'chat' });
        expect(chat).toHaveBeenCalledTimes(1);
        expect(
            warn.mock.calls.filter((c) => String(c[0]).includes('IndexedDB')),
        ).toHaveLength(1);
        warn.mockRestore();
    });

    it('starts the feed again once the user signs back in', async () => {
        const { module, feed, host } = makeModule();
        const chat = vi.fn();
        await module.onPush('chat', chat, { onError: () => {} });

        host.setAuthToken(null);
        feed.onError(new PuterJSError('changed', 'auth_changed'));
        await flush();
        expect(feed.opened).toBe(1);

        host.setAuthToken('t2');
        await flush();
        expect(feed.opened).toBe(2);
        await feed.deliver({ uid: 'n1', channel: 'chat' });
        expect(chat).toHaveBeenCalledTimes(1);
    });

    it('starts the feed again at once when the token changes to another', async () => {
        const { module, feed, host } = makeModule();
        await module.onPush('chat', () => {}, { onError: () => {} });
        host.authToken = 't2';
        feed.onError(new PuterJSError('changed', 'auth_changed'));
        await flush();
        expect(feed.opened).toBe(2);
    });

    describe('on load', () => {
        it('syncs nothing for a user who never turned push on here', async () => {
            withBrowser(makeNav({ existing: makeSubscription() }));
            server();
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            expect(mockRequest).not.toHaveBeenCalled();
        });

        it('syncs once for every onPush on the page when the user turned push on', async () => {
            store.set(OPT_IN, true);
            withBrowser(makeNav({ existing: makeSubscription() }));
            server();
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await module.onPush('mail', () => {});
            await module.onPush('news', () => {});
            await flush();
            expect(
                mockRequest.mock.calls.filter(
                    ([, method]) => method === 'POST',
                ),
            ).toHaveLength(1);
        });

        it.each([
            'push_disabled',
            'push_revoked',
            'push_unavailable',
            'too_many_requests',
        ])('keeps quiet about %s', async (code) => {
            store.set(OPT_IN, true);
            withBrowser(makeNav({ existing: makeSubscription() }));
            server(() => {
                throw new PuterJSError('no', code);
            });
            const error = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const onError = vi.fn();
            const { module } = makeModule();
            await module.onPush('chat', () => {}, { onError });
            await flush();
            expect(onError).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
            expect(store.has(OPT_IN)).toBe(code !== 'push_revoked');
            error.mockRestore();
        });

        it('reports any other failure as a sync failure', async () => {
            store.set(OPT_IN, true);
            withBrowser(makeNav({ existing: makeSubscription() }));
            server(() => {
                throw new PuterJSError('down', 'internal_error');
            });
            const error = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            expect(error).toHaveBeenCalledWith(
                '[puter.notifications] could not keep the push subscription current',
                expect.objectContaining({ code: 'internal_error' }),
            );

            const onError = vi.fn();
            const { module: other } = makeModule();
            await other.onPush('chat', () => {}, { onError });
            await flush();
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'internal_error' }),
            );
            error.mockRestore();
        });
    });

    describe('live delivery while the user is elsewhere', () => {
        let nav;
        const page = ({ visibilityState = 'visible', focused = true } = {}) => {
            globalThis.document = { visibilityState, hasFocus: () => focused };
        };
        const away = () => page({ visibilityState: 'hidden', focused: false });

        beforeEach(() => {
            nav = makeNav({ active: null });
            nav.registration.showNotification = vi.fn(async () => {});
            withBrowser(nav);
            mockRequest.mockResolvedValue({});
        });

        afterEach(() => {
            delete globalThis.document;
        });

        it.each([
            ['hidden', { visibilityState: 'hidden', focused: false }],
            ['visible in an unfocused window', { focused: false }],
        ])(
            'shows the handler`s result when the page is %s',
            async (_, state) => {
                page(state);
                const { module, feed } = makeModule();
                await module.onPush('chat', () => ({
                    title: 'From the handler',
                }));
                await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
                expect(nav.registration.showNotification).toHaveBeenCalledWith(
                    'From the handler',
                    expect.objectContaining({
                        tag: 'n1',
                        renotify: false,
                        data: {
                            puter: expect.objectContaining({
                                uid: 'n1',
                                url: `${ORIGIN}/`,
                            }),
                        },
                    }),
                );
            },
        );

        it('shows a notification no handler takes, as sent', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => ({ title: 'not this one' }));
            await feed.deliver({
                uid: 'n1',
                channel: null,
                title: 'Hi',
                text: 'there',
                target: '/c/1',
            });
            expect(nav.registration.showNotification).toHaveBeenCalledWith(
                'Hi',
                expect.objectContaining({
                    body: 'there',
                    data: {
                        puter: expect.objectContaining({
                            url: `${ORIGIN}/c/1`,
                        }),
                    },
                }),
            );
        });

        it('tags a grouped notification as its push and alerts again', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await feed.deliver({
                uid: 'n1',
                channel: 'chat',
                title: 'Hi',
                group: 'room-1',
                app: { uid: 'app-1', name: 'Chat' },
            });
            expect(nav.registration.showNotification).toHaveBeenCalledWith(
                'Hi',
                expect.objectContaining({
                    tag: 'app-1:room-1',
                    renotify: true,
                }),
            );
        });

        it('names only the app for a sensitive notification', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => ({ title: 'Secret' }));
            await feed.deliver({
                uid: 'n1',
                channel: 'chat',
                title: 'Secret',
                target: '/secret',
                data: { id: 1 },
                sensitive: true,
                app: { uid: 'app-1', name: 'Chat' },
            });
            expect(nav.registration.showNotification).toHaveBeenCalledWith(
                'Chat',
                {
                    body: 'New notification from Chat',
                    tag: 'n1',
                    renotify: false,
                    data: {
                        puter: {
                            uid: 'n1',
                            target: null,
                            data: null,
                            url: `${ORIGIN}/`,
                        },
                    },
                },
            );
        });

        it('shows the notification when its handler outlasts 5 seconds', async () => {
            vi.useFakeTimers();
            away();
            const onError = vi.fn();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => new Promise(() => {}), {
                onError,
            });
            const delivered = feed.deliver({
                uid: 'n1',
                channel: 'chat',
                title: 'Hi',
            });
            await vi.advanceTimersByTimeAsync(5_000);
            await delivered;
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'push_handler_timeout' }),
            );
            expect(nav.registration.showNotification).toHaveBeenCalledWith(
                'Hi',
                expect.any(Object),
            );
        });

        it('looks up the registration of the worker it was given', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {}, {
                serviceWorker: '/js/sw.js',
            });
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(nav.serviceWorker.getRegistration).toHaveBeenLastCalledWith(
                '/js/sw.js',
            );
        });

        it('reads the tap URL from the worker`s scope', async () => {
            away();
            nav.registration.scope = `${ORIGIN}/app/`;
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(
                nav.registration.showNotification.mock.calls[0][1].data.puter
                    .url,
            ).toBe(`${ORIGIN}/app/`);
        });

        it('hands the notification to push-sw.js, which may hold it back', async () => {
            away();
            const posted = [];
            nav.registration.active = {
                scriptURL: SCRIPT,
                postMessage: (message, [port]) => {
                    posted.push(message);
                    port.postMessage({ shown: false });
                },
            };
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(posted).toEqual([
                {
                    type: 'puter-push-show',
                    title: 'Hi',
                    options: expect.objectContaining({ tag: 'n1' }),
                },
            ]);
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
        });

        it('shows it itself when an older push-sw.js never answers', async () => {
            vi.useFakeTimers();
            away();
            nav.registration.active = {
                scriptURL: SCRIPT,
                postMessage: vi.fn(),
            };
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            const delivered = feed.deliver({
                uid: 'n1',
                channel: 'chat',
                title: 'Hi',
            });
            await vi.advanceTimersByTimeAsync(2_000);
            await delivered;
            expect(nav.registration.active.postMessage).toHaveBeenCalled();
            expect(nav.registration.showNotification).toHaveBeenCalledTimes(1);
        });

        it('shows nothing while the page has focus', async () => {
            page();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
        });

        it('shows nothing inside the Puter desktop, which shows its own banner', async () => {
            page({ focused: false });
            const { module, feed } = makeModule({ env: 'app' });
            await module.onPush('chat', () => {});
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
        });
    });

    describe('receipts', () => {
        const answer = (module) => {
            const ack = vi.fn();
            module._noteReceived('n1');
            module._answerReceipt({ uid: 'n1' }, ack);
            return ack.mock.calls[0][0];
        };

        it('says the page shows its own notification while its push feed runs', async () => {
            withBrowser(makeNav());
            const { module } = makeModule();
            expect(answer(module).showsOwn).toBe(false);
            const listener = await module.onPush('chat', () => {});
            await flush();
            expect(answer(module).showsOwn).toBe(true);
            await listener.off();
            expect(answer(module).showsOwn).toBe(false);
        });

        it('says it does not without a registered worker or permission', async () => {
            const nav = makeNav();
            nav.serviceWorker.getRegistration.mockResolvedValue(undefined);
            withBrowser(nav);
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            expect(answer(module).showsOwn).toBe(false);

            withBrowser(makeNav(), 'denied');
            const { module: denied } = makeModule();
            await denied.onPush('chat', () => {});
            await flush();
            expect(answer(denied).showsOwn).toBe(false);
        });
    });
});

describe('clicks from push-sw.js', () => {
    it('acknowledges a tap only while a click handler takes it', () => {
        const nav = makeNav();
        withBrowser(nav);
        const { module } = makeModule();
        const handler = vi.fn();
        module.on('click', handler);
        const source = { postMessage: vi.fn() };
        const tap = {
            type: 'puter-notification-click',
            id: 'click-1',
            notification: { uid: 'n1', target: '/c', data: null },
        };

        nav.post(tap, source);
        expect(source.postMessage).toHaveBeenCalledWith({
            type: 'puter-notification-click-ack',
            id: 'click-1',
        });
        expect(handler).toHaveBeenCalledWith({
            uid: 'n1',
            target: '/c',
            data: null,
        });

        source.postMessage.mockClear();
        module.off('click', handler);
        nav.post(tap, source);
        expect(source.postMessage).not.toHaveBeenCalled();
    });
});

describe('enable', () => {
    it('asks the browser before anything is awaited, and remembers the user turned push on', async () => {
        const nav = makeNav({ existing: makeSubscription() });
        withBrowser(nav, 'default');
        server();
        const { module } = makeModule();
        const pending = module.enable();
        expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
        await expect(pending).resolves.toBe(true);
        expect(store.get(OPT_IN)).toBe(true);
    });

    it('rejects user_gesture_required outside a click, without prompting', async () => {
        withBrowser(makeNav(), 'default');
        Object.defineProperty(globalThis.navigator, 'userActivation', {
            value: { isActive: false },
            configurable: true,
        });
        try {
            const { module } = makeModule();
            await expect(module.enable()).rejects.toMatchObject({
                code: 'user_gesture_required',
            });
            expect(Notification.requestPermission).not.toHaveBeenCalled();
            expect(mockRequest).not.toHaveBeenCalled();
        } finally {
            delete globalThis.navigator.userActivation;
        }
    });

    it('rejects with push_revoked when the user turned the app off in Puter, opens no prompt, and forgets the opt-in', async () => {
        store.set(OPT_IN, true);
        withBrowser(makeNav({ existing: makeSubscription() }));
        server(() => {
            throw new PuterJSError('off', 'push_revoked');
        });
        const { module } = makeModule();
        module.requestPermission = vi.fn(async () => true);
        await expect(module.enable()).rejects.toMatchObject({
            code: 'push_revoked',
        });
        expect(module.requestPermission).not.toHaveBeenCalled();
        expect(Notification.requestPermission).not.toHaveBeenCalled();
        expect(mockRequest).toHaveBeenCalledTimes(2);
        expect(store.has(OPT_IN)).toBe(false);
    });
});

describe('disable', () => {
    it('removes the subscription and forgets the opt-in', async () => {
        store.set(OPT_IN, true);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockResolvedValue({ removed: true });
        const { module } = makeModule();
        await expect(module.disable()).resolves.toBe(true);
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
    });
});

describe('sign-out', () => {
    it('removes the subscription with the leaving user`s token and forgets their push state', async () => {
        store.set(OPT_IN, true);
        store.set('clicks:n1', { uid: 'n1' });
        store.set('handlers:chat', '() => {}');
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockResolvedValue({ removed: true });
        const { module } = makeModule();

        await module._forgetPush('leaving-token');

        expect(mockRequest).toHaveBeenCalledWith(
            expect.anything(),
            'DELETE',
            '/push/web/subscriptions',
            { endpoint: subscription.endpoint },
            { authToken: 'leaving-token' },
        );
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
        expect(store.has('clicks:n1')).toBe(false);
        expect(store.has('handlers:chat')).toBe(true);
    });

    it('never rejects, and still forgets the push state when the server refuses', async () => {
        store.set(OPT_IN, true);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockRejectedValue(
            new PuterJSError('down', 'internal_error'),
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { module } = makeModule();

        await expect(
            module._forgetPush('leaving-token'),
        ).resolves.toBeUndefined();

        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
        warn.mockRestore();
    });

    it('does nothing inside the Puter desktop', async () => {
        withBrowser(makeNav({ existing: makeSubscription() }));
        const { module } = makeModule({ env: 'app' });
        await module._forgetPush('token');
        expect(mockRequest).not.toHaveBeenCalled();
    });
});
