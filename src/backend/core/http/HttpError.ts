/**
 * Options accepted by `HttpError`. All optional.
 */
export interface HttpErrorOptions {
    /** Underlying error. Set as the standard `Error.cause`. */
    cause?: unknown;
    /**
     * Stable wire-format error code that legacy clients key on (e.g.
     * `item_with_same_name_exists`, `forbidden`, `subject_does_not_exist`).
     * Serialized as `code` in the response body for back-compat.
     */
    legacyCode?: string;
    /**
     * Modern, structured error code. If both `legacyCode` and `code` are set,
     * the legacy one takes the `code` slot in the response body and `code`
     * is emitted as `errorCode`, so clients keying on either field find
     * what they expect.
     */
    code?: string;
    /** Additional fields merged into the response body. */
    fields?: Record<string, unknown>;
}

/**
 * The single error type controllers and services throw to surface an HTTP
 * failure. The terminal `errorHandler` middleware catches it, serializes a
 * JSON body, and sets the response status.
 *
 * Usage:
 * ```ts
 * throw new HttpError(404, 'Item not found');
 * throw new HttpError(409, 'Cannot overwrite directory', { legacyCode: 'is_directory' });
 * throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden', fields: { target } });
 * ```
 *
 * Express 5 forwards thrown errors (sync and async) to error-handling
 * middleware automatically — no `next(err)` ceremony required.
 */
export class HttpError extends Error {
    readonly statusCode: number;
    readonly legacyCode?: string;
    readonly code?: string;
    readonly fields?: Record<string, unknown>;

    constructor (
        statusCode: number,
        message: string,
        options: HttpErrorOptions = {},
    ) {
        super(
            message,
            options.cause !== undefined ? { cause: options.cause } : undefined,
        );
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.legacyCode = options.legacyCode;
        this.code = options.code;
        this.fields = options.fields;
    }
}

/**
 * Type guard that survives module-graph duplication (defensive — cross-realm
 * `instanceof` can be unreliable in test setups). Pure runtime convenience;
 * normal callers can use `instanceof HttpError`.
 */
export const isHttpError = (e: unknown): e is HttpError => {
    if ( e instanceof HttpError ) return true;
    return Boolean(
        e
        && typeof e === 'object'
        && (e as { name?: unknown }).name === 'HttpError'
        && typeof (e as { statusCode?: unknown }).statusCode === 'number',
    );
};
