import { describe, expect, it } from 'vitest';
import { isRetryableError } from './retryable.js';

const withFields = (fields, ErrorType = Error) =>
    Object.assign(new ErrorType(fields.message ?? 'boom'), fields);

describe('which handler failures are retried', () => {
    it.each([
        ['an error marked retry: true', withFields({ retry: true })],
        ['a 429', withFields({ status: 429 })],
        ['a 503', withFields({ status: 503 })],
        ['a 500 as statusCode', withFields({ statusCode: 500 })],
        ['a puter.js network error', withFields({ code: 'network_error' })],
        ['a puter.js request timeout', withFields({ code: 'request_timeout' })],
        ['a rate limit', withFields({ code: 'too_many_requests' })],
        ['a dropped events connection', withFields({ code: 'events_connection_failed' })],
        ['a reset socket', withFields({ code: 'ECONNRESET' })],
        ['an abort signal timeout', withFields({ name: 'TimeoutError' })],
        ['a browser fetch failure', new TypeError('Failed to fetch')],
        ['a node fetch failure', new TypeError('fetch failed')],
        ['a fetch network error', new TypeError('NetworkError when attempting to fetch resource.')],
    ])('retries %s', (_label, error) => {
        expect(isRetryableError(error)).toBe(true);
    });

    it.each([
        ['a plain error', new Error('bad input')],
        ['a 400', withFields({ status: 400 })],
        ['a 404', withFields({ status: 404 })],
        ['an unrelated TypeError', new TypeError('x is not a function')],
        ['an unknown code', withFields({ code: 'subject_does_not_exist' })],
        ['a thrown string', 'nope'],
        ['undefined', undefined],
        ['terminal: true, even on a 503', withFields({ terminal: true, status: 503 })],
        ['events_terminal, even with retry: true', withFields({ code: 'events_terminal', retry: true })],
    ])('drops %s', (_label, error) => {
        expect(isRetryableError(error)).toBe(false);
    });
});
