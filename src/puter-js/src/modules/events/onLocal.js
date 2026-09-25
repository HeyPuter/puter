import { assertHandler, assertSubject } from './lib/validate.js';

/** @typedef {import('./lib/subscription.js').EventSubscription} EventSubscription */
/** @typedef {import('./types.js').EventHandler} EventHandler */
/** @typedef {import('./types.js').OnLocalOptions} OnLocalOptions */

/**
 * Subscribes to a subject for as long as this client is connected.
 *
 * The subscription belongs to the connection, not to the account: it is not
 * stored anywhere and nothing runs while the page is closed. Every
 * subscription this client makes shares one connection, which opens on the
 * first `onLocal()` and closes when the last subscription is ended.
 *
 * The handler is called with `{ event }` for every matching change, and with a
 * gap marker (`event.op === 'gap'`) in place of events that were dropped
 * against a limit.
 *
 * @this {import('./index.js').EventsModule}
 * @param {string} subject The subject to watch, e.g. `fs:~/Documents` or
 *   `fs:~/Documents/inbox.txt:write`.
 * @param {EventHandler} handler Called with `{ event }` per delivery.
 * @param {OnLocalOptions} [options]
 * @returns {Promise<EventSubscription>} Resolves once the server has confirmed
 *   the subscription.
 */
export async function onLocal (subject, handler, options = {}) {
    assertSubject(subject);
    assertHandler(handler);

    return await this.channel.subscribe(subject, handler, options);
}
