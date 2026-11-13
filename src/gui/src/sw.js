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
// is { uid, title, body, icon, group, target: { app, path }, data, ts }, plus
// `app: { uid, name, icon }` when an app sent it.
// On `pushsubscriptionchange` it keeps Puter's subscription, marks it, and tells this origin's windows.
// A `type: 'challenge'` message is shown, then its `challenge` is posted to
// this origin's windows as { type: 'puter-push-challenge', challenge } for the
// page to confirm the subscription with the server.

const DEFAULT_TITLE = 'New notification';
const DEFAULT_ICON = '/favicons/android-icon-192x192.png';
const CLICK_MESSAGE = 'puter-notification-click';
const CLICK_ACK_MESSAGE = 'puter-notification-click-ack';
const SUBSCRIPTION_CHANGED_MESSAGE = 'puter-push-subscription-changed';
const CHALLENGE_MESSAGE = 'puter-push-challenge';
const CLICK_PARAM = 'puter.notification';
// Browsers allow openWindow only shortly after the click.
const CLICK_ACK_BUDGET_MS = 600;
const GUI_PATHS = /^\/(?:$|desktop(?:\/|$)|dashboard(?:\/|$)|app\/|settings(?:\/|$)|@)/;
// Entries puter.js keeps here (modules/notifications/lib/pushStore.js).
const DB_NAME = 'puter-push';
const HANDLERS = 'handlers';
const CLICKS = 'clicks';
const SERVER_KEY = 'puter:server-key';
const SERVER_KEYS = 'puter:server-keys';
const CHANGED_PREFIX = 'puter:subscription-changed:';
const RECEIPT_PREFIX = 'puter:receipt:';

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

// An app's message is shown under the app's name and Puter's copy of its icon, never an icon the app chose.
function appMessage (source, origin) {
    const app = source.app && typeof source.app === 'object' ? source.app : null;
    if ( ! nonEmptyString(app?.uid) ) return null;
    const title = nonEmptyString(source.title);
    const body = nonEmptyString(source.body);
    // A sensitive message already reads as a line about the app.
    const text = source.sensitive === true
        ? body
        : [title, body].filter(Boolean).join(' — ');
    return {
        title: nonEmptyString(app.name) ?? DEFAULT_TITLE,
        body: nonEmptyString(text),
        icon: notificationIcon(app.icon, origin),
    };
}

function normalizeMessage (message, origin) {
    const source = message && typeof message === 'object' ? message : {};
    const uid = nonEmptyString(source.uid);
    const app = appMessage(source, origin);
    const body = app ? app.body : nonEmptyString(source.body);
    const target = pushTarget(source.target);
    const tag = nonEmptyString(source.group) ?? uid;
    const sentAt = Number.isFinite(source.ts) ? source.ts : undefined;
    return {
        title: app ? app.title : nonEmptyString(source.title) ?? DEFAULT_TITLE,
        options: {
            ...(body ? { body } : {}),
            icon: app ? app.icon : notificationIcon(source.icon, origin),
            ...(tag ? { tag } : {}),
            // A group's newer notification replaces the one showing and alerts again.
            renotify: !! tag && tag !== uid,
            ...(sentAt !== undefined ? { timestamp: sentAt } : {}),
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

async function postToWindows (scope, message) {
    const origin = scope.location.origin;
    const windowClients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for ( const client of windowClients ) {
        if ( sameOriginUrl(client.url, origin) ) client.postMessage(message);
    }
}

function openDB () {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(HANDLERS);
            req.result.createObjectStore(CLICKS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idb (mode, action) {
    const db = await openDB();
    try {
        return await new Promise((resolve, reject) => {
            const req = action(db.transaction(HANDLERS, mode).objectStore(HANDLERS));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

function fromBase64Url (value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameKey (buffer, value) {
    if ( ! buffer ) return false;
    try {
        const bytes = new Uint8Array(buffer);
        const key = fromBase64Url(value);
        return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
    } catch ( _e ) {
        return false;
    }
}

async function puterKeys () {
    const last = await idb('readonly', (s) => s.get(SERVER_KEY));
    const listed = await idb('readonly', (s) => s.get(SERVER_KEYS));
    return [last, ...(Array.isArray(listed) ? listed : [])].filter((key) => nonEmptyString(key));
}

// This worker only ever holds Puter's subscription, so one that went is push the user had on.
async function keepSubscription (scope, event) {
    const registration = scope.registration;
    const keys = await puterKeys();
    if ( ! keys.length ) return;
    const old = event.oldSubscription?.options?.applicationServerKey;
    if ( old && ! keys.some((key) => sameKey(old, key)) ) return;
    // The page asks the server whether the old endpoint was removed before registering again.
    const receipt = await idb('readonly', (s) => s.get(RECEIPT_PREFIX + registration.scope));
    const earlier = await idb('readonly', (s) => s.get(CHANGED_PREFIX + registration.scope));
    // A mark no page handled yet keeps the endpoint the server last knew.
    const oldEndpoint = nonEmptyString(earlier?.oldEndpoint)
        ?? nonEmptyString(event.oldSubscription?.endpoint)
        ?? nonEmptyString(receipt?.endpoint);
    await idb('readwrite', (s) => s.put({ at: Date.now(), ...(oldEndpoint ? { oldEndpoint } : {}) }, CHANGED_PREFIX + registration.scope));
    // The receipt names the old endpoint and keys.
    await idb('readwrite', (s) => s.delete(RECEIPT_PREFIX + registration.scope));
    if ( event.newSubscription ) return;
    if ( await registration.pushManager.getSubscription() ) return;
    // Push turned off here leaves no subscription or receipt to go by.
    if ( ! event.oldSubscription && ! oldEndpoint ) return;
    await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(keys[0]) });
}

async function handleSubscriptionChange (scope, event) {
    try {
        await keepSubscription(scope, event);
    } catch ( err ) {
        console.warn('[puter] could not keep the push subscription', err);
    }
    await postToWindows(scope, { type: SUBSCRIPTION_CHANGED_MESSAGE });
}

async function handlePush (scope, message) {
    await showMessage(scope.registration, message, scope.location.origin);
    if ( message?.type === 'challenge' && nonEmptyString(message.challenge) ) {
        await postToWindows(scope, { type: CHALLENGE_MESSAGE, challenge: message.challenge });
    }
}

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    event.waitUntil(handlePush(self, readPushPayload(event.data)));
});

self.addEventListener('message', (event) => {
    const message = event.data;
    if ( !message || !event.source || !sameOriginUrl(event.source.url, self.location.origin) ) return;
    if ( message.type === CLICK_ACK_MESSAGE ) {
        pendingClickAcks.get(message.id)?.();
    }
});

self.addEventListener('notificationclick', (event) => {
    const startedAt = Date.now();
    event.notification.close();
    event.waitUntil(routeClick(self, clickFromData(event.notification.data), startedAt));
});

self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(handleSubscriptionChange(self, event));
});
