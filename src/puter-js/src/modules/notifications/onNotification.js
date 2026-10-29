import { PuterJSError } from '../../lib/PuterJSError.js';
import { needsSignIn, signInVisitor } from '../events/lib/signIn.js';
import { NotificationFeed } from './lib/feed.js';

/**
 * Calls `handler` once per notification of this app: the ones it already has,
 * then each new one. Needs an app token and events turned on on the server.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {import('./types.js').NotificationHandler} handler
 * @param {import('./types.js').OnNotificationOptions} [options]
 * @returns {Promise<import('./types.js').NotificationListener>}
 */
export async function onNotification(handler, options = {}) {
    if (typeof handler !== 'function') {
        throw new PuterJSError('handler must be a function', 'invalid_handler');
    }
    if (options.since !== undefined && typeof options.since !== 'number') {
        throw new PuterJSError('`since` must be a number', 'invalid_argument');
    }

    if (needsSignIn(this.puter)) await signInVisitor(this.puter);
    if (!this.puter.getAppIDFromAuthToken?.(this.puter.authToken)) {
        throw new PuterJSError(
            "onNotification() reads an app's notifications, so it needs an app token",
            'app_required',
        );
    }

    const feed = new NotificationFeed(this.puter, handler, options, (uid) =>
        this._noteReceived(uid),
    );
    await feed.start();
    return { off: () => feed.off() };
}
