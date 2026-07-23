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
const MAX_ATTEMPTS = 5;         // transient attempts (network / retryable 5xx / 429)
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 60_000;    // cap each backoff wait at 1 minute

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

// Full-jitter exponential backoff, each wait capped at MAX_DELAY_MS.
const backoffDelay = attempt => Math.random() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));

/**
 * Drive the env-specific permission prompt for a denied driver call.
 * @returns {Promise<{granted: boolean}>}
 */
async function resolvePermission (permission) {
    try {
        const perm = await puter.ui.requestPermission({ permission });
        return { granted: !! perm?.granted };
    } catch ( e ) {
        return { granted: false };
    }
}

/**
 * Send one attempt. Resolves with a terminal outcome:
 *   { streamed: true, xhr, lineStream } — NDJSON, resolved at HEADERS_RECEIVED
 *   { xhr, status }                     — buffered response (any HTTP status)
 *   { networkError: true, xhr }         — transport error
 * Rejects only on abort. The NDJSON line buffering matches the old inline
 * streaming in fetchUrl and driverCall_; per-line semantics (usage/email/etc.)
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

    if ( outcome.networkError ) {
        return ( ctx.retrySafe && autoRetryEnabled() && ctx.attempt < MAX_ATTEMPTS )
            ? { delayMs: backoffDelay(ctx.attempt) } : null;
    }

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

    // transient status — read-safe only, honors kill switch, bounded + backed off.
    if ( RETRYABLE_STATUS.has(status) ) {
        return ( ctx.retrySafe && autoRetryEnabled() && ctx.attempt < MAX_ATTEMPTS )
            ? { delayMs: backoffDelay(ctx.attempt) } : null;
    }

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
        if ( decision ) { await sleep(decision.delayMs, spec.signal); continue; }
        return shape(outcome);
    }
}

// -- In-flight request dedup --
// Coalesce concurrent identical requests: a second caller within `windowMs`
// gets the first request's promise (shared resolved value). The entry is
// deleted when the request settles. Generalized from the copy-pasted logic in
// FileSystem readdir/stat (which keep their own bespoke cache and are untouched).
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

export { buildXhr, dedupe, fetchUrl, resolveReauth, sendWithRetry };
