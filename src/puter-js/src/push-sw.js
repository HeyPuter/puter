// Puter push notifications on an app's own origin, served at
// https://js.puter.com/push-sw.js. The app serves a worker (default
// `/puter-sw.js`) that contains:
//
//     importScripts('https://js.puter.com/push-sw.js');
//
// It shows each Puter push, running the handler the page saved with
// `puter.notifications.onPush(key, handler)`, and routes taps back to the app.
// A handler that needs imports can be registered in the worker itself with
// `puterPush.onPush(key, handler)`, which wins over a saved one. After
// `puterPush.savedHandlers(false)` only those run, and saved source never does.
//
// To serve a fixed copy instead, self-host this file or import it from npm, such
// as https://cdn.jsdelivr.net/npm/@heyputer/puter.js@<version>/src/push-sw.js,
// and update it whenever the page's puter.js changes.
//
// No install, activate or fetch handlers, so importing it into an existing
// worker leaves that worker's lifecycle alone. Pushes without a `puter`
// message are left to the app's own listeners.
(() => {
    if (self.puterPush) return;

    // Shared with puter.js on the same origin (modules/notifications/lib/pushStore.js).
    const DB_NAME = 'puter-push';
    const HANDLERS = 'handlers';
    const CLICKS = 'clicks';
    const HANDLER_TIMEOUT_MS = 5000;
    const CLICK_KEEP_MS = 5 * 60 * 1000;
    const CLICK_ACK_BUDGET_MS = 600;
    // Firefox allows openWindow for 1 s after the click; this leaves room for it.
    const CLICK_OPEN_BUDGET_MS = 800;
    // Saved by the page; the worker's scope is used when there is none.
    const TAP_BASE_PREFIX = 'puter:tap-base:';
    const DEFAULT_TITLE = 'New notification';
    const CHALLENGE_MESSAGE = 'puter-push-challenge';
    const CLICK_MESSAGE = 'puter-notification-click';
    const CLICK_ACK_MESSAGE = 'puter-notification-click-ack';
    const SHOW_MESSAGE = 'puter-push-show';
    const CHANGED_MESSAGE = 'puter-push-subscription-changed';
    const CLICK_PARAM = 'puter.notification';
    const SHOWN_FIELDS = ['title', 'body', 'icon', 'badge', 'image', 'tag', 'url'];

    const registered = new Map();
    let useSavedHandlers = true;
    const pendingClickAcks = new Map();
    let nextClickId = 0;

    const openDB = () => new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(HANDLERS);
            req.result.createObjectStore(CLICKS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    const idb = async (store, mode, action) => {
        const db = await openDB();
        try {
            return await new Promise((resolve, reject) => {
                const req = action(db.transaction(store, mode).objectStore(store));
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } finally {
            db.close();
        }
    };

    const str = (value) => (typeof value === 'string' && value !== '' ? value : null);

    function readMessage (data) {
        let payload;
        try {
            payload = data ? data.json() : null;
        } catch {
            return null;
        }
        let message = payload && typeof payload === 'object'
            ? (payload.puter ?? payload.data?.puter)
            : null;
        if ( typeof message === 'string' ) {
            try {
                message = JSON.parse(message);
            } catch {
                return null;
            }
        }
        return message && typeof message === 'object' ? message : null;
    }

    const appOf = (message) => (message.app && typeof message.app === 'object' ? message.app : null);

    // The push names the app's group as `<app uid>:<group>`, or the uid when it has none.
    function groupOf (message) {
        const group = str(message.group);
        const prefix = `${str(appOf(message)?.uid) ?? ''}:`;
        if ( ! group || group === message.uid ) return null;
        return group.startsWith(prefix) ? group.slice(prefix.length) || null : group;
    }

    // The shape `onPush` handlers get in the page.
    const toNotification = (message) => ({
        uid: str(message.uid) ?? '',
        title: str(message.title) ?? '',
        text: str(message.body),
        icon: str(message.icon),
        target: str(message.target?.path),
        data: message.data ?? null,
        group: groupOf(message),
        channel: str(message.channel),
        sensitive: message.sensitive === true,
        replaced: message.replaced === true,
        createdAt: typeof message.ts === 'number' && Number.isFinite(message.ts) ? message.ts : Date.now(),
        app: appOf(message),
    });

    async function handlerFor (channel) {
        if ( ! channel ) return null;
        if ( registered.has(channel) ) return registered.get(channel);
        if ( ! useSavedHandlers ) return null;
        const source = await idb(HANDLERS, 'readonly', (s) => s.get(channel));
        if ( typeof source !== 'string' ) return null;
        const fn = new Function(`"use strict"; return (${source});`)();
        return typeof fn === 'function' ? fn : null;
    }

    const withTimeout = (promise) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('push handler timed out')), HANDLER_TIMEOUT_MS)),
    ]);

    async function render (notification, message) {
        const icon = notification.icon ?? str(notification.app?.icon);
        const shown = {
            title: notification.title || DEFAULT_TITLE,
            ...(notification.text ? { body: notification.text } : {}),
            ...(icon ? { icon } : {}),
            // The server's tag, which the page uses for the same notification too.
            tag: str(message.group) ?? notification.uid,
            ...(notification.target ? { url: notification.target } : {}),
        };
        try {
            const handler = await handlerFor(notification.channel);
            const result = handler ? await withTimeout(Promise.resolve().then(() => handler(notification))) : null;
            if ( result && typeof result === 'object' ) {
                for ( const field of SHOWN_FIELDS ) {
                    if ( str(result[field]) ) shown[field] = result[field];
                }
                if ( typeof result.requireInteraction === 'boolean' ) shown.requireInteraction = result.requireInteraction;
                if ( Array.isArray(result.actions) ) {
                    shown.actions = [];
                    for ( const entry of result.actions ) {
                        if ( ! entry || typeof entry.action !== 'string' ||
                            ! entry.action.trim() || entry.action.length > 64 ||
                            typeof entry.title !== 'string' ||
                            ! entry.title.trim() || entry.title.length > 64 ) continue;
                        shown.actions.push({
                            action: entry.action,
                            title: entry.title,
                            ...(str(entry.icon) ? { icon: entry.icon } : {}),
                        });
                        if ( shown.actions.length === 2 ) break;
                    }
                }
            }
        } catch ( err ) {
            console.warn('[puter] push handler failed', err);
        }
        return shown;
    }

    async function tapBase () {
        const scope = self.registration.scope ?? `${self.location.origin}/`;
        try {
            const base = await idb(HANDLERS, 'readonly', (s) => s.get(TAP_BASE_PREFIX + scope));
            if ( typeof base === 'string' && new URL(base).origin === self.location.origin ) return base;
        } catch {
            // nothing saved, or IndexedDB is unavailable
        }
        return scope;
    }

    // Taps only ever open this origin; relative paths are read from the tap base.
    async function sameOriginUrl (url) {
        const base = await tapBase();
        try {
            const parsed = new URL(url ?? '', base);
            return parsed.origin === self.location.origin ? parsed.href : base;
        } catch {
            return base;
        }
    }

    async function windows ({ topLevel = false } = {}) {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        return all.filter((c) => {
            if ( topLevel && c.frameType === 'nested' ) return false;
            try {
                return new URL(c.url).origin === self.location.origin;
            } catch {
                return false;
            }
        });
    }

    async function showPush (message) {
        if ( message.type === 'challenge' ) {
            await self.registration.showNotification(str(message.title) ?? DEFAULT_TITLE, {
                ...(str(message.body) ? { body: message.body } : {}),
                tag: str(message.group) ?? 'puter-push-challenge',
            });
            if ( str(message.challenge) ) {
                for ( const win of await windows() ) win.postMessage({ type: CHALLENGE_MESSAGE, challenge: message.challenge });
            }
            return;
        }
        const notification = toNotification(message);
        const { title, url, ...options } = await render(notification, message);
        const data = {
            puter: {
                uid: notification.uid,
                target: notification.target,
                data: notification.data,
                url: await sameOriginUrl(url),
            },
        };
        try {
            await self.registration.showNotification(title, {
                ...options,
                renotify: options.tag !== notification.uid,
                data,
            });
        } catch {
            // Browsers count a push with nothing shown against the site.
            await self.registration.showNotification(DEFAULT_TITLE, { data });
        }
    }

    // A page that got a notification live while away; held back while another window of the app has focus.
    async function showForPage (message, source) {
        for ( const win of await windows({ topLevel: true }) ) {
            if ( win.focused && win.id !== source?.id ) return false;
        }
        const options = message.options && typeof message.options === 'object' ? message.options : {};
        try {
            await self.registration.showNotification(str(message.title) ?? DEFAULT_TITLE, options);
        } catch {
            await self.registration.showNotification(DEFAULT_TITLE, { data: options.data });
        }
        return true;
    }

    async function forgetOldClicks () {
        const cutoff = Date.now() - CLICK_KEEP_MS;
        await idb(CLICKS, 'readwrite', (s) => {
            const req = s.openCursor();
            req.addEventListener('success', () => {
                const cursor = req.result;
                if ( ! cursor ) return;
                if ( ! (cursor.value?.at > cutoff) ) cursor.delete();
                cursor.continue();
            });
            return req;
        });
    }

    // One readwrite get+delete, so only the page or the worker gets the tap.
    async function claimClick (uid, id) {
        const matches = (kept) => !!kept && (id === undefined || kept.id === id);
        const kept = await idb(CLICKS, 'readwrite', (s) => {
            const req = s.get(uid);
            req.addEventListener('success', () => {
                if ( matches(req.result) ) s.delete(uid);
            });
            return req;
        });
        return matches(kept) ? kept : null;
    }

    // Like claimClick, but keeps the copy, without its id, for the page opened next.
    async function reclaimClick (uid, id) {
        const kept = await idb(CLICKS, 'readwrite', (s) => {
            const req = s.get(uid);
            req.addEventListener('success', () => {
                if ( req.result?.id !== id ) return;
                const { id: _, ...copy } = req.result;
                s.put({ ...copy, at: Date.now() }, uid);
            });
            return req;
        });
        return kept?.id === id ? kept : null;
    }

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

    // Kept for the page that claims it: an open one by `id`, or one the tap opens.
    async function keepClick (click, id) {
        if ( ! click.uid ) return false;
        try {
            await idb(CLICKS, 'readwrite', (s) => s.put({ ...click, at: Date.now(), ...(id ? { id } : {}) }, click.uid));
            return true;
        } catch ( err ) {
            console.warn('[puter] could not keep a tap', err);
            return false;
        }
    }

    // An open window with a click handler takes the tap; otherwise one opens its URL.
    async function routeClick (puter, action, startedAt = Date.now()) {
        const click = { uid: puter.uid, target: puter.target ?? null, data: puter.data ?? null, action: str(action) };
        const url = await sameOriginUrl(puter.url);
        const open = await windows({ topLevel: true });
        const win = open.find((c) => c.url === url) ?? open.find((c) => c.focused) ?? open[0];
        if ( win ) {
            const id = `click-${Date.now()}-${++nextClickId}`;
            const kept = await keepClick(click, id);
            const postedAt = Date.now();
            const deadline = Math.min(postedAt + CLICK_ACK_BUDGET_MS, startedAt + CLICK_OPEN_BUDGET_MS);
            const acked = waitForClickAck(id, Math.max(0, deadline - postedAt));
            win.postMessage({ type: CLICK_MESSAGE, id, notification: click, ...(kept ? { kept: true } : {}) });
            try {
                await win.focus();
            } catch {
                // focus is refused once the click's window has passed
            }
            if ( await acked ) {
                // A page that took the tap removed it; an older page leaves it.
                if ( kept ) await claimClick(click.uid, id).catch(() => null);
                return;
            }
            // Already there: the page may still take its copy; reloading would lose its state.
            if ( win.url === url ) return;
            // A failed claim counts as the page's, so the tap runs at most once.
            if ( kept && ! await reclaimClick(click.uid, id).catch(() => null) ) return;
            if ( ! kept ) await keepClick(click);
        } else {
            await keepClick(click);
        }
        const opened = new URL(url);
        if ( click.uid ) opened.searchParams.set(CLICK_PARAM, click.uid);
        if ( win?.navigate ) {
            try {
                await win.navigate(opened.href);
                return;
            } catch {
                // only a window this worker controls can be navigated
            }
        }
        await self.clients.openWindow(opened.href);
    }

    const forgetOldClicksQuietly = () => forgetOldClicks().catch(() => {});

    self.addEventListener('push', (event) => {
        const message = readMessage(event.data);
        if ( ! message ) return;
        event.waitUntil(Promise.all([showPush(message), forgetOldClicksQuietly()]));
    });

    self.addEventListener('message', (event) => {
        const message = event.data;
        if ( ! message || typeof message !== 'object' ) return;
        if ( message.type === CLICK_ACK_MESSAGE ) {
            pendingClickAcks.get(message.id)?.();
        } else if ( message.type === SHOW_MESSAGE ) {
            event.waitUntil((async () => {
                let shown = false;
                try {
                    shown = await showForPage(message, event.source);
                } catch ( err ) {
                    console.warn('[puter] could not show a notification', err);
                }
                event.ports?.[0]?.postMessage({ shown });
            })());
        }
    });

    self.addEventListener('notificationclick', (event) => {
        const puter = event.notification.data?.puter;
        if ( ! puter || typeof puter !== 'object' ) return;
        const startedAt = Date.now();
        event.notification.close();
        event.waitUntil(Promise.all([routeClick(puter, event.action, startedAt), forgetOldClicksQuietly()]));
    });

    // Entries pushStore.js writes.
    const OPT_IN_PREFIX = 'puter:opt-in:';
    const SERVER_KEY = 'puter:server-key';
    const SERVER_KEYS = 'puter:server-keys';
    const CHANGED_PREFIX = 'puter:subscription-changed:';

    const fromBase64Url = (value) => {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
        return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    };

    function sameKey (buffer, value) {
        if ( ! buffer ) return false;
        try {
            const bytes = new Uint8Array(buffer);
            const key = fromBase64Url(value);
            return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
        } catch {
            return false;
        }
    }

    async function puterKeys () {
        const last = await idb(HANDLERS, 'readonly', (s) => s.get(SERVER_KEY));
        const listed = await idb(HANDLERS, 'readonly', (s) => s.get(SERVER_KEYS));
        return [last, ...(Array.isArray(listed) ? listed : [])].filter((key) => str(key));
    }

    // No Puter session here: keep Puter's subscription and mark it for the next page load to register.
    async function keepSubscription (event) {
        const optIns = await idb(HANDLERS, 'readonly', (s) => s.count(IDBKeyRange.bound(OPT_IN_PREFIX, `${OPT_IN_PREFIX}\uffff`)));
        if ( ! optIns ) return;
        const keys = await puterKeys();
        const old = event.oldSubscription?.options?.applicationServerKey;
        if ( old && ! keys.some((key) => sameKey(old, key)) ) return;
        await idb(HANDLERS, 'readwrite', (s) => s.put(Date.now(), CHANGED_PREFIX + self.registration.scope));
        if ( event.newSubscription || ! keys.length ) return;
        if ( await self.registration.pushManager.getSubscription() ) return;
        // Without the old subscription, only a worker a Puter page used (it saved a tap base) subscribes.
        if ( ! old && ! await idb(HANDLERS, 'readonly', (s) => s.get(TAP_BASE_PREFIX + self.registration.scope)) ) return;
        await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(keys[0]) });
    }

    self.addEventListener('pushsubscriptionchange', (event) => {
        event.waitUntil((async () => {
            try {
                await keepSubscription(event);
            } catch ( err ) {
                console.warn('[puter] could not keep the push subscription', err);
            }
            for ( const win of await windows() ) win.postMessage({ type: CHANGED_MESSAGE });
        })());
    });

    self.puterPush = {
        /** Handles pushes for `key` in the worker, over a handler the page saved. */
        onPush (key, handler) {
            if ( typeof key !== 'string' || typeof handler !== 'function' ) {
                throw new TypeError('onPush(key, handler) takes a string and a function');
            }
            registered.set(key, handler);
        },
        /** With `false`, pushes without a handler registered here show their own title and text. */
        savedHandlers (on) {
            if ( typeof on !== 'boolean' ) throw new TypeError('savedHandlers(on) takes a boolean');
            useSavedHandlers = on;
        },
    };
})();
