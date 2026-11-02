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

/**
 * Enough of IndexedDB for get/put and a cursor walk. Logs each transaction in
 * `stores.log`; every call fails while `stores.broken` is set.
 */
const fakeIndexedDB = (stores) => {
    const request = (run) => {
        const req = { listeners: [] };
        req.addEventListener = (_t, fn) => req.listeners.push(fn);
        queueMicrotask(() => {
            try {
                if (stores.broken) throw new Error('IndexedDB is not available');
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
            delete: (key) => request(() => void map.delete(key)),
            openCursor: () => {
                const keys = [...map.keys()];
                const cursorAt = (req, i) =>
                    i < keys.length
                        ? {
                              value: map.get(keys[i]),
                              delete: () => map.delete(keys[i]),
                              continue: () =>
                                  queueMicrotask(() => {
                                      req.result = cursorAt(req, i + 1);
                                      for (const fn of req.listeners) fn();
                                  }),
                          }
                        : null;
                return request((req) => cursorAt(req, 0));
            },
        };
    };
    return {
        open: () => {
            const req = request(() => ({
                transaction: (name, mode) => {
                    stores.log.push({ name, mode });
                    return { objectStore: () => objectStore(name) };
                },
                close: () => {},
                createObjectStore: () => {},
            }));
            return req;
        },
    };
};

let nextWindow = 0;
const windowClient = (url, over = {}) => ({
    id: `w${++nextWindow}`,
    url,
    focused: false,
    focus: vi.fn(async () => {}),
    navigate: vi.fn(async () => null),
    postMessage: vi.fn(),
    ...over,
});

const loadWorker = ({
    handlers = {},
    clicks = {},
    windows = [],
    matchAllDelayMs = 0,
    scope: registrationScope = `${ORIGIN}/`,
} = {}) => {
    const listeners = {};
    const shown = [];
    const stores = {
        handlers: new Map(Object.entries(handlers)),
        clicks: new Map(Object.entries(clicks)),
        log: [],
        broken: false,
    };
    const scope = {
        location: { origin: ORIGIN },
        addEventListener: (type, fn) => {
            listeners[type] = fn;
        },
        registration: {
            scope: registrationScope,
            showNotification: vi.fn(async (title, options) => {
                shown.push({ title, options });
            }),
        },
        clients: {
            matchAll: vi.fn(async () => {
                if (matchAllDelayMs) await wait(matchAllDelayMs);
                return windows;
            }),
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
        clearTimeout,
        Number,
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
    /** Fires a tap and lets `answer(win, message)` respond to what it posts. */
    const tap = async (puter, answer = () => {}) => {
        for (const win of windows) {
            win.postMessage.mockImplementation((message) =>
                answer(win, message),
            );
        }
        await fire('notificationclick', {
            notification: { data: { puter }, close: vi.fn() },
        });
    };
    return { context, scope, listeners, shown, stores, fire, tap };
};

const pushData = (payload) => ({ json: () => payload });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TAP_BASE = 'puter:tap-base:';

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
                    renotify: false,
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
        const worker = loadWorker({ handlers: { chat: '() => ({ url: "https://elsewhere.example/x" })' } });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi', channel: 'chat' } }),
        });
        expect(worker.shown[0].options.data.puter.url).toBe(`${ORIGIN}/`);
    });

    it('tags a grouped push as the server did, alerting again, and hands the handler the app`s own group', async () => {
        const worker = loadWorker({
            handlers: { chat: '(n) => ({ body: n.group + "@" + n.createdAt })' },
        });
        await worker.fire('push', {
            data: pushData({
                puter: {
                    uid: 'n1',
                    title: 'Hi',
                    channel: 'chat',
                    group: 'app-1:room-1',
                    ts: 1_700_000_000_123,
                    app: { uid: 'app-1', name: 'Chat' },
                },
            }),
        });
        expect(worker.shown[0].options).toMatchObject({
            tag: 'app-1:room-1',
            renotify: true,
            body: 'room-1@1700000000123',
        });
    });

    it('hands the handler no group for an ungrouped push, and the time in ms', async () => {
        const worker = loadWorker({
            handlers: { chat: '(n) => ({ body: String(n.group) + " " + (n.createdAt > 1e12) })' },
        });
        await worker.fire('push', {
            data: pushData({
                puter: { uid: 'n1', title: 'Hi', channel: 'chat', group: 'n1' },
            }),
        });
        expect(worker.shown[0].options).toMatchObject({
            tag: 'n1',
            renotify: false,
            body: 'null true',
        });
    });

    it('shows the app`s icon when the notification has none', async () => {
        const worker = loadWorker();
        await worker.fire('push', {
            data: pushData({
                puter: {
                    uid: 'n1',
                    title: 'Hi',
                    app: { uid: 'a', name: 'Chat', icon: 'https://cdn.test/a.png' },
                },
            }),
        });
        expect(worker.shown[0].options.icon).toBe('https://cdn.test/a.png');
    });

    it('opens an app on a subpath at its scope', async () => {
        const worker = loadWorker({ scope: `${ORIGIN}/app/` });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi' } }),
        });
        expect(worker.shown[0].options.data.puter.url).toBe(`${ORIGIN}/app/`);
    });

    it('opens the site`s root for a folder worker when the page saved it as the tap base', async () => {
        const worker = loadWorker({
            scope: `${ORIGIN}/puter/`,
            handlers: {
                [`${TAP_BASE}${ORIGIN}/puter/`]: `${ORIGIN}/`,
                chat: '() => ({ url: "chat/1" })',
            },
        });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi' } }),
        });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n2', title: 'Hi', channel: 'chat' } }),
        });
        expect(worker.shown.map((n) => n.options.data.puter.url)).toEqual([
            `${ORIGIN}/`,
            `${ORIGIN}/chat/1`,
        ]);
    });

    it('keeps to the scope when the saved tap base is on another origin', async () => {
        const worker = loadWorker({
            scope: `${ORIGIN}/puter/`,
            handlers: { [`${TAP_BASE}${ORIGIN}/puter/`]: 'https://elsewhere.example/' },
        });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi' } }),
        });
        expect(worker.shown[0].options.data.puter.url).toBe(`${ORIGIN}/puter/`);
    });

    it('removes taps kept longer than five minutes', async () => {
        const now = Date.now();
        const worker = loadWorker({
            clicks: {
                old: { uid: 'old', at: now - 6 * 60 * 1000 },
                fresh: { uid: 'fresh', at: now },
            },
        });
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi' } }),
        });
        expect([...worker.stores.clicks.keys()]).toEqual(['fresh']);
    });

    it('hands a challenge to nested frames too', async () => {
        const nested = windowClient(`${ORIGIN}/embed`, { frameType: 'nested' });
        const worker = loadWorker({ windows: [nested] });
        await worker.fire('push', {
            data: pushData({ puter: { type: 'challenge', challenge: 'c.sig' } }),
        });
        expect(nested.postMessage).toHaveBeenCalledWith({ type: 'puter-push-challenge', challenge: 'c.sig' });
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
    const acks = (worker) => (win, message) =>
        worker.listeners.message({
            data: { type: 'puter-notification-click-ack', id: message.id },
            source: win,
        });

    it('hands the tap to an open window of the app, which acknowledges it', async () => {
        const open = windowClient(`${ORIGIN}/chat`);
        const worker = loadWorker({ windows: [open] });
        await worker.tap(
            { uid: 'n1', target: '/chat', data: { id: 1 }, url: `${ORIGIN}/chat` },
            acks(worker),
        );
        expect(open.postMessage).toHaveBeenCalledWith({
            type: 'puter-notification-click',
            id: expect.any(String),
            notification: { uid: 'n1', target: '/chat', data: { id: 1 } },
            kept: true,
        });
        expect(open.focus).toHaveBeenCalled();
        expect(open.navigate).not.toHaveBeenCalled();
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });

    it('takes the window to the tap`s URL when nothing there takes the tap', async () => {
        const open = windowClient(`${ORIGIN}/inbox`);
        const worker = loadWorker({ windows: [open] });
        const started = Date.now();
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` });
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/chat?puter.notification=n1`);
        expect(worker.stores.clicks.get('n1')).toMatchObject({ uid: 'n1', target: '/chat' });
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });

    it('opens a window when the open one cannot be navigated', async () => {
        const open = windowClient(`${ORIGIN}/inbox`, {
            navigate: vi.fn(async () => {
                throw new TypeError('not controlled');
            }),
        });
        const worker = loadWorker({ windows: [open] });
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` });
        expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(
            `${ORIGIN}/chat?puter.notification=n1`,
        );
    });

    it('leaves a window already at the tap`s URL as it is', async () => {
        const open = windowClient(`${ORIGIN}/chat`);
        const worker = loadWorker({ windows: [open] });
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` });
        expect(open.focus).toHaveBeenCalled();
        expect(open.navigate).not.toHaveBeenCalled();
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });

    it('opens the app with the tap in the URL and keeps it for the page', async () => {
        const worker = loadWorker();
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` });
        expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/chat?puter.notification=n1`);
        expect(worker.stores.clicks.get('n1')).toMatchObject({ uid: 'n1', target: '/chat' });
    });

    it('removes the copy an older page acknowledged without taking it', async () => {
        const open = windowClient(`${ORIGIN}/chat`);
        const worker = loadWorker({ windows: [open] });
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` }, acks(worker));
        expect(worker.stores.clicks.has('n1')).toBe(false);
    });

    it('skips nested frames and opens a window for the tap', async () => {
        const nested = windowClient(`${ORIGIN}/chat`, { frameType: 'nested', focused: true });
        const worker = loadWorker({ windows: [nested] });
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` }, acks(worker));
        expect(nested.postMessage).not.toHaveBeenCalled();
        expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/chat?puter.notification=n1`);
    });

    it('removes taps kept longer than five minutes', async () => {
        const worker = loadWorker({ clicks: { old: { uid: 'old', at: Date.now() - 6 * 60 * 1000 } } });
        await worker.tap({ uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` });
        expect([...worker.stores.clicks.keys()]).toEqual(['n1']);
    });

    describe('delivers a tap once', () => {
        /** A page that claims the kept tap after `claimAfter` ms and acks `ackAfter` ms after that. */
        const slowPage = (worker, ran, { claimAfter, ackAfter = 0 }) => (win, message) => {
            setTimeout(() => {
                const kept = worker.stores.clicks.get(message.notification.uid);
                if (message.kept) {
                    if (kept?.id !== message.id) return;
                    worker.stores.clicks.delete(message.notification.uid);
                }
                ran.push(message.notification.uid);
                setTimeout(() => acks(worker)(win, message), ackAfter);
            }, claimAfter);
        };
        /** Handler runs: in the open page, plus one for a page opened or navigated with the tap kept for it. */
        const deliveries = (worker, open, ran) => {
            const reopened = open.navigate.mock.calls.length + worker.scope.clients.openWindow.mock.calls.length;
            return ran.length + (reopened && worker.stores.clicks.has('n1') ? 1 : 0);
        };
        const TAP = { uid: 'n1', target: '/chat', data: null, url: `${ORIGIN}/chat` };

        it('when the page claims it after the worker gave up', async () => {
            const open = windowClient(`${ORIGIN}/inbox`);
            const worker = loadWorker({ windows: [open] });
            const ran = [];
            await worker.tap(TAP, slowPage(worker, ran, { claimAfter: 900 }));
            await wait(1_000);
            expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/chat?puter.notification=n1`);
            expect(deliveries(worker, open, ran)).toBe(1);
        });

        it('when the page is already at the tap`s URL and answers late', async () => {
            const open = windowClient(`${ORIGIN}/chat`);
            const worker = loadWorker({ windows: [open] });
            const ran = [];
            await worker.tap(TAP, slowPage(worker, ran, { claimAfter: 700 }));
            await wait(800);
            expect(ran).toEqual(['n1']);
            expect(open.navigate).not.toHaveBeenCalled();
            expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
        });

        it('when IndexedDB fails as the worker takes the tap back', async () => {
            const open = windowClient(`${ORIGIN}/inbox`);
            const worker = loadWorker({ windows: [open] });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await worker.tap(TAP, () => {
                worker.stores.broken = true;
            });
            warn.mockRestore();
            expect(open.navigate).not.toHaveBeenCalled();
            expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
        });

        it('taking it back and keeping it for the next page in one transaction', async () => {
            const open = windowClient(`${ORIGIN}/inbox`);
            const worker = loadWorker({ windows: [open] });
            let posted = 0;
            await worker.tap(TAP, () => {
                posted = worker.stores.log.length;
            });
            await wait(10);
            const after = worker.stores.log.slice(posted).filter((t) => t.name === 'clicks');
            expect(after).toEqual([{ name: 'clicks', mode: 'readwrite' }]);
            expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/chat?puter.notification=n1`);
            expect(worker.stores.clicks.get('n1')).toEqual({
                uid: 'n1',
                target: '/chat',
                data: null,
                at: expect.any(Number),
            });
        });

        it('when the page claimed it but its ack came too late', async () => {
            const open = windowClient(`${ORIGIN}/inbox`);
            const worker = loadWorker({ windows: [open] });
            const ran = [];
            await worker.tap(TAP, slowPage(worker, ran, { claimAfter: 100, ackAfter: 800 }));
            await wait(900);
            expect(ran).toEqual(['n1']);
            expect(open.navigate).not.toHaveBeenCalled();
            expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
            expect(deliveries(worker, open, ran)).toBe(1);
        });

        it('waiting for the ack from the post, when finding the windows was slow', async () => {
            const open = windowClient(`${ORIGIN}/inbox`);
            const worker = loadWorker({ windows: [open], matchAllDelayMs: 300 });
            const ran = [];
            await worker.tap(TAP, slowPage(worker, ran, { claimAfter: 350 }));
            expect(ran).toEqual(['n1']);
            expect(open.navigate).not.toHaveBeenCalled();
        });
    });

    it('ignores the app`s own notifications', async () => {
        const worker = loadWorker();
        await worker.fire('notificationclick', { notification: { data: { mine: true }, close: vi.fn() } });
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });
});

describe('push-sw notifications a page shows', () => {
    const show = async (worker, source) => {
        const port = { postMessage: vi.fn() };
        await worker.fire('message', {
            data: {
                type: 'puter-push-show',
                title: 'Hi',
                options: { tag: 'n1', data: { puter: { uid: 'n1' } } },
            },
            source,
            ports: [port],
        });
        return port.postMessage.mock.calls[0]?.[0];
    };

    it('shows one for a page that is away, and says so', async () => {
        const away = windowClient(`${ORIGIN}/`, { visibilityState: 'hidden' });
        const worker = loadWorker({ windows: [away, windowClient(`${ORIGIN}/b`)] });
        expect(await show(worker, away)).toEqual({ shown: true });
        expect(worker.shown).toEqual([
            { title: 'Hi', options: { tag: 'n1', data: { puter: { uid: 'n1' } } } },
        ]);
    });

    it('holds it back while another window of the app has focus', async () => {
        const away = windowClient(`${ORIGIN}/`);
        const worker = loadWorker({
            windows: [away, windowClient(`${ORIGIN}/b`, { focused: true })],
        });
        expect(await show(worker, away)).toEqual({ shown: false });
        expect(worker.shown).toEqual([]);
    });

    it('shows it while only a nested frame of the app has focus', async () => {
        const away = windowClient(`${ORIGIN}/`);
        const worker = loadWorker({
            windows: [away, windowClient(`${ORIGIN}/embed`, { focused: true, frameType: 'nested' })],
        });
        expect(await show(worker, away)).toEqual({ shown: true });
    });

    it('ignores other messages', async () => {
        const worker = loadWorker();
        await worker.fire('message', { data: { type: 'something-else' } });
        await worker.fire('message', { data: null });
        expect(worker.shown).toEqual([]);
    });
});
