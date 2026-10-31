import { PuterJSError } from '../../lib/PuterJSError.js';
import { needsSignIn } from '../events/lib/signIn.js';
import { webPushSupported, workerFor } from './lib/webPush.js';

/** Same rule the server applies to a notification's `channel`. */
const KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Fields a handler's result may set on the shown notification. */
const SHOWN_FIELDS = ['title', 'body', 'icon', 'badge', 'image', 'tag', 'url'];

const DEFAULT_TITLE = 'New notification';

/** The tag the server gives the same notification's push. */
export const pushTag = (notification) => {
    const appUid = notification.app?.uid;
    return notification.group && appUid && !notification.sensitive
        ? `${appUid}:${notification.group}`
        : notification.uid;
};

/**
 * The handler's result, reduced to what a notification can show. A sensitive
 * notification names only the app, as its push does, whatever the handler
 * returns.
 */
export const shownFrom = (notification, result) => {
    const appIcon = notification.app?.icon;
    if (notification.sensitive) {
        const name = notification.app?.name;
        return {
            title: name || DEFAULT_TITLE,
            ...(name ? { body: `New notification from ${name}` } : {}),
            ...(appIcon ? { icon: appIcon } : {}),
            tag: notification.uid,
        };
    }
    const icon = notification.icon ?? appIcon;
    const shown = {
        title: notification.title || DEFAULT_TITLE,
        ...(notification.text ? { body: notification.text } : {}),
        ...(icon ? { icon } : {}),
        tag: pushTag(notification),
        ...(notification.target ? { url: notification.target } : {}),
    };
    if (!result || typeof result !== 'object') return shown;
    for (const field of SHOWN_FIELDS) {
        if (typeof result[field] === 'string' && result[field] !== '')
            shown[field] = result[field];
    }
    return shown;
};

let evalBlockedWarned = false;

/**
 * The handler's source, checked the way `push-sw.js` rebuilds it. A page whose
 * CSP blocks eval can't check it, so there it is taken as written.
 */
const workerSource = (handler) => {
    const source = Function.prototype.toString.call(handler);
    let rebuilt = null;
    try {
        rebuilt = new Function(`"use strict"; return (${source});`)();
    } catch (error) {
        if (error instanceof EvalError) {
            if (!evalBlockedWarned) {
                evalBlockedWarned = true;
                console.warn(
                    '[puter.notifications] this page blocks eval, so onPush() cannot check that its handler runs in the service worker',
                );
            }
            return source;
        }
    }
    if (typeof rebuilt !== 'function') {
        throw new PuterJSError(
            'The handler is saved as source code for the service worker, so it must be a function or arrow function written out in full, not a method, bound or built-in function',
            'invalid_handler',
        );
    }
    return source;
};

/**
 * Handles this app's notifications sent with `channel: key`, live while the app
 * is connected and as a browser push while it isn't.
 *
 * The handler gets the notification and may return `{ title, body, icon, badge,
 * image, tag, url }` to change what is shown. On a website it is also saved for
 * `push-sw.js`, which runs it when a push arrives with no page open, so it must
 * be self-contained (see the docs for the limits). Once the user turned
 * notifications on here with `enable()`, this keeps the browser's subscription
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
    const source = web ? workerSource(handler) : null;
    const worker = web ? workerFor(puter.env, options.serviceWorker) : null;

    const listener = await this._addPushHandler(key, handler, {
        onError: options.onError,
        source,
        worker,
    });

    if (
        worker &&
        !needsSignIn(puter) &&
        webPushSupported() &&
        Notification.permission === 'granted'
    ) {
        // Not awaited: a new subscription waits on a confirmation push.
        this._syncPushOnLoad(worker);
    }

    return listener;
}
