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

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    pushMessageFor,
    pushWorkerEnabled,
    shouldShowLocalBanner,
    showLocalBanner,
} from './pushWorker.js';

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

const share = {
    type: 'share.received',
    title: 'alice shared a file with you',
    icon: 'shared.svg',
    fields: { target: { path: '/alice/Shared/a.txt', name: 'a.txt' } },
};

describe('shouldShowLocalBanner', () => {
    const live = { notification: share, visibilityState: 'hidden', permission: 'granted' };

    it('shows one for a live arrival in a hidden tab with permission', () => {
        expect(shouldShowLocalBanner(live)).toBe(true);
    });

    it('shows none while the tab is visible', () => {
        expect(shouldShowLocalBanner({ ...live, visibilityState: 'visible' })).toBe(false);
    });

    it('shows none for a replay, an acknowledged or a silent one', () => {
        expect(shouldShowLocalBanner({ ...live, replay: true })).toBe(false);
        expect(shouldShowLocalBanner({ ...live, acknowledged: true })).toBe(false);
        expect(shouldShowLocalBanner({ ...live, notification: { ...share, silent: true } })).toBe(false);
    });

    it('shows none without permission granted', () => {
        expect(shouldShowLocalBanner({ ...live, permission: 'default' })).toBe(false);
        expect(shouldShowLocalBanner({ ...live, permission: 'denied' })).toBe(false);
        expect(shouldShowLocalBanner({ ...live, permission: undefined })).toBe(false);
    });
});

describe('pushMessageFor', () => {
    it('targets the app and path an app message names, with its data and https icon', () => {
        expect(pushMessageFor('n1', {
            type: 'app.message',
            title: 'New reply',
            text: 'see you',
            icon: 'https://example.com/i.png',
            target: '/rooms/7',
            data: { room: 7 },
            group: 'room-7',
            app: { uid: 'app-1', name: 'Chat' },
        })).toEqual({
            uid: 'n1',
            group: 'app-1:room-7',
            title: 'New reply',
            body: 'see you',
            icon: 'https://example.com/i.png',
            target: { app: 'app-1', path: '/rooms/7' },
            data: { room: 7 },
        });
    });

    it('shows only the app name for a sensitive app message', () => {
        expect(pushMessageFor('n1', {
            type: 'app.message',
            title: 'Code 1234',
            text: 'secret',
            sensitive: true,
            app: { uid: 'app-1', name: 'Bank' },
        })).toEqual({ uid: 'n1', group: 'n1', title: 'Bank', target: { app: 'app-1' } });
    });

    it('points a share at the item it names and drops a non-https icon', () => {
        expect(pushMessageFor('n2', share)).toEqual({
            uid: 'n2',
            group: 'n2',
            title: 'alice shared a file with you',
            target: { path: '/alice/Shared/a.txt' },
        });
    });

    it("tags an app message's group with its app, so two apps never share one", () => {
        const message = (app, over = {}) => ({ type: 'app.message', title: 't', group: 'room-7', app: { uid: app }, ...over });
        expect(pushMessageFor('n1', message('app-1')).group).toBe('app-1:room-7');
        expect(pushMessageFor('n1', message('app-2')).group).toBe('app-2:room-7');
        expect(pushMessageFor('n1', message('app-1', { sensitive: true })).group).toBe('app-1:room-7');
        expect(pushMessageFor('n1', message('app-b'), 'app-a').group).toBe('app-a:room-7');
        expect(pushMessageFor('n1', message('app-1', { group: undefined })).group).toBe('n1');
        expect(pushMessageFor('n2', { ...share, group: 'room-7' }).group).toBe('room-7');
    });

    it("uses the row's app uid over the one the message names", () => {
        expect(pushMessageFor('n1', { type: 'app.message', title: 't' }, 'app-9').target).toEqual({ app: 'app-9' });
        expect(pushMessageFor('n1', { type: 'app.message', title: 't', app: { uid: 'app-b' } }, 'app-a').target)
            .toEqual({ app: 'app-a' });
        expect(pushMessageFor('n1', { type: 'app.message', title: 't', app: { uid: 'app-b' } }, '').target)
            .toEqual({ app: 'app-b' });
    });
});

describe('showLocalBanner', () => {
    const env = ({
        visibilityState = 'hidden',
        permission = 'granted',
        active = { postMessage: vi.fn() },
        pushEnabled = true,
        subscribed = true,
        holds = true,
    } = {}) => ({
        params: { pushEnabled },
        doc: { visibilityState },
        NotificationApi: { permission },
        nav: {
            serviceWorker: {
                register: vi.fn(),
                getRegistration: vi.fn(async () => (active
                    ? { active, pushManager: { getSubscription: async () => (subscribed ? {} : null) } }
                    : undefined)),
            },
        },
        holdsPush: vi.fn(async () => holds),
        active,
    });

    it('hands one notification to the worker, tagged by its uid', async () => {
        const e = env();
        expect(await showLocalBanner({ uid: 'n1', notification: share }, {}, e)).toBe(true);
        expect(e.nav.serviceWorker.getRegistration).toHaveBeenCalledWith('/');
        expect(e.active.postMessage).toHaveBeenCalledOnce();
        expect(e.active.postMessage).toHaveBeenCalledWith({
            type: 'puter-show-notification',
            puter: pushMessageFor('n1', share),
        });
    });

    it('hands nothing over while visible, for a replay, or without a worker', async () => {
        const visible = env({ visibilityState: 'visible' });
        expect(await showLocalBanner({ uid: 'n1', notification: share }, {}, visible)).toBe(false);
        expect(visible.nav.serviceWorker.getRegistration).not.toHaveBeenCalled();

        const replay = env();
        expect(await showLocalBanner({ uid: 'n1', notification: share }, { replay: true }, replay)).toBe(false);
        expect(replay.active.postMessage).not.toHaveBeenCalled();

        expect(await showLocalBanner({ uid: 'n1', notification: share }, {}, env({ active: null }))).toBe(false);
    });

    it('hands nothing over while push is off in this browser', async () => {
        const off = env({ subscribed: false });
        expect(await showLocalBanner({ uid: 'n1', notification: share }, {}, off)).toBe(false);
        expect(off.active.postMessage).not.toHaveBeenCalled();
    });

    it('shows an app`s message only when the app may push', async () => {
        const message = (uid) => ({ type: 'app.message', title: 'Hi', app: { uid } });
        const denied = env({ holds: false });
        expect(await showLocalBanner({ uid: 'n1', notification: message('app-1'), appUid: 'app-1' }, {}, denied)).toBe(false);
        expect(denied.holdsPush).toHaveBeenCalledWith('app-1');
        const allowed = env();
        expect(await showLocalBanner({ uid: 'n1', notification: message('app-2'), appUid: 'app-2' }, {}, allowed)).toBe(true);
    });

    it('asks once a minute whether an app may push', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(1_000);
            const e = env();
            const message = { type: 'app.message', title: 'Hi', app: { uid: 'app-busy' } };
            const show = (uid) => showLocalBanner({ uid, notification: message, appUid: 'app-busy' }, {}, e);
            expect(await Promise.all([show('n1'), show('n2')])).toEqual([true, true]);
            expect(await show('n3')).toBe(true);
            expect(e.holdsPush).toHaveBeenCalledTimes(1);
            expect(e.active.postMessage).toHaveBeenCalledTimes(3);

            vi.setSystemTime(1_000 + 60 * 1000);
            expect(await show('n4')).toBe(true);
            expect(e.holdsPush).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('hands nothing over where push is off for the deployment', async () => {
        const off = env({ pushEnabled: false });
        expect(await showLocalBanner({ uid: 'n1', notification: share }, {}, off)).toBe(false);
        expect(off.nav.serviceWorker.getRegistration).not.toHaveBeenCalled();
    });
});

describe('pushWorkerEnabled', () => {
    it('needs the deployment flag and a browser with service workers', () => {
        const nav = { serviceWorker: { register: () => {} } };
        expect(pushWorkerEnabled({ pushEnabled: true }, nav)).toBe(true);
        expect(pushWorkerEnabled({ pushEnabled: false }, nav)).toBe(false);
        expect(pushWorkerEnabled({}, nav)).toBe(false);
        expect(pushWorkerEnabled({ pushEnabled: true }, {})).toBe(false);
    });
});

describe('startPushWorker', () => {
    const UID = '0b6a2c1e-6f1d-4a57-9c1e-3d2f8a9b7c10';

    const makeNav = (registrations = []) => {
        const listeners = {};
        return {
            listeners,
            serviceWorker: {
                register: vi.fn(async () => ({})),
                getRegistrations: vi.fn(async () => registrations),
                addEventListener: vi.fn((type, fn) => {
                    listeners[type] = fn;
                }),
            },
        };
    };

    const load = async () => {
        const worker = await import('./pushWorker.js');
        const tap = await import('./notificationTap.js');
        return { ...worker, ...tap };
    };

    const start = (mod, over) => mod.startPushWorker({
        params: { pushEnabled: true },
        query: new URLSearchParams(),
        clearParam: vi.fn(),
        framed: false,
        ...over,
    });

    it('registers /sw.js at the root scope, acks its taps and routes them', async () => {
        const mod = await load();
        const handler = vi.fn();
        mod.setPushTapHandler(handler);
        const nav = makeNav();
        await start(mod, { nav });
        expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });

        const source = { postMessage: vi.fn() };
        nav.listeners.message({ data: { type: 'other', notification: { uid: UID } }, source });
        nav.listeners.message({ data: { type: 'puter-notification-click', id: 'click-0', notification: { uid: 'n1' } }, source });
        nav.listeners.message({
            data: { type: 'puter-notification-click', id: 'click-1', notification: { uid: UID, target: { app: 'a' } } },
            source,
        });
        expect(source.postMessage.mock.calls).toEqual([[{ type: 'puter-notification-click-ack', id: 'click-1' }]]);
        expect(handler.mock.calls).toEqual([[{ uid: UID }]]);
    });

    it('registers nothing inside a frame', async () => {
        const nav = makeNav();
        await start(await load(), { nav, framed: true });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    });

    it('leaves an existing /sw.js alone where push is off, and registers nothing', async () => {
        const puter = { active: { scriptURL: 'https://puter.test/sw.js' }, unregister: vi.fn(async () => true) };
        const nav = makeNav([puter]);
        await start(await load(), { nav, params: { pushEnabled: false } });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
        expect(puter.unregister).not.toHaveBeenCalled();
    });

    it('hands over the notification uid a page was opened for and clears it', async () => {
        const mod = await load();
        const handler = vi.fn();
        mod.setPushTapHandler(handler);
        const clearParam = vi.fn();
        await start(mod, {
            nav: makeNav(),
            query: new URLSearchParams({ 'puter.notification': UID }),
            clearParam,
        });
        expect(clearParam).toHaveBeenCalledWith('puter.notification');
        expect(handler).toHaveBeenCalledWith({ uid: UID });
    });

    it('clears a malformed parameter and hands nothing over', async () => {
        const mod = await load();
        const handler = vi.fn();
        mod.setPushTapHandler(handler);
        const clearParam = vi.fn();
        await start(mod, {
            nav: makeNav(),
            query: new URLSearchParams({ 'puter.notification': JSON.stringify({ uid: UID }) }),
            clearParam,
        });
        expect(clearParam).toHaveBeenCalledWith('puter.notification');
        expect(handler).not.toHaveBeenCalled();
    });
});
