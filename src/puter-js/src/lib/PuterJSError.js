/**
 * The error puter.js throws for client-side validation failures, and the
 * canonical shape module code normalizes thrown values into.
 *
 * Historically the SDK threw one of two shapes: a plain `{ message, code }`
 * object (KV, Hosting, ...) or, in a couple of Apps methods, the nested
 * `{ success: false, error: { code, message } }`. `PuterJSError` is a strict
 * superset of both so existing `catch` blocks keep working unchanged:
 *
 *   - it is a real `Error`, so `err instanceof Error`, `err.stack`, and
 *     `err.message` all work (plain objects gave none of these);
 *   - `message` and `code` are own, enumerable properties, so
 *     `JSON.stringify(err)` and `const { code } = err` behave like the old
 *     plain objects did;
 *   - any extra fields (e.g. the legacy `success` / `error` pair) are attached
 *     as own properties, so callers reading `err.error.code` keep working.
 *
 * Error codes are API surface — they are `snake_case` and must not change.
 */
export class PuterJSError extends Error {
    /**
     * @param {string} message - Human-readable message.
     * @param {string} [code] - Stable `snake_case` error code.
     * @param {Record<string, unknown>} [extra] - Extra own-enumerable fields
     *   to attach (for backward-compatible shapes such as `{ success, error }`).
     */
    constructor (message, code, extra = {}) {
        super(message);

        // Restore the prototype chain: subclassing the built-in Error loses it
        // once the bundle is minified/transpiled, which would make both
        // `instanceof PuterJSError` and `instanceof Error` return false.
        Object.setPrototypeOf(this, new.target.prototype);

        // `name` is defined non-enumerable (like a native Error's) so it stays
        // out of `JSON.stringify`, and as an own property so it survives
        // minification of the class name.
        Object.defineProperty(this, 'name', {
            value: 'PuterJSError',
            enumerable: false,
            writable: true,
            configurable: true,
        });

        // A native Error's `message` is non-enumerable; redefine it enumerable
        // so the thrown value serializes and spreads like the legacy plain
        // `{ message, code }` object it replaces.
        Object.defineProperty(this, 'message', {
            value: message,
            enumerable: true,
            writable: true,
            configurable: true,
        });

        if ( code !== undefined ) this.code = code;
        Object.assign(this, extra);
    }

    /**
     * Normalizes an arbitrary thrown value into a `PuterJSError`, passing an
     * existing one through untouched. Object values keep their `message`,
     * `code`, and every other own field; primitives become the message.
     *
     * @param {unknown} value
     * @returns {PuterJSError}
     */
    static from (value) {
        if ( value instanceof PuterJSError ) return value;

        if ( value !== null && typeof value === 'object' ) {
            const { message, code, ...rest } = /** @type {Record<string, unknown>} */ (value);
            return new PuterJSError(
                typeof message === 'string' ? message : 'Unknown error',
                typeof code === 'string' ? code : undefined,
                rest,
            );
        }

        return new PuterJSError(typeof value === 'string' ? value : 'Unknown error');
    }
}
