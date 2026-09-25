import { PuterJSError } from '../../../lib/PuterJSError.js';
import { scanHandlerSource } from './freeVariables.js';

/**
 * Turning what a developer wrote into what gets deployed.
 *
 * A handler is not called where it is written — it is serialized, stored, and
 * run later in the app's events worker. So the three accepted forms all reduce
 * to one string, that string is scanned for anything it cannot carry with it,
 * and its hash goes along so the server can tell whether the code a
 * subscription was written against is still what is published.
 */

/** Hard cap on a subscription's serialized `context`, matching the column. */
export const CONTEXT_MAX_BYTES = 4096;

const invalidHandler = (message) =>
    new PuterJSError(message, 'events_handler_invalid');

const contextTooLarge = () =>
    new PuterJSError(
        `Subscription context may not exceed ${CONTEXT_MAX_BYTES} bytes`,
        'events_context_too_large',
    );

/**
 * Hashing is `crypto.subtle`, which an insecure browser origin does not
 * provide. Failing loudly beats binding a subscription to whatever happens to
 * be published under the name.
 */
const hashUnavailable = () =>
    new PuterJSError(
        'This environment provides no `crypto.subtle`, so an inline handler cannot be ' +
            'hashed. Publish it with `puter.events.handlers.publish()` and subscribe with ' +
            '`handlerName` instead.',
        'events_handler_hash_unavailable',
    );

const encoder = new TextEncoder();

/** Bytes a string takes on the wire, which is what every cap is measured in. */
export const byteLength = (text) => encoder.encode(text).length;

/**
 * SHA-256 of the source, hex, matching what the server stores. Async because
 * `crypto.subtle` is, and it is the only digest all three runtimes share.
 *
 * @param {string} source
 * @returns {Promise<string>}
 */
export const hashSource = async (source) => {
    const subtle = globalThis.crypto?.subtle;
    if ( ! subtle ) throw hashUnavailable();
    const digest = await subtle.digest('SHA-256', encoder.encode(source));
    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
};

// A method defined with shorthand syntax (`ingest({ event }) { … }` in an
// object literal or a class) stringifies without the `function` keyword, and
// so is not an expression: the worker would bake it as a broken stub. Every
// other form — `function`, `async function`, arrows, `class` — already is one.
const METHOD_SHORTHAND = /^(async\s+)?(\*\s*)?([A-Za-z_$][\w$]*|\[[^\]]*\])\s*\(/;
const NOT_SHORTHAND = /^(async\s+)?(function\b|class\b|\()/;

/**
 * A function's source as something that parses on its own. Shorthand methods
 * get the keyword they stringified without; anything else is returned as is.
 *
 * @param {string} source
 * @returns {string}
 */
export const asExpression = (source) => {
    const trimmed = source.trim();
    if ( NOT_SHORTHAND.test(trimmed) || ! METHOD_SHORTHAND.test(trimmed) ) return source;
    const isAsync = /^async\s+/.test(trimmed);
    const rest = trimmed.replace(/^async\s+/, '');
    // A getter, setter or computed name cannot be turned into a plain function
    // by hand — leave it for the server-side check to refuse.
    if ( /^(get|set)\s+[A-Za-z_$[]/.test(rest) || rest.startsWith('[') ) return source;
    return `${isAsync ? 'async ' : ''}function ${rest}`;
};

/**
 * The source of a handler given as a function or a source string. A
 * `{ file }` form is read separately, because reading is asynchronous and
 * everything else here is not.
 *
 * @param {unknown} handler
 * @returns {string | null} `null` when the handler is a `{ file }` reference.
 */
export const sourceOf = (handler) => {
    if ( typeof handler === 'function' )
        return asExpression(Function.prototype.toString.call(handler));
    if ( typeof handler === 'string' ) {
        if ( handler.trim().length === 0 )
            throw invalidHandler('A handler source string may not be empty');
        return handler;
    }
    if ( handler && typeof handler === 'object' && 'file' in handler ) return null;
    throw invalidHandler(
        'A handler must be a function, a source string, or `{ file: <path> }`',
    );
};

/**
 * Resolve a handler to its source, reading a `{ file }` reference through the
 * caller's own filesystem.
 *
 * File references resolve **at this call**, not at delivery: what is deployed
 * is the bytes as they were when the handler was published or subscribed, so
 * editing the file afterwards changes nothing until it is published again.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {unknown} handler
 * @returns {Promise<string>}
 */
export const resolveSource = async (puter, handler) => {
    const inline = sourceOf(handler);
    if ( inline !== null ) return inline;

    const path = /** @type {{ file: unknown }} */ (handler).file;
    if ( typeof path !== 'string' || path.trim().length === 0 )
        throw invalidHandler('`file` must be a non-empty path');

    const blob = await puter.fs.read(path);
    const source = typeof blob === 'string' ? blob : await blob.text();
    if ( source.trim().length === 0 )
        throw invalidHandler(`\`${path}\` is empty`);
    return source;
};

/**
 * Everything the wire needs about a handler: its source, its hash, and the
 * guarantee that it names nothing it cannot carry.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {unknown} handler
 * @returns {Promise<{ source: string, hash: string }>}
 */
export const prepareHandler = async (puter, handler) => {
    const source = await resolveSource(puter, handler);
    scanHandlerSource(source);
    return { source, hash: await hashSource(source) };
};

/**
 * The `context` a subscription carries, serialized and checked against the cap
 * before the request rather than after it.
 *
 * Evaluated **now**: `ctx` is a snapshot of these values as they are at
 * subscribe time, and it never changes again for the life of the subscription.
 *
 * @param {unknown} context
 * @returns {string | undefined}
 */
export const serializeContext = (context) => {
    if ( context === undefined || context === null ) return undefined;

    let json;
    try {
        json = JSON.stringify(context);
    } catch {
        throw new PuterJSError(
            'context must be JSON-serializable',
            'events_context_invalid',
        );
    }
    if ( json === undefined )
        throw new PuterJSError(
            'context must be JSON-serializable',
            'events_context_invalid',
        );
    if ( byteLength(json) > CONTEXT_MAX_BYTES ) throw contextTooLarge();
    return json;
};
