import { FileReaderPoly } from './polyfills/fileReaderPoly.js';
import { buildXhr, resolveReauth, sendWithRetry } from './networkUtils.js';
import { showUsageLimitDialog } from '../modules/UsageLimitDialog.js';
import { showEmailConfirmationDialog } from '../modules/EmailConfirmationDialog.js';

/**
 * Parses a given response text into a JSON object. If the parsing fails due to invalid JSON format,
 * the original response text is returned.
 *
 * @param {string} responseText - The response text to be parsed into JSON. It is expected to be a valid JSON string.
 * @returns {Object|string} The parsed JSON object if the responseText is valid JSON, otherwise returns the original responseText.
 * @example
 * // returns { key: "value" }
 * parseResponse('{"key": "value"}');
 *
 * @example
 * // returns "Invalid JSON"
 * parseResponse('Invalid JSON');
 */
async function parseResponse (target) {
    if ( target.responseType === 'blob' ) {
        // Get content type of the blob
        const contentType = target.getResponseHeader('content-type');
        if ( contentType.startsWith('application/json') ) {
            // If the blob is JSON, parse it
            const text = await target.response.text();
            try {
                return JSON.parse(text);
            } catch ( error ) {
                return text;
            }
        } else if ( contentType.startsWith('application/octet-stream') ) {
            // If the blob is an octet stream, return the blob
            return target.response;
        }

        // Otherwise return an ojbect
        return {
            success: true,
            result: target.response,
        };
    }
    const responseText = target.responseText;
    try {
        return JSON.parse(responseText);
    } catch ( error ) {
        return responseText;
    }
}

/**
 * A function that generates a UUID (Universally Unique Identifier) using the version 4 format,
 * which are random UUIDs. It uses the cryptographic number generator available in modern browsers.
 *
 * The generated UUID is a 36 character string (32 alphanumeric characters separated by 4 hyphens).
 * It follows the pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx, where x is any hexadecimal digit
 * and y is one of 8, 9, A, or B.
 *
 * @returns {string} Returns a new UUID v4 string.
 *
 * @example
 *
 * let id = this.#uuidv4(); // Generate a new UUID
 *
 */
function uuidv4 () {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

/**
 * Initializes and returns an XMLHttpRequest object configured for a specific API endpoint, method, and headers.
 *
 * @param {string} endpoint - The API endpoint to which the request will be sent. This is appended to the API origin URL.
 * @param {string} APIOrigin - The origin URL of the API. This is prepended to the endpoint.
 * @param {string} authToken - The authorization token used for accessing the API. This is included in the request headers.
 * @param {string} [method='post'] - The HTTP method to be used for the request. Defaults to 'post' if not specified.
 * @param {string} [contentType='application/json;charset=UTF-8'] - The content type of the request. Defaults to
 *                                                                  'application/json;charset=UTF-8' if not specified.
 *
 * @returns {XMLHttpRequest} The initialized XMLHttpRequest object.
 */
function initXhr (endpoint, APIOrigin, authToken, method = 'post', contentType = 'text/plain;actually=json', responseType = undefined) {
    return buildXhr({
        url: APIOrigin + endpoint,
        method,
        headers: { 'Content-Type': contentType },
        // `includePuterAuth` re-reads the live token at build time, so a replay
        // picks up a freshly-minted token (same as the old replay path, which
        // passed `globalThis.puter.authToken`).
        includePuterAuth: !! authToken,
        withCredentials: true,
        responseType: responseType ?? '',
        logId: {
            method,
            service: 'xhr',
            operation: endpoint.replace(/^\//, ''),
            params: { endpoint, contentType, responseType },
        },
    });
}

/**
 * Re-issue an XHR after the reauth coordinator resolves. Rebuilds the request
 * from the captured `_puterReq` spec (with a fresh token via `buildXhr`) and
 * routes the new response back through the same callbacks. Returns true if a
 * replay was scheduled, false otherwise.
 */
function replayXhrAfterReauth (response, success_cb, error_cb, resolve_func, reject_func) {
    const xhr = response.target ?? response;
    const spec = xhr?._puterReq;
    if ( ! spec ) return false;
    // Already a replay attempt — don't loop into reauth a second time if
    // even the fresh token comes back rejected. The retry path is one-shot.
    if ( spec._replayed ) return false;
    const newSpec = { ...spec, _replayed: true };
    const newXhr = buildXhr(newSpec);
    setupXhrEventHandlers(newXhr, success_cb, error_cb, resolve_func, reject_func);
    newXhr.send(spec.body);
    return true;
}

/**
 * Handles an HTTP response by invoking appropriate callback functions and resolving or rejecting a promise.
 *
 * @param {Function} success_cb - An optional callback function for successful responses. It should take a response object
 *                                as its only argument.
 * @param {Function} error_cb - An optional callback function for error handling. It should take an error object
 *                              as its only argument.
 * @param {Function} resolve_func - A function used to resolve a promise. It should take a response object
 *                                  as its only argument.
 * @param {Function} reject_func - A function used to reject a promise. It should take an error object
 *                                 as its only argument.
 * @param {Object} response - The HTTP response object from the request. Expected to have 'status' and 'responseText'
 *                            properties.
 *
 * @returns {void} The function does not return a value but will either resolve or reject a promise based on the
 *                 response status.
 */
async function handle_resp (success_cb, error_cb, resolve_func, reject_func, response) {
    const resp = await parseResponse(response);
    // error - unauthorized
    if ( response.status === 401 ) {
        const reauth = await resolveReauth(resp);
        if ( reauth?.action === 'replay' ) {
            // Replay the original request with the fresh token. If the replay
            // can't be scheduled (no captured request, or already retried),
            // fall through to the generic Unauthorized rejection below.
            if ( replayXhrAfterReauth(response, success_cb, error_cb, resolve_func, reject_func) ) {
                return;
            }
        } else if ( reauth?.action === 'reject' ) {
            if ( error_cb && typeof error_cb === 'function' ) error_cb(reauth.error);
            return reject_func(reauth.error);
        }
        // if error callback is provided, call it
        if ( error_cb && typeof error_cb === 'function' )
        {
            error_cb({ status: 401, message: 'Unauthorized' });
        }
        // reject promise
        return reject_func({ status: 401, message: 'Unauthorized' });
    }
    // error - other
    else if ( response.status !== 200 ) {
        // if error callback is provided, call it
        if ( error_cb && typeof error_cb === 'function' )
        {
            error_cb(resp);
        }
        // reject promise
        return reject_func(resp);
    }
    // success
    else {
        // This is a driver error
        if ( resp.success === false && resp.error?.code === 'permission_denied' ) {
            let perm = await puter.ui.requestPermission({ permission: 'driver:puter-image-generation:generate' });
            // try sending again if permission was granted
            if ( perm.granted ) {
                // todo repeat request
            }
        }
        // if success callback is provided, call it
        if ( success_cb && typeof success_cb === 'function' )
        {
            success_cb(resp);
        }
        // resolve with success
        return resolve_func(resp);
    }
}

/**
 * Handles an error by invoking a specified error callback and then rejecting a promise.
 *
 * @param {Function} error_cb - An optional callback function that is called if it's provided.
 *                              This function should take an error object as its only argument.
 * @param {Function} reject_func - A function used to reject a promise. It should take an error object
 *                                 as its only argument.
 * @param {Object} error - The error object that is passed to both the error callback and the reject function.
 *
 * @returns {void} The function does not return a value but will call the reject function with the error.
 */
function handle_error (error_cb, reject_func, error) {
    // if error callback is provided, call it
    if ( error_cb && typeof error_cb === 'function' )
    {
        error_cb(error);
    }
    // reject promise
    return reject_func(error);
}

function setupXhrEventHandlers (xhr, success_cb, error_cb, resolve_func, reject_func) {
    // load: success or error
    xhr.addEventListener('load', async function (e) {
        // Log the response if API logging is enabled
        if ( globalThis.puter?.apiCallLogger?.isEnabled() && this._puterRequestId ) {
            const response = await parseResponse(this).catch(() => null);
            globalThis.puter.apiCallLogger.logRequest({
                service: this._puterRequestId.service,
                operation: this._puterRequestId.operation,
                params: this._puterRequestId.params,
                result: this.status >= 400 ? null : response,
                error: this.status >= 400 ? { message: this.statusText, status: this.status } : null,
            });
        }
        return handle_resp(success_cb, error_cb, resolve_func, reject_func, this, xhr);
    });

    // error
    xhr.addEventListener('error', function (e) {
        // Log the error if API logging is enabled
        if ( globalThis.puter?.apiCallLogger?.isEnabled() && this._puterRequestId ) {
            globalThis.puter.apiCallLogger.logRequest({
                service: this._puterRequestId.service,
                operation: this._puterRequestId.operation,
                params: this._puterRequestId.params,
                error: {
                    message: 'Network error occurred',
                    event: e.type,
                },
            });
        }
        return handle_error(error_cb, reject_func, this);
    });
}

const NOOP = () => {
};
class Valid {
    static callback (cb) {
        return (cb && typeof cb === 'function') ? cb : undefined;
    }
}

/**
 * Makes the hybrid promise/callback function for a particular driver method
 * @param {string[]} arg_defs - argument names (for now; definitions eventually)
 * @param {string} driverInterface - name of the interface
 * @param {string} driverName - name of the driver
 * @param {string} driverMethod - name of the method
 *
 * `settings.puter` carries the SDK instance the call runs against; callers
 * that don't pass one fall back to the global instance.
 */
function make_driver_method (arg_defs, driverInterface, driverName, driverMethod, settings = {}) {
    return async function (...args) {
        let driverArgs = {};
        let options = {};

        // Check if the first argument is an object and use it as named parameters
        if ( args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0]) ) {
            driverArgs = { ...args[0] };
            options = {
                success: driverArgs.success,
                error: driverArgs.error,
            };
            // Remove callback functions from driverArgs if they exist
            delete driverArgs.success;
            delete driverArgs.error;
        } else {
            // Handle as individual arguments
            arg_defs.forEach((argName, index) => {
                driverArgs[argName] = args[index];
            });
            options = {
                success: args[arg_defs.length],
                error: args[arg_defs.length + 1],
            };
        }

        // preprocess
        if ( settings.preprocess && typeof settings.preprocess === 'function' ) {
            driverArgs = settings.preprocess(driverArgs);
        }

        return await driverCall(options, driverInterface, driverName, driverMethod, driverArgs, settings);
    };
}

async function driverCall (options, driverInterface, driverName, driverMethod, driverArgs, settings) {
    const deferred = createDeferred();

    driverCall_(
        options,
        deferred.resolve,
        deferred.reject,
        driverInterface,
        driverName,
        driverMethod,
        driverArgs,
        undefined,
        undefined,
        settings,
    );

    return await deferred.promise;
}

// This function encapsulates the logic for sending a driver call request
async function driverCall_ (
    options = {},
    resolve_func,
    reject_func,
    driverInterface,
    driverName,
    driverMethod,
    driverArgs,
    method,
    contentType = 'text/plain;actually=json',
    settings = {},
) {
    const puter = settings.puter ?? globalThis.puter;
    // Generate request ID for logging
    // Store request info for logging
    let requestInfo = null;
    if ( globalThis.puter?.apiCallLogger?.isEnabled() ) {
        requestInfo = {
            interface: driverInterface,
            driver: driverName,
            method: driverMethod,
            args: driverArgs,
        };
    }

    // If there is no authToken and the environment is web, try authenticating with Puter
    if ( !puter.authToken && puter.env === 'web' ) {
        try {
            await puter.ui.authenticateWithPuter();
        } catch (e) {
            // Log authentication error
            if ( requestInfo && globalThis.puter?.apiCallLogger?.isEnabled() ) {
                globalThis.puter.apiCallLogger.logRequest({
                    service: 'drivers',
                    operation: `${driverInterface}::${driverMethod}`,
                    params: { interface: driverInterface, driver: driverName, method: driverMethod, args: driverArgs },
                    error: { code: 'auth_canceled', message: 'Authentication canceled' },
                });
            }
            return reject_func({
                error: {
                    code: 'auth_canceled', message: 'Authentication canceled',
                },
            });
        }
    }

    const success_cb = Valid.callback(options.success) ?? NOOP;
    const error_cb = Valid.callback(options.error) ?? NOOP;

    const logDriver = fields => {
        if ( requestInfo && globalThis.puter?.apiCallLogger?.isEnabled() ) {
            globalThis.puter.apiCallLogger.logRequest({
                service: 'drivers',
                operation: `${driverInterface}::${driverMethod}`,
                params: { interface: driverInterface, driver: driverName, method: driverMethod, args: driverArgs },
                ...fields,
            });
        }
    };

    // The request spec is rebuilt per attempt by the retry engine, so a reauth
    // replay carries a freshly-minted token in the body.
    const spec = {
        url: puter.APIOrigin + '/drivers/call',
        method: 'POST',
        headers: { 'Content-Type': contentType },
        withCredentials: true,
        responseType: settings.responseType || '',
        buildBody: () => JSON.stringify({
            interface: driverInterface,
            driver: driverName,
            test_mode: settings?.test_mode,
            method: driverMethod,
            args: driverArgs,
            auth_token: puter.authToken,
        }),
    };

    // Wrap the engine's raw parsed-line NDJSON stream with the driver's per-line
    // semantics (usage-limit / email-confirmation dialogs, `toString`) and the
    // ReadableStream `.start` adapter, then resolve with it.
    const shapeStream = lineStream => {
        const startedStream = (async function* () {
            for await ( const lineObject of lineStream ) {
                if ( lineObject?.error?.code === 'insufficient_funds' || lineObject?.metadata?.usage_limited === true ) {
                    if ( puter.env === 'web' ) {
                        showUsageLimitDialog('You have reached your usage limit for this account.<br>Please upgrade to continue.');
                    } else if ( puter.env === 'app' ) {
                        await puter.ui.requestUpgrade();
                    }
                }
                if ( lineObject?.error?.code === 'email_must_be_confirmed' && puter.env === 'web' ) {
                    showEmailConfirmationDialog(lineObject?.error?.message || 'Email confirmation required. Go to Puter.com to confirm your email address.');
                }
                if ( typeof (lineObject.text) === 'string' ) {
                    Object.defineProperty(lineObject, 'toString', {
                        enumerable: false,
                        value: () => lineObject.text,
                    });
                }
                yield lineObject;
            }
        })();
        Object.defineProperty(startedStream, 'start', {
            enumerable: false,
            value: async (controller) => {
                const texten = new TextEncoder();
                for await ( const part of startedStream ) {
                    controller.enqueue(texten.encode(part));
                }
                controller.close();
            },
        });
        return resolve_func(startedStream);
    };

    // Interpret the final (non-stream) driver response. Reauth, permission-grant,
    // and transient retries have already been handled by the engine, so anything
    // reaching here is terminal.
    const shape = async outcome => {
        if ( outcome.networkError ) {
            logDriver({ error: { message: 'Network error occurred' } });
            return handle_error(error_cb, reject_func, outcome.xhr);
        }

        const xhr = outcome.xhr;
        const status = xhr.status;
        const resp = await parseResponse(xhr);

        logDriver({
            result: status >= 400 || resp?.success === false ? null : resp,
            error: status >= 400 || resp?.success === false ? resp : null,
        });

        const isInsufficientFunds = (status === 402) ||
            (resp?.error?.code === 'insufficient_funds') ||
            (resp?.error?.status === 402);
        const isUsageLimited = resp?.metadata?.usage_limited === true;
        if ( (isInsufficientFunds || isUsageLimited) && puter.env === 'web' ) {
            showUsageLimitDialog('Your account has not enough funding to complete this request.<br>Please upgrade to continue.');
        } else if ( (isInsufficientFunds || isUsageLimited) && puter.env === 'app' ) {
            await puter.ui.requestUpgrade();
        }
        if ( resp?.error?.code === 'email_must_be_confirmed' && puter.env === 'web' ) {
            showEmailConfirmationDialog(resp?.error?.message || 'Email confirmation required. Go to Puter.com to confirm your email address.');
        }

        // Unauthorized — the reauth / token_auth_failed flows already ran in the
        // engine's classifier; a leftover 401 here is terminal.
        if ( status === 401 || resp?.code === 'token_auth_failed' ) {
            error_cb({ status: 401, message: 'Unauthorized' });
            return reject_func({ status: 401, message: 'Unauthorized' });
        }
        // Other HTTP error
        if ( status && status !== 200 ) {
            error_cb(resp);
            return reject_func(resp);
        }
        // Driver-level error (incl. a permission_denied the engine couldn't clear)
        if ( resp.success === false ) {
            error_cb(resp);
            return reject_func(resp);
        }

        let result = resp.result !== undefined ? resp.result : resp;
        if ( settings.transform ) {
            result = await settings.transform(result);
        }
        if ( resolve_func.success ) {
            success_cb(result);
        }
        return resolve_func(result);
    };

    sendWithRetry(spec, {
        // Read-style driver methods opt into transient retry via settings.readonly.
        retrySafe: !! settings.readonly,
        permission: `driver:${ driverInterface }:${ driverMethod }`,
        shapeStream,
        shape,
    }).catch(reject_func);
}

async function blob_to_url (blob) {
    const reader = new (globalThis.FileReader || FileReaderPoly)();
    return await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function blobToDataUri (blob) {
    return new Promise((resolve, reject) => {
        const reader = new (globalThis.FileReader || FileReaderPoly)();
        reader.onload = function (event) {
            resolve(event.target.result);
        };
        reader.onerror = function (error) {
            reject(error);
        };
        reader.readAsDataURL(blob);
    });
}

function arrayBufferToDataUri (arrayBuffer) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([arrayBuffer]);
        const reader = new (globalThis.FileReader || FileReaderPoly)();
        reader.onload = function (event) {
            resolve(event.target.result);
        };
        reader.onerror = function (error) {
            reject(error);
        };
        reader.readAsDataURL(blob);
    });
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mpeg', 'avi', 'mkv', 'm4v', 'ogv'];

const isVideoInput = (url) => {
    if ( typeof url !== 'string' ) return false;
    if ( url.startsWith('data:video/') ) return true;
    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
};

export {
    arrayBufferToDataUri, blob_to_url, blobToDataUri, driverCall, handle_error, handle_resp, initXhr, isVideoInput, make_driver_method, parseResponse, setupXhrEventHandlers, uuidv4,
};
