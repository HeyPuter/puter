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

import { appHoldsPermissions } from './holdsPermissions.js';
import { cachedPushApps } from './notificationApi.js';
import { PUSH_PERMISSION } from './pushClient.js';

/** An app a website's Web Push confirmation let in pushes only to that website's browsers, not to Puter's. @param {import('./notificationApi.js').PushApp} app */
export const pushesToPuter = (app) => app.puterDevices !== false;

/** @typedef {{ holds?: (permissions: string[], appUid: string) => Promise<boolean>, listApps?: () => Promise<import('./notificationApi.js').PushApp[]> }} PushAppsDeps */

/** Whether the app's push grant reaches Puter's devices: never without a uid to match. The grant alone counts when the list can't be read or leaves the app out, since the list is capped and can trail a grant. */
const listedForPuter = async (appUid, listApps) => {
    if ( ! appUid ) return false;
    let apps;
    try {
        apps = await listApps();
    } catch ( e ) {
        console.warn('[push] could not list the apps that may push', e);
        return true;
    }
    const app = apps.find((listed) => listed.uid === appUid);
    return ! app || pushesToPuter(app);
};

/** Whether the app holds all of `permissions`, push counting only for Puter's devices. @param {string[]} permissions @param {string} appUid @param {PushAppsDeps} [deps] @returns {Promise<boolean>} */
export const appHoldsForPuter = async (permissions, appUid, {
    holds = appHoldsPermissions,
    listApps = cachedPushApps,
} = {}) => {
    if ( ! await holds(permissions, appUid) ) return false;
    if ( ! permissions.includes(PUSH_PERMISSION) ) return true;
    return await listedForPuter(appUid, listApps);
};

/** `permissions` without a push grant the app already holds for Puter's devices, which a prompt for the rest leaves out. @param {string[]} permissions @param {string} appUid @param {PushAppsDeps} [deps] @returns {Promise<string[]>} */
export const withoutHeldPush = async (permissions, appUid, deps) => {
    if ( ! permissions.includes(PUSH_PERMISSION) ) return permissions;
    if ( ! await appHoldsForPuter([PUSH_PERMISSION], appUid, deps) ) return permissions;
    return permissions.filter((permission) => permission !== PUSH_PERMISSION);
};

/** The app's push grant: none, Puter's own, or only its website's Web Push. @param {string} appUid @param {PushAppsDeps} [deps] @returns {Promise<'none'|'puter'|'website'>} */
export const pushGrantOf = async (appUid, {
    holds = appHoldsPermissions,
    listApps = cachedPushApps,
} = {}) => {
    if ( ! await holds([PUSH_PERMISSION], appUid) ) return 'none';
    return await listedForPuter(appUid, listApps) ? 'puter' : 'website';
};
