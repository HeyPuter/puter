import { PuterJSError } from '../../lib/PuterJSError.js';
import { needsSignIn } from '../events/lib/signIn.js';
import { HANDLERS_STORE, idbDelete, idbPut } from './lib/pushStore.js';
import { syncWebPush, webPushSupported, workerFor } from './lib/webPush.js';

/** Same rule the server applies to a notification's `channel`. */
const KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Fields a handler's result may set on the shown notification. */
const SHOWN_FIELDS = ['title', 'body', 'icon', 'badge', 'image', 'tag', 'url'];

/** The handler's result, reduced to what a notification can show. */
export const shownFrom = (notification, result) => {
    const shown = {
        title: notification.title || 'New notification',
        ...(notification.text ? { body: notification.text } : {}),
        ...(notification.icon ? { icon: notification.icon } : {}),
        tag: notification.group ?? notification.uid,
        ...(notification.target ? { url: notification.target } : {}),
    };
    if (!result || typeof result !== 'object') return shown;
    for (const field of SHOWN_FIELDS) {
        if (typeof result[field] === 'string' && result[field] !== '')
            shown[field] = result[field];
    }
    return shown;
};

/** Sync failures that are the server's or the user's standing choice, not a fault. */
const QUIET_SYNC_ERRORS = new Set(['push_unavailable', 'push_revoked']);

const report = (onError, error) => {
    if (onError) onError(error);
    else console.error('[puter.notifications] push handler failed', error);
};

/**
 * Handles this app's notifications sent with `channel: key`, live while the app
 * is connected and as a browser push while it isn't.
 *
 * The handler gets the notification and may return `{ title, body, icon, badge,
 * image, tag, url }` to change what is shown. On a website it is also saved for
 * `push-sw.js`, which runs it when a push arrives with no page open, so it must
 * be self-contained (see the docs for the limits). Once the user turned
 * notifications on with `enable()`, this keeps the browser's subscription
 * current without asking again.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {string} key
 * @param {import('./types.js').PushHandler} handler
 * @param {import('./types.js').OnPushOptions} [options]
 * @returns {Promise<import('./types.js').NotificationListener>}
 */
export async function onPush(key, handler, options = {}) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
        throw new PuterJSError(
            '`key` must be 1 to 32 lowercase letters, digits or -',
            'invalid_argument',
        );
    }
    if (typeof handler !== 'function') {
        throw new PuterJSError('handler must be a function', 'invalid_handler');
    }

    const { puter } = this;
    const web = puter.env === 'web';
    if (web) await idbPut(HANDLERS_STORE, key, handler.toString());

    const off = await this._addPushHandler(key, handler, options.onError);

    if (
        web &&
        !needsSignIn(puter) &&
        webPushSupported() &&
        Notification.permission === 'granted'
    ) {
        const worker = workerFor(puter.env, options.serviceWorker);
        const sync = async () => {
            try {
                await syncWebPush(puter, { worker });
            } catch (error) {
                // Nothing a page load can do about these; `enable()` reports them from a click.
                if (QUIET_SYNC_ERRORS.has(error?.code)) return;
                report(options.onError, error);
            }
        };
        // Not awaited: a new subscription waits on a confirmation push.
        void sync();
        this._resyncOnSubscriptionChange(sync);
    }

    return {
        off: async () => {
            const lastForKey = await off();
            if (web && lastForKey) await idbDelete(HANDLERS_STORE, key);
        },
    };
}
