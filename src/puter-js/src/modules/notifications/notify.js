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
 * What the server answers a create with: the written notification, or the send
 * it stored for later.
 *
 * @typedef {{
 *     uid?: unknown;
 *     scheduled?: import('./types.js').ScheduledNotification;
 * }} CreateAnswer
 */

/**
 * @overload
 * @param {(
 *     | import('./types.js').NotificationInput
 *     | import('./types.js').ShareNotificationInput
 * ) &
 *     import('./types.js').DelayedNotificationOptions} notification
 * @returns {Promise<
 *     import('./types.js').ScheduledNotification | string | void
 * >}
 *   The stored send. When `sendAt` is within 5 seconds or past, the notification
 *   is sent at once and this resolves as it would without it.
 */
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
 * of a KV share. Only an app can send one. With `sendAt` it is stored and sent
 * then; `cancel()` takes it back before it goes.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {(
 *     | import('./types.js').NotificationInput
 *     | import('./types.js').ShareNotificationInput
 * ) &
 *     Partial<import('./types.js').DelayedNotificationOptions>} notification
 * @returns {Promise<
 *     import('./types.js').ScheduledNotification | string | void
 * >}
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
    if (value.sendAt instanceof Date) {
        if (!Number.isFinite(value.sendAt.getTime())) {
            throw new PuterJSError(
                '`sendAt` is not a valid date',
                'events_schedule_invalid',
            );
        }
        value.sendAt = value.sendAt.toISOString();
    }

    let created;
    try {
        created = /** @type {CreateAnswer | null} */ (
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

    if (created?.scheduled) {
        const { scheduleId, sendAt } = created.scheduled;
        return { scheduleId, sendAt };
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
