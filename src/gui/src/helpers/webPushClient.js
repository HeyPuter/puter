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

// Puter's own push client: standard Web Push through `/sw.js`, via
// `puter.notifications`. Used when the server publishes `pushWebPushKey`.

/** @returns {import('./pushClient.js').PushClient} */
export const webPushClient = ({
    notifications = globalThis.puter?.notifications,
    NotificationApi = globalThis.Notification,
    nav = globalThis.navigator,
} = {}) => {
    const currentDevice = async () => {
        const devices = await notifications.listDevices();
        return devices.find((d) => d.current && d.platform === 'webpush') ?? null;
    };
    return {
        // Not async before `enable()`: it asks the browser inside the click.
        enable: () => notifications.enable().then(async (on) => {
            if ( ! on ) throw new Error(`notifications ${NotificationApi?.permission ?? 'unavailable'}`);
            const device = await currentDevice();
            if ( ! device ) throw new Error('this browser was not registered');
            return { deviceUid: device.uid };
        }),
        disable: async () => {
            await notifications.disable();
        },
        status: async () => {
            const permission = NotificationApi?.permission ?? 'default';
            const registration = await nav.serviceWorker?.getRegistration('/');
            const subscription = await registration?.pushManager?.getSubscription();
            if ( permission !== 'granted' || ! subscription ) return { permission, registered: false };
            const device = await currentDevice();
            return device
                ? { permission, registered: true, deviceUid: device.uid }
                : { permission, registered: false };
        },
    };
};
