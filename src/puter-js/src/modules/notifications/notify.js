import { driverCall } from '../../lib/networkUtils.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { APP_MESSAGE_TYPE } from './lib/shapes.js';

// A driver failure arrives flat or nested under `error`.
const toError = (error) => {
    const nested = /** @type {{ error?: unknown } | null} */ (error)?.error;
    if (nested && typeof nested === 'object') return PuterJSError.from(nested);
    return PuterJSError.from(error);
};

/**
 * @overload
 * @param {import('./types.js').NotificationInput & { to?: undefined }} notification
 * @returns {Promise<string>} The notification's uid; on a replacement, the uid
 *   of the notification it replaced.
 */
/**
 * @overload
 * @param {import('./types.js').ShareNotificationInput} notification
 * @returns {Promise<void>} Nothing, so the call says nothing about the
 *   recipient's notifications.
 */
/**
 * Sends the user this app runs for a notification, or with `to` the other party
 * of a KV share. Only an app can send one.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {import('./types.js').NotificationInput
 *     | import('./types.js').ShareNotificationInput} notification
 * @returns {Promise<string | void>}
 */
export async function notify(notification) {
    if (
        !notification ||
        typeof notification !== 'object' ||
        Array.isArray(notification)
    ) {
        throw new PuterJSError(
            'notification must be an object',
            'invalid_argument',
        );
    }
    if (
        typeof notification.title !== 'string' ||
        notification.title.trim() === ''
    ) {
        throw new PuterJSError('`title` is required', 'invalid_argument');
    }

    /** @type {Record<string, unknown>} */
    const value = {};
    for (const [key, field] of Object.entries(notification)) {
        if (field !== undefined) value[key] = field;
    }
    value.type = APP_MESSAGE_TYPE;

    let created;
    try {
        created = /** @type {{ uid?: unknown } | null} */ (
            await driverCall({
                puter: this.puter,
                iface: 'puter-notifications',
                driver: 'es:notification',
                method: 'create',
                args: { object: { value } },
            })
        );
    } catch (error) {
        throw toError(error);
    }

    // A notification to someone else answers with nothing about it.
    if (value.to !== undefined) return;
    if (typeof created?.uid !== 'string') {
        throw new PuterJSError(
            'The server did not return the notification',
            'notifications_failed',
        );
    }
    return created.uid;
}
