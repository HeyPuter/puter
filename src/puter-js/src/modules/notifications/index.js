import EventListener from '../../lib/EventListener.js';
import { needsSignIn } from '../events/lib/signIn.js';
import { disable } from './disable.js';
import { enable } from './enable.js';
import { enablePush } from './enablePush.js';
import { CLICKS_STORE, idbDelete, idbGet } from './lib/pushStore.js';
import { ReceiptLog } from './lib/receipts.js';
import { toClick } from './lib/shapes.js';
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
/** What a worker posts when the browser replaced the push subscription. */
export const SUBSCRIPTION_CHANGED_MESSAGE = 'puter-push-subscription-changed';
/** Query parameter `push-sw.js` adds to a page it opens for a tap. */
export const CLICK_PARAM = 'puter.notification';

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
    /** @type {(() => Promise<void>) | null} */
    #resync = null;
    #receipts = new ReceiptLog();

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
     * @internal `onPush`'s live side: one notifications feed for every key.
     * Resolves `off`, which resolves whether `key` has no handlers left.
     */
    async _addPushHandler(key, handler, onError) {
        const entry = { handler, onError };
        const entries = this.#pushHandlers.get(key) ?? new Set();
        entries.add(entry);
        this.#pushHandlers.set(key, entries);
        this.#startPushFeed();
        return async () => {
            entries.delete(entry);
            if (entries.size === 0 && this.#pushHandlers.get(key) === entries)
                this.#pushHandlers.delete(key);
            if (this.#pushHandlers.size === 0) await this.#stopPushFeed();
            return !this.#pushHandlers.has(key);
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

    /** @internal Registers again when the worker reports a replaced subscription. */
    _resyncOnSubscriptionChange(sync) {
        const listening = this.#resync !== null;
        this.#resync = sync;
        if (listening) return;
        globalThis.navigator?.serviceWorker?.addEventListener(
            'message',
            (event) => {
                if (event.data?.type !== SUBSCRIPTION_CHANGED_MESSAGE) return;
                if (this.#pushHandlers.size > 0) void this.#resync?.();
            },
        );
    }

    #startPushFeed() {
        if (this.#pushFeed || this.#stopWaitingForAuth) return;
        // A visitor who hasn't signed in yet: start once they do.
        if (needsSignIn(this.puter)) {
            this.#stopWaitingForAuth = this.puter.onAuthStateChanged(() => {
                if (needsSignIn(this.puter)) return;
                this.#stopWaitingForAuth?.();
                this.#stopWaitingForAuth = null;
                this.#startPushFeed();
            });
            return;
        }
        const onError = (error) => this.#reportPush(error);
        this.#pushFeed = (async () => {
            try {
                return await this.onNotification(
                    (notification) => this.#dispatchPush(notification),
                    { catchUp: false, onError },
                );
            } catch (error) {
                onError(error);
                this.#pushFeed = null;
                return null;
            }
        })();
    }

    async #stopPushFeed() {
        this.#stopWaitingForAuth?.();
        this.#stopWaitingForAuth = null;
        const feed = this.#pushFeed;
        this.#pushFeed = null;
        await (await feed)?.off();
    }

    #reportPush(error) {
        const handlers = [...this.#pushHandlers.values()].flatMap((set) =>
            [...set].map((entry) => entry.onError).filter(Boolean),
        );
        if (handlers.length === 0)
            console.error('[puter.notifications] push listener failed', error);
        for (const onError of new Set(handlers)) onError(error);
    }

    async #dispatchPush(notification) {
        const entries = this.#pushHandlers.get(notification.channel ?? '');
        if (!entries) return;
        let result;
        for (const { handler, onError } of [...entries]) {
            try {
                result = (await handler(notification)) ?? result;
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
     * push would have. Inside the Puter desktop, the desktop's banner shows
     * it.
     */
    async #showIfAway(notification, result) {
        if (this.puter.env !== 'web') return;
        const doc = globalThis.document;
        const away =
            doc?.visibilityState === 'hidden' || doc?.hasFocus?.() === false;
        if (!away) return;
        if (globalThis.Notification?.permission !== 'granted') return;
        try {
            const registration =
                await globalThis.navigator.serviceWorker?.getRegistration();
            if (!registration) return;
            const shown = shownFrom(notification, result);
            const origin = globalThis.location.origin;
            const url = new URL(shown.url ?? '/', origin);
            const { title, url: _url, ...options } = shown;
            await registration.showNotification(title, {
                ...options,
                data: {
                    puter: {
                        uid: notification.uid,
                        target: notification.target,
                        data: notification.data,
                        url: url.origin === origin ? url.href : `${origin}/`,
                    },
                },
            });
        } catch (error) {
            console.warn(
                '[puter.notifications] could not show a notification',
                error,
            );
        }
    }

    /**
     * Taps from `push-sw.js`: posted to an open page, or carried by the URL of
     * one it opened.
     */
    #listenForWorkerClicks(firstHandler) {
        const container = globalThis.navigator?.serviceWorker;
        container?.addEventListener('message', (event) => {
            if (event.data?.type !== WORKER_CLICK_MESSAGE) return;
            const click = toClick(event.data.notification);
            if (click) this.emit('click', click);
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
