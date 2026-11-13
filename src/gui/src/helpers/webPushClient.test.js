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

import { describe, expect, it, vi } from 'vitest';
import {
    RECEIPT_PREFIX as STORED_RECEIPT_PREFIX,
    SUBSCRIPTION_CHANGED_PREFIX as STORED_CHANGED_PREFIX,
} from '../../../puter-js/src/modules/notifications/lib/pushStore.js';
import { cachedPushApps } from './notificationApi.js';
import { registerPushClient } from './pushClient.js';
import { syncBrowserPush } from './pushSync.js';
import { LAST_ENDPOINT_PREFIX, ON_KEPT_MS, RECEIPT_PREFIX, SUBSCRIPTION_CHANGED_PREFIX, webPushClient } from './webPushClient.js';

const SCOPE = 'https://puter.test/';
const LAST_ENDPOINT_KEY = `${LAST_ENDPOINT_PREFIX}u-1`;
const CHANGED = `${STORED_CHANGED_PREFIX}${SCOPE}`;

/** `localStorage` over a Map. */
const fakeStorage = (entries = {}) => {
    const map = new Map(Object.entries(entries));
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) };
};

/** IndexedDB with one store's worth of entries, answering on a microtask. */
const fakeIdb = (entries = {}) => {
    const map = new Map(Object.entries(entries));
    const later = (run) => {
        const req = {};
        queueMicrotask(() => {
            req.result = run();
            req.onsuccess?.();
        });
        return req;
    };
    const store = {
        get: (key) => later(() => map.get(key)),
        delete: (key) => later(() => void map.delete(key)),
    };
    return {
        map,
        open: () => later(() => ({ transaction: () => ({ objectStore: () => store }), close: () => {} })),
    };
};

const make = ({ on = true, devices = [], permission = 'granted', subscription = { endpoint: 'https://push.test/1' }, user = 'u-1', serverState = 'active', idb = fakeIdb(), storage = fakeStorage() } = {}) => {
    const notifications = {
        enable: vi.fn(async () => on),
        _enableWebPush: vi.fn(async () => {}),
        disable: vi.fn(async () => true),
        listDevices: vi.fn(async () => devices),
    };
    const listeners = new Set();
    const state = { subscription, user, serverState, now: 0 };
    const nav = {
        serviceWorker: {
            getRegistration: vi.fn(async () => ({ scope: SCOPE, pushManager: { getSubscription: async () => state.subscription } })),
            addEventListener: (type, fn) => listeners.add(fn),
        },
    };
    const post = (data) => {
        for ( const fn of listeners ) fn({ data });
    };
    const endpointState = vi.fn(async () => state.serverState);
    const client = webPushClient({ notifications, NotificationApi: { permission }, nav, userUid: () => state.user, idb, endpointState, storage, now: () => state.now });
    return { notifications, client, post, state, endpointState, idb, storage };
};

const current = { uid: 'd1', platform: 'webpush', current: true };

describe('webPushClient', () => {
    it('calls enable() before anything is awaited, and returns this browser`s device', async () => {
        const { notifications, client } = make({ devices: [{ uid: 'x', platform: 'web', current: true }, current] });
        const pending = client.enable();
        expect(notifications.enable).toHaveBeenCalledTimes(1);
        await expect(pending).resolves.toEqual({ deviceUid: 'd1' });
    });

    it('rejects when the browser said no', async () => {
        const { client } = make({ on: false, permission: 'denied' });
        await expect(client.enable()).rejects.toThrow('notifications denied');
    });

    it('is registered only with a subscription the server lists for this session', async () => {
        await expect(make({ devices: [current] }).client.status()).resolves.toEqual({ permission: 'granted', registered: true, deviceUid: 'd1' });
        await expect(make({ devices: [] }).client.status()).resolves.toEqual({ permission: 'granted', registered: false });
        await expect(make({ subscription: null, devices: [current] }).client.status()).resolves.toEqual({ permission: 'granted', registered: false });
        await expect(make({ permission: 'denied' }).client.status()).resolves.toEqual({ permission: 'denied', registered: false });
    });

    it('is registered only while the server has this subscription`s endpoint', async () => {
        const { client, endpointState } = make({ devices: [current], serverState: 'unknown' });
        await expect(client.status()).resolves.toEqual({ permission: 'granted', registered: false });
        expect(endpointState).toHaveBeenCalledWith('https://push.test/1');
        await expect(make({ devices: [current], serverState: 'removed' }).client.status()).resolves.toEqual({ permission: 'granted', registered: false });
        // A server that can't tell leaves the session match.
        await expect(make({ devices: [current], serverState: null }).client.status()).resolves.toEqual({ permission: 'granted', registered: true, deviceUid: 'd1' });
    });

    it('is not registered once the worker marked the subscription replaced, until enable() registers it', async () => {
        const idb = fakeIdb({ [CHANGED]: 1 });
        const { client, endpointState } = make({ devices: [current], idb });
        await expect(client.status()).resolves.toEqual({ permission: 'granted', registered: false });
        expect(endpointState).not.toHaveBeenCalled();

        await expect(client.enable()).resolves.toEqual({ deviceUid: 'd1' });
        expect(idb.map.has(CHANGED)).toBe(false);
        await expect(client.status()).resolves.toEqual({ permission: 'granted', registered: true, deviceUid: 'd1' });
    });

    it('has the next load register a replaced subscription in full', async () => {
        globalThis.gui_params = { pushEnabled: true };
        const { client, notifications } = make({ devices: [current], idb: fakeIdb({ [CHANGED]: 1 }) });
        registerPushClient(client);
        const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        await expect(syncBrowserPush({}, { NotificationApi: { permission: 'granted' }, userUid: 'u-1', storage, holdsPush: async () => true })).resolves.toBe('on');
        expect(notifications._enableWebPush).toHaveBeenCalledTimes(1);
    });

    it('turns off through puter.notifications', async () => {
        const { notifications, client } = make();
        await client.disable();
        expect(notifications.disable).toHaveBeenCalled();
    });

    it('turns on from a click through enable(), which replaces a browser removed in Puter', async () => {
        const { notifications, client } = make({ devices: [current] });
        await client.enable();
        expect(notifications.enable).toHaveBeenCalledTimes(1);
        expect(notifications._enableWebPush).not.toHaveBeenCalled();
    });

    it('turns on in the background without replacing a browser removed in Puter', async () => {
        const { notifications, client } = make({ devices: [current] });
        await expect(client.enable({ background: true })).resolves.toEqual({ deviceUid: 'd1' });
        expect(notifications._enableWebPush).toHaveBeenCalledWith({ url: '/sw.js', scope: '/' }, { background: true });
        expect(notifications.enable).not.toHaveBeenCalled();

        const removed = Object.assign(new Error('removed'), { code: 'push_device_removed' });
        notifications._enableWebPush.mockRejectedValue(removed);
        await expect(client.enable({ background: true })).rejects.toBe(removed);
    });
});

describe('webPushClient status with cached', () => {
    const on = { permission: 'granted', registered: true, deviceUid: 'd1' };

    /** A client whose last read was `on`. */
    const readOn = async () => {
        const made = make({ devices: [current] });
        await expect(made.client.status()).resolves.toEqual(on);
        made.notifications.listDevices.mockClear();
        return made;
    };

    it('answers with the last on this page read, without listing devices', async () => {
        const { notifications, client } = await readOn();
        await expect(client.status({ cached: true })).resolves.toEqual(on);
        expect(notifications.listDevices).not.toHaveBeenCalled();
    });

    it('lists devices for a read without cached', async () => {
        const { notifications, client } = await readOn();
        await client.status();
        expect(notifications.listDevices).toHaveBeenCalledTimes(1);
    });

    it('lists devices when nothing was read yet', async () => {
        const { notifications, client } = make({ devices: [current] });
        await expect(client.status({ cached: true })).resolves.toEqual(on);
        expect(notifications.listDevices).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the worker says the subscription changed', ({ post }) => post({ type: 'puter-push-subscription-changed' })],
        ['the subscription has another endpoint', ({ state }) => {
            state.subscription = { endpoint: 'https://push.test/2' };
        }],
        ['another user signed in', ({ state }) => {
            state.user = 'u-2';
        }],
        ['the user signed out', ({ state }) => {
            state.user = undefined;
        }],
        ['the last on is older than a page keeps it', ({ state }) => {
            state.now += ON_KEPT_MS;
        }],
        ['enable() failed', async ({ client, notifications }) => {
            notifications.enable.mockResolvedValueOnce(false);
            await client.enable().catch(() => {});
        }],
        ['disable() ran', async ({ client }) => {
            await client.disable();
        }],
        ['a read found this browser unregistered', async ({ client, notifications }) => {
            notifications.listDevices.mockResolvedValueOnce([]);
            await client.status();
        }],
    ])('asks the server again once %s', async (_label, change) => {
        const made = await readOn();
        await change(made);
        made.notifications.listDevices.mockClear();
        await made.client.status({ cached: true });
        expect(made.notifications.listDevices).toHaveBeenCalledTimes(1);
    });

    it('answers with the on enable() read, without listing devices again', async () => {
        const { notifications, client } = make({ devices: [current] });
        await client.enable({ background: true });
        notifications.listDevices.mockClear();
        await expect(client.status({ cached: true })).resolves.toEqual(on);
        expect(notifications.listDevices).not.toHaveBeenCalled();
    });

    it('keeps answering with the last on until it is too old', async () => {
        const { notifications, client, state } = await readOn();
        state.now += ON_KEPT_MS - 1;
        await expect(client.status({ cached: true })).resolves.toEqual(on);
        expect(notifications.listDevices).not.toHaveBeenCalled();
    });

    it('reports off after disable()', async () => {
        const { notifications, client } = await readOn();
        await client.disable();
        notifications.listDevices.mockResolvedValue([]);
        await expect(client.status({ cached: true })).resolves.toEqual({ permission: 'granted', registered: false });
    });

    it('keeps no on read before a disable() that ended first', async () => {
        const { notifications, client } = make({ devices: [current] });
        let list;
        notifications.listDevices.mockImplementationOnce(() => new Promise((resolve) => {
            list = resolve;
        }));
        const reading = client.status();
        await vi.waitFor(() => expect(list).toBeDefined());
        await client.disable();
        list([current]);
        await reading;
        notifications.listDevices.mockResolvedValue([]);
        await expect(client.status({ cached: true })).resolves.toEqual({ permission: 'granted', registered: false });
    });

    it('ignores the last on while the worker`s subscription-changed mark is set', async () => {
        const made = await readOn();
        made.idb.map.set(CHANGED, 1);
        await expect(made.client.status({ cached: true })).resolves.toEqual({ permission: 'granted', registered: false });
        made.idb.map.delete(CHANGED);
        made.endpointState.mockClear();
        await made.client.status({ cached: true });
        expect(made.notifications.listDevices).toHaveBeenCalledTimes(1);
        expect(made.endpointState).toHaveBeenCalledTimes(1);
    });

    it('keeps no on the server didn`t confirm for this endpoint', async () => {
        for ( const serverState of ['unknown', null] ) {
            const made = await readOn();
            made.state.serverState = serverState;
            await made.client.status();
            made.state.serverState = 'active';
            made.notifications.listDevices.mockClear();
            made.endpointState.mockClear();
            await made.client.status({ cached: true });
            expect(made.notifications.listDevices).toHaveBeenCalledTimes(1);
            expect(made.endpointState).toHaveBeenCalledTimes(1);
        }
    });

    it('stays on right after enable() while the endpoint check doesn`t have it yet', async () => {
        const { client, state } = make({ devices: [current], serverState: 'unknown' });
        await client.enable();
        await expect(client.status()).resolves.toEqual(on);
        await expect(client.status()).resolves.toEqual(on);
        state.now += ON_KEPT_MS;
        await expect(client.status()).resolves.toEqual({ permission: 'granted', registered: false });
    });

    it('answers a cached launch without the endpoint check', async () => {
        const made = await readOn();
        made.endpointState.mockClear();
        await expect(made.client.status({ cached: true })).resolves.toEqual(on);
        expect(made.endpointState).not.toHaveBeenCalled();
    });

    it('keeps no on from a device list that another user`s sign-in overlapped', async () => {
        const { notifications, client, state } = make({ devices: [current] });
        let list;
        notifications.listDevices.mockImplementationOnce(() => new Promise((resolve) => {
            list = resolve;
        }));
        const reading = client.status();
        await vi.waitFor(() => expect(list).toBeDefined());
        state.user = 'u-2';
        list([current]);
        await reading;
        state.user = 'u-1';
        notifications.listDevices.mockClear();
        await client.status({ cached: true });
        expect(notifications.listDevices).toHaveBeenCalledTimes(1);
    });

    it('keeps no on read while an enable() that failed was running', async () => {
        const { notifications, client } = make({ devices: [current] });
        let fail;
        notifications._enableWebPush.mockImplementationOnce(() => new Promise((_, reject) => {
            fail = reject;
        }));
        const enabling = client.enable({ background: true });
        await expect(client.status()).resolves.toEqual(on);
        fail(new Error('no push service'));
        await expect(enabling).rejects.toThrow('no push service');
        notifications.listDevices.mockClear();
        await client.status({ cached: true });
        expect(notifications.listDevices).toHaveBeenCalledTimes(1);
    });

    it('is off without listing devices once the browser has no subscription or permission', async () => {
        const { notifications, client, state } = await readOn();
        state.subscription = null;
        await expect(client.status({ cached: true })).resolves.toEqual({ permission: 'granted', registered: false });
        expect(notifications.listDevices).not.toHaveBeenCalled();
    });
});

describe('webPushClient and a browser removed from another device', () => {
    const OLD = 'https://push.test/0';
    const NEW = { endpoint: 'https://push.test/1', unsubscribe: vi.fn(async () => true) };
    const OPT_OUT = 'puter.push.browser-off:u-1';
    const sync = (storage) => syncBrowserPush({}, { NotificationApi: { permission: 'granted' }, userUid: 'u-1', storage, holdsPush: async () => true });

    const removedElsewhere = (over) => {
        globalThis.gui_params = { pushEnabled: true };
        NEW.unsubscribe.mockClear();
        const made = make({ devices: [], subscription: NEW, ...over });
        made.endpointState.mockImplementation(async (endpoint) => (endpoint === OLD ? 'removed' : 'unknown'));
        registerPushClient(made.client);
        return made;
    };

    it('stays off after a subscription change, and records it as turned off', async () => {
        const made = removedElsewhere({ idb: fakeIdb({ [CHANGED]: { at: 1, oldEndpoint: OLD } }) });
        await expect(sync(made.storage)).resolves.toBe('removed');
        expect(made.endpointState).toHaveBeenCalledWith(OLD);
        expect(made.notifications._enableWebPush).not.toHaveBeenCalled();
        expect(NEW.unsubscribe).toHaveBeenCalledTimes(1);
        expect(made.idb.map.has(CHANGED)).toBe(false);
        expect(made.storage.map.get(OPT_OUT)).toBe('1');
        await expect(sync(made.storage)).resolves.toBe('opted_out');
    });

    it('forgets the removed endpoint`s receipt when it stays off', async () => {
        const RECEIPT = `${STORED_RECEIPT_PREFIX}${SCOPE}`;
        const made = removedElsewhere({ idb: fakeIdb({ [CHANGED]: { at: 1, oldEndpoint: OLD }, [RECEIPT]: { endpoint: OLD, receipt: 'r.sig' } }) });
        await expect(sync(made.storage)).resolves.toBe('removed');
        expect(made.idb.map.has(RECEIPT)).toBe(false);
    });

    it('stays off after the browser dropped the subscription, from the last endpoint the server confirmed', async () => {
        const made = removedElsewhere({ subscription: null, storage: fakeStorage({ [LAST_ENDPOINT_KEY]: OLD }) });
        await expect(sync(made.storage)).resolves.toBe('removed');
        expect(made.notifications._enableWebPush).not.toHaveBeenCalled();
        expect(made.storage.map.get(OPT_OUT)).toBe('1');
    });

    it('asks about the endpoint confirmed for the signed-in user only', async () => {
        const made = removedElsewhere({ subscription: null, user: 'u-2', storage: fakeStorage({ [LAST_ENDPOINT_KEY]: OLD }) });
        made.notifications.listDevices.mockResolvedValue([current]);
        await expect(made.client.enable({ background: true })).resolves.toEqual({ deviceUid: 'd1' });
        expect(made.endpointState).not.toHaveBeenCalledWith(OLD);
    });

    it('turns back on from a click, which keeps the new endpoint', async () => {
        const made = removedElsewhere({ idb: fakeIdb({ [CHANGED]: { at: 1, oldEndpoint: OLD } }) });
        await sync(made.storage);
        made.notifications.listDevices.mockResolvedValue([current]);
        await expect(made.client.enable()).resolves.toEqual({ deviceUid: 'd1' });
        expect(made.notifications.enable).toHaveBeenCalledTimes(1);
        expect(made.storage.map.get(LAST_ENDPOINT_KEY)).toBe(NEW.endpoint);
    });

    it('stays off when the removed endpoint is two subscription changes back', async () => {
        const made = removedElsewhere({
            idb: fakeIdb({ [CHANGED]: { at: 2, oldEndpoint: 'https://push.test/0b' } }),
            storage: fakeStorage({ [LAST_ENDPOINT_KEY]: OLD }),
        });
        await expect(sync(made.storage)).resolves.toBe('removed');
        expect(made.endpointState).toHaveBeenCalledWith('https://push.test/0b');
        expect(made.endpointState).toHaveBeenCalledWith(OLD);
        expect(made.notifications._enableWebPush).not.toHaveBeenCalled();
        expect(made.storage.map.get(OPT_OUT)).toBe('1');
    });

    it('registers nothing while the server answers 429, keeps the mark, and goes ahead on the next run', async () => {
        const made = removedElsewhere({ idb: fakeIdb({ [CHANGED]: { at: 1, oldEndpoint: OLD } }) });
        made.endpointState.mockResolvedValue('busy');
        await expect(sync(made.storage)).resolves.toBe('later');
        expect(made.notifications._enableWebPush).not.toHaveBeenCalled();
        expect(made.idb.map.has(CHANGED)).toBe(true);
        expect(made.storage.map.has(OPT_OUT)).toBe(false);

        made.endpointState.mockResolvedValue('unknown');
        made.notifications.listDevices.mockResolvedValue([current]);
        await expect(sync(made.storage)).resolves.toBe('on');
        expect(made.notifications._enableWebPush).toHaveBeenCalledTimes(1);
    });

    it('turns on from a click while the server answers 429', async () => {
        const made = removedElsewhere({ idb: fakeIdb({ [CHANGED]: { at: 1, oldEndpoint: OLD } }) });
        made.endpointState.mockResolvedValue('busy');
        made.notifications.listDevices.mockResolvedValue([current]);
        await expect(made.client.enable()).resolves.toEqual({ deviceUid: 'd1' });
    });

    it('registers in the background as before when the old endpoint wasn`t removed', async () => {
        const made = removedElsewhere({ idb: fakeIdb({ [CHANGED]: { at: 1, oldEndpoint: OLD } }) });
        made.endpointState.mockResolvedValue('unknown');
        made.notifications.listDevices.mockResolvedValue([current]);
        await expect(sync(made.storage)).resolves.toBe('on');
        expect(made.notifications._enableWebPush).toHaveBeenCalledTimes(1);
    });
});

describe('webPushClient requests', () => {
    it('shares one real check among status reads of the same user and endpoint', async () => {
        const { client, notifications, endpointState } = make({ devices: [current] });
        const reads = await Promise.all([client.status({ cached: true }), client.status({ cached: true }), client.status()]);
        expect(reads.every((r) => r.registered)).toBe(true);
        expect(notifications.listDevices).toHaveBeenCalledTimes(1);
        expect(endpointState).toHaveBeenCalledTimes(1);
    });

    it('drops the page`s /push/apps answer on enable() and disable()', async () => {
        globalThis.window = globalThis.window ?? globalThis;
        window.api_origin = 'https://api.puter.test';
        globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ apps: [] }), { status: 200 }));
        const { client } = make({ devices: [current] });
        await cachedPushApps();
        await cachedPushApps();
        expect(fetch).toHaveBeenCalledTimes(1);
        await client.enable();
        await cachedPushApps();
        expect(fetch).toHaveBeenCalledTimes(2);
        await client.disable();
        await cachedPushApps();
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('reads the marker under the key puter.js and the worker use', () => {
        expect(SUBSCRIPTION_CHANGED_PREFIX).toBe(STORED_CHANGED_PREFIX);
        expect(RECEIPT_PREFIX).toBe(STORED_RECEIPT_PREFIX);
    });
});

