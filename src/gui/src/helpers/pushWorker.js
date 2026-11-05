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

// The page's side of `/sw.js`: routed taps, and updates once push is on.

import {
    dispatchPushTap,
    normalizePushTap,
    pushTapFromParams,
    PUSH_TAP_PARAM,
} from './notificationTap.js';
import { clear_query_param } from './parseSharedPath.js';
import { getPushClient, registerPushClient } from './pushClient.js';
import { webPushClient } from './webPushClient.js';

export const WORKER_URL = '/sw.js';
export const WORKER_CLICK_MESSAGE = 'puter-notification-click';
export const WORKER_CLICK_ACK_MESSAGE = 'puter-notification-click-ack';

/**
 * @param {Object} [params] - `window.gui_params`
 * @param {Navigator} [nav]
 * @returns {boolean}
 */
export const pushWorkerEnabled = (params, nav) => (
    params?.pushEnabled === true
    && typeof nav?.serviceWorker?.register === 'function'
);

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
        if ( opened ) dispatchPushTap(opened);
    }

    // Leave an existing worker: removing it ends this browser's subscription.
    if ( ! pushWorkerEnabled(params, nav) ) return;
    if ( typeof params.pushWebPushKey === 'string' && params.pushWebPushKey && ! getPushClient() ) {
        registerPushClient(webPushClient());
    }
    nav.serviceWorker.addEventListener('message', (event) => {
        if ( event.data?.type !== WORKER_CLICK_MESSAGE || ! normalizePushTap(event.data.notification) ) return;
        event.source?.postMessage?.({ type: WORKER_CLICK_ACK_MESSAGE, id: event.data.id });
        dispatchPushTap(event.data.notification);
    });
    // Turning push on registers the worker. One left without a subscription
    // goes, so nothing but push installs it.
    try {
        const registration = await nav.serviceWorker.getRegistration?.('/');
        if ( ! registration ) return;
        if ( await registration.pushManager?.getSubscription() ) await registration.update?.();
        else await registration.unregister();
    } catch ( err ) {
        console.warn('Could not update the service worker:', err);
    }
};

/** Closes a browser banner that the desktop's worker showed for this uid. */
export const closeLocalBanner = async (uid, nav = globalThis.navigator) => {
    try {
        const registration = await nav?.serviceWorker?.getRegistration?.('/');
        for ( const notification of await registration?.getNotifications?.() ?? [] ) {
            if ( notification.data?.uid === uid ) notification.close();
        }
    } catch ( err ) {
        console.warn('Could not close a browser notification:', err);
    }
};
