import { needsSignIn, signInVisitor } from '../events/lib/signIn.js';
import { syncWebPush, webPushSupported, workerFor } from './lib/webPush.js';

/**
 * Turns on push notifications for this app in this browser. Call it from a
 * click: the browser's prompt is asked before anything else.
 *
 * Inside the Puter desktop this is `enablePush()`. On a website it asks for
 * notification permission on the site's own origin, then subscribes through the
 * site's service worker (`/puter-sw.js` unless `serviceWorker` names another)
 * and confirms the subscription with Puter.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {{ serviceWorker?: string }} [options]
 * @returns {Promise<boolean>} Whether this browser now receives pushes.
 */
export async function enable(options = {}) {
    const { puter } = this;
    if (puter.env === 'app') return this.enablePush();
    if (!webPushSupported()) return false;

    // Before any await, so the click's activation covers the prompt.
    const asking =
        Notification.permission === 'default'
            ? Notification.requestPermission()
            : Promise.resolve(Notification.permission);
    if ((await asking) !== 'granted') return false;

    if (needsSignIn(puter)) await signInVisitor(puter);
    const worker = workerFor(puter.env, options.serviceWorker);
    try {
        await syncWebPush(puter, { worker });
    } catch (error) {
        // The user turned this app off in Puter; only Puter's prompt undoes it.
        if (error?.code !== 'push_revoked') throw error;
        if (!(await this.requestPermission())) return false;
        await syncWebPush(puter, { worker });
    }
    return true;
}
