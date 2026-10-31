/** The permission that lets an app's notifications go out as pushes. */
export const PUSH_PERMISSION = 'notifications:push';

/**
 * Asks the user to let this app send pushes. Resolves whether it may.
 *
 * @this {import('./index.js').NotificationsModule}
 * @returns {Promise<boolean>}
 */
export async function requestPermission() {
    return (await this.puter.perms.request(PUSH_PERMISSION)) === true;
}

/**
 * Whether this app may send pushes. Always `true` for a session with no app.
 *
 * @this {import('./index.js').NotificationsModule}
 * @returns {Promise<boolean>}
 */
export async function hasPermission() {
    return (await this.puter.perms.check(PUSH_PERMISSION)) === true;
}
