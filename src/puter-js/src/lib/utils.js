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
    const xhr = new XMLHttpRequest();
    xhr.open(method, APIOrigin + endpoint, true);
    if ( authToken )
    {
        xhr.setRequestHeader('Authorization', `Bearer ${ authToken}`);
    }
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.responseType = responseType ?? '';

    // Add API call logging if available
    if ( globalThis.puter?.apiCallLogger?.isEnabled() ) {
        xhr._puterRequestId = {
            method,
            service: 'xhr',
            operation: endpoint.replace(/^\//, ''),
            params: { endpoint, contentType, responseType },
        };
    }

    return xhr;
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
    const tp = new TeePromise();

    driverCall_(options,
                    tp.resolve.bind(tp),
                    tp.reject.bind(tp),
                    driverInterface,
                    driverName,
                    driverMethod,
                    driverArgs,
                    undefined,
                    undefined,
                    settings);

    return await tp;
}

// This function encapsulates the logic for sending a driver call request
async function driverCall_ (
    options = {},
    resolve_func, reject_func,
    driverInterface, driverName, driverMethod, driverArgs,
    method,
    contentType = 'text/plain;actually=json',
    settings = {},
) {
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
    // create xhr object
    const xhr = initXhr('/drivers/call', puter.APIOrigin, undefined, 'POST', contentType);

    // Store request info for later logging
    if ( requestInfo ) {
        xhr._puterDriverRequestInfo = requestInfo;
    }

    if ( settings.responseType ) {
        xhr.responseType = settings.responseType;
    }

    // ===============================================
    // TO UNDERSTAND THIS CODE, YOU MUST FIRST
    // UNDERSTAND THE FOLLOWING TEXT:
    //
    // Everything between here and the comment reading
    // "=== END OF STREAMING ===" is ONLY for handling
    // requests with content type "application/x-ndjson"
    // ===============================================

    let is_stream = false;
    let signal_stream_update = null;
    let lastLength = 0;
    let response_complete = false;

    let buffer = '';

    // NOTE: linked-list technically would perform better,
    //       but in practice there are at most 2-3 lines
    //       buffered so this does not matter.
    const lines_received = [];

    xhr.onreadystatechange = () => {
        if ( xhr.readyState === 2 ) {
            if ( xhr.getResponseHeader('Content-Type') !==
                'application/x-ndjson'
            ) return;
            is_stream = true;
            const Stream = async function* Stream () {
                while ( !response_complete ) {
                    const tp = new TeePromise();
                    signal_stream_update = tp.resolve.bind(tp);
                    await tp;
                    if ( response_complete ) break;
                    while ( lines_received.length > 0 ) {
                        const line = lines_received.shift();
                        if ( line.trim() === '' ) continue;
                        const lineObject = (JSON.parse(line));
                        if ( typeof (lineObject.text) === 'string' ) {
                            Object.defineProperty(lineObject, 'toString', {
                                enumerable: false,
                                value: () => lineObject.text,
                            });
                        }
                        yield lineObject;
                    }
                }
            };

            const startedStream = Stream();
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
        }
        if ( xhr.readyState === 4 ) {
            response_complete = true;
            if ( is_stream ) {
                signal_stream_update?.();
            }
        }
    };

    xhr.onprogress = function () {
        if ( ! signal_stream_update ) return;

        const newText = xhr.responseText.slice(lastLength);
        lastLength = xhr.responseText.length; // Update lastLength to the current length

        let hasUpdates = false;
        for ( let i = 0; i < newText.length; i++ ) {
            buffer += newText[i];
            if ( newText[i] === '\n' ) {
                hasUpdates = true;
                lines_received.push(buffer);
                buffer = '';
            }
        }

        if ( hasUpdates ) {
            signal_stream_update();
        }
    };

    // ========================
    // === END OF STREAMING ===
    // ========================

    // load: success or error
    xhr.addEventListener('load', async function (response) {
        if ( is_stream ) {
            return;
        }
        const resp = await parseResponse(response.target);

        // Log driver call response
        if ( this._puterDriverRequestInfo && globalThis.puter?.apiCallLogger?.isEnabled() ) {
            globalThis.puter.apiCallLogger.logRequest({
                service: 'drivers',
                operation: `${this._puterDriverRequestInfo.interface}::${this._puterDriverRequestInfo.method}`,
                params: { interface: this._puterDriverRequestInfo.interface, driver: this._puterDriverRequestInfo.driver, method: this._puterDriverRequestInfo.method, args: this._puterDriverRequestInfo.args },
                result: response.status >= 400 || resp?.success === false ? null : resp,
                error: response.status >= 400 || resp?.success === false ? resp : null,
            });
        }

        // HTTP Error - unauthorized
        if ( response.status === 401 || resp?.code === 'token_auth_failed' ) {
            if ( resp?.code === 'token_auth_failed' && puter.env === 'web' ) {
                try {
                    puter.resetAuthToken();
                    await puter.ui.authenticateWithPuter();
                } catch (e) {
                    return reject_func({
                        error: {
                            code: 'auth_canceled', message: 'Authentication canceled',
                        },
                    });
                }
            }
            // if error callback is provided, call it
            if ( error_cb && typeof error_cb === 'function' )
            {
                error_cb({ status: 401, message: 'Unauthorized' });
            }
            // reject promise
            return reject_func({ status: 401, message: 'Unauthorized' });
        }
        // HTTP Error - other
        else if ( response.status && response.status !== 200 ) {
            // if error callback is provided, call it
            error_cb(resp);
            // reject promise
            return reject_func(resp);
        }
        // HTTP Success
        else {
            // Driver Error: permission denied
            if ( resp.success === false && resp.error?.code === 'permission_denied' ) {
                let perm = await puter.ui.requestPermission({ permission: `driver:${ driverInterface }:${ driverMethod}` });
                // try sending again if permission was granted
                if ( perm.granted ) {
                    // repeat request with permission granted
                    return driverCall_(options, resolve_func, reject_func, driverInterface, driverMethod, driverArgs, method, contentType, settings);
                } else {
                    // if error callback is provided, call it
                    error_cb(resp);
                    // reject promise
                    return reject_func(resp);
                }
            }
            // Driver Error: other
            else if ( resp.success === false ) {
                // if error callback is provided, call it
                error_cb(resp);
                // reject promise
                return reject_func(resp);
            }

            let result = resp.result !== undefined ? resp.result : resp;
            if ( settings.transform ) {
                result = await settings.transform(result);
            }

            // Success: if callback is provided, call it
            if ( resolve_func.success )
            {
                success_cb(result);
            }
            // Success: resolve with the result
            return resolve_func(result);
        }
    });

    // error
    xhr.addEventListener('error', function (e) {
        // Log driver call error
        if ( this._puterDriverRequestInfo && globalThis.puter?.apiCallLogger?.isEnabled() ) {
            globalThis.puter.apiCallLogger.logRequest({
                service: 'drivers',
                operation: `${this._puterDriverRequestInfo.interface}::${this._puterDriverRequestInfo.method}`,
                params: { interface: this._puterDriverRequestInfo.interface, driver: this._puterDriverRequestInfo.driver, method: this._puterDriverRequestInfo.method, args: this._puterDriverRequestInfo.args },
                error: { message: 'Network error occurred', event: e.type },
            });
        }
        return handle_error(error_cb, reject_func, this);
    });

    // send request
    xhr.send(JSON.stringify({
        interface: driverInterface,
        driver: driverName,
        test_mode: settings?.test_mode,
        method: driverMethod,
        args: driverArgs,
        auth_token: puter.authToken,
    }));
}

class TeePromise {
    static STATUS_PENDING = {};
    static STATUS_RUNNING = {};
    static STATUS_DONE = {};
    constructor () {
        this.status_ = this.constructor.STATUS_PENDING;
        this.donePromise = new Promise((resolve, reject) => {
            this.doneResolve = resolve;
            this.doneReject = reject;
        });
    }
    get status () {
        return this.status_;
    }
    set status (status) {
        this.status_ = status;
        if ( status === this.constructor.STATUS_DONE ) {
            this.doneResolve();
        }
    }
    resolve (value) {
        this.status_ = this.constructor.STATUS_DONE;
        this.doneResolve(value);
    }
    awaitDone () {
        return this.donePromise;
    }
    then (fn, rfn) {
        return this.donePromise.then(fn, rfn);
    }

    reject (err) {
        this.status_ = this.constructor.STATUS_DONE;
        this.doneReject(err);
    }

    /**
     * @deprecated use then() instead
     */
    onComplete (fn) {
        return this.then(fn);
    }
}

async function blob_to_url (blob) {
    const tp = new TeePromise();
    const reader = new FileReader();
    reader.onloadend = () => tp.resolve(reader.result);
    reader.readAsDataURL(blob);
    return await tp;
}

function blobToDataUri (blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
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
        const reader = new FileReader();
        reader.onload = function (event) {
            resolve(event.target.result);
        };
        reader.onerror = function (error) {
            reject(error);
        };
        reader.readAsDataURL(blob);
    });
}

export { parseResponse, uuidv4, handle_resp, handle_error, initXhr, setupXhrEventHandlers, driverCall,
    TeePromise,
    make_driver_method,
    blob_to_url,
    arrayBufferToDataUri,
    blobToDataUri,
};