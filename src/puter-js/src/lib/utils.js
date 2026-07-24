import { FileReaderPoly } from './polyfills/fileReaderPoly.js';
import { buildXhr, driverCall, parseResponse, resolveReauth } from './networkUtils.js';

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
            if ( perm === true ) {
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

/**
 * Makes the hybrid promise/callback function for one driver method: the
 * returned function takes either a named-parameters object or the positional
 * arguments listed in `argNames`, optionally followed by success/error
 * callbacks, and resolves the driver's `result`.
 *
 * @param {{
 *   iface: string,
 *   method: string,
 *   argNames?: string[],
 *   driver?: string,
 *   puter?: unknown,
 *   testMode?: boolean,
 *   readonly?: boolean,
 *   responseType?: '' | 'text' | 'blob',
 *   preprocess?: (args: Record<string, unknown>) => Record<string, unknown>,
 *   transform?: (result: unknown) => unknown,
 * }} spec `iface`/`driver`/`method`/`testMode` address the driver call itself
 *   (see `driverCall`); the rest configures this wrapper.
 * @returns {(...args: unknown[]) => Promise<unknown>}
 */
function makeDriverMethod (spec) {
    const { iface, method, argNames = [], driver, puter, testMode } = spec;
    const { readonly, responseType, preprocess, transform } = spec;

    return async function (...args) {
        let driverArgs = {};
        let onError;

        if ( args.length === 1 && typeof args[0] === 'object' && ! Array.isArray(args[0]) ) {
            // Named parameters — the callbacks travel with them, so they have
            // to come off before the rest goes on the wire.
            driverArgs = { ...args[0] };
            onError = driverArgs.error;
            delete driverArgs.success;
            delete driverArgs.error;
        } else {
            argNames.forEach((argName, index) => {
                driverArgs[argName] = args[index];
            });
            onError = args[argNames.length + 1];
        }

        if ( typeof preprocess === 'function' ) {
            driverArgs = preprocess(driverArgs);
        }

        return await driverCall(
            { iface, driver, method, args: driverArgs, testMode, puter },
            { readonly, responseType, transform, onError },
        );
    };
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

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mpeg', 'avi', 'mkv', 'm4v', 'ogv'];

const isVideoInput = (url) => {
    if ( typeof url !== 'string' ) return false;
    if ( url.startsWith('data:video/') ) return true;
    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
};

export {
    blobToDataUri, handle_error, initXhr, isVideoInput, makeDriverMethod, setupXhrEventHandlers, uuidv4,
};
