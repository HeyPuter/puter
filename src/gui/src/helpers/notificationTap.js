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
 * What a tap on a notification does, wherever it was tapped: a toast, a row in
 * the notification center, or a browser notification the service worker
 * routed here.
 *
 * An app message opens its app and hands it the tap. A running instance gets
 * the GUI broadcast `notificationClick`; a fresh launch gets the same object
 * as `puter.args.notificationClick`. Both carry `{ uid, target, data }`, where
 * `target` is the path inside the app the message named.
 */

import { isShareNotification } from '../UI/Dashboard/notificationCenter.js';

export const NOTIFICATION_CLICK = 'notificationClick';
export const APP_MESSAGE_TYPE = 'app.message';

/** The query parameter a tap's page opens with when no Puter window was open. */
export const PUSH_TAP_PARAM = 'puter.notification';

/**
 * @typedef {Object} NotificationClick
 * @property {string} uid
 * @property {string} [target] - The path inside the app the message named
 * @property {unknown} [data]
 */

/**
 * What the service worker knows about a tapped notification.
 *
 * @typedef {Object} PushTap
 * @property {string} [uid]
 * @property {{ app?: string, path?: string }} [target]
 * @property {unknown} [data]
 */

/**
 * @typedef {{ kind: 'app', appUid: string, click: NotificationClick }
 *     | { kind: 'share', notification: Object }
 *     | { kind: 'panel' }} TapRoute
 */

/**
 * Where a tap goes. With the notification in hand its type decides; with only
 * what a push carried, an app target is an app message and a path is a share.
 *
 * @param {{ uid?: string, notification?: Object|null, appUid?: string|null, push?: PushTap }} tap
 * @returns {TapRoute}
 */
export const tapRoute = ({ uid, notification, appUid, push }) => {
    if ( notification && typeof notification === 'object' ) {
        if ( notification.type === APP_MESSAGE_TYPE ) {
            const app = notification.app?.uid ?? appUid;
            if ( typeof app !== 'string' || app === '' ) return { kind: 'panel' };
            return {
                kind: 'app',
                appUid: app,
                click: { uid, target: notification.target, data: notification.data },
            };
        }
        if ( isShareNotification(notification) ) return { kind: 'share', notification };
        return { kind: 'panel' };
    }
    const target = push?.target;
    if ( typeof target?.app === 'string' && target.app ) {
        return {
            kind: 'app',
            appUid: target.app,
            click: { uid, target: target.path, data: push.data },
        };
    }
    if ( typeof target?.path === 'string' && target.path.startsWith('/') ) {
        return {
            kind: 'share',
            notification: { type: 'share.received', fields: { target: { path: target.path } } },
        };
    }
    return { kind: 'panel' };
};

/**
 * A push tap as the worker or the URL hands it over, with anything that isn't
 * the expected shape dropped. Null when there is no uid to act on.
 *
 * @param {unknown} raw
 * @returns {PushTap|null}
 */
export const normalizePushTap = (raw) => {
    if ( ! raw || typeof raw !== 'object' ) return null;
    if ( typeof raw.uid !== 'string' || raw.uid === '' ) return null;
    const target = {};
    if ( typeof raw.target?.app === 'string' && raw.target.app ) target.app = raw.target.app;
    if ( typeof raw.target?.path === 'string' && raw.target.path ) target.path = raw.target.path;
    return {
        uid: raw.uid,
        ...(Object.keys(target).length ? { target } : {}),
        ...(raw.data !== undefined ? { data: raw.data } : {}),
    };
};

/**
 * The tap a page was opened for, from its `puter.notification` parameter.
 *
 * @param {URLSearchParams} [params]
 * @returns {PushTap|null}
 */
export const pushTapFromParams = (params) => {
    const raw = params?.get?.(PUSH_TAP_PARAM);
    if ( ! raw ) return null;
    try {
        return normalizePushTap(JSON.parse(raw));
    } catch {
        return null;
    }
};

/** The message a running app instance is sent for a tap. */
export const appClickBroadcast = (click) => ({
    msg: 'broadcast',
    name: NOTIFICATION_CLICK,
    data: click,
});

/**
 * A running instance of the app, newest last: brought forward, and able to
 * post to its iframe. Null when none is open.
 */
const runningInstance = (appUid) => {
    const $windows = $(`.window[data-app_uuid="${window.html_encode(appUid)}"]`);
    if ( ! $windows.length ) return null;
    const $win = $windows.last();
    return {
        reveal: () => {
            const minimized = $win.attr('data-is_minimized');
            if ( minimized === '1' || minimized === 'true' ) $win.showWindow();
            else $win.focusWindow();
        },
        post: (message) => {
            const iframe = $win.find('.window-app-iframe').get(0);
            if ( ! iframe?.contentWindow ) return;
            let origin;
            try {
                origin = new URL(iframe.src).origin;
            } catch {
                return;
            }
            iframe.contentWindow.postMessage(message, origin);
        },
    };
};

/**
 * Open the app a tap is for and hand it the tap: broadcast to an open
 * instance, or launch it with the tap in its args.
 *
 * @param {{ appUid: string, click: NotificationClick }} route
 * @param {{ getApp: Function, launch: Function, running?: Function }} deps -
 *     `get_app_by_uid` and `launch_app`
 * @returns {Promise<'broadcast'|'launched'|'missing'>}
 */
export const openAppForTap = async ({ appUid, click }, { getApp, launch, running = runningInstance }) => {
    const instance = running(appUid);
    if ( instance ) {
        instance.reveal();
        instance.post(appClickBroadcast(click));
        return 'broadcast';
    }
    const app = await getApp(appUid, { icon_size: 64 });
    if ( ! app?.name ) return 'missing';
    await launch({ name: app.name, app_obj: app, args: { [NOTIFICATION_CLICK]: click } });
    return 'launched';
};

/**
 * Act on a tap. `share` and `panel` are the surface's own: what a share opens
 * and where the notification list is differ between desktop and dashboard.
 *
 * @param {{ uid?: string, notification?: Object|null, appUid?: string|null, push?: PushTap }} tap
 * @param {{ share: (notification: Object) => unknown, panel?: () => unknown, openApp: (route: TapRoute) => unknown }} surface
 */
export const handleNotificationTap = async (tap, { share, panel, openApp }) => {
    const route = tapRoute(tap);
    if ( route.kind === 'app' ) return openApp(route);
    if ( route.kind === 'share' ) return share(route.notification);
    return panel?.();
};

/** @type {((tap: PushTap) => unknown) | null} */
let pushTapHandler = null;
/** @type {PushTap[]} */
const pendingPushTaps = [];

/**
 * Where taps routed by the service worker go. A tap that arrives before the
 * desktop or dashboard has set this waits for it.
 *
 * @param {(tap: PushTap) => unknown} handler
 */
export const setPushTapHandler = (handler) => {
    pushTapHandler = handler;
    for ( const tap of pendingPushTaps.splice(0) ) void handler(tap);
};

/** @param {unknown} raw - The worker's `notification` object */
export const dispatchPushTap = (raw) => {
    const tap = normalizePushTap(raw);
    if ( ! tap ) return;
    if ( pushTapHandler ) void pushTapHandler(tap);
    else pendingPushTaps.push(tap);
};
