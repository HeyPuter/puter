import { markNotification } from './lib/mark.js';

/**
 * Marks one of the app's notifications as shown.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {string} uid From `notify()`, `onNotification()` or a click event.
 * @returns {Promise<boolean>} Whether it was marked. False if already marked or
 *   the notification isn't visible to this app and user.
 */
export async function markShown(uid) {
    return markNotification(this.puter, 'mark_shown', uid);
}
