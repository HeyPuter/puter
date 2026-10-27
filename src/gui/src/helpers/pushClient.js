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

// A GUI extension owns the browser's push subscription; doc/push-client.md has the contract.

/** @typedef {{ permission: 'default'|'granted'|'denied', registered: boolean, deviceUid?: string }} PushClientStatus */

/** @typedef {{ enable: () => Promise<{ deviceUid: string }>, disable: () => Promise<void>, status: () => Promise<PushClientStatus> }} PushClient */

/** @typedef {'checking'|'unavailable'|'blocked'|'on'|'off'} BrowserPushState */

/** Dispatched on `window` when a client is registered. */
export const PUSH_CLIENT_REGISTERED_EVENT = 'push-client-registered';

/** The permission that lets an app's notifications go out as pushes. */
export const PUSH_PERMISSION = 'notifications:push';

/** How long a dialog waits for the client an extension registers after its own checks. */
export const PUSH_CLIENT_WAIT_MS = 3000;

/** How long a registration begun from a click may take before the caller moves on. */
export const PUSH_ENABLE_TIMEOUT_MS = 15000;

/** @type {PushClient|null} */
let pushClient = null;

const isPushClient = (client) => (
    !! client
    && typeof client.enable === 'function'
    && typeof client.disable === 'function'
    && typeof client.status === 'function'
);

/** @param {PushClient} client @returns {boolean} Whether it was accepted */
export const registerPushClient = (client) => {
    if ( ! isPushClient(client) ) {
        console.warn('[push] client needs enable, disable and status');
        return false;
    }
    pushClient = client;
    globalThis.dispatchEvent?.(new CustomEvent(PUSH_CLIENT_REGISTERED_EVENT));
    return true;
};

/** @returns {PushClient|null} */
export const getPushClient = () => pushClient;

/** The client, now or once one registers within `ms`; null right away when the server has push off, since no extension registers one then. @param {number} [ms] @param {{ pushEnabled?: boolean }} [params] `window.gui_params` @returns {Promise<PushClient|null>} */
export const pushClientWithin = (ms = PUSH_CLIENT_WAIT_MS, params = globalThis.gui_params) => new Promise((resolve) => {
    if ( pushClient || params?.pushEnabled !== true ) {
        resolve(pushClient);
        return;
    }
    const done = () => {
        clearTimeout(timer);
        globalThis.removeEventListener(PUSH_CLIENT_REGISTERED_EVENT, done);
        resolve(pushClient);
    };
    const timer = setTimeout(done, ms);
    globalThis.addEventListener(PUSH_CLIENT_REGISTERED_EVENT, done);
});

/** @param {PushClient|null} client @returns {Promise<BrowserPushState>} */
export const browserPushState = async (client) => {
    if ( ! client ) return 'unavailable';
    try {
        const status = await client.status();
        if ( status?.permission === 'denied' ) return 'blocked';
        return status?.registered ? 'on' : 'off';
    } catch ( e ) {
        console.warn('[push] client status failed', e);
        return 'unavailable';
    }
};

const OPT_OUT_PREFIX = 'puter.push.browser-off:';

/** Records, per user, that they turned push off in this browser, so nothing turns it back on without a click. @param {string|undefined} userUid @param {boolean} optedOut @param {Storage} [storage] */
export const setBrowserPushOptOut = (userUid, optedOut, storage = globalThis.localStorage) => {
    if ( ! userUid ) return;
    try {
        if ( optedOut ) storage.setItem(`${OPT_OUT_PREFIX}${userUid}`, '1');
        else storage.removeItem(`${OPT_OUT_PREFIX}${userUid}`);
    } catch ( e ) {
        // Without storage the choice lasts for this page only.
    }
};

/** @param {string|undefined} userUid @param {Storage} [storage] @returns {boolean} */
export const browserPushOptedOut = (userUid, storage = globalThis.localStorage) => {
    if ( ! userUid ) return false;
    try {
        return storage.getItem(`${OPT_OUT_PREFIX}${userUid}`) === '1';
    } catch ( e ) {
        return false;
    }
};

/** Starts `enable()` before anything is awaited, so a click's activation covers the browser's prompt; resolves whether this browser registered and never rejects. @param {PushClient|null} client @param {string} [userUid] Whose opt-out a success clears @returns {Promise<boolean>} */
export const enableBrowserPush = (client, userUid = globalThis.user?.uuid) => {
    let enabling;
    try {
        enabling = Promise.resolve(client.enable());
    } catch ( e ) {
        enabling = Promise.reject(e);
    }
    return enabling.then(() => {
        setBrowserPushOptOut(userUid, false);
        return true;
    }, (e) => {
        console.debug('[push] enable failed', e);
        return false;
    });
};

globalThis.def?.(registerPushClient, 'push.registerPushClient');
