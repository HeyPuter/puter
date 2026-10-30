import EventListener from '../../lib/EventListener.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { needsSignIn } from '../events/lib/signIn.js';
import { disable } from './disable.js';
import { enable } from './enable.js';
import { enablePush } from './enablePush.js';
import {
    CLICKS_STORE,
    HANDLERS_STORE,
    forgetPushState,
    hasOptIn,
    idbDelete,
    idbGet,
    idbPut,
    setOptIn,
} from './lib/pushStore.js';
import { ReceiptLog } from './lib/receipts.js';
import { toClick } from './lib/shapes.js';
import {
    removeWebPush,
    syncWebPush,
    webPushSupported,
    workerFor,
} from './lib/webPush.js';
import { listDevices } from './listDevices.js';
import { notify } from './notify.js';
import { onNotification } from './onNotification.js';
import { onPush, shownFrom } from './onPush.js';
import { registerDevice } from './registerDevice.js';
import { removeDevice } from './removeDevice.js';
import { hasPermission, requestPermission } from './requestPermission.js';

/** The desktop's broadcast for a click on one of this app's notifications. */
export const CLICK_BROADCAST = 'notificationClick';
/** What `push-sw.js` posts to an open page of the app when a push is tapped. */
export const WORKER_CLICK_MESSAGE = 'puter-notification-click';
/** What the page answers a tap with when a click handler took it. */
export const WORKER_CLICK_ACK_MESSAGE = 'puter-notification-click-ack';
/** What a page posts `push-sw.js` to show a notification it received live. */
export const WORKER_SHOW_MESSAGE = 'puter-push-show';
/** What a worker posts when the browser replaced the push subscription. */
export const SUBSCRIPTION_CHANGED_MESSAGE = 'puter-push-subscription-changed';
/** Query parameter `push-sw.js` adds to a page it opens for a tap. */
export const CLICK_PARAM = 'puter.notification';

/** As long as `push-sw.js` gives a handler. */
const HANDLER_TIMEOUT_MS = 5_000;
/** How long an older `push-sw.js`, which never answers, is waited for. */
const WORKER_SHOW_TIMEOUT_MS = 2_000;
/**
 * Sync failures that are the server's or the user's standing choice, not a
 * fault.
 */
const QUIET_SYNC_ERRORS = new Set([
    'push_disabled',
    'push_revoked',
    'push_unavailable',
    'too_many_requests',
]);

let storageWarned = false;
const warnStorage = (error) => {
    if (storageWarned) return;
    storageWarned = true;
    console.warn(
        '[puter.notifications] IndexedDB is unavailable, so pushes show without their onPush handlers',
        error,
    );
};

/** Hidden, or in a window without focus. */
const pageAway = () => {
    const doc = globalThis.document;
    return doc?.visibilityState === 'hidden' || doc?.hasFocus?.() === false;
};

/** `promise`, or `push_handler_timeout` after the time a worker would give it. */
const withinHandlerTime = async (promise) => {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new PuterJSError(
                                'The push handler did not finish within 5 seconds',
                                'push_handler_timeout',
                            ),
                        ),
                    HANDLER_TIMEOUT_MS,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Where a tap goes: on this origin, with relative paths read from the worker's
 * scope.
 */
export const tapUrl = (url, scope) => {
    const base = new URL(scope);
    try {
        const resolved = new URL(url ?? '', base);
        return resolved.origin === base.origin ? resolved.href : base.href;
    } catch {
        return base.href;
    }
};

/**
 * Hands the notification to `push-sw.js`, which shows it unless another window
 * of the app has focus. Resolves whether the worker answered.
 */
const showThroughWorker = (registration, title, options) => {
    const worker = registration.active;
    if (!worker || typeof globalThis.MessageChannel !== 'function')
        return Promise.resolve(false);
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const done = (answered) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(answered);
        };
        const timer = setTimeout(() => done(false), WORKER_SHOW_TIMEOUT_MS);
        channel.port1.onmessage = () => done(true);
        try {
            worker.postMessage({ type: WORKER_SHOW_MESSAGE, title, options }, [
                channel.port2,
            ]);
        } catch {
            done(false);
        }
    });
};

/**
 * An app's notifications to the user it runs for.
 *
 * @extends {EventListener<{ click: import('./types.js').NotificationClick }>}
 */
export class NotificationsModule extends EventListener {
    // Rebound in the constructor so destructured calls keep `this`.
    notify = notify;
    onNotification = onNotification;
    enable = enable;
    disable = disable;
    onPush = onPush;
    requestPermission = requestPermission;
    hasPermission = hasPermission;
    enablePush = enablePush;
    registerDevice = registerDevice;
    listDevices = listDevices;
    removeDevice = removeDevice;

    #listening = false;
    /** @type {Map<string, Set<{ handler: Function; onError?: Function }>>} */
    #pushHandlers = new Map();
    /** @type {Promise<{ off: () => Promise<void> } | null> | null} */
    #pushFeed = null;
    /** @type {(() => unknown) | null} */
    #stopWaitingForAuth = null;
    /** @type {{ url: string; scope?: string } | null} */
    #worker = null;
    /** Whether the page's push worker is registered, as last looked up. */
    #workerRegistered = false;
    /**
     * The load-time sync, per worker URL.
     *
     * @type {Map<string, Promise<void>>}
     */
    #syncs = new Map();
    #listeningForResubscribe = false;
    /**
     * Writes of saved handlers, chained per key.
     *
     * @type {Map<string, Promise<void>>}
     */
    #sourceWrites = new Map();
    #receipts = new ReceiptLog(() => this.#showsOwn());

    /** @param {import('../../index.js').Puter} puter */
    constructor(puter) {
        super(['click']);
        /** @type {import('../../index.js').Puter} */
        this.puter = puter;

        const methods = /** @type {Record<string, Function>} */ (
            /** @type {unknown} */ (this)
        );
        for (const name of [
            'notify',
            'onNotification',
            'enable',
            'disable',
            'onPush',
            'requestPermission',
            'hasPermission',
            'enablePush',
            'registerDevice',
            'listDevices',
            'removeDevice',
        ]) {
            methods[name] = methods[name].bind(this);
        }
    }

    /**
     * Listens for clicks on this app's notifications. A click that came in
     * before the first handler was added is delivered to that handler.
     *
     * @param {'click'} eventName
     * @param {(click: import('./types.js').NotificationClick) => void} handler
     *   Called with `{ uid, target, data }`.
     * @returns {this | undefined}
     */
    on(eventName, handler) {
        const result = super.on(eventName, handler);
        if (result && eventName === 'click' && !this.#listening) {
            this.#listening = true;
            let replaying = true;
            // `puter.ui` replays its last broadcast here, before `on()` returns.
            this.puter.ui?.on?.(CLICK_BROADCAST, (data) => {
                const click = toClick(data);
                if (!click) return;
                const first = replaying ? handler : null;
                queueMicrotask(() =>
                    first ? first(click) : this.emit('click', click),
                );
            });
            replaying = false;
            if (this.puter.env === 'web') this.#listenForWorkerClicks(handler);
        }
        return result;
    }

    /**
     * `onPush`'s live side: one notifications feed for every key. With
     * `source`, the handler is also saved for the worker until the last handler
     * for `key` goes.
     *
     * @param {string} key
     * @param {Function} handler
     * @param {{
     *     onError?: Function;
     *     source?: string | null;
     *     worker?: { url: string; scope?: string } | null;
     * }} [options]
     * @returns {Promise<import('./types.js').NotificationListener>}
     * @internal
     */
    async _addPushHandler(
        key,
        handler,
        { onError, source = null, worker = null } = {},
    ) {
        const entry = { handler, onError };
        const entries = this.#pushHandlers.get(key) ?? new Set();
        entries.add(entry);
        this.#pushHandlers.set(key, entries);
        if (worker) this.#useWorker(worker);
        this.#startPushFeed();
        if (source !== null) {
            await this.#writeSource(key, () =>
                idbPut(HANDLERS_STORE, key, source),
            );
        }

        let removed = false;
        return {
            off: async () => {
                if (removed) return;
                removed = true;
                entries.delete(entry);
                if (
                    entries.size === 0 &&
                    this.#pushHandlers.get(key) === entries
                )
                    this.#pushHandlers.delete(key);
                const stopping =
                    this.#pushHandlers.size === 0 ? this.#stopPushFeed() : null;
                if (source !== null) {
                    await this.#writeSource(key, async () => {
                        // A handler added since, here or in another tab, keeps its own.
                        if (this.#pushHandlers.has(key)) return;
                        if ((await idbGet(HANDLERS_STORE, key)) === source)
                            await idbDelete(HANDLERS_STORE, key);
                    });
                }
                await stopping;
            },
        };
    }

    /** @internal This page received `uid` live, in a feed or the desktop. */
    _noteReceived(uid) {
        this.#receipts.note(uid);
    }

    /** @internal The server asks whether this page received a notification. */
    _answerReceipt(data, ack) {
        this.#receipts.answer(data, ack);
    }

    /**
     * `onPush`'s sync on load, once per worker: only for a user who turned push
     * on here with `enable()`.
     *
     * @param {{ url: string; scope?: string }} worker
     * @internal
     */
    _syncPushOnLoad(worker) {
        if (!this.#syncs.has(worker.url)) {
            this.#syncs.set(worker.url, this.#syncIfOptedIn(worker));
        }
        if (this.#listeningForResubscribe) return;
        this.#listeningForResubscribe = true;
        globalThis.navigator?.serviceWorker?.addEventListener(
            'message',
            (event) => {
                if (event.data?.type !== SUBSCRIPTION_CHANGED_MESSAGE) return;
                if (this.#pushHandlers.size > 0 && this.#worker)
                    void this.#syncIfOptedIn(this.#worker);
            },
        );
    }

    /**
     * `enable()` on a website or the GUI: registers this browser and, on a
     * website, remembers that this user turned push on here.
     *
     * @param {{ url: string; scope?: string }} worker
     * @internal
     */
    async _enableWebPush(worker) {
        this.#useWorker(worker);
        try {
            await syncWebPush(this.puter, { worker });
        } catch (error) {
            if (error?.code === 'push_revoked') await this.#recordOptIn(false);
            throw error;
        }
        this.#workerRegistered = true;
        await this.#recordOptIn(true);
    }

    /**
     * `disable()`: ends this browser's subscription and forgets every opt-in
     * here.
     *
     * @param {{ url: string; scope?: string }} worker
     * @returns {Promise<boolean>}
     * @internal
     */
    async _disableWebPush(worker) {
        try {
            return await removeWebPush(this.puter, { worker });
        } finally {
            if (this.puter.env === 'web') await this.#forgetOptIns();
        }
    }

    /**
     * Sign-out on a website: removes this browser's subscription with the token
     * of the user leaving, and forgets their opt-in and taps. Never throws.
     *
     * @param {string | null | undefined} authToken
     * @internal
     */
    async _forgetPush(authToken) {
        if (this.puter.env !== 'web') return;
        this.#syncs.clear();
        try {
            if (authToken && webPushSupported()) {
                await removeWebPush(this.puter, {
                    worker: this.#worker ?? workerFor('web'),
                    authToken,
                });
            }
        } catch (error) {
            console.warn(
                '[puter.notifications] could not remove the push subscription at sign-out',
                error,
            );
        }
        await this.#forgetOptIns();
    }

    #useWorker(worker) {
        this.#worker = worker;
        void (async () => {
            try {
                const registration =
                    await globalThis.navigator?.serviceWorker?.getRegistration(
                        worker.scope ?? worker.url,
                    );
                if (this.#worker === worker)
                    this.#workerRegistered = !!registration;
            } catch {
                if (this.#worker === worker) this.#workerRegistered = false;
            }
        })();
    }

    /** Whether this page shows a browser notification itself while it is away. */
    #showsOwn() {
        return (
            this.puter.env === 'web' &&
            this.#pushFeed !== null &&
            this.#pushHandlers.size > 0 &&
            this.#workerRegistered &&
            globalThis.Notification?.permission === 'granted'
        );
    }

    async #userUuid() {
        const known =
            this.puter.whoami ?? (await this.puter.whoamiCache_) ?? null;
        if (typeof known?.uuid === 'string') return known.uuid;
        const user = await this.puter.auth?.whoami?.();
        return typeof user?.uuid === 'string' ? user.uuid : null;
    }

    async #recordOptIn(on) {
        if (this.puter.env !== 'web') return;
        try {
            const uuid = await this.#userUuid();
            if (uuid) await setOptIn(uuid, on);
        } catch (error) {
            warnStorage(error);
        }
    }

    async #forgetOptIns() {
        try {
            await forgetPushState();
        } catch (error) {
            warnStorage(error);
        }
    }

    async #syncIfOptedIn(worker) {
        let optedIn = false;
        try {
            const uuid = await this.#userUuid();
            optedIn = !!uuid && (await hasOptIn(uuid));
        } catch (error) {
            warnStorage(error);
        }
        if (!optedIn) return;
        try {
            await syncWebPush(this.puter, { worker });
            this.#workerRegistered = true;
        } catch (error) {
            if (error?.code === 'push_revoked') await this.#recordOptIn(false);
            if (QUIET_SYNC_ERRORS.has(error?.code)) return;
            this.#reportPush(
                error,
                'could not keep the push subscription current',
            );
        }
    }

    /**
     * Saved-handler writes for one key run in call order; a failed one only
     * warns.
     */
    #writeSource(key, write) {
        const previous = this.#sourceWrites.get(key);
        const next = (async () => {
            await previous;
            try {
                await write();
            } catch (error) {
                warnStorage(error);
            }
        })();
        this.#sourceWrites.set(key, next);
        void (async () => {
            await next;
            if (this.#sourceWrites.get(key) === next)
                this.#sourceWrites.delete(key);
        })();
        return next;
    }

    #startPushFeed() {
        if (this.#pushHandlers.size === 0) return;
        if (this.#pushFeed || this.#stopWaitingForAuth) return;
        // A visitor who hasn't signed in yet: start once they do.
        if (needsSignIn(this.puter)) {
            this.#restartOnAuthChange();
            return;
        }
        /** @type {Promise<{ off: () => Promise<void> } | null>} */
        const feed = (async () => {
            try {
                return await this.onNotification(
                    (notification) => this.#dispatchPush(notification),
                    {
                        catchUp: false,
                        onError: (error) => this.#feedFailed(feed, error),
                    },
                );
            } catch (error) {
                if (this.#pushFeed === feed) this.#pushFeed = null;
                this.#reportPush(error);
                return null;
            }
        })();
        this.#pushFeed = feed;
    }

    /**
     * A stopped feed is dropped; a new token, or the next sign-in, starts
     * another.
     */
    #feedFailed(feed, error) {
        if (error?.code !== 'catch_up_truncated' && this.#pushFeed === feed) {
            this.#pushFeed = null;
            // Reported from inside the change, which may already carry a new token.
            if (error?.code === 'auth_changed')
                queueMicrotask(() => this.#startPushFeed());
            else this.#restartOnAuthChange();
        }
        this.#reportPush(error);
    }

    #restartOnAuthChange() {
        if (this.#stopWaitingForAuth) return;
        this.#stopWaitingForAuth = this.puter.onAuthStateChanged(() => {
            if (needsSignIn(this.puter)) return;
            this.#stopWaitingForAuth?.();
            this.#stopWaitingForAuth = null;
            this.#startPushFeed();
        });
    }

    async #stopPushFeed() {
        this.#stopWaitingForAuth?.();
        this.#stopWaitingForAuth = null;
        const feed = this.#pushFeed;
        this.#pushFeed = null;
        await (await feed)?.off();
    }

    #reportPush(error, what = 'push listener failed') {
        const handlers = [...this.#pushHandlers.values()].flatMap((set) =>
            [...set].map((entry) => entry.onError).filter(Boolean),
        );
        if (handlers.length === 0)
            console.error(`[puter.notifications] ${what}`, error);
        for (const onError of new Set(handlers)) onError(error);
    }

    async #dispatchPush(notification) {
        const entries = this.#pushHandlers.get(notification.channel ?? '');
        let result;
        for (const { handler, onError } of entries ? [...entries] : []) {
            try {
                result =
                    (await withinHandlerTime(
                        (async () => handler(notification))(),
                    )) ?? result;
            } catch (error) {
                if (onError) onError(error);
                else
                    console.error(
                        '[puter.notifications] push handler failed',
                        error,
                    );
            }
        }
        await this.#showIfAway(notification, result);
    }

    /**
     * A website page that is hidden or in an unfocused window shows what the
     * push would have, through `push-sw.js` so a focused window of the app
     * holds it back. Inside the Puter desktop, the desktop's banner shows it.
     */
    async #showIfAway(notification, result) {
        if (this.puter.env !== 'web' || !pageAway()) return;
        if (globalThis.Notification?.permission !== 'granted') return;
        try {
            const worker = this.#worker ?? workerFor('web');
            const registration =
                await globalThis.navigator.serviceWorker?.getRegistration(
                    worker.scope ?? worker.url,
                );
            this.#workerRegistered = !!registration;
            if (!registration) return;
            const { title, url, ...shown } = shownFrom(notification, result);
            const scope =
                registration.scope ?? `${globalThis.location.origin}/`;
            const sensitive = notification.sensitive === true;
            const options = {
                ...shown,
                renotify: shown.tag !== notification.uid,
                data: {
                    puter: {
                        uid: notification.uid,
                        target: sensitive ? null : notification.target,
                        data: sensitive ? null : notification.data,
                        url: tapUrl(url, scope),
                    },
                },
            };
            if (await showThroughWorker(registration, title, options)) return;
            await registration.showNotification(title, options);
        } catch (error) {
            console.warn(
                '[puter.notifications] could not show a notification',
                error,
            );
        }
    }

    /**
     * Taps from `push-sw.js`: posted to an open page, or carried by the URL of
     * one it opened. A posted tap is acknowledged only while a click handler is
     * there to take it; otherwise the worker opens its URL.
     */
    #listenForWorkerClicks(firstHandler) {
        const container = globalThis.navigator?.serviceWorker;
        container?.addEventListener('message', (event) => {
            if (event.data?.type !== WORKER_CLICK_MESSAGE) return;
            const click = toClick(event.data.notification);
            if (!click || !this._hasListeners('click')) return;
            if (event.data.id !== undefined) {
                event.source?.postMessage?.({
                    type: WORKER_CLICK_ACK_MESSAGE,
                    id: event.data.id,
                });
            }
            this.emit('click', click);
        });
        container?.startMessages?.();

        const url = globalThis.location
            ? new URL(globalThis.location.href)
            : null;
        const uid = url?.searchParams.get(CLICK_PARAM);
        if (!uid) return;
        url.searchParams.delete(CLICK_PARAM);
        globalThis.history?.replaceState?.(
            globalThis.history.state,
            '',
            url.href,
        );
        void (async () => {
            try {
                const click = toClick(await idbGet(CLICKS_STORE, uid));
                await idbDelete(CLICKS_STORE, uid);
                if (click) firstHandler(click);
            } catch (error) {
                console.warn(
                    '[puter.notifications] could not read a tap',
                    error,
                );
            }
        })();
    }
}

/**
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof NotificationsModule,
 *     'puter' | 'emit'
 * >} NotificationsConstructor
 */

export const Notifications = /** @type {NotificationsConstructor} */ (
    NotificationsModule
);

export default Notifications;
