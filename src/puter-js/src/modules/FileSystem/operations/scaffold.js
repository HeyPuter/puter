// Shared scaffold for the filesystem operations in this directory.
//
// Every operation accepts the same calling conventions (an options object, or
// positional arguments optionally followed by legacy success/error
// callbacks), needs the same authentication gate before it touches the
// network, and talks to the API the same way. Operations built with
// `defineOperation` only describe what is unique to them: the names of their
// positional arguments and the request they make.

import * as utils from '../../../lib/utils.js';

/** @typedef {import('../index.js').PuterJSFileSystemModule} FileSystemModule */

/**
 * One request against the filesystem API.
 *
 * @typedef {{
 *   endpoint: string,
 *   body?: unknown,
 *   method?: 'get' | 'post' | 'put' | 'delete',
 *   contentType?: string,
 *   responseType?: '' | 'blob' | 'text',
 *   authHeader?: boolean,
 *   prepareXhr?: (xhr: XMLHttpRequest) => void,
 *   transform?: (response: unknown) => unknown,
 *   success?: (value: unknown) => void,
 *   error?: (reason: unknown) => void,
 * }} FSRequestSpec
 */

// What every operation rejects with when the user can't be authenticated.
const AUTHENTICATION_FAILED = 'Authentication failed.';

/**
 * Whether a value is an options object rather than a positional argument.
 * Paths arrive as strings or arrays of strings, and data as File/Blob, so
 * anything else object-shaped is the options form.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isOptionsObject = (value) =>
    typeof value === 'object' &&
    value !== null &&
    ! Array.isArray(value) &&
    ! (typeof File !== 'undefined' && value instanceof File) &&
    ! (typeof Blob !== 'undefined' && value instanceof Blob);

/**
 * Reads the first defined option among `names`, so operations keep accepting
 * the legacy snake_case spellings alongside their camelCase equivalents.
 *
 * @param {Record<string, unknown>} options
 * @param {...string} names
 * @returns {unknown}
 */
export const firstDefined = (options, ...names) => {
    for ( const name of names ) {
        if ( options[name] !== undefined ) return options[name];
    }
    return undefined;
};

/**
 * Normalizes the calling conventions every filesystem operation supports into
 * a single options object:
 *
 *   op(options)
 *   op(...positional, options?, success?, error?)
 *   op(...positional, success?, error?)
 *
 * The returned object is always a fresh copy, so operations can rewrite paths
 * on it without mutating an object the caller still holds.
 *
 * @param {unknown[]} args
 * @param {string[]} [positional] names to bind the leading arguments to
 * @returns {Record<string, unknown>}
 */
export const parseOperationArgs = (args, positional = []) => {
    if ( isOptionsObject(args[0]) ) {
        return { ...(/** @type {Record<string, unknown>} */ (args[0])) };
    }

    /** @type {Record<string, unknown>} */
    const options = {};
    positional.forEach((name, index) => {
        if ( args[index] !== undefined ) options[name] = args[index];
    });

    // An explicit `undefined` in the options slot still leaves the callbacks
    // where callers have always passed them.
    let rest = args.slice(positional.length);
    if ( rest[0] === undefined ) {
        rest = rest.slice(1);
    }
    if ( isOptionsObject(rest[0]) ) {
        Object.assign(options, rest[0]);
        rest = rest.slice(1);
    }
    if ( typeof rest[0] === 'function' ) options.success = rest[0];
    if ( typeof rest[1] === 'function' ) options.error = rest[1];

    return options;
};

/**
 * Ensures there is an auth token before a request goes out, prompting the user
 * in the web environment. Throws when authentication fails — callers must not
 * fall through and fire the request anyway.
 *
 * @returns {Promise<void>}
 */
export const ensureAuthenticated = async () => {
    if ( puter.authToken || puter.env !== 'web' ) {
        return;
    }
    try {
        await puter.ui.authenticateWithPuter();
    } catch (e) {
        throw AUTHENTICATION_FAILED;
    }
};

/**
 * Performs one authenticated request against the filesystem API and resolves
 * with the parsed response, after running it through `transform` if given.
 * Legacy success/error callbacks receive the same value the promise settles
 * with.
 *
 * @this {FileSystemModule}
 * @param {FSRequestSpec} spec
 * @returns {Promise<unknown>}
 */
export async function fsRequest (spec) {
    const {
        endpoint, body, method = 'post', contentType, responseType,
        authHeader = true, prepareXhr, transform, success, error,
    } = spec;

    await ensureAuthenticated();

    return new Promise((resolve, reject) => {
        const xhr = utils.initXhr(
            endpoint,
            this.APIOrigin,
            authHeader ? this.authToken : undefined,
            method,
            contentType,
            responseType,
        );

        prepareXhr?.(xhr);

        // `transform` has to run before the callbacks so that they and the
        // promise agree on the value, which rules out `setupXhrEventHandlers`'
        // own success callback.
        utils.setupXhrEventHandlers(xhr, undefined, error, async (response) => {
            try {
                const result = transform ? await transform.call(this, response) : response;
                if ( typeof success === 'function' ) success(result);
                resolve(result);
            } catch (e) {
                if ( typeof error === 'function' ) error(e);
                reject(e);
            }
        }, reject);

        xhr.send(body === undefined ? undefined : JSON.stringify(body));
    });
}

/**
 * Builds a filesystem operation from the parts that differ between
 * operations. `request` receives the normalized options and returns the
 * request to make; it may be async when the operation needs to look something
 * up first.
 *
 * The operation is returned as `T`, so each operation declares its own public
 * signature (matching `types/modules/filesystem.d.ts`) where it is defined.
 *
 * @template {(...args: any[]) => Promise<unknown>} [T=(this: FileSystemModule, ...args: unknown[]) => Promise<unknown>]
 * @param {{
 *   positional?: string[],
 *   request: (this: FileSystemModule, options: Record<string, unknown>) => FSRequestSpec | Promise<FSRequestSpec>,
 * }} spec
 * @returns {T}
 */
export const defineOperation = ({ positional = [], request }) => {
    /**
     * @this {FileSystemModule}
     * @param {unknown[]} args
     */
    const operation = async function (...args) {
        const options = parseOperationArgs(args, positional);
        const requestSpec = await request.call(this, options);
        return await fsRequest.call(this, {
            success: options.success,
            error: options.error,
            ...requestSpec,
        });
    };

    return /** @type {T} */ (/** @type {unknown} */ (operation));
};
