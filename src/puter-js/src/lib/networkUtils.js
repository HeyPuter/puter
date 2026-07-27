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

import { showEmailConfirmationDialog } from '../modules/EmailConfirmationDialog.js';
import { showUsageLimitDialog } from '../modules/UsageLimitDialog.js';

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
 * utils.js) apply the exact same policy.
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
 * The one XHR builder both `initXhr` (utils.js) and `fetchUrl` wrap. Opens the
 * request, applies headers/credentials/responseType, and stashes the whole
 * `spec` on `xhr._puterReq` as the single replay representation — any attempt
 * (reauth, permission, transient) rebuilds the request by calling
 * `buildXhr(spec)` again, which re-reads the live token when `includePuterAuth`.
 *
 * @param {Object} spec
 * @param {string} spec.url - Full request URL.
 * @param {string} [spec.method='GET']
 * @param {Object} [spec.headers] - Extra headers (nullish values skipped).
 * @param {boolean} [spec.includePuterAuth=false] - Add a fresh `Authorization: Bearer`.
 * @param {boolean} [spec.withCredentials=true]
 * @param {string} [spec.responseType='']
 * @param {Object} [spec.logId] - Pre-built apiCallLogger request id.
 * @returns {XMLHttpRequest}
 */
function buildXhr (spec) {
    const {
        url,
        method = 'GET',
        headers = {},
        includePuterAuth = false,
        withCredentials = true,
        responseType = '',
    } = spec;

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = withCredentials;
    xhr.responseType = responseType ?? '';

    if ( includePuterAuth && globalThis.puter?.authToken ) {
        xhr.setRequestHeader('Authorization', `Bearer ${globalThis.puter.authToken}`);
    }
    for ( const [ name, value ] of Object.entries(headers) ) {
        if ( value !== undefined && value !== null ) {
            xhr.setRequestHeader(name, value);
        }
    }

    xhr._puterReq = spec;
    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
        spec.body = body;
        return origSend(body);
    };

    if ( globalThis.puter?.apiCallLogger?.isEnabled() ) {
        xhr._puterRequestId = spec.logId ?? {
            method,
            service: 'xhr',
            operation: url,
            params: { url, method, responseType },
        };
    }

    return xhr;
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

/**
 * Read a completed XHR as a driver/API response: JSON when the body parses as
 * JSON, the raw text when it doesn't, and — for `responseType: 'blob'` — the
 * Blob itself (wrapped in a success envelope unless the response declares a
 * type we can read directly).
 *
 * @param {XMLHttpRequest} xhr
 * @returns {Promise<unknown>}
 */
async function parseResponse (xhr) {
    if ( xhr.responseType !== 'blob' ) {
        try {
            return JSON.parse(xhr.responseText);
        } catch ( e ) {
            return xhr.responseText;
        }
    }

    const contentType = xhr.getResponseHeader('content-type');
    if ( contentType.startsWith('application/json') ) {
        const text = await xhr.response.text();
        try {
            return JSON.parse(text);
        } catch ( e ) {
            return text;
        }
    }
    if ( contentType.startsWith('application/octet-stream') ) {
        return xhr.response;
    }
    return { success: true, result: xhr.response };
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

// -- Retry engine --
// One loop drives every request: build the XHR from its spec, send, classify
// the outcome, and either replay (reauth / permission / transient backoff) or
// hand the result to the caller's shaper. A replay just rebuilds from the same
// spec, so there are no hand-listed argument lists to get wrong.

const RETRYABLE_STATUS = new Set([ 429, 502, 503, 504 ]);

// Fixed retry backoff: a quick ramp to a 2s ceiling, then hold at 2s. Index i is
// the wait (ms) after attempt i+1 fails. The array length caps the retries — 8
// delays ⇒ 9 attempts total, the 2s ceiling used 5 times — after which the
// request is failed.
const RETRY_DELAYS_MS = [ 250, 500, 1000, 2000, 2000, 2000, 2000, 2000 ];
const RETRY_CEILING_MS = 2000;
// If a ceiling-length wait overruns real time by more than this, the clock
// jumped (e.g. the laptop slept mid-wait); the request is stale, so give up
// rather than fire a very old retry.
const MAX_SLEEP_DRIFT_MS = 2000;

// Kill-switch seam: puter.configure() (deferred) will drive this. Default on.
const autoRetryEnabled = () => globalThis.puter?.config?.autoRetry ?? true;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if ( signal?.aborted ) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
});

const retryDelay = attempt => RETRY_DELAYS_MS[attempt - 1];

const transientRetry = ctx => {
    if ( ! (ctx.retrySafe && autoRetryEnabled()) ) return null;
    const delayMs = retryDelay(ctx.attempt);
    return delayMs === undefined ? null : { delayMs };
};

/**
 * Drive the env-specific permission prompt for a denied driver call.
 * @returns {Promise<{granted: boolean}>}
 */
async function resolvePermission (permission) {
    try {
        // requestPermission resolves to a boolean; the legacy `{granted}`
        // object shape is also tolerated for safety.
        const perm = await puter.ui.requestPermission({ permission });
        return { granted: perm === true || perm?.granted === true };
    } catch ( e ) {
        return { granted: false };
    }
}

/**
 * Send one attempt. Resolves with a terminal outcome:
 *   { streamed: true, xhr, lineStream } — NDJSON, resolved at HEADERS_RECEIVED
 *   { xhr, status }                     — buffered response (any HTTP status)
 *   { networkError: true, xhr }         — transport error
 * Rejects only on abort. Per-line semantics (usage/email prompts, `toString`)
 * belong to the caller's `shapeStream`.
 */
function sendOnce (spec) {
    return new Promise((resolve, reject) => {
        const xhr = buildXhr(spec);

        let streamed = false;
        let responseComplete = false;
        let signalStreamUpdate = null;
        const lines = [];
        let carry = '';
        let consumed = 0;

        const lineStream = (async function* () {
            while ( true ) {
                while ( lines.length > 0 ) {
                    const line = lines.shift();
                    if ( line.trim() === '' ) continue;
                    yield JSON.parse(line);
                }
                if ( responseComplete ) break;
                const sig = createDeferred();
                signalStreamUpdate = sig.resolve;
                await sig.promise;
            }
        })();

        xhr.onreadystatechange = () => {
            if ( xhr.readyState === 2 && isNdjson(xhr.getResponseHeader('Content-Type')) ) {
                streamed = true;
                resolve({ streamed: true, xhr, lineStream });
            }
            if ( xhr.readyState === 4 && streamed ) {
                if ( carry.length > 0 ) { lines.push(carry); carry = ''; }
                responseComplete = true;
                signalStreamUpdate?.();
            }
        };

        xhr.onprogress = () => {
            if ( ! streamed ) return;
            const fresh = xhr.responseText.slice(consumed);
            consumed = xhr.responseText.length;
            if ( ! fresh ) return;
            carry += fresh;
            let nl;
            while ( (nl = carry.indexOf('\n')) !== -1 ) {
                lines.push(carry.slice(0, nl));
                carry = carry.slice(nl + 1);
            }
            signalStreamUpdate?.();
        };

        xhr.addEventListener('load', () => {
            if ( streamed ) return;
            resolve({ xhr, status: xhr.status });
        });
        xhr.addEventListener('error', () => resolve({ networkError: true, xhr }));
        xhr.addEventListener('abort', () => reject(spec.signal?.reason ?? new DOMException('Aborted', 'AbortError')));

        if ( spec.signal ) {
            if ( spec.signal.aborted ) return reject(spec.signal.reason ?? new DOMException('Aborted', 'AbortError'));
            spec.signal.addEventListener('abort', () => xhr.abort(), { once: true });
        }

        const body = typeof spec.buildBody === 'function' ? spec.buildBody() : spec.body;
        xhr.send(body ?? null);
    });
}

/**
 * Classify a completed attempt into a retry decision. Reauth and permission are
 * one-shot (tracked in `ctx.done`) and apply to any request; transient backoff
 * applies only to `ctx.retrySafe` requests and honors the autoRetry kill switch.
 * Memoizes the parsed body on `outcome.parsed` and stashes any reauth error on
 * `outcome.reauthError` for the shaper.
 *
 * @returns {Promise<{delayMs:number}|null>} a delay to retry after, or null to stop.
 */
async function classifyRetry (outcome, ctx) {
    if ( outcome.streamed ) return null; // committed stream — never retried

    if ( outcome.networkError ) return transientRetry(ctx);

    const { xhr, status } = outcome;
    if ( outcome.parsed === undefined ) {
        outcome.parsed = await bodyJson(xhr).catch(() => null);
    }
    const parsed = outcome.parsed;

    // reauth (401 / token_auth_failed) — one-shot, any method, no backoff.
    if ( status === 401 || parsed?.code === 'token_auth_failed' ) {
        if ( ! ctx.done.has('reauth') ) {
            const reauth = await resolveReauth(parsed);
            if ( reauth?.action === 'replay' ) { ctx.done.add('reauth'); return { delayMs: 0 }; }
            if ( reauth?.action === 'reject' ) outcome.reauthError = reauth.error;
        }
        return null;
    }

    // permission denied (200 success:false) — one-shot, any method, no backoff.
    if ( ctx.permission && parsed?.success === false && parsed?.error?.code === 'permission_denied' ) {
        if ( ! ctx.done.has('permission') ) {
            const perm = await resolvePermission(ctx.permission);
            if ( perm.granted ) { ctx.done.add('permission'); return { delayMs: 0 }; }
        }
        return null;
    }

    // transient status — read-safe only, honors kill switch, fixed schedule.
    if ( RETRYABLE_STATUS.has(status) ) return transientRetry(ctx);

    return null;
}

/**
 * The one retry loop. Sends `spec` (rebuilding per attempt), classifies each
 * outcome, and retries on reauth / permission / transient causes; otherwise
 * hands the outcome to `shape`.
 *
 * @param {Object} spec - buildXhr spec (+ optional buildBody, signal).
 * @param {Object} opts
 * @param {boolean} [opts.retrySafe=false] - eligible for transient backoff retry.
 * @param {string|null} [opts.permission] - `driver:<iface>:<method>` enables the permission cause.
 * @param {(lineStream, xhr) => any} opts.shapeStream - wrap an NDJSON stream.
 * @param {(outcome) => any} opts.shape - shape a buffered outcome (may throw).
 */
async function sendWithRetry (spec, { retrySafe = false, permission = null, shapeStream, shape }) {
    const ctx = { attempt: 0, retrySafe, permission, done: new Set() };
    while ( true ) {
        ctx.attempt++;
        const outcome = await sendOnce(spec);
        if ( outcome.streamed ) return shapeStream(outcome.lineStream, outcome.xhr);
        const decision = await classifyRetry(outcome, ctx);
        if ( decision ) {
            const before = Date.now();
            await sleep(decision.delayMs, spec.signal);
            if ( decision.delayMs >= RETRY_CEILING_MS
                && (Date.now() - before) - decision.delayMs > MAX_SLEEP_DRIFT_MS ) {
                return shape(outcome);
            }
            continue;
        }
        return shape(outcome);
    }
}

// -- In-flight request dedup --
// Coalesce concurrent identical requests: a second caller within `windowMs`
// gets the first request's promise (shared resolved value). The entry is
// deleted when the request settles. Keys are global, so namespace them
// (`fs:stat:…`) rather than passing a bare request signature.
const inflightRequests = new Map();

/**
 * @param {string} key - fully-qualified request key (namespace it yourself, e.g.
 *   `${method}:${url}:${bodyKey}`).
 * @param {() => Promise<any>} factory - runs the request; called only on a miss.
 * @param {{windowMs?: number}} [opts]
 * @returns {Promise<any>} shared promise (resolved value shared by reference).
 */
function dedupe (key, factory, { windowMs = 2000 } = {}) {
    const existing = inflightRequests.get(key);
    if ( existing ) {
        if ( Date.now() - existing.timestamp < windowMs ) return existing.promise;
        inflightRequests.delete(key); // stale — fall through and re-issue
    }
    const promise = factory();
    inflightRequests.set(key, { promise, timestamp: Date.now() });
    const cleanup = () => {
        if ( inflightRequests.get(key)?.promise === promise ) inflightRequests.delete(key);
    };
    promise.then(cleanup, cleanup);
    return promise;
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
 * @param {boolean} [opts.retry] - Force-enable (`true`) or disable (`false`)
 *   transient-failure auto-retry for this request; omit for the default
 *   (idempotent methods retry, others don't). Never retries a write.
 * @param {boolean|string} [opts.dedupe] - Coalesce concurrent identical in-flight
 *   requests (reads only): `true` auto-keys by method+url+body, or pass a key.
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
        retry,
        dedupe: dedupeOpt,
    } = opts;

    const logId = logContext ?? { service: 'fetchUrl', operation: `${method} ${url}`, params: { url, method } };
    const spec = { url, method, headers, includePuterAuth, withCredentials, responseType, body, signal, logId };

    // Read-safety: idempotent methods auto-retry; a POST read opts in with
    // `retry:true`; nothing retries when `retry:false` (writes/uploads).
    const idempotent = method === 'GET' || method === 'HEAD';
    const retrySafe = retry === false ? false : ( retry === true || idempotent );

    const loggingOn = () => globalThis.puter?.apiCallLogger?.isEnabled();

    const run = () => sendWithRetry(spec, {
        retrySafe,
        shapeStream: (lineStream, xhr) => {
            if ( loggingOn() ) logRequest(logId, { result: '[stream]' });
            return makeResponse(xhr, lineStream);
        },
        shape: async (outcome) => {
            if ( outcome.networkError ) {
                if ( loggingOn() ) logRequest(logId, { error: { message: 'Network error occurred' } });
                throw new TypeError(`Network request to ${url} failed`);
            }
            const { xhr } = outcome;
            const resp = makeResponse(xhr);
            if ( loggingOn() ) {
                const logged = await bodyForLog(xhr);
                logRequest(logId, xhr.status >= 400
                    ? { error: logged ?? { message: xhr.statusText, status: xhr.status } }
                    : { result: logged });
            }
            return resp;
        },
    });

    if ( dedupeOpt ) {
        const bodyKey = body == null ? '' : ( typeof body === 'string' ? body : '[body]' );
        const key = typeof dedupeOpt === 'string' ? dedupeOpt : `${method}:${url}:${bodyKey}`;
        return dedupe(key, run);
    }
    return run();
}

// -- Driver calls --
// Every `POST /drivers/call` in the SDK goes through this section. Two result
// shapes ship today and both are public behavior: `driverCall` resolves the
// unwrapped `result` and rejects driver errors, `driverCallEnvelope` resolves
// the response envelope as-is. Everything else — the wire body, the auth
// prompt, the logging, the usage/email prompts — is shared.

const DRIVER_CONTENT_TYPE = 'text/plain;actually=json';

/**
 * @typedef {{
 *   iface: string,
 *   method: string,
 *   args?: unknown,
 *   driver?: string,
 *   testMode?: boolean,
 *   puter?: unknown,
 * }} DriverCall
 * A driver method to invoke. `iface` is the interface name and `driver` the
 * concrete implementation behind it, which the backend resolves to the
 * interface's default when omitted. `puter` is the SDK instance the call runs
 * against; it falls back to the global instance.
 */

const callInstance = call => call.puter ?? globalThis.puter;

/** The wire body. Fields left `undefined` drop out of the JSON. */
const callBody = (call, puter) => JSON.stringify({
    interface: call.iface,
    driver: call.driver,
    test_mode: call.testMode,
    method: call.method,
    args: call.args,
    auth_token: puter.authToken,
});

const logCall = (call, fields) => {
    if ( ! globalThis.puter?.apiCallLogger?.isEnabled() ) return;
    globalThis.puter.apiCallLogger.logRequest({
        service: 'drivers',
        operation: `${call.iface}::${call.method}`,
        params: {
            interface: call.iface,
            driver: call.driver ?? call.iface,
            method: call.method,
            args: call.args,
        },
        ...fields,
    });
};

/** Prompt for funding, or hand off to the app's upgrade flow. */
async function promptUpgrade (puter, message) {
    if ( puter.env === 'web' ) {
        showUsageLimitDialog(message);
    } else if ( puter.env === 'app' ) {
        await puter.ui.requestUpgrade();
    }
}

function promptEmailConfirmation (puter, error) {
    if ( error?.code !== 'email_must_be_confirmed' || puter.env !== 'web' ) return;
    showEmailConfirmationDialog(error.message
        || 'Email confirmation required. Go to Puter.com to confirm your email address.');
}

/**
 * Wrap the engine's parsed NDJSON lines in the driver stream contract: the
 * per-line usage/email prompts, `toString()` on text parts, and the `start`
 * adapter that lets the stream feed a `ReadableStream` controller.
 */
function driverLineStream (lineStream, puter) {
    const stream = (async function* () {
        for await ( const line of lineStream ) {
            if ( line?.error?.code === 'insufficient_funds' || line?.metadata?.usage_limited === true ) {
                await promptUpgrade(puter, 'You have reached your usage limit for this account.<br>Please upgrade to continue.');
            }
            promptEmailConfirmation(puter, line?.error);
            if ( typeof line.text === 'string' ) {
                Object.defineProperty(line, 'toString', {
                    enumerable: false,
                    value: () => line.text,
                });
            }
            yield line;
        }
    })();

    Object.defineProperty(stream, 'start', {
        enumerable: false,
        value: async (controller) => {
            const encoder = new TextEncoder();
            for await ( const part of stream ) {
                controller.enqueue(encoder.encode(part));
            }
            controller.close();
        },
    });

    return stream;
}

/**
 * Driver call resolving the method's `result`, the shape `puter.ai.*`,
 * `puter.kv.*`, `puter.apps.*` and friends expose. Rejects with the driver's
 * error payload on failure, drives the env-specific auth / funding / email
 * prompts, and resolves an async iterator of lines for a streaming response.
 *
 * @param {DriverCall} call
 * @param {{
 *   responseType?: '' | 'text' | 'blob',
 *   readonly?: boolean,
 *   transform?: (result: unknown) => unknown,
 *   onError?: (error: unknown) => void,
 * }} [opts] `readonly` marks the method retry-safe on transient failures,
 *   `transform` post-processes a successful result, and `onError` is the
 *   legacy error callback the module APIs accept alongside the promise.
 * @returns {Promise<unknown>}
 */
async function driverCall (call, opts = {}) {
    const { responseType = '', readonly = false, transform, onError } = opts;
    const puter = callInstance(call);

    const fail = (error) => {
        if ( typeof onError === 'function' ) onError(error);
        throw error;
    };

    // A signed-out visitor on a third-party page gets the sign-in flow first.
    if ( ! puter.authToken && puter.env === 'web' ) {
        try {
            await puter.ui.authenticateWithPuter();
        } catch ( e ) {
            const canceled = { code: 'auth_canceled', message: 'Authentication canceled' };
            logCall(call, { error: canceled });
            throw { error: canceled };
        }
    }

    const spec = {
        url: `${puter.APIOrigin}/drivers/call`,
        method: 'POST',
        headers: { 'Content-Type': DRIVER_CONTENT_TYPE },
        withCredentials: true,
        responseType,
        // Rebuilt per attempt, so a reauth replay carries the fresh token.
        buildBody: () => callBody(call, puter),
    };

    return await sendWithRetry(spec, {
        retrySafe: readonly,
        permission: `driver:${call.iface}:${call.method}`,
        shapeStream: lineStream => driverLineStream(lineStream, puter),
        // Reauth, permission grants, and transient retries are already spent by
        // the time the engine hands the outcome over, so this is terminal.
        shape: async (outcome) => {
            if ( outcome.networkError ) {
                logCall(call, { error: { message: 'Network error occurred' } });
                return fail(outcome.xhr);
            }

            const { status } = outcome.xhr;
            const resp = await parseResponse(outcome.xhr);
            const failed = status >= 400 || resp?.success === false;
            logCall(call, { result: failed ? null : resp, error: failed ? resp : null });

            if ( status === 402 || resp?.error?.code === 'insufficient_funds'
                || resp?.error?.status === 402 || resp?.metadata?.usage_limited === true ) {
                await promptUpgrade(puter, 'Your account has not enough funding to complete this request.<br>Please upgrade to continue.');
            }
            promptEmailConfirmation(puter, resp?.error);

            if ( status === 401 || resp?.code === 'token_auth_failed' ) {
                return fail({ status: 401, message: 'Unauthorized' });
            }
            if ( status && status !== 200 ) return fail(resp);
            if ( resp.success === false ) return fail(resp);

            const result = resp.result !== undefined ? resp.result : resp;
            return transform ? await transform(result) : result;
        },
    });
}

/**
 * Driver call resolving the response envelope (`{ success, result }`) as the
 * backend sent it — the shape `puter.drivers.call()` has always returned. A
 * driver-level failure resolves with the envelope instead of rejecting; only
 * transport failures and unreadable responses throw.
 *
 * NDJSON resolves an async iterator of parsed lines and `octet-stream` a Blob,
 * neither with the per-line prompts `driverCall` layers on.
 *
 * @param {DriverCall} call
 * @returns {Promise<unknown>}
 */
async function driverCallEnvelope (call) {
    const puter = callInstance(call);
    try {
        const resp = await fetchUrl(`${puter.APIOrigin}/drivers/call`, {
            method: 'POST',
            headers: { 'Content-Type': DRIVER_CONTENT_TYPE },
            body: callBody(call, puter),
        });

        // TODO: parser for Content-Type
        const contentType = (resp.headers.get('content-type') ?? '').split(';')[0].trim();
        const result = await (() => {
            switch ( contentType ) {
            case 'application/x-ndjson': return resp.stream();
            case 'application/octet-stream': return resp.blob();
            // A response that declares no type at all is JSON, the API's default.
            case 'application/json': case '': return resp.json();
            default: throw new Error(`unrecognized content type: ${contentType}`);
            }
        })();

        logCall(call, { result });
        return result;
    } catch ( error ) {
        logCall(call, {
            error: { message: error?.message ?? String(error), stack: error?.stack },
        });
        throw error;
    }
}

export {
    buildXhr,
    dedupe,
    driverCall,
    driverCallEnvelope,
    fetchUrl,
    parseResponse,
    resolveReauth,
    sendWithRetry,
};
