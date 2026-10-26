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

/** Dispatched on `window` when a client is registered. */
export const PUSH_CLIENT_REGISTERED_EVENT = 'push-client-registered';

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

globalThis.def?.(registerPushClient, 'push.registerPushClient');
