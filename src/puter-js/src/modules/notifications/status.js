import { webPushSupported, workerFor } from './lib/webPush.js';

/** @type {ReadonlySet<string>} */
const STATES = new Set(['on', 'off', 'blocked', 'unavailable']);

/**
 * Whether this app's push notifications reach the browser the user is in,
 * without asking anything. `off` means `enable()` can turn them on, `blocked`
 * that the browser blocks notifications, and `unavailable` that this browser,
 * page or server can't receive pushes.
 *
 * On a website, `on` means the user turned pushes on here with `enable()`, this
 * browser holds the subscription, and Puter hasn't had this browser removed or
 * the app turned off. Inside the Puter desktop it means pushes are on in this
 * browser and the app holds `notifications:push`.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {{ serviceWorker?: string }} [options]
 * @returns {Promise<import('./types.js').PushStatus>}
 */
export async function status(options = {}) {
    const { puter } = this;
    if (puter.env === 'app') {
        let state = null;
        try {
            state = await puter.ui?.pushStatus_?.();
        } catch {
            // A desktop that couldn't tell.
        }
        return STATES.has(state)
            ? /** @type {import('./types.js').PushStatus} */ (state)
            : 'unavailable';
    }
    if (puter.env !== 'web' && puter.env !== 'gui') return 'unavailable';
    if (!webPushSupported()) return 'unavailable';
    return await this._webPushStatus(
        workerFor(puter.env, options.serviceWorker),
    );
}
