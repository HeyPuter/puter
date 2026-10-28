/**
 * Whether a handler failure is worth trying again. Anything else a handler
 * throws drops the event. Shared by this client and the events worker runtime,
 * which inlines this file, so it has no imports.
 *
 * Retryable: `retry: true` on the error; a 429 or 5xx `status`; a network,
 * timeout or rate-limit error code; a `TimeoutError`; or a `TypeError` from a
 * failed `fetch`. `terminal: true` always drops.
 *
 * @param {unknown} error What the handler threw.
 * @returns {boolean}
 */
export const isRetryableError = (error) => {
    if ( !error || typeof error !== 'object' ) return false;
    const err = /** @type {Record<string, unknown>} */ (error);
    if ( err.terminal === true || err.code === 'events_terminal' ) return false;
    if ( err.retry === true ) return true;

    const status = Number(err.status ?? err.statusCode);
    if ( status === 429 || (status >= 500 && status < 600) ) return true;
    if ( typeof err.code === 'string' && RETRYABLE_CODES.includes(err.code) ) return true;
    if ( err.name === 'TimeoutError' ) return true;
    return err.name === 'TypeError' &&
        typeof err.message === 'string' &&
        /fetch|network/i.test(err.message);
};

const RETRYABLE_CODES = [
    'network_error',
    'request_timeout',
    'too_many_requests',
    'rate_limited',
    'events_connection_failed',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
];
