// Shapes shared across the `puter.notifications` surface. JSDoc-only; no runtime exports.

/**
 * What an app sends with `notify()`. Only `title` is required.
 *
 * @typedef {Object} NotificationInput
 * @property {string} title Up to 120 characters, on one line.
 * @property {string} [text] Up to 240 characters. Newlines are kept.
 * @property {string} [icon] An `https` URL. The app's own icon is shown without
 *   one.
 * @property {string} [target] A path inside the app, starting with `/`, such as
 *   `/chats/42`. Handed back to the app when the user clicks the notification.
 * @property {unknown} [data] Any JSON value up to 1 KB, handed back to the app
 *   on click. Push providers can read it, so keep it to IDs.
 * @property {string} [group] A newer notification with the same group replaces
 *   the one showing and alerts again. Letters, digits and `. _ : -`.
 * @property {string} [channel] The kind of notification, such as `messages`.
 *   Lowercase letters, digits and `-`.
 * @property {boolean} [sensitive] Pushes show a generic line instead of the
 *   title and text.
 * @property {'normal'} [priority] Only `'normal'` is available to apps.
 * @property {number} [ttl] Seconds a push may wait for an offline device, 1 to
 *   86400. Default 3600.
 */

/**
 * The app that sent a notification, as the server records it.
 *
 * @typedef {Object} NotificationSender
 * @property {string} uid
 * @property {string} [name]
 * @property {string} [icon]
 */

/**
 * One of the app's notifications, as `onNotification()` hands it over. Fields
 * the notification was sent without are `null`.
 *
 * @typedef {Object} AppNotification
 * @property {string} uid The notification's uid. The same on every delivery of
 *   it, live or caught up.
 * @property {string} title
 * @property {string | null} text
 * @property {string | null} icon
 * @property {string | null} target
 * @property {unknown} data
 * @property {string | null} group
 * @property {string | null} channel
 * @property {boolean} sensitive Sent with `sensitive: true`; its push and the
 *   notification the page shows for it name only the app.
 * @property {number} createdAt Milliseconds since the epoch.
 * @property {NotificationSender | null} app
 */

/**
 * Called once per notification.
 *
 * @typedef {(notification: AppNotification) => unknown} NotificationHandler
 */

/**
 * Options for {@link import('./onNotification.js').onNotification}.
 *
 * @typedef {Object} OnNotificationOptions
 * @property {boolean} [catchUp] Also deliver the notifications the app already
 *   has, oldest first, before live ones. Default `true`.
 * @property {number} [since] Milliseconds since the epoch. Notifications read
 *   back, not live ones, are delivered only if created in or after this
 *   second.
 * @property {(error: Error & { code?: string }) => void} [onError] Called when
 *   the listener stops on its own: the connection could not be restored,
 *   reading what was missed after a reconnect failed, or the token changed
 *   (`auth_changed`). Nothing is delivered after it. Also called, without
 *   stopping, with `catch_up_truncated` if a read had to stop early. Without
 *   it, errors are reported on the console.
 */

/**
 * What `onNotification()` resolves to.
 *
 * @typedef {Object} NotificationListener
 * @property {() => Promise<void>} off Stops delivering. Safe to call more than
 *   once.
 */

/**
 * What a click handler receives, for a push the user clicked.
 *
 * @typedef {Object} NotificationClick
 * @property {string} uid The notification's uid.
 * @property {string | null} target The `target` it was sent with.
 * @property {unknown} data The `data` it was sent with, or `null`.
 */

/**
 * What a push handler may return to change the shown notification. `url` is a
 * path or URL on the app's own origin, opened when it is tapped.
 *
 * @typedef {Object} PushShown
 * @property {string} [title]
 * @property {string} [body]
 * @property {string} [icon]
 * @property {string} [badge]
 * @property {string} [image]
 * @property {string} [tag]
 * @property {string} [url]
 */

/**
 * Called for each notification sent with the handler's key. It runs in the page
 * while the app is connected and, on websites, in the service worker when a
 * push arrives: it must be self-contained there (no outside variables or
 * imports), finish within 5 seconds, and not touch the DOM.
 *
 * @typedef {(
 *     notification: AppNotification,
 * ) => PushShown | void | Promise<PushShown | void>} PushHandler
 */

/**
 * Options for {@link import('./onPush.js').onPush}.
 *
 * @typedef {Object} OnPushOptions
 * @property {string} [serviceWorker] Path of the app's worker that imports
 *   `push-sw.js`. Default `/puter-sw.js`.
 * @property {(error: Error & { code?: string }) => void} [onError] Called when
 *   the handler throws or runs past 5 seconds (`push_handler_timeout`), the
 *   live listener stops, keeping the browser's subscription current fails, or
 *   the confirmation push after `enable()` doesn't arrive
 *   (`push_verification_timeout`).
 */

/** @typedef {'webpush' | 'web'} PushPlatform `web` gets no pushes. */

/**
 * A device registered for push notifications.
 *
 * @typedef {Object} PushDevice
 * @property {string} uid
 * @property {PushPlatform} platform
 * @property {string | null} label
 * @property {string | null} userAgent
 * @property {number} createdAt Unix seconds.
 * @property {number} lastSeenAt Unix seconds.
 * @property {boolean} current Registered from the session making the call.
 */
