/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The worker is a classic script; run it as one, against a stand-in scope.
const SOURCE = readFileSync(fileURLToPath(new URL('./sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://puter.test';
const DEFAULT_ICON = `${ORIGIN}/favicons/android-icon-192x192.png`;

const loadWorker = ({ windows = [] } = {}) => {
    const listeners = {};
    const shown = [];
    const scope = {
        location: { origin: ORIGIN },
        addEventListener: (type, fn) => {
            listeners[type] = fn;
        },
        skipWaiting: vi.fn(),
        registration: {
            showNotification: vi.fn(async (title, options) => {
                shown.push({ title, options });
            }),
        },
        clients: {
            claim: vi.fn(async () => {}),
            matchAll: vi.fn(async () => windows),
            openWindow: vi.fn(async () => null),
        },
    };
    const context = vm.createContext({
        URL,
        JSON,
        console,
        Map,
        Promise,
        Date: { now: () => globalThis.Date.now() },
        setTimeout: (...args) => globalThis.setTimeout(...args),
        clearTimeout: (...args) => globalThis.clearTimeout(...args),
        self: scope,
    });
    vm.runInContext(SOURCE, context);

    /** Run one event through its listener and wait for what it extended. */
    const fire = async (type, event) => {
        let pending = Promise.resolve();
        listeners[type]({ ...event, waitUntil: (p) => { pending = p; } });
        await pending;
    };
    return { context, scope, listeners, shown, fire };
};

const pushData = (payload) => ({ json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload) });

const windowClient = (url, over = {}) => ({
    url,
    frameType: 'top-level',
    focused: false,
    visibilityState: 'hidden',
    focus: vi.fn(async () => {}),
    postMessage: vi.fn(),
    ...over,
});

describe('service worker helpers', () => {
    const { context } = loadWorker();

    it('reads the message under `puter`, as an object or a JSON string', () => {
        const message = { uid: 'n1', title: 'Hi' };
        expect(context.readPushPayload(pushData({ puter: message }))).toEqual(message);
        expect(context.readPushPayload(pushData({ puter: JSON.stringify(message) }))).toEqual(message);
    });

    it('reads the message from string data under `data.puter`', () => {
        const message = { uid: 'n2', title: 'Hello' };
        const payload = { data: { puter: JSON.stringify(message) }, from: '123', messageId: 'm1' };
        expect(context.readPushPayload(pushData(payload))).toEqual(message);
        expect(context.readPushPayload(pushData({ data: { other: 'x' } }))).toBeNull();
    });

    it('reads nothing from a missing, garbled or misplaced payload', () => {
        expect(context.readPushPayload(null)).toBeNull();
        expect(context.readPushPayload({ json: () => { throw new SyntaxError('bad'); } })).toBeNull();
        expect(context.readPushPayload(pushData({ title: 'no puter key' }))).toBeNull();
        expect(context.readPushPayload(pushData({ puter: '{oops' }))).toBeNull();
        expect(context.readPushPayload(pushData({ puter: 5 }))).toBeNull();
    });

    it('keeps an https or same-origin icon and swaps anything else for Puter\'s', () => {
        expect(context.notificationIcon('https://cdn.example.com/i.png', ORIGIN)).toBe('https://cdn.example.com/i.png');
        expect(context.notificationIcon('/images/x.png', ORIGIN)).toBe(`${ORIGIN}/images/x.png`);
        expect(context.notificationIcon('http://example.com/i.png', ORIGIN)).toBe(DEFAULT_ICON);
        expect(context.notificationIcon('data:image/png;base64,AAAA', ORIGIN)).toBe(DEFAULT_ICON);
        expect(context.notificationIcon(undefined, ORIGIN)).toBe(DEFAULT_ICON);
    });

    it('builds the notification from the contract, with defaults for what is missing', () => {
        expect(JSON.parse(JSON.stringify(context.normalizeMessage({
            uid: 'n1',
            title: 'New reply',
            body: 'see you',
            group: 'room-7',
            target: { app: 'app-1', path: '/rooms/7', extra: 1 },
            data: { room: 7 },
        }, ORIGIN)))).toEqual({
            title: 'New reply',
            options: {
                body: 'see you',
                icon: DEFAULT_ICON,
                tag: 'room-7',
                renotify: false,
                data: { uid: 'n1', target: { app: 'app-1', path: '/rooms/7' }, data: { room: 7 } },
            },
        });
        const bare = context.normalizeMessage(null, ORIGIN);
        expect(bare.title).toBe('New notification');
        expect(bare.options).not.toHaveProperty('tag');
        expect(context.normalizeMessage({ uid: 'n2', title: ' ' }, ORIGIN).options.tag).toBe('n2');
    });

    it('opens only this origin, carrying just the notification uid', () => {
        const click = { uid: 'n1', target: { app: 'app-1', path: '//elsewhere.example/x' }, data: 1 };
        const url = new URL(context.clickUrl(click, ORIGIN));
        expect(url.origin).toBe(ORIGIN);
        expect(url.pathname).toBe('/');
        expect([...url.searchParams]).toEqual([['puter.notification', 'n1']]);
        expect(context.clickUrl({ uid: undefined }, ORIGIN)).toBe(`${ORIGIN}/`);
    });

    it('picks a top-level GUI window on this origin, focused first', () => {
        const other = windowClient('https://elsewhere.example/', { focused: true });
        const nested = windowClient(`${ORIGIN}/builtin/editor`, { frameType: 'nested', focused: true });
        const popup = windowClient(`${ORIGIN}/?embedded_in_popup=true`, { focused: true });
        const action = windowClient(`${ORIGIN}/action/login`, { focused: true });
        const background = windowClient(`${ORIGIN}/`);
        const focused = windowClient(`${ORIGIN}/desktop`, { focused: true });
        expect(context.pickWindow([other, nested, popup, action, background, focused], ORIGIN)).toBe(focused);
        expect(context.pickWindow([other, nested, popup, action, background], ORIGIN)).toBe(background);
        expect(context.pickWindow([other, nested, popup, action], ORIGIN)).toBeNull();
        expect(context.pickWindow([windowClient(`${ORIGIN}/app/editor`)], ORIGIN)).not.toBeNull();
    });
});

describe('service worker push', () => {
    it('shows the message it was sent', async () => {
        const worker = loadWorker();
        await worker.fire('push', {
            data: pushData({ puter: { uid: 'n1', title: 'Hi', body: 'there', group: 'g', icon: 'https://e.example/i.png' } }),
        });
        expect(worker.shown).toHaveLength(1);
        expect(worker.shown[0].title).toBe('Hi');
        expect(worker.shown[0].options).toMatchObject({ body: 'there', tag: 'g', icon: 'https://e.example/i.png' });
    });

    it('still shows a generic notification for a payload it cannot read', async () => {
        for ( const data of [null, { json: () => { throw new Error('x'); } }, pushData({ other: 1 })] ) {
            const worker = loadWorker();
            await worker.fire('push', { data });
            expect(worker.shown).toHaveLength(1);
            expect(worker.shown[0].title).toBe('New notification');
            expect(worker.shown[0].options.icon).toBe(DEFAULT_ICON);
        }
    });

    it('falls back to the generic notification when showing the message fails', async () => {
        const worker = loadWorker();
        worker.scope.registration.showNotification
            .mockImplementationOnce(async () => { throw new TypeError('bad options'); });
        await worker.fire('push', { data: pushData({ puter: { uid: 'n1', title: 'Hi' } }) });
        expect(worker.scope.registration.showNotification).toHaveBeenCalledTimes(2);
        expect(worker.shown).toEqual([{ title: 'New notification', options: { icon: DEFAULT_ICON } }]);
    });

    it('shows a page\'s message only while no Puter window is visible', async () => {
        const visible = loadWorker({ windows: [windowClient(`${ORIGIN}/desktop`, { visibilityState: 'visible' })] });
        await visible.fire('message', {
            data: { type: 'puter-show-notification', puter: { uid: 'n1', title: 'Hi' } },
            source: { url: `${ORIGIN}/` },
        });
        expect(visible.shown).toEqual([]);
        expect(visible.scope.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });

        const otherOrigin = loadWorker({ windows: [windowClient('https://elsewhere.example/', { visibilityState: 'visible' })] });
        await otherOrigin.fire('message', {
            data: { type: 'puter-show-notification', puter: { uid: 'n1', title: 'Hi' } },
            source: { url: `${ORIGIN}/` },
        });
        expect(otherOrigin.shown.map((n) => n.title)).toEqual(['Hi']);
    });

    it('shows a page\'s message from this origin and ignores other messages', async () => {
        const worker = loadWorker();
        await worker.fire('message', {
            data: { type: 'puter-show-notification', puter: { uid: 'n1', title: 'Hi' } },
            source: { url: `${ORIGIN}/` },
        });
        worker.listeners.message({ data: { type: 'other' }, source: { url: `${ORIGIN}/` }, waitUntil: () => {} });
        worker.listeners.message({
            data: { type: 'puter-show-notification', puter: { title: 'x' } },
            source: { url: 'https://elsewhere.example/' },
            waitUntil: () => {},
        });
        expect(worker.shown.map((n) => n.title)).toEqual(['Hi']);
    });
});

describe('service worker notificationclick', () => {
    const tapped = (data) => ({ notification: { data, close: vi.fn() } });
    const CLICK = { uid: 'n1', target: { app: 'app-1', path: '/rooms/7' }, data: { room: 7 } };

    afterEach(() => {
        vi.useRealTimers();
    });

    /** A window whose page answers the worker's tap message. */
    const answeringWindow = (worker, url) => {
        const win = windowClient(url);
        win.postMessage.mockImplementation((message) => {
            worker.listeners.message({
                data: { type: 'puter-notification-click-ack', id: message.id },
                source: { url },
                waitUntil: () => {},
            });
        });
        return win;
    };

    it('focuses an open Puter window and posts it the tap, which it acknowledges', async () => {
        const worker = loadWorker();
        const win = answeringWindow(worker, `${ORIGIN}/`);
        worker.scope.clients.matchAll.mockResolvedValue([win]);
        const event = tapped(CLICK);
        await worker.fire('notificationclick', event);
        expect(event.notification.close).toHaveBeenCalled();
        expect(win.focus).toHaveBeenCalled();
        expect(win.postMessage).toHaveBeenCalledWith({
            type: 'puter-notification-click',
            id: expect.any(String),
            notification: CLICK,
        });
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
    });

    it('opens Puter when the window does not acknowledge within 600 ms of the click', async () => {
        vi.useFakeTimers();
        const win = windowClient(`${ORIGIN}/`);
        const worker = loadWorker({ windows: [win] });
        const done = worker.fire('notificationclick', tapped(CLICK));
        await vi.advanceTimersByTimeAsync(599);
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await done;
        expect(win.postMessage).toHaveBeenCalled();
        expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/?puter.notification=n1`);
    });

    it('counts the window lookup against the same 600 ms', async () => {
        vi.useFakeTimers();
        const win = windowClient(`${ORIGIN}/`);
        const worker = loadWorker();
        worker.scope.clients.matchAll.mockImplementation(() => new Promise((resolve) => {
            setTimeout(() => resolve([win]), 400);
        }));
        const done = worker.fire('notificationclick', tapped(CLICK));
        await vi.advanceTimersByTimeAsync(599);
        expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await done;
        expect(worker.scope.clients.openWindow).toHaveBeenCalledOnce();
    });

    it('opens Puter on this origin when no window of its own is open', async () => {
        const worker = loadWorker({ windows: [windowClient('https://elsewhere.example/')] });
        await worker.fire('notificationclick', tapped({ uid: 'n1', target: { path: '/alice/Shared/a.txt' } }));
        const [url] = worker.scope.clients.openWindow.mock.calls[0];
        expect(new URL(url).origin).toBe(ORIGIN);
        expect(new URL(url).searchParams.get('puter.notification')).toBe('n1');
    });

    it('opens the desktop for a notification that carries nothing', async () => {
        const worker = loadWorker();
        await worker.fire('notificationclick', tapped(undefined));
        expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    });
});

describe('service worker pushsubscriptionchange', () => {
    it('tells every window on this origin, and no other', async () => {
        const desktop = windowClient(`${ORIGIN}/desktop`);
        const hidden = windowClient(`${ORIGIN}/`);
        const other = windowClient('https://elsewhere.example/');
        const worker = loadWorker({ windows: [desktop, hidden, other] });
        await worker.fire('pushsubscriptionchange', {});
        expect(worker.scope.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
        for ( const win of [desktop, hidden] ) {
            expect(win.postMessage).toHaveBeenCalledWith({ type: 'puter-push-subscription-changed' });
        }
        expect(other.postMessage).not.toHaveBeenCalled();
        expect(worker.shown).toEqual([]);
    });
});

describe('service worker challenge push', () => {
    it('shows it, then hands the challenge to this origin`s windows', async () => {
        const desktop = windowClient(`${ORIGIN}/desktop`);
        const other = windowClient('https://elsewhere.example/');
        const worker = loadWorker({ windows: [desktop, other] });
        await worker.fire('push', {
            data: pushData({ puter: { type: 'challenge', challenge: 'c.sig', uid: 'n1', title: 'Notifications are on', group: 'puter-push-challenge' } }),
        });
        expect(worker.shown.map((n) => n.title)).toEqual(['Notifications are on']);
        expect(desktop.postMessage).toHaveBeenCalledWith({ type: 'puter-push-challenge', challenge: 'c.sig' });
        expect(other.postMessage).not.toHaveBeenCalled();
    });

    it('posts nothing for an ordinary push', async () => {
        const desktop = windowClient(`${ORIGIN}/desktop`);
        const worker = loadWorker({ windows: [desktop] });
        await worker.fire('push', { data: pushData({ puter: { uid: 'n1', title: 'Hi' } }) });
        expect(desktop.postMessage).not.toHaveBeenCalled();
    });
});

describe('service worker lifecycle', () => {
    it('takes over at once and adds no fetch handler', async () => {
        const worker = loadWorker();
        worker.listeners.install({});
        await worker.fire('activate', {});
        expect(worker.scope.skipWaiting).toHaveBeenCalled();
        expect(worker.scope.clients.claim).toHaveBeenCalled();
        expect(worker.listeners).not.toHaveProperty('fetch');
    });
});
