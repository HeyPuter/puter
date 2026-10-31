import { webPushSupported, workerFor } from './lib/webPush.js';

/**
 * Turns push notifications off for this app in this browser: ends the browser's
 * subscription and removes it from Puter. Notifications still arrive live while
 * the app is open. On a website, `onPush()` stops renewing the subscription
 * until `enable()` is called again.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {{ serviceWorker?: string }} [options]
 * @returns {Promise<boolean>} Whether there was a subscription to remove.
 */
export async function disable(options = {}) {
    const { puter } = this;
    if (puter.env !== 'web' && puter.env !== 'gui') return false;
    if (!webPushSupported()) return false;
    return await this._disableWebPush(
        workerFor(puter.env, options.serviceWorker),
    );
}
