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
import { webPushClient } from './webPushClient.js';

const make = ({ on = true, devices = [], permission = 'granted', subscription = { endpoint: 'https://push.test/1' }, user = 'u-1' } = {}) => {
    const notifications = {
        enable: vi.fn(async () => on),
        _enableWebPush: vi.fn(async () => {}),
        disable: vi.fn(async () => true),
        listDevices: vi.fn(async () => devices),
    };
    const listeners = new Set();
    const state = { subscription, user };
    const nav = {
        serviceWorker: {
            getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: async () => state.subscription } })),
            addEventListener: (type, fn) => listeners.add(fn),
        },
    };
    const post = (data) => {
        for ( const fn of listeners ) fn({ data });
    };
    const client = webPushClient({ notifications, NotificationApi: { permission }, nav, userUid: () => state.user });
    return { notifications, client, post, state };
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
        expect(notifications._enableWebPush).toHaveBeenCalledWith({ url: '/sw.js', scope: '/' }, { renewRemoved: false });
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
        ['enable() ran', async ({ client }) => {
            await client.enable();
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

    it('is off without listing devices once the browser has no subscription or permission', async () => {
        const { notifications, client, state } = await readOn();
        state.subscription = null;
        await expect(client.status({ cached: true })).resolves.toEqual({ permission: 'granted', registered: false });
        expect(notifications.listDevices).not.toHaveBeenCalled();
    });
});
