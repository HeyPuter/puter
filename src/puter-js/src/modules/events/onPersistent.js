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
 * and is also sent to every connected client. With `queue`, each event goes
 * to exactly one consumer instead.
 *
 * With a `handler` and no `handlerName`, the source is sent and stored in the
 * signed-in user's own scope, and runs for this user's events only.
 *
 * Passing a function as `handler` also runs it in this client for each
 * delivery it receives: the same body, the same `{ event, ctx }`, plus `user`,
 * `fetch` and — for a `queue` subscription — `ack`.
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
    const hasHandler = handler !== undefined && handler !== null;
    // A queued delivery is owed to exactly one consumer, and the handler is
    // the only one always there to take it.
    if ( (options.queue === true || options.delivery === 'single') && ! handlerName && ! hasHandler ) {
        throw new PuterJSError(
            'A `queue` subscription needs a `handlerName` or an inline `handler`',
            'events_handler_required',
        );
    }

    const inline = hasHandler ? await prepareHandler(puter, handler) : null;

    const body = {
        subject,
        ...(typeof options.queue === 'boolean' ? { queue: options.queue } : {}),
        ...(options.delivery ? { delivery: options.delivery } : {}),
        ...(handlerName ? { handlerName } : {}),
        ...(options.handlerScope ? { handlerScope: options.handlerScope } : {}),
        // Named: the hash checks it against what is published. Unnamed: the
        // source itself, which the server stores under its own hash.
        ...(inline && handlerName ? { handlerHash: inline.hash } : {}),
        ...(inline && ! handlerName ? { handlerSource: inline.source } : {}),
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
