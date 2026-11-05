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
        SERVER_KEYS_ENTRY: 'puter:server-keys',
        SYNCED_PREFIX: 'puter:synced:',
        SUBSCRIPTION_CHANGED_PREFIX: 'puter:subscription-changed:',
        TAP_BASE_PREFIX: 'puter:tap-base:',
        CLICK_KEEP_MS: 5 * 60 * 1000,
        takeClick: stored(async (uid, id) => {
            const kept = store.get(`clicks:${uid}`);
            if (!kept || (id !== undefined && kept.id !== id)) return null;
            store.delete(`clicks:${uid}`);
            return kept;
        }),
        forgetOldClicks: stored(async () => {
            const cutoff = Date.now() - 5 * 60 * 1000;
            for (const [key, value] of [...store.entries()]) {
                if (key.startsWith('clicks:') && !(value?.at > cutoff))
                    store.delete(key);
            }
        }),
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
            const forgotten = [
                optIn(''),
                'handlers:puter:synced:',
                'handlers:puter:subscription-changed:',
                'clicks:',
            ];
            for (const key of [...store.keys()]) {
                if (forgotten.some((prefix) => key.startsWith(prefix)))
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
const SERVER_KEY = 'handlers:puter:server-key';

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
            getRegistrations: vi.fn(async () => [registration]),
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
            { interactiveReauth: false },
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

    it('says when only the confirmation is left, before it arrives', async () => {
        const nav = makeNav();
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { device: { uid: 'd3' } },
        );
        const onPending = vi.fn();
        const syncing = syncWebPush(puter, { worker, nav, onPending });
        await vi.waitFor(() => expect(onPending).toHaveBeenCalledTimes(1));
        expect(
            mockRequest.mock.calls.some(
                ([, , route]) => route === '/push/web/subscriptions/verify',
            ),
        ).toBe(false);
        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await expect(syncing).resolves.toEqual({ uid: 'd3' });
    });

    it('stops waiting for the confirmation once its signal aborts, without verifying', async () => {
        const nav = makeNav();
        server(() => ({ status: 'pending' }));
        const stop = new AbortController();
        const syncing = syncWebPush(puter, {
            worker,
            nav,
            signal: stop.signal,
            onPending: () => stop.abort(),
        });
        await expect(syncing).rejects.toMatchObject({
            code: 'push_verification_canceled',
        });
        expect(
            mockRequest.mock.calls.map(([, , route]) => route),
        ).not.toContain('/push/web/subscriptions/verify');
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

    describe('with the earlier keys the server lists', () => {
        const listing = () =>
            mockRequest.mockImplementation(async (_p, method, route) =>
                route === '/push/web/key'
                    ? { publicKey: KEY, previousKeys: [OLD_KEY] }
                    : { status: 'active', device: { uid: 'd1' } },
            );

        it('replaces a subscription made with one, though none is stored here', async () => {
            const stale = makeSubscription(fromBase64Url(OLD_KEY));
            const nav = makeNav({ existing: stale });
            listing();
            await syncWebPush(puter, { worker, nav });
            expect(stale.unsubscribe).toHaveBeenCalled();
            expect(nav.pushManager.subscribe).toHaveBeenCalled();
            expect(store.get(SERVER_KEY)).toBe(KEY);
            expect(store.get('handlers:puter:server-keys')).toEqual([
                KEY,
                OLD_KEY,
            ]);
        });

        it('still leaves a subscription made with a key it doesn`t list', async () => {
            const theirs = makeSubscription(new Uint8Array([4, 1, 2]));
            const nav = makeNav({ existing: theirs });
            listing();
            await expect(
                syncWebPush(puter, { worker, nav }),
            ).rejects.toMatchObject({ code: 'push_subscription_conflict' });
            expect(theirs.unsubscribe).not.toHaveBeenCalled();
        });

        it('stores none from a server that lists none', async () => {
            const nav = makeNav({ existing: makeSubscription() });
            server();
            await syncWebPush(puter, { worker, nav });
            expect(store.has('handlers:puter:server-keys')).toBe(false);
        });
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

    it('rejects push_device_removed and keeps the subscription unless told to renew it', async () => {
        const removed = makeSubscription();
        const nav = makeNav({ existing: removed });
        server(() => {
            throw new PuterJSError('removed', 'push_device_removed');
        });
        await expect(syncWebPush(puter, { worker, nav })).rejects.toMatchObject(
            { code: 'push_device_removed' },
        );
        expect(removed.unsubscribe).not.toHaveBeenCalled();
        expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
    });

    it('replaces a subscription the user removed in Puter with renewRemoved, once', async () => {
        const removed = makeSubscription(undefined, 'https://push.example/1');
        const nav = makeNav({ existing: removed });
        nav.pushManager.subscribe.mockResolvedValue(
            makeSubscription(undefined, 'https://push.example/2'),
        );
        server((route, body) => {
            if (body.subscription.endpoint === 'https://push.example/1')
                throw new PuterJSError('removed', 'push_device_removed');
            if (route === '/push/web/subscriptions') {
                queueMicrotask(() =>
                    nav.post({
                        type: 'puter-push-challenge',
                        challenge: 'c.sig',
                    }),
                );
                return { status: 'pending' };
            }
            return { device: { uid: 'd6' } };
        });
        await expect(
            syncWebPush(puter, { worker, nav, renewRemoved: true }),
        ).resolves.toEqual({ uid: 'd6' });
        expect(removed.unsubscribe).toHaveBeenCalledTimes(1);
        expect(nav.pushManager.subscribe).toHaveBeenCalledTimes(1);
    });

    it('replaces a subscription the confirmation finds removed, with renewRemoved', async () => {
        const first = makeSubscription(undefined, 'https://push.example/1');
        const second = makeSubscription(undefined, 'https://push.example/2');
        const nav = makeNav();
        nav.pushManager.subscribe
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
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
            if (body.subscription.endpoint === 'https://push.example/1')
                throw new PuterJSError('removed', 'push_device_removed');
            return { device: { uid: 'd7' } };
        });
        await expect(
            syncWebPush(puter, { worker, nav, renewRemoved: true }),
        ).resolves.toEqual({ uid: 'd7' });
        expect(first.unsubscribe).toHaveBeenCalledTimes(1);
        expect(
            mockRequest.mock.calls.filter(
                ([, , route]) => route === '/push/web/subscriptions/verify',
            ),
        ).toHaveLength(2);
    });

    /** A server that answers pending; `confirm()` hands back the challenge. */
    const pendingServer = (nav) => {
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { device: { uid: 'd8' } },
        );
        return () =>
            nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
    };
    const reauthByRoute = () =>
        Object.fromEntries(
            mockRequest.mock.calls.map(([, , route, , options]) => [
                route,
                options?.interactiveReauth,
            ]),
        );

    it.each([
        [false, undefined],
        [true, true],
    ])(
        'with interactive: %s, lets only the key and the announce open a sign-in',
        async (interactive, given) => {
            const nav = makeNav();
            const confirm = pendingServer(nav);
            const onPending = vi.fn();
            const syncing = syncWebPush(puter, {
                worker,
                nav,
                onPending,
                interactive: given,
            });
            await vi.waitFor(() => expect(onPending).toHaveBeenCalled());
            confirm();
            await syncing;
            expect(reauthByRoute()).toEqual({
                '/push/web/key': interactive,
                '/push/web/subscriptions': interactive,
                '/push/web/subscriptions/verify': false,
            });
        },
    );

    it('subscribes and announces inside withLock, and not at all once push is no longer wanted', async () => {
        const nav = makeNav();
        const order = [];
        server((route) => {
            order.push(route);
            return { status: 'active', device: { uid: 'd1' } };
        });
        const withLock = async (run) => {
            order.push('lock');
            try {
                return await run();
            } finally {
                order.push('unlock');
            }
        };
        nav.pushManager.subscribe.mockImplementation(async () => {
            order.push('subscribe');
            return makeSubscription();
        });
        await syncWebPush(puter, { worker, nav, withLock });
        expect(order).toEqual([
            'lock',
            'subscribe',
            '/push/web/subscriptions',
            'unlock',
        ]);

        mockRequest.mockClear();
        nav.pushManager.subscribe.mockClear();
        await expect(
            syncWebPush(puter, { worker, nav, stillWanted: () => false }),
        ).rejects.toMatchObject({ code: 'push_verification_canceled' });
        expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
        expect(Object.keys(reauthByRoute())).toEqual(['/push/web/key']);
    });

    it.each(['active', 'pending'])(
        'waits for the lock as long as it takes when the server answers %s',
        async (status) => {
            vi.useFakeTimers();
            const unhandled = [];
            const note = (reason) => unhandled.push(reason);
            process.on('unhandledRejection', note);
            try {
                const nav = makeNav();
                server(() => ({ status, device: { uid: 'd9' } }));
                let release;
                const held = new Promise((resolve) => {
                    release = resolve;
                });
                const syncing = syncWebPush(puter, {
                    worker,
                    nav,
                    onPending: () =>
                        nav.post({
                            type: 'puter-push-challenge',
                            challenge: 'c.sig',
                        }),
                    withLock: async (run) => {
                        await held;
                        return await run();
                    },
                });
                await vi.advanceTimersByTimeAsync(31_000);
                release();
                await expect(syncing).resolves.toEqual({ uid: 'd9' });
                await vi.advanceTimersByTimeAsync(0);
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', note);
            }
        },
    );

    it('verifies only while push is still wanted when the confirmation arrives', async () => {
        const nav = makeNav();
        const confirm = pendingServer(nav);
        let wanted = true;
        const syncing = syncWebPush(puter, {
            worker,
            nav,
            onPending: () => {
                wanted = false;
                confirm();
            },
            stillWanted: () => wanted,
        });
        await expect(syncing).rejects.toMatchObject({
            code: 'push_verification_canceled',
        });
        expect(Object.keys(reauthByRoute())).not.toContain(
            '/push/web/subscriptions/verify',
        );
    });
});

describe('removeWebPush', () => {
    /** A browser with a registration per scope, each holding `subscription`. */
    const navWith = (byScope) => {
        const registrations = Object.entries(byScope).map(
            ([scope, subscription]) => ({
                scope: `${ORIGIN}${scope}`,
                pushManager: { getSubscription: async () => subscription },
            }),
        );
        return {
            serviceWorker: {
                getRegistrations: vi.fn(async () => registrations),
                getRegistration: vi.fn(async (path) =>
                    registrations.find((r) =>
                        `${ORIGIN}${path}`.startsWith(r.scope),
                    ),
                ),
            },
        };
    };
    const theirKey = new Uint8Array([4, ...Array(64).fill(9)]);

    it('ends the subscription in the browser, then tells the server', async () => {
        store.set(SERVER_KEY, KEY);
        const order = [];
        const subscription = makeSubscription();
        subscription.unsubscribe.mockImplementation(async () => {
            order.push('unsubscribe');
        });
        mockRequest.mockImplementation(async (_p, method) => {
            order.push(method);
            return { removed: true };
        });
        const nav = makeNav({ existing: subscription });
        await expect(removeWebPush(puter, { worker, nav })).resolves.toBe(true);
        expect(mockRequest).toHaveBeenCalledWith(
            puter,
            'DELETE',
            '/push/web/subscriptions',
            { endpoint: subscription.endpoint },
            {
                authToken: undefined,
                interactiveReauth: false,
                keepalive: false,
            },
        );
        expect(order).toEqual(['unsubscribe', 'DELETE']);
    });

    it('leaves a subscription made with another key alone, and tells the server nothing', async () => {
        store.set(SERVER_KEY, KEY);
        const theirs = makeSubscription(theirKey);
        const nav = makeNav({ existing: theirs });
        await expect(removeWebPush(puter, { worker, nav })).resolves.toBe(
            false,
        );
        expect(theirs.unsubscribe).not.toHaveBeenCalled();
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('without a worker, finds Puter`s subscription in a folder and keeps the site`s own at the root', async () => {
        store.set(SERVER_KEY, KEY);
        const theirs = makeSubscription(theirKey, 'https://push.example/site');
        const ours = makeSubscription();
        const nav = navWith({ '/': theirs, '/push/': ours });
        mockRequest.mockResolvedValue({ removed: true });
        await expect(removeWebPush(puter, { nav })).resolves.toBe(true);
        expect(ours.unsubscribe).toHaveBeenCalled();
        expect(theirs.unsubscribe).not.toHaveBeenCalled();
        expect(mockRequest.mock.calls.map(([, , , body]) => body)).toEqual([
            { endpoint: ours.endpoint },
        ]);
    });

    it('asks the server for Puter`s key, without a sign-in, when none is stored', async () => {
        const theirs = makeSubscription(theirKey, 'https://push.example/site');
        const ours = makeSubscription();
        const nav = navWith({ '/': theirs, '/push/': ours });
        server(() => ({ removed: true }));
        await removeWebPush(puter, { nav, authToken: 'leaving' });
        expect(mockRequest.mock.calls[0]).toEqual([
            puter,
            'GET',
            '/push/web/key',
            undefined,
            { authToken: 'leaving', interactiveReauth: false },
        ]);
        expect(ours.unsubscribe).toHaveBeenCalled();
        expect(theirs.unsubscribe).not.toHaveBeenCalled();
    });

    it('without a worker, also ends one made with a key the server listed as Puter`s', async () => {
        store.set(SERVER_KEY, KEY);
        store.set('handlers:puter:server-keys', [KEY, OLD_KEY]);
        const theirs = makeSubscription(theirKey, 'https://push.example/site');
        const older = makeSubscription(fromBase64Url(OLD_KEY));
        const nav = navWith({ '/': theirs, '/push/': older });
        mockRequest.mockResolvedValue({ removed: true });
        await expect(removeWebPush(puter, { nav })).resolves.toBe(true);
        expect(older.unsubscribe).toHaveBeenCalled();
        expect(theirs.unsubscribe).not.toHaveBeenCalled();
    });

    it('takes the earlier keys from the server when none is stored', async () => {
        const older = makeSubscription(fromBase64Url(OLD_KEY));
        const nav = navWith({ '/push/': older });
        mockRequest.mockImplementation(async (_p, method, route) =>
            route === '/push/web/key'
                ? { publicKey: KEY, previousKeys: [OLD_KEY] }
                : { removed: true },
        );
        await expect(removeWebPush(puter, { nav })).resolves.toBe(true);
        expect(older.unsubscribe).toHaveBeenCalled();
    });

    it('touches nothing when Puter`s key can`t be told', async () => {
        const subscription = makeSubscription();
        const nav = makeNav({ existing: subscription });
        mockRequest.mockRejectedValue(
            new PuterJSError('down', 'internal_error'),
        );
        await expect(removeWebPush(puter, { worker, nav })).resolves.toBe(
            false,
        );
        expect(subscription.unsubscribe).not.toHaveBeenCalled();
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

    it('keeps the first two valid buttons and only their display fields', () => {
        expect(shownFrom(notification, { actions: [
            null, {}, { action: '', title: 'Empty' },
            { action: ' ', title: 'Blank' }, { action: 1, title: 'Number' },
            { action: 'x'.repeat(65), title: 'Long id' },
            { action: 'bad', title: '' }, { action: 'bad', title: ' ' },
            { action: 'bad', title: 1 }, { action: 'bad', title: 'x'.repeat(65) },
            { action: 'accept', title: 'Accept', icon: '/accept.png', extra: 'dropped' },
            { action: 'd'.repeat(64), title: 'D'.repeat(64), icon: 3 },
            { action: 'third', title: 'Third' },
        ] }).actions).toEqual([
            { action: 'accept', title: 'Accept', icon: '/accept.png' },
            { action: 'd'.repeat(64), title: 'D'.repeat(64) },
        ]);
    });

    it.each([null, 'accept', { action: 'accept', title: 'Accept' }])(
        'ignores non-array actions: %s', (actions) => {
            expect(shownFrom(notification, { actions })).not.toHaveProperty('actions');
        },
    );

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
                { title: 'Secret', body: 'secret', actions: [{ action: 'secret', title: 'Secret' }] },
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

/** Web Locks for this test's tabs only, with shared mode and `ifAvailable`. */
const fakeLocks = () => {
    const locks = new Map();
    const lockFor = (name) => {
        if (!locks.has(name))
            locks.set(name, { mode: null, held: 0, queue: [] });
        return locks.get(name);
    };
    const free = (lock, mode) =>
        lock.held === 0 || (mode === 'shared' && lock.mode === 'shared');
    const grant = (lock, { name, mode, callback, resolve, reject }) => {
        lock.mode = mode;
        lock.held++;
        Promise.resolve()
            .then(() => callback({ name, mode }))
            .then(resolve, reject)
            .finally(() => {
                if (--lock.held === 0) lock.mode = null;
                while (lock.queue.length && free(lock, lock.queue[0].mode))
                    grant(lock, lock.queue.shift());
            });
    };
    return {
        request: (name, options, callback) =>
            new Promise((resolve, reject) => {
                const lock = lockFor(name);
                const ask = {
                    name,
                    mode: options.mode ?? 'exclusive',
                    callback,
                    resolve,
                    reject,
                };
                if (lock.queue.length === 0 && free(lock, ask.mode))
                    grant(lock, ask);
                else if (options.ifAvailable)
                    Promise.resolve()
                        .then(() => callback(null))
                        .then(resolve, reject);
                else lock.queue.push(ask);
            }),
    };
};

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

    it('starts its feed from the newest notification in one read', async () => {
        const fetches = [];
        let receive = () => {};
        const pages = [
            { items: [], cursor: 'end-1' },
            {
                items: [
                    {
                        id: 'n2',
                        op: 'post',
                        uid: 'n2',
                        type: 'app.message',
                        notification: { title: 'Hi', channel: 'chat' },
                        ts: 1,
                    },
                ],
            },
        ];
        const events = {
            onLocal: vi.fn(async (_subject, handler) => {
                receive = handler;
                return { off: async () => {} };
            }),
            fetch: vi.fn(async (options) => {
                fetches.push(options);
                return pages.shift() ?? { items: [] };
            }),
        };
        const module = new NotificationsModule({
            ...puter,
            events,
            getAppIDFromAuthToken: () => 'app-1',
            onAuthStateChanged: () => () => {},
        });
        const chat = vi.fn();

        const listener = await module.onPush('chat', chat);
        await vi.waitFor(() => expect(fetches).toHaveLength(1));
        expect(fetches[0]).toEqual({
            subject: 'notif:app-user',
            limit: 200,
            from: 'end',
        });

        receive({ event: { op: 'gap', reason: 'reconnect' } });
        await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
        expect(fetches).toEqual([
            { subject: 'notif:app-user', limit: 200, from: 'end' },
            { subject: 'notif:app-user', limit: 200, cursor: 'end-1' },
        ]);
        expect(chat.mock.calls[0][0]).toMatchObject({ uid: 'n2' });
        await listener.off();
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

    describe('across tabs', () => {
        beforeEach(() => {
            Object.defineProperty(globalThis.navigator, 'locks', {
                value: fakeLocks(),
                configurable: true,
            });
        });
        afterEach(() => {
            delete globalThis.navigator.locks;
        });

        it('keeps the saved handler while another tab still uses it, and removes it with the last', async () => {
            const chat = (n) => ({ title: n.text });
            const tabA = await makeModule().module.onPush('chat', chat);
            const tabB = await makeModule().module.onPush('chat', chat);
            await tabA.off();
            expect(store.get('handlers:chat')).toBe(chat.toString());
            await tabB.off();
            expect(store.has('handlers:chat')).toBe(false);
        });

        it('keeps the saved handler for a tab that adds one while the last one leaves', async () => {
            const chat = (n) => ({ title: n.text });
            const tabA = await makeModule().module.onPush('chat', chat);
            const leaving = tabA.off();
            const tabB = makeModule().module.onPush('chat', chat);
            await Promise.all([leaving, tabB]);
            expect(store.get('handlers:chat')).toBe(chat.toString());
        });

        describe('in the back/forward cache', () => {
            let page;
            beforeEach(() => {
                page = new EventTarget();
                globalThis.addEventListener = page.addEventListener.bind(page);
            });
            afterEach(() => {
                delete globalThis.addEventListener;
            });
            const pageEvent = (type, persisted) =>
                page.dispatchEvent(
                    Object.assign(new Event(type), { persisted }),
                );

            it('lets go of the lock while hidden, so another tab can remove the saved handler', async () => {
                const chat = (n) => ({ title: n.text });
                await makeModule().module.onPush('chat', chat);
                const tabB = await makeModule().module.onPush('chat', chat);
                pageEvent('pagehide', true);
                await flush();
                await tabB.off();
                expect(store.has('handlers:chat')).toBe(false);
            });

            it('takes the lock again and saves its handler again when restored', async () => {
                const chat = (n) => ({ title: n.text });
                const { module } = makeModule();
                const cached = await module.onPush('chat', chat);
                const tabB = await makeModule().module.onPush('chat', chat);
                pageEvent('pagehide', true);
                await flush();
                await tabB.off();
                expect(store.has('handlers:chat')).toBe(false);
                pageEvent('pageshow', true);
                await vi.waitFor(() =>
                    expect(store.get('handlers:chat')).toBe(chat.toString()),
                );
                const tabC = await makeModule().module.onPush('chat', chat);
                await tabC.off();
                expect(store.get('handlers:chat')).toBe(chat.toString());
                await cached.off();
                expect(store.has('handlers:chat')).toBe(false);
            });

            it('changes nothing on a pageshow that is not a restore', async () => {
                const chat = (n) => ({ title: n.text });
                await makeModule().module.onPush('chat', chat);
                const tabB = await makeModule().module.onPush('chat', chat);
                pageEvent('pageshow', false);
                await tabB.off();
                expect(store.get('handlers:chat')).toBe(chat.toString());
            });
        });

        it('lets each key go on its own', async () => {
            const tabA = await makeModule().module.onPush('chat', () => {});
            await makeModule().module.onPush('mail', () => {});
            await tabA.off();
            expect(store.has('handlers:chat')).toBe(false);
            expect(store.has('handlers:mail')).toBe(true);
        });
    });

    describe('without Web Locks', () => {
        beforeEach(() => {
            Object.defineProperty(globalThis.navigator, 'locks', {
                value: undefined,
                configurable: true,
            });
        });
        afterEach(() => {
            delete globalThis.navigator.locks;
        });

        it('keeps the saved handler, since it cannot tell whether another tab uses it', async () => {
            const { module } = makeModule();
            const listener = await module.onPush('chat', () => {});
            expect(store.has('handlers:chat')).toBe(true);
            await listener.off();
            expect(store.has('handlers:chat')).toBe(true);
        });
    });

    describe('tap base', () => {
        const TAP_BASE = 'handlers:puter:tap-base:';

        it.each([
            [
                'the worker`s folder for a page inside it',
                `${ORIGIN}/app/index.html`,
                '/app/puter-sw.js',
                `${ORIGIN}/app/`,
                `${ORIGIN}/app/`,
            ],
            [
                'the site`s root for a page outside the folder',
                `${ORIGIN}/`,
                '/puter/puter-sw.js',
                `${ORIGIN}/puter/`,
                `${ORIGIN}/`,
            ],
            [
                'the root for the default worker',
                `${ORIGIN}/chat`,
                undefined,
                `${ORIGIN}/`,
                `${ORIGIN}/`,
            ],
        ])('saves %s', async (_, href, serviceWorker, scope, base) => {
            globalThis.location = { href, origin: ORIGIN };
            const { module } = makeModule();
            await module.onPush('chat', () => {}, { serviceWorker });
            await flush();
            expect(store.get(`${TAP_BASE}${scope}`)).toBe(base);
        });

        it('is saved by enable() too', async () => {
            withBrowser(
                makeNav({
                    active: { scriptURL: `${ORIGIN}/puter/puter-sw.js` },
                }),
            );
            server();
            const { module } = makeModule();
            await module.enable({ serviceWorker: '/puter/puter-sw.js' });
            expect(store.get(`${TAP_BASE}${ORIGIN}/puter/`)).toBe(`${ORIGIN}/`);
        });
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
            withBrowser(makeNav());
            server();
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            expect(mockRequest).not.toHaveBeenCalled();
        });

        it.each([
            ['a user who never turned push on here', {}],
            ['a visitor who is not signed in', { authToken: null }],
        ])(
            'ends Puter`s subscription in the browser only, for %s',
            async (_label, over) => {
                store.set(SERVER_KEY, KEY);
                const subscription = makeSubscription();
                withBrowser(makeNav({ existing: subscription }));
                const { module } = makeModule(over);
                await module.onPush('chat', () => {}, { onError: () => {} });
                await vi.waitFor(() =>
                    expect(subscription.unsubscribe).toHaveBeenCalled(),
                );
                expect(mockRequest).not.toHaveBeenCalled();
            },
        );

        it('leaves the subscription alone when the opt-ins can`t be read', async () => {
            store.set(SERVER_KEY, KEY);
            storage.broken = true;
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const subscription = makeSubscription();
            withBrowser(makeNav({ existing: subscription }));
            const { module } = makeModule();
            await module.onPush('chat', () => {}, { onError: () => {} });
            await flush();
            await flush();
            expect(subscription.unsubscribe).not.toHaveBeenCalled();
            warn.mockRestore();
        });

        it('leaves another service`s subscription alone', async () => {
            store.set(SERVER_KEY, KEY);
            const theirs = makeSubscription(new Uint8Array([4, 1, 2]));
            withBrowser(makeNav({ existing: theirs }));
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            await flush();
            expect(theirs.unsubscribe).not.toHaveBeenCalled();
        });

        it('removes taps kept longer than five minutes', async () => {
            store.set('clicks:old', {
                uid: 'old',
                at: Date.now() - 6 * 60 * 1000,
            });
            store.set('clicks:fresh', { uid: 'fresh', at: Date.now() });
            withBrowser(makeNav());
            server();
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            expect(store.has('clicks:old')).toBe(false);
            expect(store.has('clicks:fresh')).toBe(true);
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
            'reauth_required',
            'token_auth_failed',
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

        it('never opens a sign-in, nor when the browser replaces the subscription', async () => {
            store.set(OPT_IN, true);
            const nav = makeNav({ existing: makeSubscription() });
            withBrowser(nav);
            server();
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await vi.waitFor(() =>
                expect(mockRequest).toHaveBeenCalledTimes(2),
            );
            nav.post({ type: 'puter-push-subscription-changed' });
            await vi.waitFor(() =>
                expect(mockRequest).toHaveBeenCalledTimes(4),
            );
            expect(
                mockRequest.mock.calls.map(([, , route, , options]) => [
                    route,
                    options,
                ]),
            ).toEqual([
                ['/push/web/key', { interactiveReauth: false }],
                ['/push/web/subscriptions', { interactiveReauth: false }],
                ['/push/web/key', { interactiveReauth: false }],
                ['/push/web/subscriptions', { interactiveReauth: false }],
            ]);
        });

        it('ends a subscription the user removed in Puter, quietly, and keeps pushes off until enable()', async () => {
            store.set(OPT_IN, true);
            const removed = makeSubscription();
            const nav = makeNav({ existing: removed });
            withBrowser(nav);
            server(() => {
                throw new PuterJSError('removed', 'push_device_removed');
            });
            const error = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const onError = vi.fn();
            const { module } = makeModule();
            await module.onPush('chat', () => {}, { onError });
            await vi.waitFor(() => expect(store.has(OPT_IN)).toBe(false));
            expect(removed.unsubscribe).toHaveBeenCalledTimes(1);
            expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
            expect(
                mockRequest.mock.calls.map(([, method]) => method),
            ).not.toContain('DELETE');
            expect(onError).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();

            nav.pushManager.getSubscription.mockResolvedValue(null);
            await expect(module.status()).resolves.toBe('off');
            mockRequest.mockClear();
            const { module: reloaded } = makeModule();
            await reloaded.onPush('chat', () => {});
            await flush();
            expect(mockRequest).not.toHaveBeenCalled();
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

    describe('on load after the server confirmed this browser', () => {
        const ENDPOINT = 'https://push.example/send/abc';
        const SYNCED = 'handlers:puter:synced:u-1';
        const CHANGED = `handlers:puter:subscription-changed:${ORIGIN}/`;
        const NEW_KEY = Buffer.from([4, ...Array(64).fill(5)]).toString(
            'base64url',
        );
        const routes = () => mockRequest.mock.calls.map(([, , r]) => r);
        const confirmed = (over = {}) => {
            store.set(OPT_IN, true);
            store.set(SERVER_KEY, KEY);
            store.set(SYNCED, { endpoint: ENDPOINT, at: Date.now(), ...over });
        };
        const statusSays = (answer) =>
            mockRequest.mockImplementation(async (_p, _m, route) => {
                if (route === '/push/web/subscriptions/status') {
                    if (answer instanceof Error) throw answer;
                    return answer;
                }
                if (route === '/push/web/key') return { publicKey: KEY };
                return { status: 'active', device: { uid: 'd1' } };
            });
        const load = async () => {
            const { module } = makeModule();
            await module.onPush('chat', () => {}, { onError: () => {} });
            for (let i = 0; i < 5; i++) await flush();
            return module;
        };

        it.each([
            ['a server that names no key', { state: 'active' }],
            [
                'a server that names the same key',
                { state: 'active', publicKey: KEY },
            ],
        ])(
            'only asks the server about the subscription, on %s',
            async (_label, answer) => {
                confirmed();
                withBrowser(makeNav({ existing: makeSubscription() }));
                statusSays(answer);
                await load();
                expect(routes()).toEqual(['/push/web/subscriptions/status']);
            },
        );

        it('has the browser look for a newer worker script, without waiting for it', async () => {
            confirmed();
            const nav = makeNav({ existing: makeSubscription() });
            nav.registration.update = vi.fn(() => new Promise(() => {}));
            withBrowser(nav);
            statusSays({ state: 'active' });
            await load();
            expect(nav.registration.update).toHaveBeenCalledTimes(1);
            expect(routes()).toEqual(['/push/web/subscriptions/status']);
        });

        it('ends a subscription the user removed in Puter, after only asking', async () => {
            confirmed();
            const subscription = makeSubscription();
            const nav = makeNav({ existing: subscription });
            withBrowser(nav);
            statusSays({ state: 'removed' });
            await load();
            expect(routes()).toEqual(['/push/web/subscriptions/status']);
            expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
            expect(store.has(OPT_IN)).toBe(false);
            expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
        });

        it('keeps pushes off once the user turned the app off in Puter, after only asking', async () => {
            confirmed();
            const subscription = makeSubscription();
            withBrowser(makeNav({ existing: subscription }));
            statusSays({ state: 'revoked' });
            await load();
            expect(routes()).toEqual(['/push/web/subscriptions/status']);
            expect(store.has(OPT_IN)).toBe(false);
            expect(subscription.unsubscribe).not.toHaveBeenCalled();
        });

        it.each([
            ['removed', 'a new subscription'],
            ['revoked', 'a new subscription'],
            ['removed', 'a new confirmation'],
        ])(
            'leaves things alone when the server says %s but another tab`s enable() made %s meanwhile',
            async (state, change) => {
                confirmed();
                const stale = makeSubscription();
                const fresh = makeSubscription(
                    fromBase64Url(KEY),
                    'https://push.example/send/new',
                );
                const nav = makeNav({ existing: stale });
                withBrowser(nav);
                let answer;
                mockRequest.mockImplementation(
                    () =>
                        new Promise((resolve) => {
                            answer = resolve;
                        }),
                );
                await load();
                expect(routes()).toEqual(['/push/web/subscriptions/status']);
                if (change === 'a new subscription') {
                    nav.pushManager.getSubscription.mockResolvedValue(fresh);
                    store.set(SYNCED, {
                        endpoint: fresh.endpoint,
                        at: Date.now() + 1,
                    });
                } else {
                    store.set(SYNCED, {
                        endpoint: ENDPOINT,
                        at: Date.now() + 1,
                    });
                }
                answer({ state });
                for (let i = 0; i < 5; i++) await flush();
                expect(stale.unsubscribe).not.toHaveBeenCalled();
                expect(fresh.unsubscribe).not.toHaveBeenCalled();
                expect(store.get(OPT_IN)).toBe(true);
            },
        );

        it.each([
            [
                'a sync over a day old',
                { at: Date.now() - 25 * 60 * 60 * 1000 },
                { state: 'active' },
            ],
            [
                'another subscription',
                { endpoint: 'https://push.example/send/other' },
                { state: 'active' },
            ],
            ['an unknown subscription', {}, { state: 'unknown' }],
            [
                'a server that can`t tell',
                {},
                new PuterJSError('Not Found', 'not_found'),
            ],
            ['a new key', {}, { state: 'active', publicKey: NEW_KEY }],
        ])('registers again after %s', async (_label, over, answer) => {
            confirmed(over);
            withBrowser(makeNav({ existing: makeSubscription() }));
            statusSays(answer);
            await load();
            expect(routes()).toEqual(
                expect.arrayContaining([
                    '/push/web/key',
                    '/push/web/subscriptions',
                ]),
            );
            expect(store.get(SYNCED).at).toBeGreaterThan(
                Date.now() - 60 * 1000,
            );
        });

        it('remembers a confirmed subscription, so the next load only asks', async () => {
            store.set(OPT_IN, true);
            withBrowser(makeNav({ existing: makeSubscription() }));
            statusSays({ state: 'active' });
            await load();
            expect(routes()).toEqual([
                '/push/web/key',
                '/push/web/subscriptions',
            ]);
            expect(store.get(SYNCED)).toEqual({
                endpoint: ENDPOINT,
                at: expect.any(Number),
            });

            mockRequest.mockClear();
            await load();
            expect(routes()).toEqual(['/push/web/subscriptions/status']);
        });

        it('remembers a subscription once its confirmation is verified', async () => {
            store.set(OPT_IN, true);
            const nav = makeNav();
            withBrowser(nav);
            server((route) =>
                route === '/push/web/subscriptions'
                    ? { status: 'pending' }
                    : { device: { uid: 'd2' } },
            );
            await load();
            expect(store.has(SYNCED)).toBe(false);
            nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
            await vi.waitFor(() =>
                expect(store.get(SYNCED)?.endpoint).toBe(ENDPOINT),
            );
        });

        it('registers again, and forgets the mark, after the worker saw the browser replace the subscription', async () => {
            confirmed();
            store.set(CHANGED, 1);
            withBrowser(makeNav({ existing: makeSubscription() }));
            statusSays({ state: 'active' });
            await load();
            expect(routes()).toEqual([
                '/push/web/key',
                '/push/web/subscriptions',
            ]);
            expect(store.has(CHANGED)).toBe(false);
        });

        it('registers in full when the worker says the browser replaced the subscription', async () => {
            confirmed();
            const nav = makeNav({ existing: makeSubscription() });
            withBrowser(nav);
            statusSays({ state: 'active' });
            await load();
            expect(routes()).toEqual(['/push/web/subscriptions/status']);
            nav.post({ type: 'puter-push-subscription-changed' });
            await vi.waitFor(() =>
                expect(routes()).toEqual([
                    '/push/web/subscriptions/status',
                    '/push/web/key',
                    '/push/web/subscriptions',
                ]),
            );
        });

        it('lets enable() register in full', async () => {
            confirmed();
            withBrowser(makeNav({ existing: makeSubscription() }));
            statusSays({ state: 'active' });
            const { module } = makeModule();
            await expect(module.enable()).resolves.toBe(true);
            expect(routes()).toEqual([
                '/push/web/key',
                '/push/web/subscriptions',
            ]);
        });

        it('is forgotten by disable()', async () => {
            confirmed();
            store.set(CHANGED, 1);
            withBrowser(makeNav({ existing: makeSubscription() }));
            mockRequest.mockResolvedValue({ removed: true });
            const { module } = makeModule();
            await module.disable();
            expect(store.has(SYNCED)).toBe(false);
            expect(store.has(CHANGED)).toBe(false);
        });
    });

    describe('live delivery while the user is elsewhere', () => {
        let nav;
        const page = ({ visibilityState = 'visible', focused = true } = {}) => {
            globalThis.document = { visibilityState, hasFocus: () => focused };
        };
        const away = () => page({ visibilityState: 'hidden', focused: false });

        beforeEach(() => {
            store.set(OPT_IN, true);
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

        it.each([true, false, 'true', 1, null, undefined])(
            'passes only a boolean requireInteraction to the browser: %s',
            async (requireInteraction) => {
                away();
                const { module, feed } = makeModule();
                await module.onPush('chat', () => ({ requireInteraction }));
                await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
                const options =
                    nav.registration.showNotification.mock.calls[0][1];
                if (typeof requireInteraction === 'boolean')
                    expect(options.requireInteraction).toBe(requireInteraction);
                else expect(options).not.toHaveProperty('requireInteraction');
            },
        );

        it('passes action buttons through the page display path', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => ({
                actions: [{ action: 'accept', title: 'Accept' }],
            }));
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(nav.registration.showNotification).toHaveBeenCalledWith('Hi', expect.objectContaining({
                actions: [{ action: 'accept', title: 'Accept' }],
            }));
        });

        it('closes the OS notification this page showed when its uid is dismissed', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            const { data } = nav.registration.showNotification.mock.calls[0][1];
            const close = vi.fn();
            nav.registration.getNotifications = vi.fn(async () => [{ data, close }]);
            await module._receiveDismissal('n1');
            expect(close).toHaveBeenCalledOnce();
        });

        it('keeps a late live posting from reopening a dismissed notification', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await module._receiveDismissal('n1');
            module._noteReceived('n1');
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Late' });
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
        });

        it('keeps a slow handler from showing an already dismissed notification', async () => {
            away();
            const { module, feed } = makeModule();
            let finish;
            await module.onPush('chat', () => new Promise((resolve) => { finish = resolve; }));
            const delivery = feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            await module._receiveDismissal('n1');
            finish({ title: 'Too late' });
            await delivery;
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
        });

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

        it('reads the tap URL from the saved tap base', async () => {
            away();
            nav.registration.scope = `${ORIGIN}/puter/`;
            const { module, feed } = makeModule();
            await module.onPush('chat', () => ({ url: 'chat/1' }), {
                serviceWorker: '/puter/puter-sw.js',
            });
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(
                nav.registration.showNotification.mock.calls[0][1].data.puter
                    .url,
            ).toBe(`${ORIGIN}/chat/1`);
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
            await module.onPush('chat', () => ({ actions: [{ action: 'accept', title: 'Accept' }] }));
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(posted).toEqual([
                {
                    type: 'puter-push-show',
                    title: 'Hi',
                    options: expect.objectContaining({ tag: 'n1', actions: [{ action: 'accept', title: 'Accept' }] }),
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

        it('shows nothing while push is off here for the user', async () => {
            store.delete(OPT_IN);
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
        });

        it('shows nothing after disable()', async () => {
            away();
            const { module, feed } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            await module.disable();
            await feed.deliver({ uid: 'n1', channel: 'chat', title: 'Hi' });
            expect(nav.registration.showNotification).not.toHaveBeenCalled();
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
            store.set(OPT_IN, true);
            withBrowser(makeNav());
            const { module } = makeModule();
            expect(answer(module).showsOwn).toBe(false);
            const listener = await module.onPush('chat', () => {});
            await flush();
            expect(answer(module).showsOwn).toBe(true);
            await listener.off();
            expect(answer(module).showsOwn).toBe(false);
        });

        it('says it does not while push is off here, so pushes reach other devices', async () => {
            withBrowser(makeNav({ existing: makeSubscription() }));
            mockRequest.mockResolvedValue({ removed: true });
            const { module } = makeModule();
            await module.onPush('chat', () => {});
            await flush();
            expect(answer(module).showsOwn).toBe(false);

            store.set(OPT_IN, true);
            const { module: optedIn } = makeModule();
            await optedIn.onPush('chat', () => {});
            await flush();
            expect(answer(optedIn).showsOwn).toBe(true);
            await optedIn.disable();
            expect(answer(optedIn).showsOwn).toBe(false);
        });

        it('hears another tab turn push off or on', async () => {
            store.set(OPT_IN, true);
            withBrowser(makeNav({ existing: makeSubscription() }));
            server((route) =>
                route === '/push/web/subscriptions'
                    ? { status: 'active', device: { uid: 'd1' } }
                    : { removed: true },
            );
            const { module: hidden } = makeModule();
            await hidden.onPush('chat', () => {});
            await vi.waitFor(() => expect(answer(hidden).showsOwn).toBe(true));

            const { module: other } = makeModule();
            await other.disable();
            await vi.waitFor(() => expect(answer(hidden).showsOwn).toBe(false));

            await other.enable();
            await vi.waitFor(() => expect(answer(hidden).showsOwn).toBe(true));
        });

        it('says it does not without a registered worker or permission', async () => {
            store.set(OPT_IN, true);
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
    it.each([undefined, '', null, 3, 'accept'])('acknowledges a tap with action %s only while a click handler takes it', (action) => {
        const nav = makeNav();
        withBrowser(nav);
        const { module } = makeModule();
        const handler = vi.fn();
        module.on('click', handler);
        const source = { postMessage: vi.fn() };
        const tap = {
            type: 'puter-notification-click',
            id: 'click-1',
            notification: { uid: 'n1', target: '/c', data: null, action },
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
            action: action === 'accept' ? 'accept' : null,
        });

        source.postMessage.mockClear();
        module.off('click', handler);
        nav.post(tap, source);
        expect(source.postMessage).not.toHaveBeenCalled();
    });

    const keptTap = {
        type: 'puter-notification-click',
        id: 'click-1',
        kept: true,
        notification: { uid: 'n1', target: '/c', data: null },
    };
    const clickModule = () => {
        const nav = makeNav();
        withBrowser(nav);
        const { module } = makeModule();
        const handler = vi.fn();
        module.on('click', handler);
        return { nav, handler, source: { postMessage: vi.fn() } };
    };

    it.each([null, 'accept'])('takes a tap with action %s the worker kept for it, then acknowledges it', async (action) => {
        const { nav, handler, source } = clickModule();
        store.set('clicks:n1', { uid: 'n1', at: Date.now(), id: 'click-1' });
        nav.post({ ...keptTap, notification: { ...keptTap.notification, action } }, source);
        await flush();
        expect(store.has('clicks:n1')).toBe(false);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ uid: 'n1', target: '/c', data: null, action });
        expect(source.postMessage).toHaveBeenCalledWith({
            type: 'puter-notification-click-ack',
            id: 'click-1',
        });
    });

    it('leaves a tap the worker already took back', async () => {
        const { nav, handler, source } = clickModule();
        nav.post(keptTap, source);
        await flush();
        expect(handler).not.toHaveBeenCalled();
        expect(source.postMessage).not.toHaveBeenCalled();
    });

    it('leaves a tap the worker kept again for the page it opened', async () => {
        const { nav, handler, source } = clickModule();
        store.set('clicks:n1', { uid: 'n1', at: Date.now() });
        nav.post(keptTap, source);
        await flush();
        expect(handler).not.toHaveBeenCalled();
        expect(store.has('clicks:n1')).toBe(true);
    });

    it('leaves a kept tap to the worker when IndexedDB fails here', async () => {
        const { nav, handler, source } = clickModule();
        store.set('clicks:n1', { uid: 'n1', at: Date.now(), id: 'click-1' });
        storage.broken = true;
        nav.post(keptTap, source);
        await flush();
        expect(handler).not.toHaveBeenCalled();
        expect(source.postMessage).not.toHaveBeenCalled();
    });

    it('runs the tap once when the worker posts it twice', async () => {
        const { nav, handler, source } = clickModule();
        store.set('clicks:n1', { uid: 'n1', at: Date.now(), id: 'click-1' });
        nav.post(keptTap, source);
        nav.post(keptTap, source);
        await flush();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    describe('in the URL of a page a tap opened', () => {
        beforeEach(() => {
            globalThis.location = {
                href: `${ORIGIN}/chat?puter.notification=n1`,
                origin: ORIGIN,
            };
        });

        it.each([undefined, 'decline'])('goes to the first click handler with action %s, once', async (action) => {
            store.set('clicks:n1', {
                uid: 'n1',
                target: '/c',
                data: 1,
                action,
                at: Date.now(),
            });
            const { handler } = clickModule();
            await flush();
            expect(handler).toHaveBeenCalledWith({
                uid: 'n1',
                target: '/c',
                data: 1,
                action: action ?? null,
            });
            expect(store.has('clicks:n1')).toBe(false);
        });

        it('is dropped once older than five minutes', async () => {
            store.set('clicks:n1', {
                uid: 'n1',
                at: Date.now() - 6 * 60 * 1000,
            });
            const { handler } = clickModule();
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect(store.has('clicks:n1')).toBe(false);
        });

        it('is removed when no click handler comes within 10 seconds of load', async () => {
            vi.useFakeTimers();
            globalThis.document = { readyState: 'complete' };
            try {
                store.set('clicks:n1', { uid: 'n1', at: Date.now() });
                makeModule();
                await vi.advanceTimersByTimeAsync(9_000);
                expect(store.has('clicks:n1')).toBe(true);
                await vi.advanceTimersByTimeAsync(1_000);
                expect(store.has('clicks:n1')).toBe(false);
            } finally {
                delete globalThis.document;
            }
        });

        it('stays for a click handler added within 10 seconds of load', async () => {
            vi.useFakeTimers();
            globalThis.document = { readyState: 'complete' };
            try {
                store.set('clicks:n1', { uid: 'n1', at: Date.now() });
                withBrowser(makeNav());
                const { module } = makeModule();
                await vi.advanceTimersByTimeAsync(5_000);
                const handler = vi.fn();
                module.on('click', handler);
                await vi.advanceTimersByTimeAsync(10_000);
                expect(handler).toHaveBeenCalledTimes(1);
            } finally {
                delete globalThis.document;
            }
        });
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

    it('resolves once the server has the subscription and confirms the browser in the background', async () => {
        const nav = makeNav();
        withBrowser(nav);
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { device: { uid: 'd2' } },
        );
        const { module } = makeModule();
        await expect(module.enable()).resolves.toBe(true);
        expect(store.get(OPT_IN)).toBe(true);
        const verifies = () =>
            mockRequest.mock.calls.filter(
                ([, , route]) => route === '/push/web/subscriptions/verify',
            );
        expect(verifies()).toHaveLength(0);

        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await vi.waitFor(() => expect(verifies()).toHaveLength(1));
        expect(verifies()[0][3]).toMatchObject({ challenge: 'c.sig' });
    });

    it('reports a confirmation that never arrives, keeps the opt-in, and the next load tries again', async () => {
        vi.useFakeTimers();
        const nav = makeNav();
        withBrowser(nav);
        server(() => ({ status: 'pending' }));
        const onError = vi.fn();
        const { module } = makeModule();
        await module.onPush('chat', () => {}, { onError });
        await expect(module.enable()).resolves.toBe(true);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'push_verification_timeout' }),
        );
        expect(store.get(OPT_IN)).toBe(true);

        mockRequest.mockClear();
        const { module: reloaded } = makeModule();
        await reloaded.onPush('chat', () => {}, { onError: () => {} });
        await vi.advanceTimersByTimeAsync(0);
        expect(mockRequest).toHaveBeenCalledWith(
            expect.anything(),
            'POST',
            '/push/web/subscriptions',
            expect.anything(),
            { interactiveReauth: false },
        );
    });

    it('waits for the confirmation in the Puter GUI, which reads the device right after', async () => {
        const nav = makeNav({ active: { scriptURL: `${ORIGIN}/sw.js` } });
        withBrowser(nav);
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { device: { uid: 'd2' } },
        );
        const { module } = makeModule({ env: 'gui' });
        let done = false;
        const enabling = (async () => {
            const on = await module.enable();
            done = true;
            return on;
        })();
        await vi.waitFor(() =>
            expect(
                mockRequest.mock.calls.map(([, , route]) => route),
            ).toContain('/push/web/subscriptions'),
        );
        await flush();
        expect(done).toBe(false);
        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await expect(enabling).resolves.toBe(true);
    });

    it('lets the key and the announce open a sign-in, but not the confirmation', async () => {
        const nav = makeNav();
        withBrowser(nav);
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { device: { uid: 'd2' } },
        );
        const { module } = makeModule();
        await module.enable();
        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(3));
        expect(
            mockRequest.mock.calls.map(([, , route, , options]) => [
                route,
                options,
            ]),
        ).toEqual([
            ['/push/web/key', { interactiveReauth: true }],
            ['/push/web/subscriptions', { interactiveReauth: true }],
            ['/push/web/subscriptions/verify', { interactiveReauth: false }],
        ]);
    });

    it('looks the user up without opening a sign-in when no user is cached', async () => {
        withBrowser(makeNav({ existing: makeSubscription() }));
        server((route) =>
            route === '/whoami'
                ? { uuid: 'u-1' }
                : { status: 'active', device: { uid: 'd1' } },
        );
        const auth = { whoami: vi.fn(async () => ({ uuid: 'u-1' })) };
        const { module } = makeModule({
            whoami: undefined,
            whoamiCache_: Promise.resolve(null),
            auth,
        });
        await module.enable();
        expect(store.get(OPT_IN)).toBe(true);
        expect(auth.whoami).not.toHaveBeenCalled();
        expect(mockRequest).toHaveBeenCalledWith(
            expect.anything(),
            'GET',
            '/whoami',
            null,
            { interactiveReauth: false },
        );
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

describe('enable() while another tab loads', () => {
    it('records the opt-in before the other tab checks it, so the new subscription stays', async () => {
        store.set(SERVER_KEY, KEY);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        let announce;
        mockRequest.mockImplementation(async (_p, method, route) => {
            if (route === '/push/web/key') return { publicKey: KEY };
            if (method === 'POST' && route === '/push/web/subscriptions') {
                return await new Promise((resolve) => {
                    announce = () =>
                        resolve({ status: 'active', device: { uid: 'd1' } });
                });
            }
            return {};
        });
        const { module: enabling } = makeModule();
        const turningOn = enabling.enable();
        await vi.waitFor(() => expect(announce).toBeDefined());

        const { module: loading } = makeModule();
        await loading.onPush('chat', () => {}, { onError: () => {} });
        await flush();
        announce();
        await expect(turningOn).resolves.toBe(true);
        await flush();
        await flush();

        expect(store.get(OPT_IN)).toBe(true);
        expect(subscription.unsubscribe).not.toHaveBeenCalled();
    });

    it('records no opt-in when the announce fails', async () => {
        withBrowser(makeNav({ existing: makeSubscription() }));
        server(() => {
            throw new PuterJSError('down', 'internal_error');
        });
        const { module } = makeModule();
        await expect(module.enable()).rejects.toMatchObject({
            code: 'internal_error',
        });
        expect(store.has(OPT_IN)).toBe(false);
    });
});

describe('enable after the user removed this browser in Puter', () => {
    it('replaces the removed subscription and turns pushes back on', async () => {
        const removed = makeSubscription(undefined, 'https://push.example/1');
        const nav = makeNav({ existing: removed });
        nav.pushManager.subscribe.mockResolvedValue(
            makeSubscription(undefined, 'https://push.example/2'),
        );
        withBrowser(nav);
        server((route, body) => {
            if (body.subscription.endpoint === 'https://push.example/1')
                throw new PuterJSError('removed', 'push_device_removed');
            return { status: 'pending' };
        });
        const { module } = makeModule();
        await expect(module.enable()).resolves.toBe(true);
        expect(removed.unsubscribe).toHaveBeenCalledTimes(1);
        expect(nav.pushManager.subscribe).toHaveBeenCalledTimes(1);
        expect(store.get(OPT_IN)).toBe(true);
    });
});

describe('status', () => {
    it('is unavailable where the browser has no Web Push, and outside a page', async () => {
        const { module } = makeModule();
        await expect(module.status()).resolves.toBe('unavailable');
        withBrowser(makeNav());
        const { module: node } = makeModule({ env: 'nodejs' });
        await expect(node.status()).resolves.toBe('unavailable');
    });

    it('is blocked when the browser blocks notifications for the site', async () => {
        store.set(OPT_IN, true);
        withBrowser(makeNav({ existing: makeSubscription() }), 'denied');
        const { module } = makeModule();
        await expect(module.status()).resolves.toBe('blocked');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('is off before the browser is asked, without a subscription, or without the user`s opt-in', async () => {
        store.set(OPT_IN, true);
        withBrowser(makeNav({ existing: makeSubscription() }), 'default');
        await expect(makeModule().module.status()).resolves.toBe('off');

        withBrowser(makeNav());
        await expect(makeModule().module.status()).resolves.toBe('off');

        store.delete(OPT_IN);
        withBrowser(makeNav({ existing: makeSubscription() }));
        await expect(makeModule().module.status()).resolves.toBe('off');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('is on with a subscription the user turned on here, and off after disable()', async () => {
        store.set(OPT_IN, true);
        const nav = makeNav({ existing: makeSubscription() });
        withBrowser(nav);
        mockRequest.mockResolvedValue({ removed: true });
        const { module } = makeModule();
        await expect(module.status()).resolves.toBe('on');
        expect(nav.serviceWorker.getRegistration).toHaveBeenCalledWith(
            '/puter-sw.js',
        );

        await module.disable();
        nav.pushManager.getSubscription.mockResolvedValue(null);
        await expect(module.status()).resolves.toBe('off');
    });

    it('looks up the worker it is given', async () => {
        const nav = makeNav();
        withBrowser(nav);
        await makeModule().module.status({ serviceWorker: '/js/sw.js' });
        expect(nav.serviceWorker.getRegistration).toHaveBeenCalledWith(
            '/js/sw.js',
        );
    });

    it('is off for a visitor who has not signed in', async () => {
        store.set(OPT_IN, true);
        withBrowser(makeNav({ existing: makeSubscription() }));
        const { module, host } = makeModule();
        host.authToken = null;
        await expect(module.status()).resolves.toBe('off');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    describe('checks an on with Puter', () => {
        let subscription;
        const answer = (reply) =>
            mockRequest.mockImplementation(async (_p, _m, route) => {
                if (route !== '/push/web/subscriptions/status')
                    throw new Error(`unexpected ${route}`);
                return await reply();
            });

        beforeEach(() => {
            store.set(OPT_IN, true);
            subscription = makeSubscription();
            withBrowser(makeNav({ existing: subscription }));
        });

        it.each(['active', 'unknown'])(
            'is on when Puter says %s',
            async (state) => {
                answer(() => ({ state }));
                await expect(makeModule().module.status()).resolves.toBe('on');
                expect(mockRequest).toHaveBeenCalledWith(
                    expect.anything(),
                    'POST',
                    '/push/web/subscriptions/status',
                    { endpoint: subscription.endpoint },
                    { interactiveReauth: false },
                );
                expect(store.get(OPT_IN)).toBe(true);
            },
        );

        it('is off once the user removed this browser, and ends the subscription here only', async () => {
            answer(() => ({ state: 'removed' }));
            await expect(makeModule().module.status()).resolves.toBe('off');
            expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
            expect(mockRequest).toHaveBeenCalledTimes(1);
            expect(store.has(OPT_IN)).toBe(false);
        });

        it('is off once the user turned the app off in Puter, keeping the subscription', async () => {
            answer(() => ({ state: 'revoked' }));
            await expect(makeModule().module.status()).resolves.toBe('off');
            expect(subscription.unsubscribe).not.toHaveBeenCalled();
            expect(store.has(OPT_IN)).toBe(false);
        });

        it.each([
            [
                'an older server without the route',
                () => {
                    throw new PuterJSError('no', 'push_unavailable');
                },
            ],
            [
                'a network failure',
                () => {
                    throw new TypeError('Failed to fetch');
                },
            ],
            ['a malformed reply', () => ({ state: 'sideways' })],
            ['an empty reply', () => ({})],
        ])('stays on after %s', async (_name, reply) => {
            answer(reply);
            await expect(makeModule().module.status()).resolves.toBe('on');
            expect(subscription.unsubscribe).not.toHaveBeenCalled();
            expect(store.get(OPT_IN)).toBe(true);
        });

        it('asks in the Puter GUI too', async () => {
            store.delete(OPT_IN);
            const nav = makeNav({
                existing: subscription,
                active: { scriptURL: `${ORIGIN}/sw.js` },
            });
            withBrowser(nav);
            answer(() => ({ state: 'removed' }));
            const { module } = makeModule({ env: 'gui' });
            await expect(module.status()).resolves.toBe('off');
            expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});

describe('disable', () => {
    it('stops a confirmation still on its way, so the browser is not registered after', async () => {
        const subscription = makeSubscription();
        const nav = makeNav();
        nav.pushManager.subscribe.mockResolvedValue(subscription);
        withBrowser(nav);
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { removed: true },
        );
        const { module } = makeModule();
        await module.enable();
        nav.pushManager.getSubscription.mockResolvedValue(subscription);
        await module.disable();
        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await flush();
        expect(
            mockRequest.mock.calls.map(([, , route]) => route),
        ).not.toContain('/push/web/subscriptions/verify');
        expect(store.has(OPT_IN)).toBe(false);
    });

    it('wins over an enable() still in flight', async () => {
        withBrowser(makeNav({ existing: makeSubscription() }));
        let announce;
        mockRequest.mockImplementation(async (_p, method, route) => {
            if (route === '/push/web/key') return { publicKey: KEY };
            if (method === 'POST' && route === '/push/web/subscriptions') {
                return await new Promise((resolve) => {
                    announce = () => resolve({ status: 'pending' });
                });
            }
            return { removed: true };
        });
        const { module } = makeModule();
        const enabling = module.enable();
        await vi.waitFor(() => expect(announce).toBeDefined());
        const disabling = module.disable();
        announce();
        await expect(disabling).resolves.toBe(true);
        await expect(enabling).rejects.toMatchObject({
            code: 'push_verification_canceled',
        });
        expect(store.has(OPT_IN)).toBe(false);
    });

    it('removes the subscription and forgets the opt-in', async () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockResolvedValue({ removed: true });
        const { module } = makeModule();
        await expect(module.disable()).resolves.toBe(true);
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
    });
});

describe.each([
    ['with Web Locks', false],
    ['without Web Locks', true],
])('another tab turning push off, %s', (_label, noLocks) => {
    beforeEach(() => {
        store.set(SERVER_KEY, KEY);
        if (noLocks)
            Object.defineProperty(globalThis.navigator, 'locks', {
                value: undefined,
                configurable: true,
            });
    });
    afterEach(() => {
        if (noLocks) delete globalThis.navigator.locks;
    });

    /** Requests these tabs made; earlier tests' tabs still hear the channel. */
    const routes = (...tabs) =>
        mockRequest.mock.calls
            .filter(([host]) => tabs.some((tab) => tab.puter === host))
            .map(([, method, route]) => `${method} ${route}`);

    it('stops a load sync before it announces, and the device stays removed', async () => {
        store.set(OPT_IN, true);
        withBrowser(makeNav({ existing: makeSubscription() }));
        let releaseKey;
        mockRequest.mockImplementation(async (_p, method, route) => {
            if (route === '/push/web/key') {
                await new Promise((resolve) => {
                    releaseKey = resolve;
                });
                return { publicKey: KEY };
            }
            return method === 'DELETE'
                ? { removed: true }
                : { status: 'active', device: { uid: 'd1' } };
        });
        const onError = vi.fn();
        const { module: loading } = makeModule();
        await loading.onPush('chat', () => {}, { onError });
        await vi.waitFor(() => expect(releaseKey).toBeDefined());

        const { module: other } = makeModule();
        await expect(other.disable()).resolves.toBe(true);
        releaseKey();
        await flush();
        await flush();

        expect(routes(loading, other)).toEqual([
            'GET /push/web/key',
            'DELETE /push/web/subscriptions',
        ]);
        expect(onError).not.toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
    });

    it('stops a load sync waiting for its confirmation, without verifying', async () => {
        store.set(OPT_IN, true);
        const nav = makeNav();
        withBrowser(nav);
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { device: { uid: 'd1' } },
        );
        const { module: loading } = makeModule();
        await loading.onPush('chat', () => {}, { onError: () => {} });
        await vi.waitFor(() =>
            expect(routes(loading)).toContain('POST /push/web/subscriptions'),
        );

        const { module: other } = makeModule();
        await other.disable();
        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await flush();
        await flush();

        expect(routes(loading)).not.toContain(
            'POST /push/web/subscriptions/verify',
        );
    });

    it('makes an enable() in flight reject', async () => {
        withBrowser(makeNav({ existing: makeSubscription() }));
        let announce;
        mockRequest.mockImplementation(async (_p, method, route) => {
            if (route === '/push/web/key') return { publicKey: KEY };
            if (method === 'POST' && route === '/push/web/subscriptions') {
                return await new Promise((resolve) => {
                    announce = () => resolve({ status: 'pending' });
                });
            }
            return { removed: true };
        });
        const { module: enablingTab } = makeModule();
        const enabling = enablingTab.enable();
        await vi.waitFor(() => expect(announce).toBeDefined());

        const { module: other } = makeModule();
        const disabling = other.disable();
        await flush();
        announce();
        await expect(enabling).rejects.toMatchObject({
            code: 'push_verification_canceled',
        });
        await expect(disabling).resolves.toBe(true);
        expect(store.has(OPT_IN)).toBe(false);
    });
});

describe('sign-out', () => {
    it('forgets the push state, ends the subscription in the browser, then removes it with the leaving user`s token', async () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        store.set('clicks:n1', { uid: 'n1' });
        store.set('handlers:chat', '() => {}');
        const order = [];
        const subscription = makeSubscription();
        subscription.unsubscribe.mockImplementation(async () => {
            order.push(['unsubscribe', store.has(OPT_IN)]);
        });
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockImplementation(async (_p, method) => {
            order.push([method]);
            return { removed: true };
        });
        const { module } = makeModule();

        await module._forgetPush('leaving-token');

        expect(mockRequest).toHaveBeenCalledWith(
            expect.anything(),
            'DELETE',
            '/push/web/subscriptions',
            { endpoint: subscription.endpoint },
            {
                authToken: 'leaving-token',
                interactiveReauth: false,
                keepalive: true,
            },
        );
        expect(order).toEqual([['unsubscribe', false], ['DELETE']]);
        expect(store.has('clicks:n1')).toBe(false);
        expect(store.has('handlers:chat')).toBe(true);
    });

    it('never rejects, and still forgets the push state when the server refuses', async () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
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

    it('leaves another service`s subscription on the site alone', async () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        const theirs = makeSubscription(new Uint8Array([4, 1, 2]));
        withBrowser(makeNav({ existing: theirs }));
        const { module } = makeModule();
        await module._forgetPush('leaving-token');
        expect(theirs.unsubscribe).not.toHaveBeenCalled();
        expect(mockRequest).not.toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
    });

    it('stops another tab`s sync waiting for its confirmation', async () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        const nav = makeNav();
        withBrowser(nav);
        server((route) =>
            route === '/push/web/subscriptions'
                ? { status: 'pending' }
                : { removed: true },
        );
        const { module: loading } = makeModule();
        await loading.onPush('chat', () => {}, { onError: () => {} });
        await vi.waitFor(() =>
            expect(mockRequest.mock.calls.map(([, , r]) => r)).toContain(
                '/push/web/subscriptions',
            ),
        );
        const { module: other } = makeModule();
        await other._forgetPush('leaving-token');
        nav.post({ type: 'puter-push-challenge', challenge: 'c.sig' });
        await flush();
        await flush();
        expect(mockRequest.mock.calls.map(([, , r]) => r)).not.toContain(
            '/push/web/subscriptions/verify',
        );
    });

    it('does nothing inside the Puter desktop', async () => {
        withBrowser(makeNav({ existing: makeSubscription() }));
        const { module } = makeModule({ env: 'app' });
        await module._forgetPush('token');
        expect(mockRequest).not.toHaveBeenCalled();
    });
});

describe('where the browser refuses Web Locks, as in a sandboxed frame', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'locks', {
            value: {
                request: vi.fn(async () => {
                    throw new Error('The request was denied');
                }),
            },
            configurable: true,
        });
    });
    afterEach(() => {
        delete globalThis.navigator.locks;
    });

    it('keeps the saved handler, since it cannot tell whether another tab uses it', async () => {
        const { module } = makeModule();
        const listener = await module.onPush('chat', () => {});
        await listener.off();
        expect(store.has('handlers:chat')).toBe(true);
    });

    it('signs out without rejecting and still ends the subscription', async () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockResolvedValue({ removed: true });
        const { module } = makeModule();
        await expect(
            module._forgetPush('leaving-token'),
        ).resolves.toBeUndefined();
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);
    });

    it('still ends a subscription left here without an opt-in on load', async () => {
        store.set(SERVER_KEY, KEY);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        const { module } = makeModule();
        await module.onPush('chat', () => {}, { onError: () => {} });
        await vi.waitFor(() =>
            expect(subscription.unsubscribe).toHaveBeenCalled(),
        );
    });
});

describe('a different user signing in', () => {
    const USERS = { 'token-a': 'u-1', 'token-a2': 'u-1', 'token-b': 'u-2' };
    /** A page signed in as u-1, whose tokens name their user in `uu`. */
    const signedIn = (over = {}) => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        mockRequest.mockResolvedValue({ removed: true });
        const { module, host } = makeModule({
            authToken: 'token-a',
            decodeJwtPayload: (token) => ({ uu: USERS[token] }),
            decodeCompressedAppID: (value) => value,
            ...over,
        });
        return { module, host, subscription };
    };
    const deletes = () =>
        mockRequest.mock.calls.filter(([, method]) => method === 'DELETE');

    it.each([
        ['over the session', ['token-b']],
        ['after the last token was dropped', [null, 'token-b']],
    ])(
        'ends the last user`s pushes with their token, %s',
        async (_label, tokens) => {
            const { host, subscription } = signedIn();
            for (const token of tokens) host.setAuthToken(token);
            await vi.waitFor(() => expect(deletes()).toHaveLength(1));
            expect(deletes()[0][4]).toMatchObject({
                authToken: 'token-a',
                keepalive: true,
            });
            expect(subscription.unsubscribe).toHaveBeenCalled();
            expect(store.has(OPT_IN)).toBe(false);
        },
    );

    it.each([
        ['a new token for the same user', ['token-a2']],
        ['the token being dropped', [null]],
    ])('keeps everything on %s', async (_label, tokens) => {
        const { host, subscription } = signedIn();
        for (const token of tokens) host.setAuthToken(token);
        await flush();
        await flush();
        expect(subscription.unsubscribe).not.toHaveBeenCalled();
        expect(mockRequest).not.toHaveBeenCalled();
        expect(store.get(OPT_IN)).toBe(true);
    });

    /** A page of u-1 where `enable()` signs in u-2; `/whoami` takes a moment. */
    const enablingPage = () => {
        store.set(OPT_IN, true);
        store.set(SERVER_KEY, KEY);
        const subscription = makeSubscription();
        withBrowser(makeNav({ existing: subscription }));
        const listeners = new Set();
        const lookUp = (token) =>
            new Promise((resolve) =>
                setTimeout(() => resolve({ uuid: USERS[token] }), 20),
            );
        const { module, host } = makeModule({
            authToken: 'token-a',
            whoami: undefined,
            whoamiCache_: lookUp('token-a'),
            decodeJwtPayload: () => null,
            onAuthStateChanged: (listener) => listeners.add(listener),
            setAuthToken(token) {
                this.authToken = token;
                for (const listener of listeners) listener();
                this.whoamiCache_ = token ? lookUp(token) : null;
            },
            ui: {
                authenticateWithPuter: async () => host.setAuthToken('token-b'),
            },
        });
        mockRequest.mockImplementation(async (_p, method, route) => {
            if (route === '/push/web/key') return { publicKey: KEY };
            if (method === 'POST' && route === '/push/web/subscriptions')
                return { status: 'active', device: { uid: 'd1' } };
            return { removed: true };
        });
        return { module, host, subscription };
    };
    const OPT_IN_B = 'handlers:puter:opt-in:u-2';
    const routes = () => mockRequest.mock.calls.map(([, m, r]) => `${m} ${r}`);

    it('lets the next user turn push on after a sign-out on the same page', async () => {
        const { module, host, subscription } = enablingPage();
        await module._forgetPush('token-a');
        host.setAuthToken(null);
        subscription.unsubscribe.mockClear();
        mockRequest.mockClear();

        await expect(module.enable()).resolves.toBe(true);
        await flush();
        await flush();

        expect(store.get(OPT_IN_B)).toBe(true);
        expect(subscription.unsubscribe).not.toHaveBeenCalled();
        expect(routes()).not.toContain('DELETE /push/web/subscriptions');
    });

    it('ends the last user`s pushes before the next one, signing in from enable(), turns them on', async () => {
        const { module, host } = enablingPage();
        await flush();
        host.setAuthToken(null);

        await expect(module.enable()).resolves.toBe(true);
        await flush();
        await flush();

        expect(store.has(OPT_IN)).toBe(false);
        expect(store.get(OPT_IN_B)).toBe(true);
        const order = routes();
        expect(order.indexOf('DELETE /push/web/subscriptions')).toBeLessThan(
            order.indexOf('POST /push/web/subscriptions'),
        );
        expect(order.lastIndexOf('DELETE /push/web/subscriptions')).toBe(
            order.indexOf('DELETE /push/web/subscriptions'),
        );
    });

    it('ends push for a user who signed out and back in with the same token, once another user signs in', async () => {
        const { module, host, subscription } = signedIn({ whoami: undefined });
        server((route) => {
            if (route === '/whoami') return { uuid: USERS[host.authToken] };
            if (route === '/push/web/subscriptions')
                return { status: 'active', device: { uid: 'd1' } };
            return { removed: true };
        });
        await module._forgetPush('token-a');
        host.setAuthToken(null);
        host.setAuthToken('token-a');
        await expect(module.enable()).resolves.toBe(true);
        expect(store.get(OPT_IN)).toBe(true);
        mockRequest.mockClear();
        subscription.unsubscribe.mockClear();

        host.setAuthToken('token-b');
        await vi.waitFor(() => expect(deletes()).toHaveLength(1));
        expect(deletes()[0][4]).toMatchObject({ authToken: 'token-a' });
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(store.has(OPT_IN)).toBe(false);

        await expect(module.enable()).resolves.toBe(true);
        expect(store.get('handlers:puter:opt-in:u-2')).toBe(true);
    });

    it('tells users apart by the cached /whoami when the token names none', async () => {
        const listeners = new Set();
        const { host } = signedIn({
            decodeJwtPayload: () => null,
            whoamiCache_: Promise.resolve({ uuid: 'u-1' }),
            onAuthStateChanged: (listener) => listeners.add(listener),
            // As `puter.setAuthToken`: listeners first, then the lookup.
            setAuthToken(token) {
                this.authToken = token;
                for (const listener of listeners) listener();
                this.whoamiCache_ = Promise.resolve({ uuid: USERS[token] });
            },
        });
        await flush();
        host.setAuthToken('token-b');
        await vi.waitFor(() => expect(deletes()).toHaveLength(1));
    });
});
