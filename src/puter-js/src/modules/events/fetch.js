import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';

/** @typedef {import('./types.js').PuterNotifEvent} PuterNotifEvent */
/** @typedef {import('./types.js').EventFetchPage} EventFetchPage */
/** @typedef {import('./types.js').EventFetchOptions} EventFetchOptions */

/**
 * Reads what a subject recorded while nothing was listening.
 *
 * A plain query, not a subscription: nothing is registered, no position is kept
 * for you, and the same call from anywhere returns the same answer. Keep the
 * `cursor` a page comes back with and pass it as `after` to continue; a page
 * with no `cursor` is the end of what there is.
 *
 * Only subjects with a store behind them can answer. Today that is `notif:` —
 * the notification mailbox — and any other family is refused rather than
 * answered with an empty page, which would read as "nothing happened".
 *
 * A fetched event carries the same `id` as the live delivery of the same
 * notification, so a client that reconnects mid-catch-up can drop the
 * duplicate.
 *
 * @this {import('./index.js').EventsModule}
 * @param {EventFetchOptions} options
 * @returns {Promise<EventFetchPage>}
 */
export async function fetch (options) {
    const opts = /** @type {EventFetchOptions} */ (options ?? {});
    const subject = opts.subject;
    if ( typeof subject !== 'string' || subject.trim().length === 0 ) {
        throw new PuterJSError(
            '`subject` is required',
            'invalid_subject',
        );
    }
    if ( opts.limit !== undefined && typeof opts.limit !== 'number' ) {
        throw new PuterJSError('`limit` must be a number', 'invalid_request');
    }
    if ( opts.after !== undefined && typeof opts.after !== 'string' ) {
        throw new PuterJSError('`after` must be a string', 'invalid_request');
    }

    const page = await request(this.puter, '/events/fetch', undefined, {
        subject,
        ...(opts.after !== undefined ? { after: opts.after } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });

    return /** @type {EventFetchPage} */ ({
        items: /** @type {PuterNotifEvent[]} */ (page.items ?? []),
        ...(typeof page.cursor === 'string' ? { cursor: page.cursor } : {}),
    });
}
