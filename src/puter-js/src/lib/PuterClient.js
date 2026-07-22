/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
 * Shared 401 reauth policy for a parsed response body. Drives the env-specific
 * reauth flow on the Puter class and tells the caller what to do next, so the
 * fetch replacement (`fetchUrl`) and the generic XHR path (`handle_resp` in
 * utils.js) apply the exact same policy. The driver-call handler (`driverCall_`)
 * keeps its own replay because it must preserve streaming/transform semantics
 * on retry.
 *
 * Recognised backend signals:
 *   - `reauth_required` (v2 `authProbe`): legacy v1 tokens, revoked sessions,
 *     and expired sessions beyond the silent re-mint window.
 *   - `token_auth_failed` (legacy `APIError.create('token_auth_failed')`):
 *     token no longer valid, prompt re-login (web env only).
 *
 * @param {Object} resp - The parsed response body.
 * @returns {Promise<{action: 'replay'}|{action: 'reject', error: Object}|null>}
 *   `replay` when the caller should re-issue the request once with the fresh
 *   token, `reject` with the error to surface, or `null` when this is not a
 *   reauth-recoverable 401 and the caller should handle it normally.
 */
async function resolveReauth (resp) {
    if ( resp?.code === 'reauth_required' ) {
        try {
            await puter.triggerReauth({
                reason: resp.reason,
                auth_id: resp.auth_id,
            });
            return { action: 'replay' };
        } catch ( e ) {
            return {
                action: 'reject',
                error: {
                    status: 401,
                    code: 'reauth_required',
                    reason: resp.reason,
                    auth_id: resp.auth_id,
                    message: e?.message || 'Reauthentication required',
                },
            };
        }
    }
    if ( resp?.code === 'token_auth_failed' && puter.env === 'web' ) {
        try {
            puter.resetAuthToken();
            await puter.ui.authenticateWithPuter();
        } catch (e) {
            return {
                action: 'reject',
                error: {
                    error: {
                        code: 'auth_canceled', message: 'Authentication canceled',
                    },
                },
            };
        }
    }
    return null;
}

/**
 * The single HTTP core for puter.js. `fetchUrl` is an XHR-based replacement for
 * `fetch()` — every request that used to call `fetch()` directly routes through
 * here so auth headers, streaming, API-call logging, and 401 reauth-replay live
 * in one place. XHR (not `fetch`) because `fetch` is inconsistent across the
 * platforms puter.js supports (browser / web-worker / service-worker / node)
 * and we ship a strong in-house XHR polyfill (`lib/polyfills/xhrshim.js`), so
 * `new XMLHttpRequest()` resolves to native XHR or the shim transparently.
 *
 * The interface is frozen: additive changes only. Retry, dedup, and pagination
 * options are reserved below and land in later sprint steps.
 */

/**
 * @typedef {Object} PuterResponse
 * A `fetch`-Response-like view over a completed (or streaming) XHR.
 * @property {boolean} ok - status in the 200-299 range.
 * @property {number} status
 * @property {string} statusText
 * @property {string} url - final response URL.
 * @property {{ get(name: string): (string|null) }} headers
 * @property {() => Promise<any>} json
 * @property {() => Promise<string>} text
 * @property {() => Promise<Blob>} blob
 * @property {() => Promise<ArrayBuffer>} arrayBuffer
 * @property {() => AsyncGenerator<any>} stream - parsed NDJSON lines; only
 *   meaningful for `application/x-ndjson` responses.
 */

const isNdjson = contentType => (contentType || '').includes('application/x-ndjson');

/** Read the XHR body as text regardless of the responseType it was sent with. */
async function bodyText (xhr) {
    switch ( xhr.responseType ) {
    case 'blob': return await xhr.response.text();
    case 'arraybuffer': return new TextDecoder().decode(xhr.response);
    case 'json': return JSON.stringify(xhr.response);
    default: return xhr.responseText; // '' | 'text'
    }
}

async function bodyBlob (xhr) {
    if ( xhr.responseType === 'blob' ) return xhr.response;
    const type = xhr.getResponseHeader('content-type') || 'application/octet-stream';
    if ( xhr.responseType === 'arraybuffer' ) return new Blob([xhr.response], { type });
    return new Blob([await bodyText(xhr)], { type });
}

async function bodyArrayBuffer (xhr) {
    if ( xhr.responseType === 'arraybuffer' ) return xhr.response;
    return await (await bodyBlob(xhr)).arrayBuffer();
}

async function bodyJson (xhr) {
    if ( xhr.responseType === 'json' ) return xhr.response;
    return JSON.parse(await bodyText(xhr));
}

function makeResponse (xhr, stream) {
    const status = xhr.status;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: xhr.statusText,
        url: xhr.responseURL || '',
        headers: { get: name => xhr.getResponseHeader(name) },
        text: () => bodyText(xhr),
        json: () => bodyJson(xhr),
        blob: () => bodyBlob(xhr),
        arrayBuffer: () => bodyArrayBuffer(xhr),
        stream: () => {
            if ( ! stream ) {
                throw new Error('stream() is only available for application/x-ndjson responses');
            }
            return stream;
        },
    };
}

function logRequest (logId, { result = null, error = null } = {}) {
    if ( ! logId || ! globalThis.puter?.apiCallLogger?.isEnabled() ) return;
    globalThis.puter.apiCallLogger.logRequest({ ...logId, result, error });
}

/** Best-effort body for logging — parsed JSON where sensible, else a placeholder. */
async function bodyForLog (xhr) {
    const contentType = xhr.getResponseHeader('content-type') || '';
    if ( xhr.responseType === '' || xhr.responseType === 'text' || contentType.includes('json') ) {
        try { return await bodyJson(xhr); } catch ( e ) {
            try { return await bodyText(xhr); } catch ( e2 ) { return null; }
        }
    }
    return `[${contentType || 'binary'}]`;
}

/**
 * XHR-based `fetch()` replacement. Returns a `fetch`-Response-like object.
 *
 * fetch semantics: the promise resolves for any HTTP status (`ok` reflects
 * 2xx); it rejects only on network/abort errors. The one exception is a 401
 * carrying a reauth signal — the reauth flow is driven first and, on success,
 * the request is replayed once with the fresh token (transparent recovery). A
 * non-recoverable 401 resolves as an `ok: false` response like any other.
 *
 * @param {string} url - Full request URL (callers own origin composition).
 * @param {Object} [opts]
 * @param {boolean} [opts.includePuterAuth=false] - Add `Authorization: Bearer <puter.authToken>`.
 * @param {string}  [opts.method='GET']
 * @param {Object}  [opts.headers] - Extra request headers (undefined/null values skipped).
 * @param {string|Blob|ArrayBuffer|FormData|null} [opts.body]
 * @param {''|'text'|'json'|'blob'|'arraybuffer'} [opts.responseType='']
 * @param {boolean} [opts.withCredentials=true]
 * @param {AbortSignal} [opts.signal]
 * @param {{service: string, operation: string, params?: Object}} [opts.logContext]
 *   Semantic context for the centralized API-call log. Omit to log generically.
 * @param {Object} [opts.retry] - Reserved for a later sprint step (ignored).
 * @param {Object} [opts.dedupe] - Reserved for a later sprint step (ignored).
 * @param {Object} [opts.paginate] - Reserved for a later sprint step (ignored).
 * @returns {Promise<PuterResponse>}
 */
function fetchUrl (url, opts = {}) {
    const {
        includePuterAuth = false,
        method = 'GET',
        headers = {},
        body = null,
        responseType = '',
        withCredentials = true,
        signal,
        logContext,
        _reauthReplayed = false, // internal one-shot guard for reauth replay
    } = opts;

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.withCredentials = withCredentials;
        // Text mode keeps NDJSON progress deltas available for stream(); callers
        // that need binary/parsed bodies pass an explicit responseType.
        xhr.responseType = responseType;

        if ( includePuterAuth && globalThis.puter?.authToken ) {
            xhr.setRequestHeader('Authorization', `Bearer ${globalThis.puter.authToken}`);
        }
        for ( const [ name, value ] of Object.entries(headers) ) {
            if ( value !== undefined && value !== null ) {
                xhr.setRequestHeader(name, value);
            }
        }

        if ( signal ) {
            if ( signal.aborted ) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', () => xhr.abort(), { once: true });
        }

        let logId = null;
        if ( globalThis.puter?.apiCallLogger?.isEnabled() ) {
            logId = logContext ?? { service: 'fetchUrl', operation: `${method} ${url}`, params: { url, method } };
        }

        // -- NDJSON streaming --
        // Detect a stream at HEADERS_RECEIVED and resolve early with a response
        // whose stream() yields parsed lines as onprogress deltas arrive. This
        // mirrors the streaming in driverCall_ (utils.js) and the xhrshim.
        let resolvedAsStream = false;
        let responseComplete = false;
        let signalStreamUpdate = null;
        const linesReceived = [];
        let carry = '';
        let consumedLength = 0;

        const pushLines = text => {
            carry += text;
            let nl;
            while ( (nl = carry.indexOf('\n')) !== -1 ) {
                linesReceived.push(carry.slice(0, nl));
                carry = carry.slice(nl + 1);
            }
        };

        xhr.onreadystatechange = () => {
            if ( xhr.readyState === 2 && ! isNdjson(xhr.getResponseHeader('Content-Type')) ) return;
            if ( xhr.readyState === 2 ) {
                resolvedAsStream = true;
                const stream = (async function* () {
                    while ( true ) {
                        while ( linesReceived.length > 0 ) {
                            const line = linesReceived.shift();
                            if ( line.trim() === '' ) continue;
                            yield JSON.parse(line);
                        }
                        if ( responseComplete ) break;
                        const sig = createDeferred();
                        signalStreamUpdate = sig.resolve;
                        await sig.promise;
                    }
                })();
                logRequest(logId, { result: '[stream]' });
                resolve(makeResponse(xhr, stream));
            }
            if ( xhr.readyState === 4 && resolvedAsStream ) {
                if ( carry.length > 0 ) { linesReceived.push(carry); carry = ''; }
                responseComplete = true;
                signalStreamUpdate?.();
            }
        };

        xhr.onprogress = () => {
            if ( ! resolvedAsStream ) return;
            const fresh = xhr.responseText.slice(consumedLength);
            consumedLength = xhr.responseText.length;
            if ( ! fresh ) return;
            pushLines(fresh);
            signalStreamUpdate?.();
        };

        // -- Buffered (non-stream) response --
        xhr.addEventListener('load', async function () {
            if ( resolvedAsStream ) return;

            if ( this.status === 401 && ! _reauthReplayed ) {
                let parsed = null;
                try { parsed = await bodyJson(this); } catch ( e ) { parsed = null; }
                const reauth = await resolveReauth(parsed);
                if ( reauth?.action === 'replay' ) {
                    try {
                        return resolve(await fetchUrl(url, { ...opts, _reauthReplayed: true }));
                    } catch ( e ) {
                        return reject(e);
                    }
                }
                // reauth 'reject'/null (incl. token_auth_failed handled inside
                // resolveReauth): surface the 401 as an ok:false response, the
                // same way fetch does for any error status.
            }

            const resp = makeResponse(this);
            if ( logId ) {
                const logged = await bodyForLog(this);
                logRequest(logId, this.status >= 400
                    ? { error: logged ?? { message: this.statusText, status: this.status } }
                    : { result: logged });
            }
            resolve(resp);
        });

        xhr.addEventListener('error', function (e) {
            logRequest(logId, { error: { message: 'Network error occurred', event: e.type } });
            reject(new TypeError(`Network request to ${url} failed`));
        });
        xhr.addEventListener('abort', function () {
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        });

        xhr.send(body);
    });
}

export { fetchUrl, resolveReauth };
