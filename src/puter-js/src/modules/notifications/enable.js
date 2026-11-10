import { PuterJSError } from '../../lib/PuterJSError.js';
import PuterDialog from '../PuterDialog.js';
import { needsSignIn, signInVisitor } from '../events/lib/signIn.js';
import { webPushSupported, workerFor } from './lib/webPush.js';

/** The browser's answer still being asked for, shared by calls made meanwhile. */
let asking = null;

const gestureRequired = () =>
    new PuterJSError(
        'enable() opens the browser`s notification prompt, so it must be called from a click',
        'user_gesture_required',
    );

/** The browser's answer, asked from the Continue click of Puter's dialog. */
const askInDialog = () =>
    new Promise((resolve, reject) => {
        /** @type {PuterDialog | null} */
        let dialog = null;
        const answer = (permission) => {
            dialog?.remove();
            resolve(permission);
        };
        try {
            dialog = PuterDialog.show({
                message: 'This website wants to send you notifications.',
                onContinue: () => {
                    Notification.requestPermission().then(answer, () =>
                        answer('default'),
                    );
                },
                onCancel: () => answer('default'),
            });
        } catch {
            reject(gestureRequired());
        }
    });

/**
 * Asks the browser for notification permission; the prompt opens before this
 * returns while the caller's click is still active. Without that activation,
 * browsers refuse to prompt, so a website asks from Puter's dialog instead.
 *
 * @param {string} env
 * @returns {Promise<NotificationPermission>}
 */
const askBrowser = (env) => {
    if (Notification.permission !== 'default')
        return Promise.resolve(Notification.permission);
    if (asking) return asking;
    let ask;
    if (globalThis.navigator?.userActivation?.isActive !== false)
        ask = Notification.requestPermission();
    else if (env === 'web') ask = askInDialog();
    else throw gestureRequired();
    asking = ask.finally(() => {
        asking = null;
    });
    return asking;
};

/**
 * Turns on push notifications for this app in this browser. Call it from a
 * click: the browser's prompt is asked before anything else. On a website
 * called without the click's activation, such as after a sign-in window or
 * slow work in the same click, it shows Puter's dialog first and asks from its
 * Continue click.
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

    if ((await askBrowser(puter.env)) !== 'granted') return false;

    if (needsSignIn(puter)) await signInVisitor(puter);
    await this._enableWebPush(workerFor(puter.env, options.serviceWorker));
    return true;
}
