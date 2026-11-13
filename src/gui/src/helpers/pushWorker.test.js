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
import { closeLocalBanner, pushWorkerEnabled } from './pushWorker.js';

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
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

    /** `registration`: the `/sw.js` already installed, if any. */
    const makeNav = (registration = null) => {
        const listeners = {};
        return {
            listeners,
            serviceWorker: {
                register: vi.fn(async () => ({})),
                getRegistration: vi.fn(async () => registration),
                addEventListener: vi.fn((type, fn) => {
                    listeners[type] = fn;
                }),
            },
        };
    };

    const installed = (subscription) => ({
        pushManager: { getSubscription: vi.fn(async () => subscription) },
        update: vi.fn(async () => {}),
        unregister: vi.fn(async () => true),
    });

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

    it('registers no worker before push is turned on, acks its taps and routes them', async () => {
        const mod = await load();
        const handler = vi.fn();
        mod.setPushTapHandler(handler);
        const nav = makeNav();
        await start(mod, { nav });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
        expect(nav.serviceWorker.getRegistration).toHaveBeenCalledWith('/');

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

    it('syncs again when the worker reports the subscription replaced', async () => {
        const resync = vi.fn(async () => 'on');
        const nav = makeNav();
        await start(await load(), { nav, resync });
        nav.listeners.message({ data: { type: 'puter-notification-click', id: 'click-1', notification: { uid: UID } }, source: { postMessage: vi.fn() } });
        expect(resync).not.toHaveBeenCalled();
        nav.listeners.message({ data: { type: 'puter-push-subscription-changed' }, source: {} });
        expect(resync).toHaveBeenCalledTimes(1);
    });

    it('registers nothing inside a frame', async () => {
        const nav = makeNav();
        await start(await load(), { nav, framed: true });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    });

    it('leaves an existing /sw.js alone where push is off, and registers nothing', async () => {
        const worker = installed(null);
        const nav = makeNav(worker);
        await start(await load(), { nav, params: { pushEnabled: false } });
        expect(nav.serviceWorker.register).not.toHaveBeenCalled();
        expect(worker.unregister).not.toHaveBeenCalled();
    });

    it('updates the worker this browser subscribed through', async () => {
        const worker = installed({ endpoint: 'https://push.example/1' });
        await start(await load(), { nav: makeNav(worker) });
        expect(worker.update).toHaveBeenCalled();
        expect(worker.unregister).not.toHaveBeenCalled();
    });

    it('removes a worker left without a subscription', async () => {
        const worker = installed(null);
        await start(await load(), { nav: makeNav(worker) });
        expect(worker.unregister).toHaveBeenCalled();
        expect(worker.update).not.toHaveBeenCalled();
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

describe('closeLocalBanner', () => {
    it('closes only the desktop worker notification with the acknowledged uid', async () => {
        const shown = [
            { data: { uid: 'one' }, close: vi.fn() },
            { data: { uid: 'two' }, close: vi.fn() },
            { data: { puter: { uid: 'one' } }, close: vi.fn() },
        ];
        const getRegistration = vi.fn(async () => ({ getNotifications: async () => shown }));
        await closeLocalBanner('one', { serviceWorker: { getRegistration } });
        expect(getRegistration).toHaveBeenCalledWith('/');
        expect(shown.map((n) => n.close.mock.calls.length)).toEqual([1, 0, 0]);
    });

    it('works without a registered worker', async () => {
        await expect(closeLocalBanner('one', {})).resolves.toBeUndefined();
    });

    it('contains browser API failures', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(closeLocalBanner('one', {
            serviceWorker: { getRegistration: async () => { throw new Error('unavailable'); } },
        })).resolves.toBeUndefined();
    });
});
