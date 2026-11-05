import { markNotification } from './lib/mark.js';

/**
 * Marks one of the app's notifications as dismissed.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {string} uid From `notify()`, `onNotification()` or a click event.
 * @returns {Promise<boolean>} Whether it was marked. False if already marked or
 *   the notification isn't visible to this app and user.
 */
export async function dismiss(uid) {
    const marked = await markNotification(this.puter, 'mark_acknowledged', uid);
    if (marked) await this._receiveDismissal(uid);
    else await this._closeNotification(uid);
    return marked;
}
