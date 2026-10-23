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
    withoutTapParam,
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
            group: 'room-7',
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

    it("uses the row's app uid when the message names none", () => {
        expect(pushMessageFor('n1', { type: 'app.message', title: 't' }, 'app-9').target).toEqual({ app: 'app-9' });
    });
});

describe('showLocalBanner', () => {
    const env = ({ visibilityState = 'hidden', permission = 'granted', active = { postMessage: vi.fn() } } = {}) => ({
        doc: { visibilityState },
        NotificationApi: { permission },
        nav: { serviceWorker: { getRegistration: vi.fn(async () => (active ? { active } : undefined)) } },
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
    const makeNav = () => {
        const listeners = {};
        return {
            listeners,
            serviceWorker: {
                register: vi.fn(async () => ({})),
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

    it('registers /sw.js at the root scope and routes its taps', async () => {
        const { startPushWorker, setPushTapHandler } = await load();
        const handler = vi.fn();
        setPushTapHandler(handler);
        const nav = makeNav();
        startPushWorker({ params: { pushEnabled: true }, nav, query: new URLSearchParams(), framed: false });
        expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });

        nav.listeners.message({ data: { type: 'other', notification: { uid: 'x' } } });
        nav.listeners.message({ data: { type: 'puter-notification-click', notification: { uid: 'n1', target: { app: 'a' } } } });
        expect(handler.mock.calls).toEqual([[{ uid: 'n1', target: { app: 'a' } }]]);
    });

    it('registers nothing where push is off, or inside a frame', async () => {
        const off = await load();
        const nav = makeNav();
        off.startPushWorker({ params: { pushEnabled: false }, nav, query: new URLSearchParams(), framed: false });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();

        vi.resetModules();
        const framed = await load();
        framed.startPushWorker({ params: { pushEnabled: true }, nav, query: new URLSearchParams(), framed: true });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    });

    it('hands over the tap a page was opened for and takes it off the URL', async () => {
        const { startPushWorker, setPushTapHandler } = await load();
        const handler = vi.fn();
        setPushTapHandler(handler);
        const tap = { uid: 'n1', target: { path: '/alice/Shared/a.txt' } };
        const history = { state: null, replaceState: vi.fn() };
        startPushWorker({
            params: {},
            nav: makeNav(),
            query: new URLSearchParams({ 'puter.notification': JSON.stringify(tap) }),
            loc: { href: `https://puter.test/?puter.notification=${encodeURIComponent(JSON.stringify(tap))}&x=1#files` },
            history,
            framed: false,
        });
        expect(handler).toHaveBeenCalledWith(tap);
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?x=1#files');
    });
});

describe('withoutTapParam', () => {
    it('keeps the path, other parameters and the hash', () => {
        expect(withoutTapParam('https://puter.test/app/x?puter.notification=%7B%7D&a=1#h')).toBe('/app/x?a=1#h');
    });
});
