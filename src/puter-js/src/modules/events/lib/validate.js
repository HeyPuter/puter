import { PuterJSError } from '../../../lib/PuterJSError.js';

// Cheap preconditions only. The subject grammar is parsed server-side, and
// duplicating it here would mean two parsers to keep in agreement; these are
// the checks that cost nothing and save a round trip.

/**
 * @param {unknown} subject
 * @returns {void}
 */
export const assertSubject = (subject) => {
    if ( typeof subject !== 'string' || subject.trim().length === 0 ) {
        throw new PuterJSError('Subject must be a non-empty string', 'invalid_subject');
    }
};

/**
 * @param {unknown} handler
 * @returns {void}
 */
export const assertHandler = (handler) => {
    if ( typeof handler !== 'function' ) {
        throw new PuterJSError('Handler must be a function', 'invalid_handler');
    }
};
