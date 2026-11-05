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
    if ( isTerminalError(error) ) return false;
    const err = /** @type {Record<string, unknown>} */ (error);
    if ( err.retry === true ) return true;

    if ( isRetryableStatus(Number(err.status ?? err.statusCode)) ) return true;
    if ( typeof err.code === 'string' && RETRYABLE_CODES.includes(err.code) ) return true;
    if ( err.name === 'TimeoutError' ) return true;
    return err.name === 'TypeError' &&
        typeof err.message === 'string' &&
        /fetch|network/i.test(err.message);
};

/**
 * Whether the handler asked for the event to be dropped, whatever else the
 * error says.
 *
 * @param {unknown} error What the handler threw.
 * @returns {boolean}
 */
export const isTerminalError = (error) => {
    if ( !error || typeof error !== 'object' ) return false;
    const err = /** @type {Record<string, unknown>} */ (error);
    return err.terminal === true || err.code === 'events_terminal';
};

/**
 * An HTTP status that means "not now": a 429 or any 5xx.
 *
 * @param {number} status
 * @returns {boolean}
 */
export const isRetryableStatus = (status) =>
    status === 429 || (status >= 500 && status < 600);

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
