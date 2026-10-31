import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';
import { serializeContext } from './lib/handlerSource.js';

/** @typedef {import('./types.js').PersistentSubscription} PersistentSubscription */
/** @typedef {import('./types.js').UpdatePersistentOptions} UpdatePersistentOptions */

/**
 * Changes a persistent subscription in place. Its `subId`, its undelivered
 * backlog and its handler binding are kept, and the next delivery runs with the
 * new `context`. A function `handler` this client registered for it gets the
 * new `ctx` too.
 *
 * An id this account does not hold reads as absent, as it does for
 * `unsubscribe()`.
 *
 * On a website with nobody signed in, opens the sign-in first; rejects
 * `auth_canceled` if the visitor closes it.
 *
 * @this {import('./index.js').EventsModule}
 * @param {string} subId The `subId` of the subscription to change.
 * @param {UpdatePersistentOptions} options What to change.
 * @returns {Promise<PersistentSubscription>}
 */
export async function update (subId, options) {
    if ( typeof subId !== 'string' || subId.trim().length === 0 ) {
        throw new PuterJSError(
            'No such subscription',
            'subscription_does_not_exist',
        );
    }
    if ( options?.context === undefined ) {
        throw new PuterJSError(
            'Pass `context`, or `null` to clear it',
            'invalid_request',
        );
    }
    // Checked against the cap before the round trip, as `onPersistent()` does.
    serializeContext(options.context);

    const sub = /** @type {PersistentSubscription} */ (
        await request(this.puter, '/events/subscriptions/update', {
            subId,
            context: options.context,
        })
    );
    this.channel.updateDurableContext(subId, options.context);
    return sub;
}
