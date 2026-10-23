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

/**
 * The GUI's side of the service worker at `/sw.js` (its contract is in
 * `src/sw.js`): registering it where the deployment has push, taking the taps
 * it routes here, and showing a browser notification for what arrives over
 * the socket while this tab is hidden. Notification permission is never
 * asked for here.
 */

import { httpsIconFor, isShareNotification } from '../UI/Dashboard/notificationCenter.js';
import { APP_MESSAGE_TYPE, dispatchPushTap, pushTapFromParams, PUSH_TAP_PARAM } from './notificationTap.js';

export const WORKER_URL = '/sw.js';
export const WORKER_CLICK_MESSAGE = 'puter-notification-click';
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
 * Whether a notification that just arrived over the socket also gets a browser
 * notification: only live ones, while the tab is hidden, with permission
 * already granted.
 *
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
 * A notification in the push payload shape the worker shows.
 *
 * @param {string} uid
 * @param {Object} notification
 * @param {string|null} [appUid] - The app the row is about, when it names one
 * @returns {Object}
 */
export const pushMessageFor = (uid, notification, appUid = null) => {
    const message = { uid, group: nonEmpty(notification.group) ?? uid };
    if ( notification.type === APP_MESSAGE_TYPE ) {
        const app = nonEmpty(notification.app?.uid) ?? nonEmpty(appUid);
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
 * Show a browser notification for a live arrival when
 * {@link shouldShowLocalBanner} says so. The worker renders it, so a tap on
 * it is routed the same way a push's is.
 *
 * @param {{ uid: string, notification: Object, appUid?: string|null }} item
 * @param {{ replay?: boolean, acknowledged?: boolean }} [meta]
 * @param {{ doc?: Document, nav?: Navigator, NotificationApi?: { permission: string } }} [env]
 * @returns {Promise<boolean>} Whether one was handed to the worker
 */
export const showLocalBanner = async ({ uid, notification, appUid = null }, { replay = false, acknowledged = false } = {}, {
    doc = globalThis.document,
    nav = globalThis.navigator,
    NotificationApi = globalThis.Notification,
} = {}) => {
    if ( ! shouldShowLocalBanner({
        replay,
        acknowledged,
        notification,
        visibilityState: doc?.visibilityState,
        permission: NotificationApi?.permission,
    }) ) return false;
    try {
        const registration = await nav?.serviceWorker?.getRegistration?.('/');
        const worker = registration?.active;
        if ( ! worker ) return false;
        worker.postMessage({ type: WORKER_SHOW_MESSAGE, puter: pushMessageFor(uid, notification, appUid) });
        return true;
    } catch ( err ) {
        console.warn('Could not show a browser notification:', err);
        return false;
    }
};

/** The page's URL without the tap parameter it was opened with. */
export const withoutTapParam = (href) => {
    const url = new URL(href);
    url.searchParams.delete(PUSH_TAP_PARAM);
    return url.pathname + url.search + url.hash;
};

let started = false;

/**
 * Register the worker where push is on, listen for the taps it routes, and
 * hand over the tap this page was opened for. Runs once per page.
 *
 * @param {{ params?: Object, nav?: Navigator, query?: URLSearchParams, loc?: Location,
 *     history?: History, framed?: boolean }} [env]
 */
export const startPushWorker = ({
    params = globalThis.gui_params,
    nav = globalThis.navigator,
    query = globalThis.url_query_params,
    loc = globalThis.location,
    history = globalThis.history,
    framed = globalThis.top !== globalThis.self,
} = {}) => {
    if ( started || framed ) return;
    started = true;

    const opened = pushTapFromParams(query);
    if ( opened ) {
        history?.replaceState?.(history.state, '', withoutTapParam(loc.href));
        dispatchPushTap(opened);
    }

    if ( ! pushWorkerEnabled(params, nav) ) return;
    nav.serviceWorker.addEventListener('message', (event) => {
        if ( event.data?.type !== WORKER_CLICK_MESSAGE ) return;
        dispatchPushTap(event.data.notification);
    });
    nav.serviceWorker.register(WORKER_URL, { scope: '/' }).catch((err) => {
        console.warn('Could not register the service worker:', err);
    });
};
