import { PuterJSError } from '../../lib/PuterJSError.js';
import { webPushSupported, workerFor } from './lib/webPush.js';

/** Same rule the server applies to a notification's `channel`. */
const KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

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
 * is connected and as a browser push when no page of it is visible and focused.
 *
 * The handler gets the notification and may return `{ title, body, icon, badge,
 * image, tag, url, requireInteraction, actions }` to change what a push shows.
 * On a website it is also saved for `push-sw.js`, which runs it when a push
 * arrives, so it must be self-contained (see the docs for the limits). Once
 * the user turned notifications on here with `enable()`, this keeps the
 * browser's subscription current without asking again.
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

    if (worker && webPushSupported() && Notification.permission === 'granted') {
        // Not awaited: a new subscription waits on a confirmation push.
        this._syncPushOnLoad(worker);
    }

    return listener;
}
