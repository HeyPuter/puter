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

// Registers this browser again without a click where the browser already allows it.

import { appHoldsPermissions } from './holdsPermissions.js';
import { listPushApps } from './notificationApi.js';
import {
    browserPushOptedOut,
    browserPushState,
    enableBrowserPush,
    PUSH_PERMISSION,
    pushClientWithin,
} from './pushClient.js';

/** @typedef {'skipped'|'opted_out'|'unavailable'|'blocked'|'on'|'off'|'no_app'|'failed'} PushSyncResult */

/** @type {Promise<PushSyncResult>|null} */
let inFlight = null;

/** Turns push on here when the browser already grants it, the user has not turned it off here, and an app holds `notifications:push` for Puter's devices: the one named by `appUid`, or any app without one. One run at a time; a call during a run joins it. @param {{ appUid?: string }} [scope] @param {{ NotificationApi?: { permission: string }, userUid?: string, storage?: Storage, holdsPush?: () => Promise<boolean> }} [deps] @returns {Promise<PushSyncResult>} */
export const syncBrowserPush = (scope, deps) => {
    if ( inFlight ) return inFlight;
    inFlight = runSync(scope, deps).finally(() => {
        inFlight = null;
    });
    return inFlight;
};

/** An app a website's Web Push confirmation let in pushes only to that website's browsers, not to Puter's. */
const pushesToPuter = (app) => app?.puterDevices !== false;

const runSync = async ({ appUid } = {}, {
    NotificationApi = globalThis.Notification,
    userUid = globalThis.user?.uuid,
    storage = globalThis.localStorage,
    holdsPush = async () => (appUid
        ? await appHoldsPermissions([PUSH_PERMISSION], appUid)
            && pushesToPuter((await listPushApps()).find((app) => app.uid === appUid))
        : (await listPushApps()).some(pushesToPuter)),
} = {}) => {
    if ( NotificationApi?.permission !== 'granted' || ! userUid ) return 'skipped';
    if ( browserPushOptedOut(userUid, storage) ) return 'opted_out';
    const client = await pushClientWithin();
    const state = await browserPushState(client);
    if ( state !== 'off' ) return state;
    try {
        if ( ! await holdsPush() ) return 'no_app';
    } catch ( e ) {
        console.warn('[push] could not tell whether an app may send pushes', e);
        return 'failed';
    }
    return await enableBrowserPush(client, userUid) ? 'on' : 'failed';
};
