import { PuterJSError } from '../../lib/PuterJSError.js';
import { NotificationFeed } from './lib/feed.js';

/**
 * Calls `handler` once per notification of this app: the ones it already has,
 * then each new one. Needs events turned on on the server.
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

    const feed = new NotificationFeed(this.puter, handler, options);
    await feed.start();
    return { off: () => feed.off() };
}
