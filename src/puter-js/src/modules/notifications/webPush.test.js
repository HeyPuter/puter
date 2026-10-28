import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('./lib/api.js', () => ({
    request: (...args) => mockRequest(...args),
}));
const store = new Map();
vi.mock('./lib/pushStore.js', () => ({
    HANDLERS_STORE: 'handlers',
    CLICKS_STORE: 'clicks',
    idbGet: vi.fn(async (s, k) => store.get(`${s}:${k}`)),
    idbPut: vi.fn(async (s, k, v) => void store.set(`${s}:${k}`, v)),
    idbDelete: vi.fn(async (s, k) => void store.delete(`${s}:${k}`)),
}));

const { syncWebPush, removeWebPush, fromBase64Url, workerFor } =
    await import('./lib/webPush.js');
const { NotificationsModule } = await import('./index.js');
const { shownFrom } = await import('./onPush.js');

// 65 bytes, 0x04 first, as base64url.
const KEY = Buffer.from([4, ...Array(64).fill(7)]).toString('base64url');

const makeSubscription = (key = fromBase64Url(KEY)) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        expirationTime: null,
        keys: { p256dh: 'p', auth: 'a' },
    }),
    unsubscribe: vi.fn(async () => true),
});

const makeNav = ({ existing = null } = {}) => {
    const listeners = new Set();
    const pushManager = {
        getSubscription: vi.fn(async () => existing),
        subscribe: vi.fn(async () => makeSubscription()),
    };
    const registration = { active: {}, pushManager };
    return {
        pushManager,
        registration,
        post: (data) => {
            for (const fn of [...listeners]) fn({ data });
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

const puter = { env: 'web', authToken: 't', APIOrigin: 'https://api.test' };
const worker = workerFor('web');

beforeEach(() => {
    mockRequest.mockReset();
    store.clear();
});

describe('syncWebPush', () => {
    it('refreshes a subscription the server already has', async () => {
        const nav = makeNav({ existing: makeSubscription() });
        mockRequest.mockImplementation(async (_p, method, route) => {
            if (route === '/push/web/key') return { publicKey: KEY };
            return { status: 'active', device: { uid: 'd1' } };
        });
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
                    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
                    keys: { p256dh: 'p', auth: 'a' },
                },
            },
        );
    });

    it('confirms a new subscription with the challenge the worker hands back', async () => {
        const nav = makeNav();
        mockRequest.mockImplementation(async (_p, method, route, body) => {
            if (route === '/push/web/key') return { publicKey: KEY };
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

    it('replaces a subscription made with another key', async () => {
        const stale = makeSubscription(new Uint8Array([4, 1, 2]));
        const nav = makeNav({ existing: stale });
        mockRequest.mockImplementation(async (_p, method, route) =>
            route === '/push/web/key'
                ? { publicKey: KEY }
                : { status: 'active', device: { uid: 'd3' } },
        );
        await syncWebPush(puter, { worker, nav });
        expect(stale.unsubscribe).toHaveBeenCalled();
        expect(nav.pushManager.subscribe).toHaveBeenCalled();
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
});

describe('onPush', () => {
    let feedHandler;
    const makeModule = () => {
        const module = new NotificationsModule({
            ...puter,
            onAuthStateChanged: () => () => {},
        });
        module.onNotification = vi.fn(async (handler) => {
            feedHandler = handler;
            return { off: vi.fn(async () => {}) };
        });
        return module;
    };

    afterEach(() => {
        feedHandler = undefined;
    });

    it('rejects a key the server would not accept as a channel', async () => {
        const module = makeModule();
        await expect(module.onPush('Chat!', () => {})).rejects.toMatchObject({
            code: 'invalid_argument',
        });
    });

    it('saves the handler for the worker and runs it for its channel only', async () => {
        const module = makeModule();
        const chat = vi.fn();
        const listener = await module.onPush('chat', chat);
        expect(store.get('handlers:chat')).toBe(chat.toString());
        expect(module.onNotification).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ catchUp: false }),
        );

        await feedHandler({ uid: 'n1', channel: 'other' });
        await feedHandler({ uid: 'n2', channel: 'chat' });
        expect(chat).toHaveBeenCalledTimes(1);
        expect(chat).toHaveBeenCalledWith({ uid: 'n2', channel: 'chat' });

        await listener.off();
        expect(store.has('handlers:chat')).toBe(false);
    });

    it('keeps the saved handler while another listener for the key remains', async () => {
        const module = makeModule();
        const first = await module.onPush('chat', () => {});
        await module.onPush('chat', () => {});
        await first.off();
        expect(store.has('handlers:chat')).toBe(true);
    });

    it('starts one feed for every key', async () => {
        const module = makeModule();
        await module.onPush('chat', () => {});
        await module.onPush('mail', () => {});
        expect(module.onNotification).toHaveBeenCalledTimes(1);
    });
});
