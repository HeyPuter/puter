import { webPushSupported, workerFor } from './lib/webPush.js';

/**
 * Turns push notifications off for this app. Notifications still arrive live
 * while the app is open.
 *
 * On a website it ends this browser's subscription, removes it from Puter, and
 * stops this site's pages here from showing notifications themselves.
 * `onPush()` stops renewing the subscription until `enable()` is called again.
 * Inside the Puter desktop it revokes the app's `notifications:push` permission
 * for the user, so its notifications stop going out as pushes to any device,
 * and a later `enable()` asks for the permission again.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {{ serviceWorker?: string }} [options]
 * @returns {Promise<boolean>} On a website, whether there was a subscription to
 *   remove. Inside the desktop, whether the app held the permission.
 */
export async function disable(options = {}) {
    const { puter } = this;
    if (puter.env === 'app') return (await puter.ui?.disablePush_?.()) === true;
    if (puter.env !== 'web' && puter.env !== 'gui') return false;
    if (!webPushSupported()) return false;
    return await this._disableWebPush(
        workerFor(puter.env, options.serviceWorker),
    );
}
