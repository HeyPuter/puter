import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';
import { prepareHandler, serializeContext } from './lib/handlerSource.js';
import { assertSubject } from './lib/validate.js';

/** @typedef {import('./types.js').OnPersistentOptions} OnPersistentOptions */
/** @typedef {import('./types.js').PersistentSubscription} PersistentSubscription */

/**
 * Subscribes to a subject with a subscription that outlives this connection.
 *
 * Unlike `onLocal()`, nothing about this lives in the page: the subscription is
 * stored against the account, keeps matching while the app is closed, and is
 * ended by `puter.events.unsubscribe()` rather than by navigating away. What
 * runs is the app's published handler, named by `handlerName`.
 *
 * `context` is evaluated **here, now** — serialized once and delivered to every
 * invocation as a frozen `ctx`. It never re-evaluates, so a value read from the
 * environment is the value that subscription carries forever.
 *
 * @this {import('./index.js').EventsModule}
 * @param {OnPersistentOptions} options
 * @returns {Promise<PersistentSubscription>}
 */
export async function onPersistent (options = {}) {
    const { puter } = this;
    assertSubject(options?.subject);

    const { handler, handlerName } = options;
    // An inline handler is source the server has to match against something it
    // already has, and a name is the only thing it can match against.
    if ( handler !== undefined && handler !== null && ! handlerName ) {
        throw new PuterJSError(
            'An inline `handler` needs a `handlerName` to publish it under',
            'events_handler_name_required',
        );
    }

    const inline = handler === undefined || handler === null
        ? null
        : await prepareHandler(puter, handler);

    const body = {
        subject: options.subject,
        ...(options.delivery ? { delivery: options.delivery } : {}),
        ...(options.targets ? { targets: options.targets } : {}),
        ...(handlerName ? { handlerName } : {}),
        ...(inline ? { handlerHash: inline.hash } : {}),
        ...(options.expiresAt !== undefined && options.expiresAt !== null
            ? { expiresAt: options.expiresAt }
            : {}),
    };

    // Serialized only to check it against the cap before the round trip; the
    // request carries the value, which the server stores the same way.
    if ( serializeContext(options.context) !== undefined )
        body.context = options.context;

    return /** @type {PersistentSubscription} */ (
        await request(puter, '/events/subscribe', body)
    );
}
