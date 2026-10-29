import { removeWebPush, webPushSupported, workerFor } from './lib/webPush.js';

/**
 * Turns push notifications off for this app in this browser: ends the browser's
 * subscription and removes it from Puter. Notifications still arrive live while
 * the app is open.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {{ serviceWorker?: string }} [options]
 * @returns {Promise<boolean>} Whether there was a subscription to remove.
 */
export async function disable(options = {}) {
    const { puter } = this;
    if (puter.env !== 'web' && puter.env !== 'gui') return false;
    if (!webPushSupported()) return false;
    return await removeWebPush(puter, {
        worker: workerFor(puter.env, options.serviceWorker),
    });
}
