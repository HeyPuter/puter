/**
 * Offers to turn push notifications on in the browser the user is in. Resolves
 * whether that browser now receives pushes.
 *
 * @this {import('./index.js').NotificationsModule}
 * @returns {Promise<boolean>}
 */
export async function enablePush() {
    return (await this.puter.ui?.enablePush?.()) === true;
}
