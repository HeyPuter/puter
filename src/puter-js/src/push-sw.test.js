// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync(
    fileURLToPath(new URL('./push-sw.js', import.meta.url)),
    'utf8',
);
const ORIGIN = 'https://app.example';

/** Enough of IndexedDB for get/put and a cursor walk. */
const fakeIndexedDB = (stores) => {
    const request = (run) => {
        const req = { listeners: [] };
        req.addEventListener = (_t, fn) => req.listeners.push(fn);
        queueMicrotask(() => {
            try {
                req.result = run(req);
                req.onsuccess?.();
                for (const fn of req.listeners) fn();
            } catch (error) {
                req.error = error;
                req.onerror?.();
            }
        });
        return req;
    };
    const objectStore = (name) => {
        const map = (stores[name] ??= new Map());
        return {
            get: (key) => request(() => map.get(key)),
            put: (value, key) => request(() => void map.set(key, value)),
            openCursor: () => request(() => null),
        };
    };
    return {
        open: () => {
            const req = request(() => ({
                transaction: (name) => ({ objectStore: () => objectStore(name) }),
                close: () => {},
                createObjectStore: () => {},
            }));
            return req;
        },
    };
};

const windowClient = (url, over = {}) => ({
    url,
    focused: false,
    focus: vi.fn(async () => {}),
    postMessage: vi.fn(),
    ...over,
});

const loadWorker = ({ handlers = {}, windows = [] } = {}) => {
    const listeners = {};
    const shown = [];
    const stores = { handlers: new Map(Object.entries(handlers)) };
    const scope = {
        location: { origin: ORIGIN },
        addEventListener: (type, fn) => {
            listeners[type] = fn;
        },
        registration: {
            showNotification: vi.fn(async (title, options) => {
                shown.push({ title, options });
            }),
        },
        clients: {
            matchAll: vi.fn(async () => windows),
            openWindow: vi.fn(async () => null),
        },
    };
    scope.self = scope;
    const context = vm.createContext({
        ...scope,
        URL,
        JSON,
        Math,
        Map,
        Promise,
        Error,
        TypeError,
        Date,
        console,
        queueMicrotask,
        setTimeout,
        Function,
        indexedDB: fakeIndexedDB(stores),
    });
    context.self = context;
    vm.runInContext(SOURCE, context);
    const fire = async (type, event) => {
        let pending = Promise.resolve();
        listeners[type]?.({ ...event, waitUntil: (p) => (pending = p) });
        await pending;
    };
    return { context, scope, listeners, shown, stores, fire };
};

const pushData = (payload) => ({ json: () => payload });

describe('push-sw push', () => {
    it('leaves a push without a Puter message to the app', async () => {
        const worker = loadWorker();
        await worker.fire('push', { data: pushData({ hello: 1 }) });
        expect(worker.shown).toEqual([]);
    });

    it('shows the message as sent when no handler is saved', async () => {
        const worker = loadWorker();
        await worker.fire('push', {
            data: pushData({
                puter: { uid: 'n1', title: 'Hi', body: 'there', target: { path: '/c/1' } },
            }),
        });
        expect(worker.shown).toEqual([
            {
                title: 'Hi',
                options: {
                    body: 'there',
                    tag: 'n1',
                    data: {
                        puter: {
                            uid: 'n1',
                            target: '/c/1',
                            data: null,
                            url: `${ORIGIN}/c/1`,
                        },
                    },
                },
            },
        ]);
    });

    it('runs the handler the page saved for the channel', async () => {
        const worker = loadWorker({
            handlers: {
                chat: '(n) => ({ title: n.app.name + ": " + n.title, url: "/chat" })',
            },
        });
        await worker.fire('push', {
            data: pushData({
                puter: { uid: 'n1', title: 'Hi', channel: 'chat', app: { uid: 'a', name: 'Chat' } },
            }),
        });
        expect(worker.shown[0].title).toBe('Chat: Hi');
        expect(worker.shown[0].options.data.puter.url).toBe(`${ORIGIN}/chat`);
    });

    it('prefers a handler registered in the worker', async () => {
        const worker = loadWorker({ handlers: { chat: '() => ({ title: "saved" })' } });
        worker.context.puterPush.onPush('chat', () => ({ title: 'worker' }));
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi', channel: 'chat' } }),
        });
        expect(worker.shown[0].title).toBe('worker');
    });

    it('still shows the defaults when the handler throws', async () => {
        const worker = loadWorker({ handlers: { chat: '() => { throw new Error("x") }' } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi', channel: 'chat' } }),
        });
        expect(worker.shown[0].title).toBe('Hi');
        warn.mockRestore();
    });

    it('never points a tap at another origin', async () => {
        const worker = loadWorker({ handlers: { chat: '() => ({ url: "https://evil.example/x" })' } });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi', channel: 'chat' } }),
        });
        expect(worker.shown[0].options.data.puter.url).toBe(`${ORIGIN}/`);
    });

    it('shows a challenge and hands it to this origin`s windows', async () => {
        const mine = windowClient(`${ORIGIN}/`);
        const other = windowClient('https://elsewhere.example/');
        const worker = loadWorker({ windows: [mine, other] });
        await worker.fire('push', {
            data: pushData({
                puter: { type: 'challenge', challenge: 'c.sig', title: 'Notifications are on', group: 'puter-push-challenge' },
            }),
        });
        expect(worker.shown.map((n) => n.title)).toEqual(['Notifications are on']);
        expect(mine.postMessage).toHaveBeenCalledWith({ type: 'puter-push-challenge', challenge: 'c.sig' });
        expect(other.postMessage).not.toHaveBeenCalled();
    });
});

describe('push-sw notificationclick', () => {
    const tap = (puter) => ({ notification: { data: { puter }, close: vi.fn() } });

    it('hands the tap to an open window of the app', async () => {
        const open = windowClient(`${ORIGIN}/chat`);
        const worker = loadWorker({ windows: [open] });
        await worker.fire('notificationclick', tap({ uid: 'n1', target: '/chat', data: { id: 1 }, url: `${ORIGIN}/chat` }));
        expect(open.postMessage).toHaveBeenCalledWith({
            type: 'puter-notification-click',
            notification: { uid: 'n1', target: '/chat', data: { id: 1 } },
        });
        expect(open.focus).toHaveBeenCalled();
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });

    it('opens the app with the tap in the URL and keeps it for the page', async () => {
        const worker = loadWorker();
        await worker.fire('notificationclick', tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` }));
        expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/chat?puter.notification=n1`);
        expect(worker.stores.clicks.get('n1')).toMatchObject({ uid: 'n1', target: '/chat' });
    });

    it('ignores the app`s own notifications', async () => {
        const worker = loadWorker();
        await worker.fire('notificationclick', { notification: { data: { mine: true }, close: vi.fn() } });
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });
});
