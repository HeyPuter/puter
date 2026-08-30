import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';

/**
 * Ends a persistent subscription.
 *
 * An id this account does not hold — one already ended, or one another app
 * created — reads as absent rather than refused, so the call cannot be used to
 * find out which subscriptions exist.
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
    await request(this.puter, '/events/unsubscribe', { subId });
}
