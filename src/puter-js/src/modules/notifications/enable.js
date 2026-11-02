import { PuterJSError } from '../../lib/PuterJSError.js';
import { needsSignIn, signInVisitor } from '../events/lib/signIn.js';
import { webPushSupported, workerFor } from './lib/webPush.js';

/**
 * Turns on push notifications for this app in this browser. Call it from a
 * click: the browser's prompt is asked before anything else, and without the
 * click it rejects with `user_gesture_required` instead of prompting.
 *
 * Inside the Puter desktop this is `enablePush()`. On a website it asks for
 * notification permission on the site's own origin, then subscribes through the
 * site's service worker (`/puter-sw.js` unless `serviceWorker` names another)
 * and sends the subscription to Puter. It resolves then; Puter's confirmation
 * push finishes the registration in the background. It rejects with
 * `push_revoked` when the user turned the app off in Puter;
 * `requestPermission()` from a click undoes that. A browser the user removed in
 * Puter is subscribed again.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {{ serviceWorker?: string }} [options]
 * @returns {Promise<boolean>} Whether this browser now receives pushes.
 */
export async function enable(options = {}) {
    const { puter } = this;
    if (puter.env === 'app') return this.enablePush();
    if (!webPushSupported()) return false;

    if (
        Notification.permission === 'default' &&
        globalThis.navigator?.userActivation?.isActive === false
    ) {
        throw new PuterJSError(
            'enable() opens the browser`s notification prompt, so it must be called from a click',
            'user_gesture_required',
        );
    }
    // Before any await, so the click's activation covers the prompt.
    const asking =
        Notification.permission === 'default'
            ? Notification.requestPermission()
            : Promise.resolve(Notification.permission);
    if ((await asking) !== 'granted') return false;

    if (needsSignIn(puter)) await signInVisitor(puter);
    await this._enableWebPush(workerFor(puter.env, options.serviceWorker));
    return true;
}
