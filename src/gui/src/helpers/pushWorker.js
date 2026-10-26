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

// The page's side of `/sw.js`: registration, routed taps, hidden-tab banners.

import { httpsIconFor, isShareNotification } from '../UI/Dashboard/notificationCenter.js';
import {
    APP_MESSAGE_TYPE,
    dispatchPushTap,
    dispatchStoredTap,
    normalizePushTap,
    pushTapFromParams,
    PUSH_TAP_PARAM,
} from './notificationTap.js';
import { clear_query_param } from './parseSharedPath.js';

export const WORKER_URL = '/sw.js';
export const WORKER_CLICK_MESSAGE = 'puter-notification-click';
export const WORKER_CLICK_ACK_MESSAGE = 'puter-notification-click-ack';
export const WORKER_SHOW_MESSAGE = 'puter-show-notification';

/**
 * @param {Object} [params] - `window.gui_params`
 * @param {Navigator} [nav]
 * @returns {boolean}
 */
export const pushWorkerEnabled = (params, nav) => (
    params?.pushEnabled === true
    && typeof nav?.serviceWorker?.register === 'function'
);

/**
 * @param {{ replay?: boolean, acknowledged?: boolean, notification?: Object,
 *     visibilityState?: string, permission?: string }} input
 * @returns {boolean}
 */
export const shouldShowLocalBanner = ({ replay = false, acknowledged = false, notification, visibilityState, permission }) => (
    ! replay
    && ! acknowledged
    && visibilityState === 'hidden'
    && permission === 'granted'
    && !! notification
    && typeof notification === 'object'
    && notification.silent !== true
);

const nonEmpty = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * @param {string} uid
 * @param {Object} notification
 * @param {string|null} [appUid] - The app the row names; wins over the value's
 * @returns {Object} The push payload shape `sw.js` shows
 */
export const pushMessageFor = (uid, notification, appUid = null) => {
    const message = { uid, group: nonEmpty(notification.group) ?? uid };
    if ( notification.type === APP_MESSAGE_TYPE ) {
        const app = nonEmpty(appUid) ?? nonEmpty(notification.app?.uid);
        if ( notification.sensitive === true ) {
            return { ...message, title: nonEmpty(notification.app?.name), ...(app ? { target: { app } } : {}) };
        }
        const path = nonEmpty(notification.target);
        if ( app ) message.target = { app, ...(path ? { path } : {}) };
        if ( notification.data !== undefined ) message.data = notification.data;
    } else if ( isShareNotification(notification) ) {
        const path = nonEmpty(notification.fields?.target?.path);
        if ( path ) message.target = { path };
    }
    const body = nonEmpty(notification.text);
    const icon = httpsIconFor(notification);
    return {
        ...message,
        title: nonEmpty(notification.title),
        ...(body ? { body } : {}),
        ...(icon ? { icon } : {}),
    };
};

/**
 * @param {{ uid: string, notification: Object, appUid?: string|null }} item
 * @param {{ replay?: boolean, acknowledged?: boolean }} [meta]
 * @param {{ params?: Object, doc?: Document, nav?: Navigator, NotificationApi?: { permission: string } }} [env]
 * @returns {Promise<boolean>} Whether one was handed to the worker
 */
export const showLocalBanner = async ({ uid, notification, appUid = null }, { replay = false, acknowledged = false } = {}, {
    params = globalThis.gui_params,
    doc = globalThis.document,
    nav = globalThis.navigator,
    NotificationApi = globalThis.Notification,
} = {}) => {
    if ( ! pushWorkerEnabled(params, nav) ) return false;
    if ( ! shouldShowLocalBanner({
        replay,
        acknowledged,
        notification,
        visibilityState: doc?.visibilityState,
        permission: NotificationApi?.permission,
    }) ) return false;
    try {
        const registration = await nav.serviceWorker.getRegistration?.('/');
        const worker = registration?.active;
        if ( ! worker ) return false;
        worker.postMessage({ type: WORKER_SHOW_MESSAGE, puter: pushMessageFor(uid, notification, appUid) });
        return true;
    } catch ( err ) {
        console.warn('Could not show a browser notification:', err);
        return false;
    }
};

let started = false;

/**
 * @param {{ params?: Object, nav?: Navigator, query?: URLSearchParams,
 *     clearParam?: (name: string) => void, framed?: boolean }} [env]
 * @returns {Promise<void>}
 */
export const startPushWorker = async ({
    params = globalThis.gui_params,
    nav = globalThis.navigator,
    query = globalThis.url_query_params,
    clearParam = clear_query_param,
    framed = globalThis.top !== globalThis.self,
} = {}) => {
    if ( started || framed ) return;
    started = true;

    if ( query?.has?.(PUSH_TAP_PARAM) ) {
        const opened = pushTapFromParams(query);
        clearParam(PUSH_TAP_PARAM);
        if ( opened ) dispatchStoredTap(opened);
    }

    // Leave an existing worker: removing it ends this browser's subscription.
    if ( ! pushWorkerEnabled(params, nav) ) return;
    nav.serviceWorker.addEventListener('message', (event) => {
        if ( event.data?.type !== WORKER_CLICK_MESSAGE || ! normalizePushTap(event.data.notification) ) return;
        event.source?.postMessage?.({ type: WORKER_CLICK_ACK_MESSAGE, id: event.data.id });
        dispatchPushTap(event.data.notification);
    });
    try {
        await nav.serviceWorker.register(WORKER_URL, { scope: '/' });
    } catch ( err ) {
        console.warn('Could not register the service worker:', err);
    }
};
