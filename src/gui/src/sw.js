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
 * Puter's service worker, served at `/sw.js` with scope `/`. It shows every
 * push as a notification and routes a tap to a Puter window on this origin.
 * No app code runs here; an app hears about a notification when it is tapped.
 *
 * Push payload: the push's data is JSON with the message under a top-level
 * `puter` key, as an object or as that object serialized to a string:
 *
 *     { "puter": { "uid", "title", "body"?, "icon"?, "group"?,
 *                  "target"?: { "app"?: <app uid>, "path"? }, "data"? } }
 *
 * Every push shows a notification, and one that can't be read shows a generic
 * one, because browsers penalize a push that shows nothing. `icon` is used
 * only when it is https or on this origin.
 *
 * Provider scripts: `/sw.js` loads the same-origin scripts extensions register
 * with `PuterHomepageService.registerServiceWorkerScript(path)` through
 * `importScripts`, before the listeners below are added. Puter's push listener
 * shows the notification, so a provider script only delivers the payload.
 *
 * Pages talk to the worker with `postMessage`:
 *
 * - `{ type: 'puter-show-notification', puter: <message> }` from a page shows
 *   that message the way a push would.
 * - `{ type: 'puter-notification-click', notification: { uid, target, data } }`
 *   goes to the Puter window a tap focused. With none open, the tap opens `/`
 *   with the same object as JSON in the `puter.notification` query parameter.
 */

const DEFAULT_TITLE = 'New notification';
const DEFAULT_ICON = '/favicons/android-icon-192x192.png';
const SHOW_MESSAGE = 'puter-show-notification';
const CLICK_MESSAGE = 'puter-notification-click';
const CLICK_PARAM = 'puter.notification';

const nonEmptyString = (value) => (
    typeof value === 'string' && value.trim() !== '' ? value : undefined
);

/** The icon URL to show: https or this origin, else Puter's own. */
function notificationIcon (icon, origin) {
    const fallback = new URL(DEFAULT_ICON, origin).href;
    if ( ! nonEmptyString(icon) ) return fallback;
    try {
        const url = new URL(icon, origin);
        if ( url.protocol === 'https:' || url.origin === origin ) return url.href;
    } catch ( _e ) {
        // unparseable: Puter's own icon
    }
    return fallback;
}

/** `{ app?, path? }` with string fields only, or undefined when empty. */
function pushTarget (target) {
    if ( ! target || typeof target !== 'object' ) return undefined;
    const app = nonEmptyString(target.app);
    const path = nonEmptyString(target.path);
    if ( ! app && ! path ) return undefined;
    return { ...(app ? { app } : {}), ...(path ? { path } : {}) };
}

/** A message in the payload contract, read field by field with defaults. */
function normalizeMessage (message, origin) {
    const source = message && typeof message === 'object' ? message : {};
    const uid = nonEmptyString(source.uid);
    const body = nonEmptyString(source.body);
    const target = pushTarget(source.target);
    const tag = nonEmptyString(source.group) ?? uid;
    return {
        title: nonEmptyString(source.title) ?? DEFAULT_TITLE,
        options: {
            ...(body ? { body } : {}),
            icon: notificationIcon(source.icon, origin),
            ...(tag ? { tag } : {}),
            renotify: false,
            data: {
                ...(uid ? { uid } : {}),
                ...(target ? { target } : {}),
                ...(source.data !== undefined ? { data: source.data } : {}),
            },
        },
    };
}

/** The message a push carries under `puter`, or null when it can't be read. */
function readPushPayload (pushData) {
    let payload;
    try {
        payload = pushData ? pushData.json() : null;
    } catch ( _e ) {
        return null;
    }
    let message = payload && typeof payload === 'object' ? payload.puter : null;
    if ( typeof message === 'string' ) {
        try {
            message = JSON.parse(message);
        } catch ( _e ) {
            return null;
        }
    }
    return message && typeof message === 'object' ? message : null;
}

/** Shows `message`, and the generic notification if that fails. */
function showMessage (registration, message, origin) {
    const { title, options } = normalizeMessage(message, origin);
    return registration.showNotification(title, options).catch(() => (
        registration.showNotification(DEFAULT_TITLE, {
            icon: notificationIcon(null, origin),
        })
    ));
}

/** What a tap hands to Puter: `{ uid, target, data }` from the notification. */
function clickFromData (data) {
    const source = data && typeof data === 'object' ? data : {};
    return {
        uid: nonEmptyString(source.uid),
        target: pushTarget(source.target),
        data: source.data,
    };
}

/** The page a tap opens when no Puter window is open: always this origin. */
function clickUrl (click, origin) {
    const url = new URL('/', origin);
    if ( click && click.uid ) url.searchParams.set(CLICK_PARAM, JSON.stringify(click));
    return url.href;
}

const isSameOrigin = (url, origin) => {
    try {
        return new URL(url).origin === origin;
    } catch ( _e ) {
        return false;
    }
};

/** The top-level window on this origin a tap should go to, if any. */
function pickWindow (windowClients, origin) {
    const candidates = windowClients.filter((client) => (
        isSameOrigin(client.url, origin) && client.frameType !== 'nested'
    ));
    return candidates.find((client) => client.focused)
        ?? candidates.find((client) => client.visibilityState === 'visible')
        ?? candidates[0]
        ?? null;
}

async function routeClick (scope, click) {
    const origin = scope.location.origin;
    const windowClients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = pickWindow(windowClients, origin);
    if ( client ) {
        try {
            await client.focus();
        } catch ( _e ) {
            // focus is best effort; the message still routes the tap
        }
        client.postMessage({ type: CLICK_MESSAGE, notification: click });
        return;
    }
    await scope.clients.openWindow(clickUrl(click, origin));
}

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    event.waitUntil(showMessage(self.registration, readPushPayload(event.data), self.location.origin));
});

self.addEventListener('message', (event) => {
    const message = event.data;
    if ( !message || message.type !== SHOW_MESSAGE ) return;
    if ( !event.source || !isSameOrigin(event.source.url, self.location.origin) ) return;
    event.waitUntil(showMessage(self.registration, message.puter, self.location.origin));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(routeClick(self, clickFromData(event.notification.data)));
});
