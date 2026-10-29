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

// What a tap on a notification does, from a toast, a list row or the worker.

import { isShareNotification } from '../UI/Dashboard/notificationCenter.js';

export const NOTIFICATION_CLICK = 'notificationClick';
export const APP_MESSAGE_TYPE = 'app.message';
export const PUSH_TAP_PARAM = 'puter.notification';

const UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UID_MAX = 64;
// A tap for a uid acted on this recently is the same tap again.
const TAP_REPEAT_MS = 10_000;

const nonEmpty = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * @typedef {Object} NotificationClick
 * @property {string} uid
 * @property {string} [target]
 * @property {unknown} [data]
 */

/**
 * A tap from the worker or the URL names only a notification; what it leads
 * to is read off the signed-in user's own row.
 * @typedef {Object} PushTap
 * @property {string} uid
 */

/**
 * @typedef {{ kind: 'app', appUid: string, click: NotificationClick }
 *     | { kind: 'share', notification: Object }
 *     | { kind: 'panel' }} TapRoute
 */

/**
 * @param {{ uid?: string, notification?: Object|null, appUid?: string|null }} tap
 * @returns {TapRoute}
 */
export const tapRoute = ({ uid, notification, appUid }) => {
    if ( ! notification || typeof notification !== 'object' ) return { kind: 'panel' };
    if ( notification.type === APP_MESSAGE_TYPE ) {
        const app = nonEmpty(appUid) ?? nonEmpty(notification.app?.uid);
        if ( ! app ) return { kind: 'panel' };
        const target = typeof notification.target === 'string' ? notification.target : undefined;
        return { kind: 'app', appUid: app, click: { uid, target, data: notification.data } };
    }
    if ( isShareNotification(notification) ) return { kind: 'share', notification };
    return { kind: 'panel' };
};

/** @returns {PushTap|null} */
const tapFor = (uid) => (
    typeof uid === 'string' && uid.length <= UID_MAX && UID_PATTERN.test(uid) ? { uid } : null
);

/**
 * @param {unknown} raw - The worker's `notification` object
 * @returns {PushTap|null} The notification it names; nothing else it carries
 */
export const normalizePushTap = (raw) => (raw && typeof raw === 'object' ? tapFor(raw.uid) : null);

/**
 * @param {URLSearchParams} [params]
 * @returns {PushTap|null}
 */
export const pushTapFromParams = (params) => tapFor(params?.get?.(PUSH_TAP_PARAM));

/**
 * @param {string} uid
 * @param {(uid: string) => Promise<Object|null>} fetchRow - `getNotification`
 * @returns {Promise<{ uid: string, notification: Object, appUid: string|null }|null>}
 */
export const storedTapItem = async (uid, fetchRow) => {
    const row = await fetchRow(uid);
    if ( ! row || row.uid !== uid ) return null;
    return {
        uid,
        notification: row.value && typeof row.value === 'object' ? row.value : {},
        appUid: nonEmpty(row.app_uid) ?? null,
    };
};

/**
 * @param {Element[]} elements
 * @param {string} key - A `dataset` key
 * @param {string} value
 * @returns {Element[]}
 */
export const elementsWithData = (elements, key, value) => (
    typeof value === 'string' ? elements.filter((el) => el?.dataset?.[key] === value) : []
);

const sendToWindow = (el_window, name, data) => (
    globalThis.services?.get('broadcast')?.sendBroadcastToWindow(el_window, name, data)
);

const runningInstance = (appUid) => {
    const windows = elementsWithData($('.window-app').get(), 'app_uuid', appUid);
    if ( ! windows.length ) return null;
    const el_window = windows[windows.length - 1];
    const $win = $(el_window);
    return {
        reveal: () => {
            const minimized = $win.attr('data-is_minimized');
            if ( minimized === '1' || minimized === 'true' ) $win.showWindow();
            else $win.focusWindow();
        },
        el_window,
    };
};

/**
 * @param {Object} [args] - Launch args from a link or another app
 * @returns {Object} The same args without a `notificationClick` key
 */
export const withoutNotificationClick = (args) => {
    if ( ! args || typeof args !== 'object' || ! Object.hasOwn(args, NOTIFICATION_CLICK) ) return args;
    const { [NOTIFICATION_CLICK]: _dropped, ...rest } = args;
    return rest;
};

/**
 * @param {{ appUid: string, click: NotificationClick }} route
 * @param {{ getApp: Function, launch: Function, running?: Function, send?: Function }} deps
 * @returns {Promise<'broadcast'|'launched'|'missing'>}
 */
export const openAppForTap = async ({ appUid, click }, {
    getApp,
    launch,
    running = runningInstance,
    send = sendToWindow,
}) => {
    const instance = running(appUid);
    if ( instance ) {
        instance.reveal();
        send(instance.el_window, NOTIFICATION_CLICK, click);
        return 'broadcast';
    }
    const app = await getApp(appUid, { icon_size: 64 });
    if ( ! app?.name ) return 'missing';
    let sent = false;
    await launch({
        name: app.name,
        app_obj: app,
        on_ready: (process) => {
            const el_win = process?.references?.el_win;
            if ( sent || el_win?.dataset?.app_uuid !== appUid ) return;
            sent = true;
            send(el_win, NOTIFICATION_CLICK, click);
        },
    });
    return 'launched';
};

/**
 * @param {{ uid?: string, notification?: Object|null, appUid?: string|null, push?: PushTap }} tap
 * @param {{ share: (notification: Object) => unknown, panel?: () => unknown, openApp: (route: TapRoute) => unknown }} surface
 */
export const handleNotificationTap = async (tap, { share, panel, openApp }) => {
    const route = tapRoute(tap);
    if ( route.kind === 'app' ) return openApp(route);
    if ( route.kind === 'share' ) return share(route.notification);
    return panel?.();
};

/**
 * @param {{ fetchRow: (uid: string) => Promise<Object|null>,
 *     surface: { share: Function, panel?: Function, openApp: Function },
 *     found?: (uid: string) => unknown, missing?: () => unknown }} deps
 *     `found` runs before routing a row that was read; `missing` instead of
 *     routing when there is none
 * @returns {(tap: PushTap) => Promise<unknown>}
 */
export const storedTapHandler = ({ fetchRow, surface, found, missing }) => async ({ uid }) => {
    const tap = await storedTapItem(uid, fetchRow);
    if ( ! tap ) return missing?.();
    found?.(uid);
    return handleNotificationTap(tap, surface);
};

/** @type {((tap: PushTap) => unknown) | null} */
let pushTapHandler = null;
/** @type {PushTap[]} */
const pendingPushTaps = [];
/** @type {Map<string, number>} uid → when it was last handed over */
const recentTaps = new Map();

/** @param {(tap: PushTap) => unknown} handler */
export const setPushTapHandler = (handler) => {
    pushTapHandler = handler;
    for ( const tap of pendingPushTaps.splice(0) ) void handler(tap);
};

const seenLately = (uid, now) => {
    for ( const [seen, at] of recentTaps ) {
        if ( now - at >= TAP_REPEAT_MS ) recentTaps.delete(seen);
    }
    if ( recentTaps.has(uid) ) return true;
    recentTaps.set(uid, now);
    return false;
};

/** @param {PushTap|null} tap */
const deliverPushTap = (tap) => {
    if ( ! tap || seenLately(tap.uid, Date.now()) ) return;
    if ( pushTapHandler ) void pushTapHandler(tap);
    else pendingPushTaps.push(tap);
};

/** @param {unknown} raw - The worker's `notification` object, or a tap from the URL */
export const dispatchPushTap = (raw) => deliverPushTap(normalizePushTap(raw));
