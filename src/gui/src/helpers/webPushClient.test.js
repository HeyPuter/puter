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

const make = ({ on = true, devices = [], permission = 'granted', subscription = {} } = {}) => {
    const notifications = {
        enable: vi.fn(async () => on),
        disable: vi.fn(async () => true),
        listDevices: vi.fn(async () => devices),
    };
    const nav = {
        serviceWorker: {
            getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: async () => subscription } })),
        },
    };
    return { notifications, client: webPushClient({ notifications, NotificationApi: { permission }, nav }) };
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
});
