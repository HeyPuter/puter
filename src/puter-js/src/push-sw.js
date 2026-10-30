// Puter push notifications on an app's own origin, served at
// https://js.puter.com/push-sw.js. The app serves a worker (default
// `/puter-sw.js`) that contains:
//
//     importScripts('https://js.puter.com/push-sw.js');
//
// It shows each Puter push, running the handler the page saved with
// `puter.notifications.onPush(key, handler)`, and routes taps back to the app.
// A handler that needs imports can be registered in the worker itself with
// `puterPush.onPush(key, handler)`, which wins over a saved one.
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
    // Browsers allow openWindow only shortly after the click.
    const CLICK_ACK_BUDGET_MS = 600;
    const DEFAULT_TITLE = 'New notification';
    const CHALLENGE_MESSAGE = 'puter-push-challenge';
    const CLICK_MESSAGE = 'puter-notification-click';
    const CLICK_ACK_MESSAGE = 'puter-notification-click-ack';
    const SHOW_MESSAGE = 'puter-push-show';
    const CHANGED_MESSAGE = 'puter-push-subscription-changed';
    const CLICK_PARAM = 'puter.notification';
    const SHOWN_FIELDS = ['title', 'body', 'icon', 'badge', 'image', 'tag', 'url'];

    const registered = new Map();
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
        createdAt: typeof message.ts === 'number' && Number.isFinite(message.ts) ? message.ts : Date.now(),
        app: appOf(message),
    });

    async function handlerFor (channel) {
        if ( ! channel ) return null;
        if ( registered.has(channel) ) return registered.get(channel);
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
            }
        } catch ( err ) {
            console.warn('[puter] push handler failed', err);
        }
        return shown;
    }

    // Taps only ever open this origin; relative paths are read from the worker's scope.
    function sameOriginUrl (url) {
        const scope = self.registration.scope ?? `${self.location.origin}/`;
        try {
            const parsed = new URL(url ?? '', scope);
            return parsed.origin === self.location.origin ? parsed.href : scope;
        } catch {
            return scope;
        }
    }

    async function windows () {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        return all.filter((c) => {
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
                url: sameOriginUrl(url),
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
        for ( const win of await windows() ) {
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

    // Kept for the page the tap opens, which reads it from the URL.
    async function keepClick (click) {
        if ( ! click.uid ) return;
        try {
            await forgetOldClicks();
            await idb(CLICKS, 'readwrite', (s) => s.put({ ...click, at: Date.now() }, click.uid));
        } catch ( err ) {
            console.warn('[puter] could not keep a tap', err);
        }
    }

    // An open window with a click handler takes the tap; otherwise one opens its URL.
    async function routeClick (puter, startedAt = Date.now()) {
        const click = { uid: puter.uid, target: puter.target ?? null, data: puter.data ?? null };
        const url = sameOriginUrl(puter.url);
        const open = await windows();
        const win = open.find((c) => c.url === url) ?? open.find((c) => c.focused) ?? open[0];
        if ( win ) {
            const id = `click-${++nextClickId}`;
            const acked = waitForClickAck(id, Math.max(0, startedAt + CLICK_ACK_BUDGET_MS - Date.now()));
            win.postMessage({ type: CLICK_MESSAGE, id, notification: click });
            try {
                await win.focus();
            } catch {
                // focus is refused once the click's window has passed
            }
            if ( await acked ) return;
            // Already there: reloading would only lose what the user had open.
            if ( win.url === url ) return;
        }
        await keepClick(click);
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

    self.addEventListener('push', (event) => {
        const message = readMessage(event.data);
        if ( ! message ) return;
        event.waitUntil(showPush(message));
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
        event.waitUntil(routeClick(puter, startedAt));
    });

    self.addEventListener('pushsubscriptionchange', (event) => {
        // The worker has no Puter session; an open page registers the new one.
        event.waitUntil((async () => {
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
    };
})();
