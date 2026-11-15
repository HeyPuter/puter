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

// Puter's own push client: standard Web Push through `/sw.js` via `puter.notifications`, used when the server publishes `pushWebPushKey`.

import { SUBSCRIPTION_CHANGED_MESSAGE } from '../../../puter-js/src/modules/notifications/lib/pushStore.js';
import { forgetPushApps, webPushEndpointState } from './notificationApi.js';

/** Where earlier builds kept the endpoint the server last confirmed, per user. */
export const LEGACY_LAST_ENDPOINT_PREFIX = 'puter.push.last-endpoint:';

const removedError = () => Object.assign(new Error('this browser was removed from push in Puter'), { code: 'push_device_removed' });
const busyError = () => Object.assign(new Error('Puter asked to wait before registering this browser'), { code: 'too_many_requests' });
const unavailableError = () => Object.assign(new Error('push notifications are unavailable in this browser'), { code: 'unavailable' });

/** How long a page answers `cached` reads from its last `on`. */
export const ON_KEPT_MS = 5 * 60 * 1000;

/** @returns {import('./pushClient.js').PushClient} */
export const webPushClient = ({
    notifications = globalThis.puter?.notifications,
    NotificationApi = globalThis.Notification,
    nav = globalThis.navigator,
    userUid = () => globalThis.user?.uuid,
    endpointState = webPushEndpointState,
    storage = globalThis.localStorage,
    now = Date.now,
} = {}) => {
    // The last `on` this page read; a new page always asks the server.
    /** @type {{ userUid: string, endpoint: string, deviceUid: string, at: number, enabled?: boolean }|null} */
    let lastOn = null;
    let generation = 0;
    const forgetOn = () => {
        lastOn = null;
        generation++;
    };
    /** The real check in flight, shared by every read of the same user and endpoint. */
    let checking = null;
    const check = (user, endpoint) => {
        const key = `${generation}\n${user ?? ''}\n${endpoint}`;
        if ( checking?.key === key ) return checking.promise;
        const entry = { key, promise: null };
        entry.promise = Promise.all([currentDevice(), endpointState(endpoint)]).finally(() => {
            if ( checking === entry ) checking = null;
        });
        checking = entry;
        return entry.promise;
    };
    nav?.serviceWorker?.addEventListener?.('message', (event) => {
        if ( event.data?.type === SUBSCRIPTION_CHANGED_MESSAGE ) forgetOn();
    });

    const currentDevice = async () => {
        const devices = await notifications.listDevices();
        return devices.find((d) => d.current && d.platform === 'webpush') ?? null;
    };
    const registration = async () => await nav.serviceWorker?.getRegistration('/');
    const legacyKey = (user) => LEGACY_LAST_ENDPOINT_PREFIX + user;
    // A puter.js from before these reads keeps nothing for the desktop.
    const pushRecord = async () => (await notifications._webPushRecord?.()) ?? { endpoint: null, changed: null };
    const record = async () => {
        const known = await pushRecord();
        if ( known.endpoint ) return known;
        try {
            return { ...known, endpoint: storage.getItem(legacyKey(userUid())) };
        } catch ( e ) {
            return known;
        }
    };
    const forgetLegacy = (user) => {
        if ( ! notifications._webPushRecord ) return;
        try {
            storage.removeItem(legacyKey(user));
        } catch ( e ) {
            // Read only while puter.js has no record of its own.
        }
    };
    /** `'removed'` when the user removed any earlier endpoint of this browser, ending the subscription here; `'busy'` on a 429. */
    const removedElsewhere = async () => {
        const { endpoint, changed } = await record();
        const earlier = [...new Set([changed?.oldEndpoint, endpoint].filter((e) => typeof e === 'string' && e))];
        const states = await Promise.all(earlier.map((e) => endpointState(e)));
        if ( ! states.includes('removed') ) return states.includes('busy') ? 'busy' : null;
        await notifications._dropRemovedWebPush?.();
        return 'removed';
    };
    return {
        // Not async before `enable()`: it asks the browser inside the click.
        enable: ({ background = false } = {}) => {
            forgetOn();
            forgetPushApps();
            const turningOn = background
                ? removedElsewhere().then(async (earlier) => {
                    if ( earlier === 'removed' ) throw removedError();
                    // The mark stays, so the next run asks again.
                    if ( earlier === 'busy' ) throw busyError();
                    return await notifications.enable({ background: true });
                })
                : notifications.enable();
            return turningOn.then(async (on) => {
                if ( ! on ) {
                    const permission = NotificationApi?.permission;
                    throw permission && permission !== 'granted' ? new Error(`notifications ${permission}`) : unavailableError();
                }
                const reading = generation;
                const user = userUid();
                const device = await currentDevice();
                if ( ! device ) throw new Error('this browser was not registered');
                const subscription = await (await registration())?.pushManager?.getSubscription();
                if ( subscription?.endpoint && user === userUid() ) {
                    if ( user ) forgetLegacy(user);
                    if ( reading === generation && user ) {
                        lastOn = { userUid: user, endpoint: subscription.endpoint, deviceUid: device.uid, at: now(), enabled: true };
                    }
                }
                return { deviceUid: device.uid };
            }).catch((e) => {
                // A read begun meanwhile keeps nothing from before the failure.
                forgetOn();
                throw e;
            });
        },
        disable: async () => {
            forgetOn();
            forgetPushApps();
            try {
                await notifications.disable();
            } finally {
                forgetOn();
            }
        },
        status: async ({ cached = false } = {}) => {
            const permission = NotificationApi?.permission ?? 'default';
            const worker = await registration();
            const subscription = await worker?.pushManager?.getSubscription();
            if ( permission !== 'granted' || ! subscription ) {
                forgetOn();
                return { permission, registered: false };
            }
            const known = await pushRecord();
            // A subscription the browser replaced is registered again in full.
            if ( known.changed != null ) {
                forgetOn();
                return { permission, registered: false };
            }
            const user = userUid();
            const kept = lastOn && lastOn.userUid === user && lastOn.endpoint === subscription.endpoint
                && now() - lastOn.at < ON_KEPT_MS;
            if ( cached && kept ) {
                return { permission, registered: true, deviceUid: lastOn.deviceUid };
            }
            const reading = generation;
            // Devices match by session, so the endpoint tells whether it is this subscription.
            const [device, state] = await check(user, subscription.endpoint);
            // The server's answer can trail what `enable()` just registered in this page.
            const trailing = state === 'unknown' && kept && lastOn?.enabled === true;
            const registered = !! device && (state === 'active' || state === null || state === 'busy' || trailing);
            if ( registered && state === 'active' && user && user === userUid() ) {
                if ( known.endpoint !== subscription.endpoint ) await notifications._noteWebPushSynced?.(subscription.endpoint);
                forgetLegacy(user);
            }
            if ( reading === generation && ! trailing ) {
                // Only an `on` the server confirmed for this endpoint and user is kept.
                lastOn = registered && state === 'active' && user && user === userUid()
                    ? { userUid: user, endpoint: subscription.endpoint, deviceUid: device.uid, at: now() }
                    : null;
            }
            return registered
                ? { permission, registered: true, deviceUid: device.uid }
                : { permission, registered: false };
        },
    };
};
