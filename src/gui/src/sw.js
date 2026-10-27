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

// Shows each push as a notification and routes taps to a Puter window.
// Push payload: JSON whose `puter` (or `data.puter`, an object or JSON string)
// is { uid, title, body, icon, group, target: { app, path }, data }.
// On `pushsubscriptionchange` it posts { type: 'puter-push-subscription-changed' }
// to this origin's windows, so a signed-in page can register again.

const DEFAULT_TITLE = 'New notification';
const DEFAULT_ICON = '/favicons/android-icon-192x192.png';
const SHOW_MESSAGE = 'puter-show-notification';
const CLICK_MESSAGE = 'puter-notification-click';
const CLICK_ACK_MESSAGE = 'puter-notification-click-ack';
const SUBSCRIPTION_CHANGED_MESSAGE = 'puter-push-subscription-changed';
const CLICK_PARAM = 'puter.notification';
// Browsers allow openWindow only shortly after the click.
const CLICK_ACK_BUDGET_MS = 600;
const GUI_PATHS = /^\/(?:$|desktop(?:\/|$)|dashboard(?:\/|$)|app\/|settings(?:\/|$)|@)/;

const nonEmptyString = (value) => (
    typeof value === 'string' && value.trim() !== '' ? value : undefined
);

function notificationIcon (icon, origin) {
    const fallback = new URL(DEFAULT_ICON, origin).href;
    if ( ! nonEmptyString(icon) ) return fallback;
    try {
        const url = new URL(icon, origin);
        if ( url.protocol === 'https:' || url.origin === origin ) return url.href;
    } catch ( _e ) {
        // not a URL: Puter's own icon
    }
    return fallback;
}

function pushTarget (target) {
    if ( ! target || typeof target !== 'object' ) return undefined;
    const app = nonEmptyString(target.app);
    const path = nonEmptyString(target.path);
    if ( ! app && ! path ) return undefined;
    return { ...(app ? { app } : {}), ...(path ? { path } : {}) };
}

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

function readPushPayload (pushData) {
    let payload;
    try {
        payload = pushData ? pushData.json() : null;
    } catch ( _e ) {
        return null;
    }
    // Providers that only carry string data deliver it under `data`.
    let message = payload && typeof payload === 'object'
        ? (payload.puter ?? payload.data?.puter)
        : null;
    if ( typeof message === 'string' ) {
        try {
            message = JSON.parse(message);
        } catch ( _e ) {
            return null;
        }
    }
    return message && typeof message === 'object' ? message : null;
}

function showMessage (registration, message, origin) {
    const { title, options } = normalizeMessage(message, origin);
    return registration.showNotification(title, options).catch(() => (
        registration.showNotification(DEFAULT_TITLE, {
            icon: notificationIcon(null, origin),
        })
    ));
}

function clickFromData (data) {
    const source = data && typeof data === 'object' ? data : {};
    return {
        uid: nonEmptyString(source.uid),
        target: pushTarget(source.target),
        data: source.data,
    };
}

function clickUrl (click, origin) {
    const url = new URL('/', origin);
    if ( click && click.uid ) url.searchParams.set(CLICK_PARAM, click.uid);
    return url.href;
}

const sameOriginUrl = (url, origin) => {
    try {
        const parsed = new URL(url);
        return parsed.origin === origin ? parsed : null;
    } catch ( _e ) {
        return null;
    }
};

function isGuiWindow (client, origin) {
    if ( client.frameType === 'nested' ) return false;
    const url = sameOriginUrl(client.url, origin);
    return !! url && GUI_PATHS.test(url.pathname) && ! url.searchParams.has('embedded_in_popup');
}

function pickWindow (windowClients, origin) {
    const candidates = windowClients.filter((client) => isGuiWindow(client, origin));
    return candidates.find((client) => client.focused)
        ?? candidates.find((client) => client.visibilityState === 'visible')
        ?? candidates[0]
        ?? null;
}

const pendingClickAcks = new Map();
let nextClickId = 0;

function waitForClickAck (id, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingClickAcks.delete(id);
            resolve(false);
        }, timeoutMs);
        pendingClickAcks.set(id, () => {
            clearTimeout(timer);
            pendingClickAcks.delete(id);
            resolve(true);
        });
    });
}

async function routeClick (scope, click, startedAt = Date.now(), budgetMs = CLICK_ACK_BUDGET_MS) {
    const origin = scope.location.origin;
    const windowClients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = pickWindow(windowClients, origin);
    if ( client ) {
        const id = `click-${++nextClickId}`;
        const acked = waitForClickAck(id, Math.max(0, startedAt + budgetMs - Date.now()));
        client.postMessage({ type: CLICK_MESSAGE, id, notification: click });
        client.focus().catch(() => {});
        if ( await acked ) return;
    }
    await scope.clients.openWindow(clickUrl(click, origin));
}

async function hasVisibleWindow (scope) {
    const origin = scope.location.origin;
    const windowClients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    return windowClients.some((client) => (
        sameOriginUrl(client.url, origin) && client.visibilityState === 'visible'
    ));
}

async function showPageMessage (scope, message) {
    if ( await hasVisibleWindow(scope) ) return;
    await showMessage(scope.registration, message, scope.location.origin);
}

async function announceSubscriptionChange (scope) {
    const origin = scope.location.origin;
    const windowClients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for ( const client of windowClients ) {
        if ( sameOriginUrl(client.url, origin) ) client.postMessage({ type: SUBSCRIPTION_CHANGED_MESSAGE });
    }
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
    if ( !message || !event.source || !sameOriginUrl(event.source.url, self.location.origin) ) return;
    if ( message.type === CLICK_ACK_MESSAGE ) {
        pendingClickAcks.get(message.id)?.();
    } else if ( message.type === SHOW_MESSAGE ) {
        event.waitUntil(showPageMessage(self, message.puter));
    }
});

self.addEventListener('notificationclick', (event) => {
    const startedAt = Date.now();
    event.notification.close();
    event.waitUntil(routeClick(self, clickFromData(event.notification.data), startedAt));
});

self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(announceSubscriptionChange(self));
});
