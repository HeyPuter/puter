import * as utils from '../../lib/utils.js';
import { dedupe } from '../../lib/networkUtils.js';
import { parseCallbackOptions } from './lib/args.js';

// How long a caller may attach to an already-pending `/whoami`. This is
// in-flight coalescing, not a cache — the entry is dropped the moment the
// request settles, so a later caller always gets a fresh read and can never
// be served a stale user. The window only bounds how long we'll wait on a
// request that hasn't come back; past it, a new caller issues its own rather
// than inheriting a possibly-hung one. Kept just above observed `/whoami`
// latency so it catches the boot burst and nothing else.
const WHOAMI_DEDUPE_WINDOW_MS = 1000;

/** @typedef {import('../Auth.js').User} User */

/** @typedef {import('../../lib/types.js').RequestCallbacks<User>} UserCallbacks */

/**
 * @overload
 * @param {UserCallbacks & { query?: Record<string, string> }} [options]
 * @returns {Promise<User>}
 */
/**
 * @overload
 * @param {(value: User) => void} success
 * @param {(reason: unknown) => void} [error]
 * @returns {Promise<User>}
 */
/**
 * Returns the currently authenticated user. Accepts an options object with an
 * optional `query` (forwarded as query-string params to `/whoami`) and
 * `success`/`error` callbacks, or trailing positional callbacks.
 *
 * @this {import('./index.js').OSModule}
 * @param {...unknown} args
 * @returns {Promise<User>}
 */
export function user (...args) {
    const { puter } = this;
    const options = parseCallbackOptions(args);

    let query = '';
    if ( options?.query ) {
        query = `?${new URLSearchParams(options.query).toString()}`;
    }

    // The GUI reaches /whoami from several independent boot paths (session
    // restore, post-login, popup auth, desktop refresh), landing identical
    // requests in the same moment. Coalesce those onto one request; the key
    // carries origin, token and query so a different user or response shape
    // never shares a result.
    const key = `os:user:${puter.APIOrigin}:${puter.authToken}:${query}`;
    const request = dedupe(
        key,
        () => new Promise((resolve, reject) => {
            const xhr = utils.initXhr(`/whoami${query}`, puter.APIOrigin, puter.authToken, 'get');
            // Callbacks are deliberately not passed here: this promise is
            // shared, so per-caller callbacks are invoked below instead —
            // otherwise a coalesced caller's `success` would never fire.
            utils.setupXhrEventHandlers(xhr, undefined, undefined, resolve, reject);
            xhr.send();
        }),
        { windowMs: WHOAMI_DEDUPE_WINDOW_MS },
    );

    return request.then(
        value => {
            options.success?.(value);
            return value;
        },
        error => {
            options.error?.(error);
            throw error;
        },
    );
}
