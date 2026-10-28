import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';
import { prepareHandler, serializeContext } from './lib/handlerSource.js';
import { assertSubject } from './lib/validate.js';
import { resolveSubject } from './lib/resolveSubject.js';

/** @typedef {import('./types.js').OnPersistentOptions} OnPersistentOptions */
/** @typedef {import('./types.js').PersistentSubscription} PersistentSubscription */

/**
 * Subscribes to a subject with a subscription that outlives this connection.
 *
 * Unlike `onLocal()`, the subscription is stored against the account, keeps
 * matching while the app is closed, and is ended by
 * `puter.events.unsubscribe()` rather than by navigating away. Each event runs
 * the app's published handler, named by `handlerName`, in its events worker,
 * and is also sent to every connected client. With `single`, each event goes
 * to exactly one consumer instead.
 *
 * Passing a function as `handler` also runs it in this client for each
 * delivery it receives: the same body, the same `{ event, ctx }`, plus `user`,
 * `fetch` and — for a `single` subscription — `ack`.
 *
 * `context` is evaluated **here, now** — serialized once and delivered to every
 * invocation as a frozen `ctx`. It never re-evaluates, so a value read from the
 * environment is the value that subscription carries forever.
 *
 * On a website with nobody signed in, opens the sign-in first; rejects
 * `auth_canceled` if the visitor closes it.
 *
 * @this {import('./index.js').EventsModule}
 * @param {OnPersistentOptions} options
 * @returns {Promise<PersistentSubscription>}
 */
export async function onPersistent (options = {}) {
    const { puter } = this;
    assertSubject(options?.subject);
    const subject = resolveSubject(options.subject, puter);
    const { handler, handlerName } = options;
    // An inline handler is source the server has to match against something it
    // already has, and a name is the only thing it can match against.
    if ( handler !== undefined && handler !== null && ! handlerName ) {
        throw new PuterJSError(
            'An inline `handler` needs a `handlerName` to publish it under',
            'events_handler_name_required',
        );
    }
    // A `single` delivery is owed to exactly one consumer, and the handler is
    // the only one always there to take it.
    if ( (options.single === true || options.delivery === 'single') && ! handlerName ) {
        throw new PuterJSError(
            'A `single` subscription needs a `handlerName`',
            'events_handler_required',
        );
    }

    const inline = handler === undefined || handler === null
        ? null
        : await prepareHandler(puter, handler);

    const body = {
        subject,
        ...(typeof options.single === 'boolean' ? { single: options.single } : {}),
        ...(options.delivery ? { delivery: options.delivery } : {}),
        ...(handlerName ? { handlerName } : {}),
        ...(inline ? { handlerHash: inline.hash } : {}),
        ...(options.expiresAt !== undefined && options.expiresAt !== null
            ? { expiresAt: options.expiresAt }
            : {}),
        ...(options.includeValue ? { includeValue: true } : {}),
    };

    // Serialized only to check it against the cap before the round trip; the
    // request carries the value, which the server stores the same way.
    if ( serializeContext(options.context) !== undefined )
        body.context = options.context;

    const sub = /** @type {PersistentSubscription} */ (
        await request(puter, '/events/subscribe', body)
    );

    // Durable ids are the server's and survive every reconnect, so routing is
    // registered once and never re-subscribed.
    if ( typeof handler === 'function' && typeof sub?.subId === 'string' ) {
        this.channel.registerDurable(sub.subId, handler, options.context, options.onError);
    }

    // `unsubscribe()` deregisters routing here too, so `off()` is just that.
    sub.off = async () => this.unsubscribe(sub.subId);
    return sub;
}
