import EventListener from '../../lib/EventListener.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { needsSignIn } from '../events/lib/signIn.js';
import { cancel } from './cancel.js';
import { dismiss } from './dismiss.js';
import { disable } from './disable.js';
import { enable } from './enable.js';
import { enablePush } from './enablePush.js';
import { request } from './lib/api.js';
import {
    CLICK_KEEP_MS,
    HANDLERS_STORE,
    SUBSCRIPTION_CHANGED_PREFIX,
    SYNCED_PREFIX,
    TAP_BASE_PREFIX,
    forgetOldClicks,
    forgetPushState,
    hasOptIn,
    idbDelete,
    idbGet,
    idbPut,
    setOptIn,
    takeClick,
} from './lib/pushStore.js';
import { closeNotification, reconcileDismissed } from './lib/osNotifications.js';
import { ReceiptLog } from './lib/receipts.js';
import { toClick } from './lib/shapes.js';
import {
    currentWebPush,
    removeWebPush,
    syncWebPush,
    unsubscribeWebPush,
    usesPuterKey,
    webPushCheck,
    webPushState,
    webPushSupported,
    workerFor,
    workerScope,
} from './lib/webPush.js';
import { listDevices } from './listDevices.js';
import { markShown } from './markShown.js';
import { notify } from './notify.js';
import { onNotification } from './onNotification.js';
import { onPush, shownFrom } from './onPush.js';
import { removeDevice } from './removeDevice.js';
import { hasPermission, requestPermission } from './requestPermission.js';
import { status } from './status.js';

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

/** Where a site's tabs tell each other that a user's opt-in changed. */
const OPT_IN_CHANNEL = 'puter-push-opt-in';
/** Held by a site's tabs while one changes this browser's subscription. */
const PUSH_LOCK = 'puter-push';

/** As long as `push-sw.js` gives a handler. */
const HANDLER_TIMEOUT_MS = 5_000;
/** How long an older `push-sw.js`, which never answers, is waited for. */
const WORKER_SHOW_TIMEOUT_MS = 2_000;
/** How long after load a page a tap opened waits for a `click` handler. */
const UNREAD_TAP_MS = 10_000;
/** How long a load only asks the server about a subscription it confirmed. */
const SYNCED_FOR_MS = 24 * 60 * 60 * 1000;
/** Sync failures that are the server's or the user's choice, not a fault. */
const QUIET_SYNC_ERRORS = new Set([
    'push_device_removed',
    'push_disabled',
    'push_revoked',
    'push_unavailable',
    'push_verification_canceled',
    'reauth_required',
    'token_auth_failed',
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

/** Runs `run` alone among the site's tabs, or as is where Web Locks refuse. */
const withPushLock = async (run) => {
    let started = false;
    const start = () => {
        started = true;
        return run();
    };
    try {
        return await globalThis.navigator.locks.request(PUSH_LOCK, start);
    } catch (error) {
        if (started) throw error;
        return await start();
    }
};

/** Held shared by every tab with a saved handler for `key`. */
const handlerLock = (key) => `puter-push-handler:${key}`;

/** Holds lock `name` shared until `release()`; without Web Locks, holds nothing. */
const holdShared = (name) => {
    let release = () => {};
    const held = new Promise((resolve) => {
        release = resolve;
    });
    let onGranted = () => {};
    const granted = new Promise((resolve) => {
        onGranted = resolve;
    });
    let released;
    try {
        released = globalThis.navigator.locks
            .request(name, { mode: 'shared' }, () => {
                onGranted();
                return held;
            })
            .catch(() => {});
    } catch {
        released = Promise.resolve();
    }
    void released.then(onGranted);
    return { granted, released, release };
};

/** Runs `run` only when lock `name` is free; never without Web Locks. */
const ifNoTabHolds = async (name, run) => {
    let started = false;
    try {
        await globalThis.navigator.locks.request(
            name,
            { ifAvailable: true },
            (lock) => {
                if (!lock) return;
                started = true;
                return run();
            },
        );
    } catch (error) {
        if (started) throw error;
    }
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

/** Where a tap goes: on `base`'s origin, with relative paths read from it. */
export const tapUrl = (url, base) => {
    const from = new URL(base);
    try {
        const resolved = new URL(url ?? '', from);
        return resolved.origin === from.origin ? resolved.href : from.href;
    } catch {
        return from.href;
    }
};

/** Where taps resolve: the worker's scope if this page is in it, else `/`. */
const tapBaseFor = (worker, pageUrl) => {
    const scope = workerScope(worker);
    return {
        scope,
        base: pageUrl.startsWith(scope) ? scope : new URL('/', scope).href,
    };
};

/** The tap base a page saved for `scope`, else `scope`. */
const savedTapBase = async (scope) => {
    try {
        const base = await idbGet(HANDLERS_STORE, TAP_BASE_PREFIX + scope);
        if (
            typeof base === 'string' &&
            new URL(base).origin === new URL(scope).origin
        )
            return base;
    } catch {
        // Nothing saved, or IndexedDB is unavailable.
    }
    return scope;
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
 * @extends {EventListener<{ click: import('./types.js').NotificationClick, dismiss: import('./types.js').NotificationDismissal }>}
 */
export class NotificationsModule extends EventListener {
    // Rebound in the constructor so destructured calls keep `this`.
    notify = notify;
    /** @type {OmitThisParameter<typeof cancel>} */
    cancel = cancel;
    /** @type {OmitThisParameter<typeof markShown>} */
    markShown = markShown;
    /** @type {OmitThisParameter<typeof dismiss>} */
    dismiss = dismiss;
    onNotification = onNotification;
    enable = enable;
    disable = disable;
    status = status;
    onPush = onPush;
    requestPermission = requestPermission;
    hasPermission = hasPermission;
    enablePush = enablePush;
    listDevices = listDevices;
    removeDevice = removeDevice;

    #pushListener = (notification) => {
        if (this.#pushHandlers.size > 0) return this.#dispatchPush(notification);
    };
    #listening = false;
    #dismissed = new Set();
    #reconciling = null;
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
    /** This page's hold on each key's handler lock, with its handler count. */
    #handlerLocks = new Map();
    #watchingPageCache = false;
    #receipts = new ReceiptLog(() => this.#showsOwn());
    /**
     * Whether the signed-in user turned push on here, as last read or set. A
     * page shows notifications itself only while it is.
     */
    #optedIn = false;
    /** Bumped on every change, so a read that started before one is dropped. */
    #optInVersion = 0;
    /** @type {BroadcastChannel | null} */
    #optInChannel = null;
    /**
     * Aborted by `disable()` and sign-out, so a confirmation still on its way
     * doesn't register this browser after them.
     */
    #stopVerifying = new AbortController();
    /** The cleanup after a user change, which `enable()` waits for. */
    #userChange = Promise.resolve();
    /** The token whose push state sign-out already ended. */
    #forgottenToken = null;
    #sweptClicks = false;

    /** @param {import('../../index.js').Puter} puter */
    constructor(puter) {
        super(['click', 'dismiss']);
        /** @type {import('../../index.js').Puter} */
        this.puter = puter;

        const methods = /** @type {Record<string, Function>} */ (
            /** @type {unknown} */ (this)
        );
        for (const name of [
            'notify',
            'cancel',
            'markShown',
            'dismiss',
            'onNotification',
            'enable',
            'disable',
            'status',
            'onPush',
            'requestPermission',
            'hasPermission',
            'enablePush',
            'listDevices',
            'removeDevice',
        ]) {
            methods[name] = methods[name].bind(this);
        }
        if (puter.env === 'web') {
            this.#watchUser();
            this.#dropUnreadTap();
        }
    }

    /**
     * Listens for clicks or dismissals of this app's notifications. An earlier
     * click is delivered to the first handler added.
     *
     * @template {'click' | 'dismiss'} K
     * @param {K} eventName
     * @param {(event: { click: import('./types.js').NotificationClick, dismiss: import('./types.js').NotificationDismissal }[K]) => void} handler
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
        if (result && eventName === 'dismiss') this.#startPushFeed();
        return result;
    }

    /**
     * @template {'click' | 'dismiss'} K
     * @param {K} eventName
     * @param {(event: { click: import('./types.js').NotificationClick, dismiss: import('./types.js').NotificationDismissal }[K]) => void} handler
     * @returns {this | undefined}
     */
    off(eventName, handler) {
        const result = super.off(eventName, handler);
        if (eventName === 'dismiss' && !this._hasListeners('dismiss') && this.#pushHandlers.size === 0)
            void this.#stopPushFeed();
        return result;
    }

    /**
     * `onPush`'s live side: one notifications feed for every key. With
     * `source`, the handler is also saved for the worker until the last handler
     * for `key` on this browser goes.
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
            await this.#holdHandlerLock(key, source);
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
                    this.#pushHandlers.size === 0 && !this._hasListeners('dismiss') ? this.#stopPushFeed() : null;
                if (source !== null) {
                    const released = this.#releaseHandlerLock(key);
                    await this.#writeSource(key, async () => {
                        await released;
                        // A handler added here since keeps its own.
                        if (this.#pushHandlers.has(key)) return;
                        await ifNoTabHolds(handlerLock(key), async () => {
                            if ((await idbGet(HANDLERS_STORE, key)) === source)
                                await idbDelete(HANDLERS_STORE, key);
                        });
                    });
                }
                await stopping;
            },
        };
    }

    /** @internal This page received `uid` live, in a feed or the desktop. */
    _noteReceived(uid, handler) {
        // A dismiss-only listener leaves postings for push delivery.
        if (handler === this.#pushListener && this.#pushHandlers.size === 0) return;
        this.#receipts.note(uid);
    }

    /** @internal Closes this browser's copy even when the row was already dismissed. */
    async _closeNotification(uid) {
        this.#rememberDismissed(uid);
        if (this.puter.env !== 'web') return;
        try {
            await closeNotification(uid, this.#worker);
        } catch (error) {
            console.warn('[puter.notifications] could not close a notification', error);
        }
    }

    /** @internal One live dismissal, shared by this page's feeds. */
    _receiveDismissal(uid) {
        const received = this.#dismissed.has(uid);
        const closing = this._closeNotification(uid);
        if (received) return closing;
        try {
            this.emit('dismiss', { uid });
        } catch (error) {
            console.error('[puter.notifications] dismissal handler failed', error);
        }
        return closing;
    }

    #rememberDismissed(uid) {
        this.#dismissed.add(uid);
        if (this.#dismissed.size > 5000)
            this.#dismissed.delete(this.#dismissed.values().next().value);
    }

    /** @internal Reconciles displayed notifications without emitting live events. */
    async _reconcileDismissed() {
        if (this.puter.env !== 'web') return;
        if (!this.#reconciling) {
            this.#reconciling = reconcileDismissed(this.puter, this.#worker)
                .then((uids) => {
                    for (const uid of uids) this.#rememberDismissed(uid);
                })
                .catch((error) => {
                    console.warn('[puter.notifications] could not check dismissed notifications', error);
                })
                .finally(() => { this.#reconciling = null; });
        }
        await this.#reconciling;
    }

    /** @internal The server asks whether this page received a notification. */
    _answerReceipt(data, ack) {
        this.#receipts.answer(data, ack);
    }

    /**
     * `onPush`'s sync on load, once per worker: only for a user who turned push
     * on here with `enable()`, else Puter's subscription here ends.
     *
     * @param {{ url: string; scope?: string }} worker
     * @internal
     */
    _syncPushOnLoad(worker) {
        if (!this.#sweptClicks) {
            this.#sweptClicks = true;
            forgetOldClicks().catch(() => {});
        }
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
                    void this.#syncIfOptedIn(this.#worker, { full: true });
            },
        );
    }

    /**
     * `enable()` on a website or the GUI: registers this browser and, on a
     * website, remembers that this user turned push on here. A website resolves
     * once the server has the subscription and confirms it in the background; a
     * failed confirmation is tried again on the next load.
     *
     * @param {{ url: string; scope?: string }} worker
     * @internal
     */
    async _enableWebPush(worker) {
        await this.#userChange;
        this.#useWorker(worker);
        this.#listenForOptInChanges();
        /** @type {() => void} */
        let pending = () => {};
        const sent = new Promise((resolve) => {
            pending = () => resolve(undefined);
        });
        const signal = this.#stopVerifying.signal;
        const syncing = syncWebPush(this.puter, {
            worker,
            onPending: pending,
            signal,
            renewRemoved: true,
            interactive: true,
            withLock: withPushLock,
            onAnnounced: () => this.#recordOptIn(true),
            onSynced: (endpoint) => this.#noteSynced(worker, endpoint),
        });
        try {
            // The GUI reads the registered device right after.
            await (this.puter.env === 'gui'
                ? syncing
                : Promise.race([syncing, sent]));
        } catch (error) {
            await this.#followRefusal(error, worker);
            throw error;
        }
        // A disable() that ran meanwhile wins.
        if (signal.aborted) {
            throw new PuterJSError(
                'Push notifications were turned off while they were being turned on',
                'push_verification_canceled',
            );
        }
        this.#workerRegistered = true;
        void this.#finishSync(
            syncing,
            worker,
            'could not confirm this browser for pushes',
        );
    }

    /**
     * `disable()`: ends this browser's subscription and forgets every opt-in
     * here. A website without a `worker` ends Puter's wherever it is.
     *
     * @param {{ url: string; scope?: string } | null} worker
     * @returns {Promise<boolean>}
     * @internal
     */
    async _disableWebPush(worker) {
        this.#stopSyncs();
        if (this.puter.env === 'web') this.#optInChanged('off');
        return await withPushLock(async () => {
            if (this.puter.env === 'web') await this.#forgetOptIns();
            return await removeWebPush(this.puter, { worker });
        });
    }

    /**
     * `status()` on a website or the GUI. On a website, a subscription counts
     * only while the signed-in user's opt-in is recorded here. An `on` is
     * checked with the server, and kept when the server can't tell.
     *
     * @param {{ url: string; scope?: string }} worker
     * @returns {Promise<import('./types.js').PushStatus>}
     * @internal
     */
    async _webPushStatus(worker) {
        const permission = globalThis.Notification?.permission;
        if (permission === 'denied') return 'blocked';
        if (permission !== 'granted') return 'off';
        let subscription = null;
        try {
            subscription = await currentWebPush({ worker });
        } catch {
            return 'off';
        }
        if (!subscription) return 'off';
        if (this.puter.env === 'web' && !(await this.#readOptIn()))
            return 'off';
        const state = await webPushState(this.puter, subscription.endpoint);
        if (state === 'removed') {
            await this.#dropRemoved(worker, subscription);
            return 'off';
        }
        if (state === 'revoked') {
            await this.#recordOptIn(false);
            return 'off';
        }
        return 'on';
    }

    /**
     * Sign-out on a website: forgets every opt-in and tap here, ends Puter's
     * subscription in the browser, then removes it with the token of the user
     * leaving. Never throws.
     *
     * @param {string | null | undefined} authToken
     * @internal
     */
    async _forgetPush(authToken) {
        if (this.puter.env !== 'web') return;
        this.#forgottenToken = authToken ?? null;
        this.#stopSyncs();
        this.#optInChanged('off');
        await withPushLock(async () => {
            await this.#forgetOptIns();
            if (!webPushSupported()) return;
            try {
                await (authToken
                    ? removeWebPush(this.puter, { authToken, keepalive: true })
                    : unsubscribeWebPush(this.puter));
            } catch (error) {
                console.warn(
                    '[puter.notifications] could not remove the push subscription at sign-out',
                    error,
                );
            }
        });
    }

    /** Another user signing in here ends push for the last one, as sign-out. */
    #watchUser() {
        /** @type {{ token: string; user: Promise<string | null> } | null} */
        let last = null;
        const note = () => {
            const token = this.puter.authToken;
            // Signed in again with it, so a later change cleans up again.
            if (token && token === this.#forgottenToken)
                this.#forgottenToken = null;
            if (!token || token === last?.token) return;
            const previous = last;
            last = { token, user: this.#tokenUser(token) };
            if (previous) {
                this.#userChange = Promise.all([
                    this.#userChange,
                    this.#forgetIfAnotherUser(previous, last),
                ]);
            }
        };
        note();
        this.puter.onAuthStateChanged?.(note);
    }

    async #forgetIfAnotherUser(previous, current) {
        if (previous.token === this.#forgottenToken) return;
        const [was, now] = await Promise.all([previous.user, current.user]);
        if (was && now && was !== now) await this._forgetPush(previous.token);
    }

    /** The user `token` names: its `uu` claim, else its cached `/whoami`. */
    async #tokenUser(token) {
        const claim = this.puter.decodeJwtPayload?.(token)?.uu;
        const named =
            typeof claim === 'string'
                ? this.puter
                      .decodeCompressedAppID?.(claim)
                      ?.replace(/^app-/, '')
                : null;
        if (named) return named;
        // `setAuthToken` starts that lookup right after telling its listeners.
        await null;
        if (this.puter.authToken !== token) return null;
        const user = await this.puter.whoamiCache_;
        return typeof user?.uuid === 'string' ? user.uuid : null;
    }

    #useWorker(worker) {
        this.#worker = worker;
        if (this.puter.env === 'web') void this.#saveTapBase(worker);
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

    async #saveTapBase(worker) {
        try {
            const { scope, base } = tapBaseFor(
                worker,
                globalThis.location.href,
            );
            await idbPut(HANDLERS_STORE, TAP_BASE_PREFIX + scope, base);
        } catch {
            // Taps then open the worker's scope.
        }
    }

    /** Whether this page shows a browser notification itself while it is away. */
    #showsOwn() {
        return (
            this.puter.env === 'web' &&
            this.#optedIn &&
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
        try {
            const user = await request(this.puter, 'GET', '/whoami', null, {
                interactiveReauth: false,
            });
            return typeof user?.uuid === 'string' ? user.uuid : null;
        } catch {
            return null;
        }
    }

    async #recordOptIn(on) {
        if (this.puter.env !== 'web') return;
        this.#setOptedIn(on);
        try {
            const uuid = await this.#userUuid();
            if (uuid) await setOptIn(uuid, on);
        } catch (error) {
            warnStorage(error);
        }
        this.#optInChanged();
    }

    async #forgetOptIns() {
        this.#setOptedIn(false);
        try {
            await forgetPushState();
        } catch (error) {
            warnStorage(error);
        }
        this.#optInChanged();
    }

    #setOptedIn(on) {
        this.#optedIn = on;
        this.#optInVersion++;
    }

    /** The user's opt-in, read into `#optedIn`; null when it can't be read. */
    async #readOptIn() {
        this.#listenForOptInChanges();
        const version = this.#optInVersion;
        /** @type {boolean | null} */
        let on = false;
        try {
            if (!needsSignIn(this.puter)) {
                const uuid = await this.#userUuid();
                on = uuid ? await hasOptIn(uuid) : null;
            }
        } catch (error) {
            warnStorage(error);
            on = null;
        }
        if (version === this.#optInVersion) this.#optedIn = on === true;
        return on;
    }

    /** Other tabs re-read the opt-in; `off` also stops their syncs. */
    #optInChanged(kind = 'changed') {
        this.#listenForOptInChanges();
        try {
            this.#optInChannel?.postMessage(kind);
        } catch {
            // A closed channel; the other tabs read it on their next sync.
        }
    }

    #listenForOptInChanges() {
        if (
            this.#optInChannel ||
            typeof globalThis.BroadcastChannel !== 'function'
        )
            return;
        this.#optInChannel = new BroadcastChannel(OPT_IN_CHANNEL);
        this.#optInChannel.onmessage = (event) => {
            if (event.data === 'off') this.#stopSyncs();
            void this.#readOptIn();
        };
    }

    /** With `full`, registers again even when a status call would do. */
    async #syncIfOptedIn(worker, { full = false } = {}) {
        const optedIn = await this.#readOptIn();
        if (optedIn === false) await this.#endUnwanted();
        if (!optedIn) return;
        if (!full && (await this.#settledByStatus(worker))) return;
        await this.#finishSync(
            syncWebPush(this.puter, {
                worker,
                signal: this.#stopVerifying.signal,
                stillWanted: async () => (await this.#readOptIn()) === true,
                withLock: withPushLock,
                onSynced: (endpoint) => this.#noteSynced(worker, endpoint),
            }),
            worker,
            'could not keep the push subscription current',
        );
    }

    /** Settles the load with a status call when that's enough; false if not. */
    async #settledByStatus(worker) {
        const signal = this.#stopVerifying.signal;
        let subscription = null;
        let uuid = null;
        let synced = null;
        try {
            uuid = await this.#userUuid();
            if (!uuid) return false;
            let changed;
            let current;
            [synced, changed, current] = await Promise.all([
                idbGet(HANDLERS_STORE, SYNCED_PREFIX + uuid),
                idbGet(
                    HANDLERS_STORE,
                    SUBSCRIPTION_CHANGED_PREFIX + workerScope(worker),
                ),
                currentWebPush({ worker }),
            ]);
            const age = Date.now() - synced?.at;
            if (
                changed != null ||
                !current ||
                synced?.endpoint !== current.endpoint ||
                !(age >= 0 && age < SYNCED_FOR_MS) ||
                !(await usesPuterKey(current))
            )
                return false;
            subscription = current;
        } catch {
            return false;
        }
        this.#checkWorkerUpdate(worker);
        const answer = await webPushCheck(this.puter, subscription.endpoint);
        if (signal.aborted) return true;
        if (answer?.state === 'removed' || answer?.state === 'revoked') {
            await withPushLock(async () => {
                // Another tab's enable() since the check wins.
                const [now, record] = await Promise.all([
                    currentWebPush({ worker }),
                    idbGet(HANDLERS_STORE, SYNCED_PREFIX + uuid),
                ]).catch(() => []);
                if (
                    !now ||
                    now.endpoint !== subscription.endpoint ||
                    record?.at !== synced.at
                )
                    return;
                if (answer.state === 'removed')
                    await this.#dropRemoved(worker, now);
                else await this.#recordOptIn(false);
            });
            return true;
        }
        if (answer?.state !== 'active') return false;
        if (
            answer.publicKey !== null &&
            !(await usesPuterKey(subscription, answer.publicKey))
        )
            return false;
        this.#workerRegistered = true;
        return true;
    }

    /** Has the browser look for a newer worker script, as registering does. */
    #checkWorkerUpdate(worker) {
        try {
            void globalThis.navigator.serviceWorker
                .getRegistration(worker.scope ?? worker.url)
                .then((registration) => registration?.update())
                .catch(() => {});
        } catch {
            // No service workers here.
        }
    }

    /** Remembers the subscription the server confirmed, for the next loads. */
    async #noteSynced(worker, endpoint) {
        if (this.puter.env !== 'web') return;
        try {
            const uuid = await this.#userUuid();
            if (uuid) {
                await idbPut(HANDLERS_STORE, SYNCED_PREFIX + uuid, {
                    endpoint,
                    at: Date.now(),
                });
            }
            await idbDelete(
                HANDLERS_STORE,
                SUBSCRIPTION_CHANGED_PREFIX + workerScope(worker),
            );
        } catch {
            // The next load registers again.
        }
    }

    /** Ends a subscription left here without an opt-in, in the browser only. */
    async #endUnwanted() {
        await withPushLock(async () => {
            if ((await this.#readOptIn()) !== false) return;
            try {
                await unsubscribeWebPush(this.puter);
            } catch {
                // The next load tries again.
            }
        });
    }

    /** Settles a sync nobody waits on; quiet about the expected failures. */
    async #finishSync(syncing, worker, what) {
        try {
            await syncing;
            this.#workerRegistered = true;
        } catch (error) {
            await this.#followRefusal(error, worker);
            if (QUIET_SYNC_ERRORS.has(error?.code)) return;
            this.#reportPush(error, what);
        }
    }

    /** Pushes stay off here when the user turned them off in Puter. */
    async #followRefusal(error, worker) {
        if (error?.code === 'push_device_removed')
            await this.#dropRemoved(worker);
        else if (error?.code === 'push_revoked') await this.#recordOptIn(false);
    }

    /**
     * The user removed this browser in Puter: ends its subscription here only,
     * since the server already dropped it, and forgets the opt-in until
     * `enable()`.
     */
    async #dropRemoved(worker, subscription = null) {
        try {
            await (
                subscription ?? (await currentWebPush({ worker }))
            )?.unsubscribe();
        } catch {
            // Already gone, or the browser can't tell.
        }
        await this.#recordOptIn(false);
    }

    /** Ends this page's syncs in flight; the next `onPush` syncs again. */
    #stopSyncs() {
        this.#stopVerifying.abort();
        this.#stopVerifying = new AbortController();
        this.#syncs.clear();
    }

    /** Holds the key's handler lock for one more handler; resolves once held. */
    #holdHandlerLock(key, source) {
        this.#watchPageCache();
        let hold = this.#handlerLocks.get(key);
        if (!hold) {
            hold = { count: 0, source, lock: holdShared(handlerLock(key)) };
            this.#handlerLocks.set(key, hold);
        }
        hold.count++;
        hold.source = source;
        return hold.lock.granted;
    }

    /** Lets go of the key's handler lock with its last handler. */
    #releaseHandlerLock(key) {
        const hold = this.#handlerLocks.get(key);
        if (!hold) return Promise.resolve();
        if (--hold.count > 0) return Promise.resolve();
        this.#handlerLocks.delete(key);
        hold.lock.release();
        return hold.lock.released;
    }

    /** Browsers keep no page holding a Web Lock in the back/forward cache. */
    #watchPageCache() {
        if (this.#watchingPageCache || !globalThis.addEventListener) return;
        this.#watchingPageCache = true;
        globalThis.addEventListener('pagehide', () => {
            for (const hold of this.#handlerLocks.values()) hold.lock.release();
        });
        globalThis.addEventListener('pageshow', (event) => {
            if (!event.persisted) return;
            for (const [key, hold] of this.#handlerLocks) {
                hold.lock = holdShared(handlerLock(key));
                const { granted } = hold.lock;
                // Another tab may have removed the saved handler meanwhile.
                void this.#writeSource(key, async () => {
                    await granted;
                    await idbPut(HANDLERS_STORE, key, hold.source);
                });
            }
        });
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
        if (this.#pushHandlers.size === 0 && !this._hasListeners('dismiss')) return;
        if (this.#pushFeed || this.#stopWaitingForAuth) return;
        // A visitor who hasn't signed in yet: start once they do.
        if (needsSignIn(this.puter)) {
            this.#restartOnAuthChange();
            return;
        }
        if (this.puter.env === 'web') void this.#readOptIn();
        /** @type {Promise<{ off: () => Promise<void> } | null>} */
        const feed = (async () => {
            try {
                return await this.onNotification(
                    this.#pushListener,
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
        if (this.puter.env !== 'web' || !this.#optedIn || !pageAway() || this.#dismissed.has(notification.uid)) return;
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
                        url: tapUrl(url, await savedTapBase(scope)),
                    },
                },
            };
            if (this.#dismissed.has(notification.uid)) return;
            if (!await showThroughWorker(registration, title, options))
                await registration.showNotification(title, options);
            if (this.#dismissed.has(notification.uid)) await this._closeNotification(notification.uid);
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
            const take = () => {
                if (event.data.id !== undefined) {
                    event.source?.postMessage?.({
                        type: WORKER_CLICK_ACK_MESSAGE,
                        id: event.data.id,
                    });
                }
                this.emit('click', click);
            };
            if (event.data.kept !== true) {
                take();
                return;
            }
            // A tap the worker kept runs only if this page takes it first.
            void (async () => {
                let claimed = false;
                try {
                    claimed = !!(await takeClick(click.uid, event.data.id));
                } catch {
                    // Left to the worker, which opens it when nobody acks.
                }
                if (claimed) take();
            })();
        });
        container?.startMessages?.();

        const uid = this.#tapInUrl();
        if (!uid) return;
        const url = new URL(globalThis.location.href);
        url.searchParams.delete(CLICK_PARAM);
        globalThis.history?.replaceState?.(
            globalThis.history.state,
            '',
            url.href,
        );
        void (async () => {
            try {
                const kept = await takeClick(uid);
                const click =
                    kept?.at > Date.now() - CLICK_KEEP_MS
                        ? toClick(kept)
                        : null;
                if (click) firstHandler(click);
            } catch (error) {
                console.warn(
                    '[puter.notifications] could not read a tap',
                    error,
                );
            }
        })();
    }

    /** The tap this page was opened for, from its URL. */
    #tapInUrl() {
        try {
            return new URL(globalThis.location.href).searchParams.get(
                CLICK_PARAM,
            );
        } catch {
            return null;
        }
    }

    /** A tap that opened this page is dropped when no `click` handler reads it. */
    #dropUnreadTap() {
        const uid = this.#tapInUrl();
        if (!uid) return;
        const drop = () =>
            setTimeout(() => {
                if (!this.#listening) takeClick(uid).catch(() => {});
            }, UNREAD_TAP_MS);
        if (globalThis.document?.readyState === 'complete') drop();
        else globalThis.addEventListener?.('load', drop, { once: true });
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
