/** The notification type an app sends and reads back. */
export const APP_MESSAGE_TYPE = 'app.message';

const stringOrNull = (value) => (typeof value === 'string' ? value : null);

/** @returns {import('../types.js').NotificationSender | null} */
const senderOf = (value) => {
    if (!value || typeof value !== 'object') return null;
    const { uid, name, icon } = /** @type {Record<string, unknown>} */ (value);
    if (typeof uid !== 'string') return null;
    return {
        uid,
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof icon === 'string' ? { icon } : {}),
    };
};

/** @returns {import('../types.js').AppNotification | null} */
export const toNotification = (event) => {
    if (!event || event.op !== 'post' || event.type !== APP_MESSAGE_TYPE)
        return null;
    if (typeof event.uid !== 'string') return null;
    const value = /** @type {Record<string, unknown>} */ (
        event.notification ?? {}
    );
    return {
        uid: event.uid,
        title: typeof value.title === 'string' ? value.title : '',
        text: stringOrNull(value.text),
        icon: stringOrNull(value.icon),
        target: stringOrNull(value.target),
        data: value.data ?? null,
        group: stringOrNull(value.group),
        channel: stringOrNull(value.channel),
        sensitive: value.sensitive === true,
        createdAt: typeof event.ts === 'number' ? event.ts : 0,
        replaced: event.replaced === true,
        app: senderOf(value.app),
    };
};

/** @returns {import('../types.js').NotificationClick | null} */
export const toClick = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const { uid, target, data } = /** @type {Record<string, unknown>} */ (
        payload
    );
    if (typeof uid !== 'string' || uid === '') return null;
    return { uid, target: stringOrNull(target), data: data ?? null };
};

/** @returns {import('../types.js').PushDevice} */
export const toDevice = (device) => ({
    uid: String(device.uid),
    platform: /** @type {import('../types.js').PushPlatform} */ (
        device.platform
    ),
    label: stringOrNull(device.label),
    userAgent: stringOrNull(device.user_agent),
    createdAt: Number(device.created_at),
    lastSeenAt: Number(device.last_seen_at),
    current: device.current === true,
});
