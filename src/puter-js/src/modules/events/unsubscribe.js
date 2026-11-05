import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';

/**
 * Ends a persistent subscription.
 *
 * An id this account does not hold — one already ended, or one another app
 * created — reads as absent rather than refused, so the call cannot be used to
 * find out which subscriptions exist.
 *
 * On a website with nobody signed in, opens the sign-in first; rejects
 * `auth_canceled` if the visitor closes it.
 *
 * @this {import('./index.js').EventsModule}
 * @param {string} subId The `subId` of the subscription to end.
 * @returns {Promise<void>}
 */
export async function unsubscribe (subId) {
    if ( typeof subId !== 'string' || subId.trim().length === 0 ) {
        throw new PuterJSError(
            'No such subscription',
            'subscription_does_not_exist',
        );
    }
    // Routing stops once the server has let go of it: a refused request
    // leaves the subscription live, so this page keeps running its handler.
    try {
        await request(this.puter, '/events/unsubscribe', { subId });
    } catch ( error ) {
        if ( error?.code === 'subscription_does_not_exist' ) {
            this.channel.deregisterDurable(subId);
        }
        throw error;
    }
    this.channel.deregisterDurable(subId);
}
