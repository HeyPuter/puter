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
import { promptIfUpgradeRequired } from './upgradePrompt.js';

/** @typedef {import('./types.js').UpgradePromptContext} UpgradePromptContext */

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
 * A background request's 401: drop the dead token and tell listeners, but never
 * raise sign-in UI. The visitor didn't ask for anything, so a popup or consent
 * dialog opening on its own reads as the site misbehaving; the next call the
 * user actually initiates does the prompting.
 *
 * @param {Object} resp - The parsed response body.
 * @param {string} [sentToken] - The token the failed request carried.
 * @returns {{ action: 'reject'; error: Object }}
 */
function resolveBackgroundReauth(resp, sentToken) {
    puter.dropStaleAuthToken({
        reason: resp.reason,
        auth_id: resp.auth_id,
        sentToken,
    });
    return {
        action: 'reject',
        error: {
            status: 401,
            code: resp.code,
            reason: resp.reason,
            auth_id: resp.auth_id,
            message: 'Reauthentication required',
        },
    };
}

/**
 * Shared 401 reauth policy for a parsed response body. Drives the env-specific
 * reauth flow on the Puter class and tells the caller what to do next, so the
 * fetch replacement (`fetchUrl`) and the generic XHR path (`handle_resp` in
 * utils.js) apply the exact same policy.
 *
 * Recognised backend signals:
 *
 * - `reauth_required` (`authProbe`): revoked sessions and expired sessions
 *   beyond the silent re-mint window.
 * - `token_auth_failed` (legacy `APIError.create('token_auth_failed')`): token no
 *   longer valid, prompt re-login (web env only).
 *
 * @param {Object} resp - The parsed response body.
 * @param {Object} [opts]
 * @param {boolean} [opts.interactive=true] - Whether this request may raise
 *   sign-in UI. False for requests the user didn't ask for (see
 *   `resolveBackgroundReauth`). Default is `true`
 * @param {string} [opts.sentToken] - The token the failed request carried, so a
 *   background reauth only discards a token that is still the current one.
 * @returns {Promise<
 *     { action: 'replay' } | { action: 'reject'; error: Object } | null
 * >}
 *   `replay` when the caller should re-issue the request once with the fresh
 *   token, `reject` with the error to surface, or `null` when this is not a
 *   reauth-recoverable 401 and the caller should handle it normally.
 */
async function resolveReauth(resp, { interactive = true, sentToken } = {}) {
    // A godmode app's token expires on schedule and the desktop renews it.
    // Asking shows no UI, so background requests ask too.
    if (
        (resp?.code === 'reauth_required' ||
            resp?.code === 'token_auth_failed') &&
        puter.env === 'app' &&
        puter.isGodmodeToken_?.(sentToken ?? puter.authToken)
    ) {
        // Renewed while this request was in flight.
        if (sentToken && puter.authToken && sentToken !== puter.authToken) {
            return { action: 'replay' };
        }
        try {
            await puter.triggerReauth({
                reason: resp.reason ?? 'token_expired',
            });
            return { action: 'replay' };
        } catch (e) {
            return {
                action: 'reject',
                error: {
                    status: 401,
                    code: resp.code,
                    reason: resp.reason,
                    message: e?.message || 'Reauthentication required',
                },
            };
        }
    }
    if (resp?.code === 'reauth_required') {
        if (!interactive) return resolveBackgroundReauth(resp, sentToken);
        try {
            await puter.triggerReauth({
                reason: resp.reason,
                auth_id: resp.auth_id,
            });
            return { action: 'replay' };
        } catch (e) {
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
    if (resp?.code === 'token_auth_failed' && puter.env === 'web') {
        if (!interactive) return resolveBackgroundReauth(resp, sentToken);
        try {
            puter.resetAuthToken();
            await puter.ui.authenticateWithPuter();
        } catch (e) {
            return {
                action: 'reject',
                error: {
                    error: {
                        code: 'auth_canceled',
                        message: 'Authentication canceled',
                    },
                },
            };
        }
    }
    return null;
}

// -- Idle timeout --
// A request that makes no progress for its limit is aborted and fails with
// `request_timeout`; any progress restarts the clock. Read-safe requests get
// the short limit only while progress is observable: before headers, or once
// body progress has been seen (the XHR shim reports none for a buffered body).
const READ_IDLE_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 15 * 60_000;

const requestTimeoutError = () => ({
    message: 'Request timed out.',
    code: 'request_timeout',
});

/**
 * Starts the idle clock for a request about to be sent. On expiry the XHR is
 * flagged `_puterTimedOut` and aborted, so its `abort` listeners can tell a
 * timeout from a cancellation.
 *
 * @param {XMLHttpRequest} xhr
 * @param {{ timeout?: number }} spec - `timeout` replaces both limits; `0`
 *   turns the clock off.
 * @param {boolean} readSafe - Eligible for the short limit.
 * @param {boolean} watchUpload - Count upload progress too.
 * @returns {() => void} Stops the clock.
 */
function watchIdle(xhr, spec, readSafe, watchUpload) {
    if (spec.timeout === 0) return () => {};
    let timer;
    let stopped = false;
    let bodyProgress = false;
    const limit = () => {
        if (spec.timeout !== undefined) return spec.timeout;
        if (!readSafe) return IDLE_TIMEOUT_MS;
        if (xhr.readyState < 2) return READ_IDLE_TIMEOUT_MS;
        if (isNdjson(xhr.getResponseHeader('content-type'))) {
            return IDLE_TIMEOUT_MS;
        }
        return bodyProgress ? READ_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
    };
    const stop = () => {
        stopped = true;
        clearTimeout(timer);
    };
    const arm = () => {
        if (stopped) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            stop();
            xhr._puterTimedOut = true;
            xhr.abort();
        }, limit());
    };
    const onBody = () => {
        bodyProgress = true;
        arm();
    };
    xhr.addEventListener('readystatechange', () => {
        // DONE comes before load/error/abort; the XHR shim reaches it on a
        // failed fetch, where its headers can't be read.
        if (xhr.readyState === 4) return stop();
        if (xhr.readyState === 3) bodyProgress = true;
        arm();
    });
    xhr.addEventListener('progress', onBody);
    if (watchUpload) xhr.upload?.addEventListener('progress', arm);
    for (const type of ['load', 'error', 'abort', 'timeout']) {
        xhr.addEventListener(type, stop);
    }
    arm();
    return stop;
}

/**
 * The one XHR builder both `initXhr` (utils.js) and `fetchUrl` wrap. Opens the
 * request, applies headers/credentials/responseType, and stashes the whole
 * `spec` on `xhr._puterReq` as the single replay representation — any attempt
 * (reauth, transient) rebuilds it by calling `buildXhr(spec)` again, which
 * re-reads the live token when `includePuterAuth`. Sending it starts the idle
 * clock (see `watchIdle`).
 *
 * @param {Object} spec
 * @param {string} spec.url - Full request URL.
 * @param {string} [spec.method='GET'] Default is `'GET'`
 * @param {Object} [spec.headers] - Extra headers (nullish values skipped).
 * @param {boolean} [spec.includePuterAuth=false] - Add a fresh `Authorization:
 *   Bearer`. Default is `false`
 * @param {string} [spec.authToken] - The token to send when there is no live
 *   one to read — during construction, before `globalThis.puter` is assigned —
 *   or, without `includePuterAuth`, a token that isn't the live one at all.
 * @param {boolean} [spec.withCredentials=true] Default is `true`
 * @param {string} [spec.responseType=''] Default is `''`
 * @param {Object} [spec.logId] - Pre-built apiCallLogger request id.
 * @param {number} [spec.timeout] - Idle limit in ms, replacing the defaults;
 *   `0` turns it off.
 * @param {{ readSafe?: boolean }} [opts] - `readSafe` selects the short idle
 *   limit.
 * @returns {XMLHttpRequest}
 */
function buildXhr(spec, { readSafe = false } = {}) {
    const {
        url,
        method = 'GET',
        headers = {},
        includePuterAuth = false,
        authToken,
        withCredentials = true,
        responseType = '',
    } = spec;

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = withCredentials;
    xhr.responseType = responseType ?? '';

    const bearer = includePuterAuth
        ? (globalThis.puter?.authToken ?? authToken)
        : authToken;
    if (bearer) {
        // Recorded per attempt: a background 401 only discards the token it was
        // actually sent with, so a reauth that landed in the meantime keeps the
        // fresh one it installed.
        spec._sentAuthToken = bearer;
        xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
    }
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null) {
            xhr.setRequestHeader(name, value);
        }
    }

    xhr._puterReq = spec;
    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
        spec.body = body;
        // An upload listener makes the browser preflight a cross-origin
        // request. One carrying a bearer is preflighted already; driver calls
        // go out as simple requests and must stay that way.
        const stopIdle = watchIdle(xhr, spec, readSafe, !!bearer);
        try {
            return origSend(body);
        } catch (e) {
            stopIdle();
            throw e;
        }
    };

    if (globalThis.puter?.apiCallLogger?.isEnabled()) {
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
 * @typedef {Object} PuterResponse A `fetch`-Response-like view over a
 *   completed (or streaming) XHR.
 * @property {boolean} ok - Status in the 200-299 range.
 * @property {number} status
 * @property {string} statusText
 * @property {string} url - Final response URL.
 * @property {{ get(name: string): string | null }} headers
 * @property {() => Promise<any>} json
 * @property {() => Promise<string>} text
 * @property {() => Promise<Blob>} blob
 * @property {() => Promise<ArrayBuffer>} arrayBuffer
 * @property {() => AsyncGenerator<any>} stream - Parsed NDJSON lines; only
 *   meaningful for `application/x-ndjson` responses.
 */

const isNdjson = (contentType) =>
    (contentType || '').includes('application/x-ndjson');

/** Read the XHR body as text regardless of the responseType it was sent with. */
async function bodyText(xhr) {
    switch (xhr.responseType) {
        case 'blob':
            return await xhr.response.text();
        case 'arraybuffer':
            return new TextDecoder().decode(xhr.response);
        case 'json':
            return JSON.stringify(xhr.response);
        default:
            return xhr.responseText; // '' | 'text'
    }
}

async function bodyBlob(xhr) {
    if (xhr.responseType === 'blob') return xhr.response;
    const type =
        xhr.getResponseHeader('content-type') || 'application/octet-stream';
    if (xhr.responseType === 'arraybuffer')
        return new Blob([xhr.response], { type });
    return new Blob([await bodyText(xhr)], { type });
}

async function bodyArrayBuffer(xhr) {
    if (xhr.responseType === 'arraybuffer') return xhr.response;
    return await (await bodyBlob(xhr)).arrayBuffer();
}

async function bodyJson(xhr) {
    if (xhr.responseType === 'json') return xhr.response;
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
async function parseResponse(xhr) {
    if (xhr.responseType !== 'blob') {
        try {
            return JSON.parse(xhr.responseText);
        } catch (e) {
            return xhr.responseText;
        }
    }

    const contentType = xhr.getResponseHeader('content-type');
    // No declared type (a bodiless 204, a proxy that strips it): a success is
    // opaque bytes, an error body is read like a JSON one.
    const untypedError = !contentType && !(xhr.status >= 200 && xhr.status < 300);
    if (contentType?.startsWith('application/json') || untypedError) {
        const text = await xhr.response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            return text;
        }
    }
    if (!contentType || contentType.startsWith('application/octet-stream')) {
        return xhr.response;
    }
    return { success: true, result: xhr.response };
}

function makeResponse(xhr, stream) {
    const status = xhr.status;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: xhr.statusText,
        url: xhr.responseURL || '',
        headers: { get: (name) => xhr.getResponseHeader(name) },
        text: () => bodyText(xhr),
        json: () => bodyJson(xhr),
        blob: () => bodyBlob(xhr),
        arrayBuffer: () => bodyArrayBuffer(xhr),
        stream: () => {
            if (!stream) {
                throw new Error(
                    'stream() is only available for application/x-ndjson responses',
                );
            }
            return stream;
        },
    };
}

function logRequest(logId, { result = null, error = null } = {}) {
    if (!logId || !globalThis.puter?.apiCallLogger?.isEnabled()) return;
    globalThis.puter.apiCallLogger.logRequest({ ...logId, result, error });
}

/**
 * Best-effort body for logging — parsed JSON where sensible, else a
 * placeholder.
 */
async function bodyForLog(xhr) {
    const contentType = xhr.getResponseHeader('content-type') || '';
    if (
        xhr.responseType === '' ||
        xhr.responseType === 'text' ||
        contentType.includes('json')
    ) {
        try {
            return await bodyJson(xhr);
        } catch (e) {
            try {
                return await bodyText(xhr);
            } catch (e2) {
                return null;
            }
        }
    }
    return `[${contentType || 'binary'}]`;
}

// -- Retry engine --
// One loop drives every request: build the XHR from its spec, send, classify
// the outcome, and either replay (reauth / transient backoff) or hand the
// result to the caller's shaper. A replay just rebuilds from the same spec, so
// there are no hand-listed argument lists to get wrong.

// Transient statuses that may or may not have run the handler. A 502/503/504
// can mean the request was half-applied upstream, so only a read replays.
const RETRYABLE_STATUS = new Set([502, 503, 504]);

// A rate/concurrency gate rejects in middleware, before the handler that would
// have done the work — so nothing happened, and replaying is safe for a write
// exactly as it is for a read. Treating this like the statuses above meant a
// multi-file upload or a burst of driver writes surfaced the gate as a hard
// failure to the app, when waiting a moment is the whole remedy.
const GATE_REJECT_STATUS = 429;

// Fixed retry backoff: a quick ramp to a 2s ceiling, then hold at 2s. Index i is
// the wait (ms) after attempt i+1 fails. The array length caps the retries — 8
// delays ⇒ 9 attempts total, the 2s ceiling used 5 times — after which the
// request is failed.
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 2000, 2000, 2000, 2000];
const RETRY_CEILING_MS = 2000;
// If a ceiling-length wait overruns real time by more than this, the clock
// jumped (e.g. the laptop slept mid-wait); the request is stale, so give up
// rather than fire a very old retry.
const MAX_SLEEP_DRIFT_MS = 2000;

// Kill-switch seam: puter.configure() (deferred) will drive this. Default on.
const autoRetryEnabled = () => globalThis.puter?.config?.autoRetry ?? true;

const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(
                signal.reason ?? new DOMException('Aborted', 'AbortError'),
            );
        const onAbort = () => {
            clearTimeout(t);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        // `once` only cleans up when abort fires; a caller reusing one signal
        // across requests would otherwise collect a listener per retry.
        const t = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });

const retryDelay = (attempt) => RETRY_DELAYS_MS[attempt - 1];

const transientRetry = (ctx) => {
    if (!(ctx.retrySafe && autoRetryEnabled())) return null;
    const delayMs = retryDelay(ctx.attempt);
    return delayMs === undefined ? null : { delayMs };
};

// Same backoff schedule as `transientRetry`, but not gated on read-safety —
// see GATE_REJECT_STATUS. An explicit `retry: false` still wins: that is the
// caller saying "never replay this one", and it means it.
const gateRetry = (ctx) => {
    if (!(ctx.retryGated && autoRetryEnabled())) return null;
    const delayMs = retryDelay(ctx.attempt);
    return delayMs === undefined ? null : { delayMs };
};

// A 429 `credits_reserved` means the account's balance is held by its own
// requests still running. It frees up when they finish — anywhere from seconds
// to minutes — so it backs off exponentially, well past the gate schedule's
// 2s ceiling. Same replay rules as the gate otherwise.
const CREDIT_HOLD_RETRY_BASE_MS = 1000;
const CREDIT_HOLD_RETRY_MAX_MS = 30_000;
const CREDIT_HOLD_MAX_RETRIES = 8; // ~2 minutes of waiting in total

const isCreditHoldRejection = (parsed) =>
    [parsed?.errorCode, parsed?.error?.errorCode].includes('credits_reserved');

const creditHoldRetry = (ctx) => {
    if (!(ctx.retryGated && autoRetryEnabled())) return null;
    if (ctx.attempt > CREDIT_HOLD_MAX_RETRIES) return null;
    return {
        delayMs: Math.min(
            CREDIT_HOLD_RETRY_MAX_MS,
            CREDIT_HOLD_RETRY_BASE_MS * 2 ** (ctx.attempt - 1),
        ),
    };
};

// The 403 account-verification gates the hosting GUI can walk a user through.
const VERIFICATION_GATE_CODES = new Set([
    'email_confirmation_required',
    'phone_verification_required',
    'card_verification_required',
]);

/** Whether an error code names one of those gates. */
const isVerificationGateCode = (code) => VERIFICATION_GATE_CODES.has(code);

// Single-flighted per gate: one gate's answer is not another's.
const pendingVerificationGates = new Map();

/**
 * Drive the hosting GUI's verification flow for a 403 `*_required` gate code.
 * Only apps hosted by the Puter GUI can prompt; every other environment
 * resolves unverified and the rejection reaches the caller unchanged.
 *
 * @param {string} code - The gate's error code.
 * @param {string[]} [factors] - Sent when a route asked for a verified factor
 *   rather than the account being flagged: the verifications it accepts, in
 *   the order to offer them.
 * @returns {Promise<{ verified: boolean }>}
 */
async function resolveVerificationGate(code, factors) {
    if (globalThis.puter?.env !== 'app') return { verified: false };
    // The gate alone, as `ctx.done` keys it; factors do not divide it.
    const key = code;
    let pending = pendingVerificationGates.get(key);
    if (!pending) {
        pending = (async () => {
            try {
                const verified = await puter.ui.requestVerificationGate(
                    code,
                    Array.isArray(factors) ? { factors } : {},
                );
                return { verified: verified === true };
            } catch (e) {
                return { verified: false };
            }
        })();
        pendingVerificationGates.set(key, pending);
        // On a microtask, so a sync throw cannot delete before the set.
        pending.finally(() => pendingVerificationGates.delete(key));
    }
    return pending;
}

/**
 * Send one attempt. Resolves with a terminal outcome: { streamed: true, xhr,
 * lineStream } — NDJSON, resolved at HEADERS_RECEIVED { xhr, status } —
 * buffered response (any HTTP status) { networkError: true, timedOut?, xhr } —
 * transport error or idle timeout. Rejects only on abort. Per-line semantics
 * (usage/email prompts, `toString`) belong to the caller's `shapeStream`.
 *
 * @param {Object} spec
 * @param {boolean} [readSafe=false] - Selects the short idle limit.
 */
function sendOnce(spec, readSafe = false) {
    return new Promise((resolve, reject) => {
        const xhr = buildXhr(spec, { readSafe });

        let streamed = false;
        let responseComplete = false;
        let signalStreamUpdate = null;
        const lines = [];
        let carry = '';
        let consumed = 0;

        let streamError;
        const abortRequest = () => xhr.abort();
        const removeAbortListener = () =>
            spec.signal?.removeEventListener('abort', abortRequest);
        const failStream = (error) => {
            streamError = error;
            responseComplete = true;
            signalStreamUpdate?.();
            removeAbortListener();
        };
        const lineStream = (async function* () {
            try {
                while (true) {
                    if (streamError) throw streamError;
                    while (lines.length > 0) {
                        const line = lines.shift();
                        if (line.trim() === '') continue;
                        yield JSON.parse(line);
                        if (streamError) throw streamError;
                    }
                    if (responseComplete) break;
                    const sig = createDeferred();
                    signalStreamUpdate = sig.resolve;
                    await sig.promise;
                }
            } finally {
                if (!responseComplete) xhr.abort();
                removeAbortListener();
            }
        })();
        const returnStream = lineStream.return.bind(lineStream);
        lineStream.return = (value) => {
            if (!responseComplete) xhr.abort();
            return returnStream(value);
        };

        xhr.onreadystatechange = () => {
            if (
                xhr.readyState === 2 &&
                isNdjson(xhr.getResponseHeader('Content-Type'))
            ) {
                streamed = true;
                resolve({ streamed: true, xhr, lineStream });
            }
        };

        xhr.onprogress = () => {
            if (!streamed) return;
            const fresh = xhr.responseText.slice(consumed);
            consumed = xhr.responseText.length;
            if (!fresh) return;
            carry += fresh;
            let nl;
            while ((nl = carry.indexOf('\n')) !== -1) {
                lines.push(carry.slice(0, nl));
                carry = carry.slice(nl + 1);
            }
            signalStreamUpdate?.();
        };

        xhr.addEventListener('load', () => {
            removeAbortListener();
            if (!streamed) {
                resolve({ xhr, status: xhr.status });
                return;
            }
            xhr.onprogress();
            if (carry.length > 0) {
                lines.push(carry);
                carry = '';
            }
            responseComplete = true;
            signalStreamUpdate?.();
        });
        const timedOut = () => {
            failStream(requestTimeoutError());
            resolve({ networkError: true, timedOut: true, xhr });
        };
        xhr.addEventListener('timeout', timedOut);
        xhr.addEventListener('error', () => {
            failStream({ message: 'Network request failed.', code: 'network_error' });
            resolve({ networkError: true, xhr });
        });
        xhr.addEventListener('abort', () => {
            if (xhr._puterTimedOut) return timedOut();
            const error = spec.signal?.reason ??
                new DOMException('Aborted', 'AbortError');
            failStream(error);
            reject(error);
        });

        if (spec.signal) {
            if (spec.signal.aborted)
                return reject(
                    spec.signal.reason ??
                        new DOMException('Aborted', 'AbortError'),
                );
            spec.signal.addEventListener('abort', abortRequest, { once: true });
        }

        const body =
            typeof spec.buildBody === 'function' ? spec.buildBody() : spec.body;
        xhr.send(body ?? null);
    });
}

/**
 * Classify a completed attempt into a retry decision. Reauth and the
 * phone-verification gate are one-shot (tracked in `ctx.done`) and apply to any
 * request; transient backoff applies only to `ctx.retrySafe` requests and
 * honors the autoRetry kill switch. Memoizes the parsed body on
 * `outcome.parsed` and stashes any reauth error on `outcome.reauthError` for
 * the shaper.
 *
 * @returns {Promise<{ delayMs: number } | null>} A delay to retry after, or
 *   null to stop.
 */
async function classifyRetry(outcome, ctx) {
    if (outcome.streamed) return null; // committed stream — never retried

    // An idle timeout replays once, on the read-safe rule: a fresh connection
    // is the cure for a dead one, and a stall that repeats isn't transient.
    if (outcome.timedOut) {
        if (ctx.done.has('timeout')) return null;
        const decision = transientRetry(ctx);
        if (decision) ctx.done.add('timeout');
        return decision;
    }
    if (outcome.networkError) return transientRetry(ctx);

    const { xhr, status } = outcome;
    if (outcome.parsed === undefined) {
        outcome.parsed = await bodyJson(xhr).catch(() => null);
    }
    const parsed = outcome.parsed;

    // reauth (401 / token_auth_failed) — one-shot, any method, no backoff.
    if (status === 401 || parsed?.code === 'token_auth_failed') {
        if (!ctx.done.has('reauth')) {
            const spec = xhr?._puterReq;
            const reauth = await resolveReauth(parsed, {
                interactive: spec?.interactiveReauth !== false,
                sentToken: spec?._sentAuthToken,
            });
            if (reauth?.action === 'replay') {
                ctx.done.add('reauth');
                return { delayMs: 0 };
            }
            if (reauth?.action === 'reject') outcome.reauthError = reauth.error;
        }
        return null;
    }

    // account verification gate (403) — one-shot per gate, any method, no
    // backoff. The gate rejects in middleware before the handler runs, so
    // replay is safe once the user clears it; a user behind several gates
    // clears them one replay at a time (email → phone → card).
    const gateCode = [parsed?.code, parsed?.error?.code].find((c) =>
        isVerificationGateCode(c),
    );
    if (status === 403 && gateCode) {
        if (!ctx.done.has(gateCode)) {
            const res = await resolveVerificationGate(
                gateCode,
                parsed?.factors ?? parsed?.error?.factors,
            );
            if (res.verified) {
                ctx.done.add(gateCode);
                return { delayMs: 0 };
            }
        }
        return null;
    }

    // gate rejection — any method, honors kill switch, fixed schedule (an
    // exponential one when it's waiting on the account's own requests).
    if (status === GATE_REJECT_STATUS) {
        return isCreditHoldRejection(parsed)
            ? creditHoldRetry(ctx)
            : gateRetry(ctx);
    }

    // transient status — read-safe only, honors kill switch, fixed schedule.
    if (RETRYABLE_STATUS.has(status)) return transientRetry(ctx);

    return null;
}

/**
 * The one retry loop. Sends `spec` (rebuilding per attempt), classifies each
 * outcome, and retries on reauth / transient causes; otherwise hands the
 * outcome to `shape`.
 *
 * @param {Object} spec - BuildXhr spec (+ optional buildBody, signal,
 *   timeout).
 * @param {Object} opts
 * @param {boolean} [opts.retrySafe=false] - Eligible for transient backoff
 *   retry and the short idle limit. Default is `false`
 * @param {boolean} [opts.retryGated=true] - Eligible for 429 backoff retry,
 *   regardless of method (the gate rejects before the handler runs). Default is
 *   `true`
 * @param {(lineStream, xhr) => any} opts.shapeStream - Wrap an NDJSON stream.
 * @param {(outcome) => any} opts.shape - Shape a buffered outcome (may throw).
 */
async function sendWithRetry(
    spec,
    {
        retrySafe = false,
        retryGated = true,
        shapeStream,
        shape,
    },
) {
    const ctx = {
        attempt: 0,
        retrySafe,
        retryGated,
        done: new Set(),
    };
    while (true) {
        ctx.attempt++;
        const outcome = await sendOnce(spec, retrySafe);
        if (outcome.streamed)
            return shapeStream(outcome.lineStream, outcome.xhr);
        const decision = await classifyRetry(outcome, ctx);
        if (decision) {
            const before = Date.now();
            await sleep(decision.delayMs, spec.signal);
            if (
                decision.delayMs >= RETRY_CEILING_MS &&
                Date.now() - before - decision.delayMs > MAX_SLEEP_DRIFT_MS
            ) {
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
 * @param {string} key - Fully-qualified request key (namespace it yourself,
 *   e.g. `${method}:${url}:${bodyKey}`).
 * @param {() => Promise<any>} factory - Runs the request; called only on a
 *   miss.
 * @param {{ windowMs?: number }} [opts]
 * @returns {Promise<any>} Shared promise (resolved value shared by reference).
 */
function dedupe(key, factory, { windowMs = 2000 } = {}) {
    const existing = inflightRequests.get(key);
    if (existing) {
        if (Date.now() - existing.timestamp < windowMs) return existing.promise;
        inflightRequests.delete(key); // stale — fall through and re-issue
    }
    const promise = factory();
    inflightRequests.set(key, { promise, timestamp: Date.now() });
    const cleanup = () => {
        if (inflightRequests.get(key)?.promise === promise)
            inflightRequests.delete(key);
    };
    promise.then(cleanup, cleanup);
    return promise;
}

/**
 * XHR-based `fetch()` replacement. Returns a `fetch`-Response-like object.
 *
 * Fetch semantics: the promise resolves for any HTTP status (`ok` reflects
 * 2xx); it rejects only on network/abort errors. The one exception is a 401
 * carrying a reauth signal — the reauth flow is driven first and, on success,
 * the request is replayed once with the fresh token (transparent recovery). A
 * non-recoverable 401 resolves as an `ok: false` response like any other.
 *
 * @param {string} url - Full request URL (callers own origin composition).
 * @param {Object} [opts]
 * @param {boolean} [opts.includePuterAuth=false] - Add `Authorization: Bearer
 *   <puter.authToken>`. Default is `false`
 * @param {string} [opts.authToken] - The Bearer credential to send when the
 *   live `puter.authToken` can't be read yet (boot-time calls, before the
 *   global is assigned) or, without `includePuterAuth`, a token that isn't the
 *   live one at all (one being exchanged for another).
 * @param {string} [opts.method='GET'] Default is `'GET'`
 * @param {Object} [opts.headers] - Extra request headers (undefined/null values
 *   skipped).
 * @param {string | Blob | ArrayBuffer | FormData | null} [opts.body]
 * @param {'' | 'text' | 'json' | 'blob' | 'arraybuffer'} [opts.responseType='']
 *   Default is `''`
 * @param {boolean} [opts.withCredentials=true] Default is `true`
 * @param {AbortSignal} [opts.signal]
 * @param {{ service: string; operation: string; params?: Object }} [opts.logContext]
 *   Semantic context for the centralized API-call log. Omit to log generically.
 * @param {boolean} [opts.retry] - Force-enable (`true`) or disable (`false`)
 *   transient-failure auto-retry for this request; omit for the default
 *   (idempotent methods retry, others don't). Never retries a write.
 * @param {boolean | string} [opts.dedupe] - Coalesce concurrent identical
 *   in-flight requests (reads only): `true` auto-keys by method+url+body, or
 *   pass a key.
 * @param {boolean} [opts.interactiveReauth=true] - Whether a reauth-recoverable
 *   401 may raise sign-in UI. Pass `false` for requests the user didn't ask for
 *   (boot telemetry, cache warmers): the stale token is dropped silently and
 *   the 401 surfaces to the caller instead. Default is `true`
 * @param {number} [opts.timeout] - Idle limit in ms, replacing the defaults
 *   (see `watchIdle`); `0` turns it off.
 * @param {Object} [opts.paginate] - Reserved for a later sprint step (ignored).
 * @returns {Promise<PuterResponse>}
 */
function fetchUrl(url, opts = {}) {
    const {
        includePuterAuth = false,
        authToken,
        method = 'GET',
        headers = {},
        body = null,
        responseType = '',
        withCredentials = true,
        signal,
        logContext,
        retry,
        dedupe: dedupeOpt,
        interactiveReauth = true,
        timeout,
    } = opts;

    const logId = logContext ?? {
        service: 'fetchUrl',
        operation: `${method} ${url}`,
        params: { url, method },
    };
    const spec = {
        url,
        method,
        headers,
        includePuterAuth,
        authToken,
        withCredentials,
        responseType,
        body,
        signal,
        logId,
        interactiveReauth,
        timeout,
    };

    // Read-safety: idempotent methods auto-retry; a POST read opts in with
    // `retry:true`; nothing retries when `retry:false` (writes/uploads).
    const idempotent = method === 'GET' || method === 'HEAD';
    const retrySafe = retry === false ? false : retry === true || idempotent;
    // A 429 is the exception: the request never ran, so a write replays too.
    const retryGated = retry !== false;

    const loggingOn = () => globalThis.puter?.apiCallLogger?.isEnabled();

    const run = () =>
        sendWithRetry(spec, {
            retrySafe,
            retryGated,
            shapeStream: (lineStream, xhr) => {
                if (loggingOn()) logRequest(logId, { result: '[stream]' });
                return makeResponse(xhr, lineStream);
            },
            shape: async (outcome) => {
                if (outcome.timedOut) {
                    if (loggingOn())
                        logRequest(logId, { error: requestTimeoutError() });
                    // A TypeError, as `fetch` rejects with, carrying the code.
                    const error = new TypeError(
                        `Network request to ${url} timed out`,
                    );
                    error.code = 'request_timeout';
                    throw error;
                }
                if (outcome.networkError) {
                    if (loggingOn())
                        logRequest(logId, {
                            error: { message: 'Network error occurred' },
                        });
                    throw new TypeError(`Network request to ${url} failed`);
                }
                const { xhr } = outcome;
                const resp = makeResponse(xhr);
                if (loggingOn()) {
                    const logged = await bodyForLog(xhr);
                    logRequest(
                        logId,
                        xhr.status >= 400
                            ? {
                                  error: logged ?? {
                                      message: xhr.statusText,
                                      status: xhr.status,
                                  },
                              }
                            : { result: logged },
                    );
                }
                return resp;
            },
        });

    if (dedupeOpt) {
        const bodyKey =
            body == null ? '' : typeof body === 'string' ? body : '[body]';
        const key =
            typeof dedupeOpt === 'string'
                ? dedupeOpt
                : `${method}:${url}:${bodyKey}`;
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
 *     iface: string;
 *     method: string;
 *     args?: unknown;
 *     driver?: string;
 *     testMode?: boolean;
 *     puter?: unknown;
 * }} DriverCall
 *   A driver method to invoke. `iface` is the interface name and `driver` the
 *   concrete implementation behind it, which the backend resolves to the
 *   interface's default when omitted. `puter` is the SDK instance the call runs
 *   against; it falls back to the global instance.
 */

const callInstance = (call) => call.puter ?? globalThis.puter;

/** The wire body. Fields left `undefined` drop out of the JSON. */
const callBody = (call, puter) =>
    JSON.stringify({
        interface: call.iface,
        driver: call.driver,
        test_mode: call.testMode,
        method: call.method,
        args: call.args,
        auth_token: puter.authToken,
    });

const logCall = (call, fields) => {
    if (!globalThis.puter?.apiCallLogger?.isEnabled()) return;
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

function promptEmailConfirmation(puter, error) {
    if (error?.code !== 'email_must_be_confirmed' || puter.env !== 'web')
        return;
    showEmailConfirmationDialog(
        error.message ||
            'Email confirmation required. Go to Puter.com to confirm your email address.',
    );
}

/**
 * Chunk types with no text to render — a `ReadableStream` reader (or anything
 * else that coerces a line to a string) gets `''` instead of the default
 * `[object Object]`.
 */
const SILENT_TOSTRING_CHUNK_TYPES = new Set([
    'reasoning_start',
    'reasoning_detail',
    'tool_use_start',
    'tool_input_delta',
    'server_tool',
    'safeguard_results',
]);

/**
 * Wrap the engine's parsed NDJSON lines in the driver stream contract: the
 * per-line upgrade/email prompts, `toString()` on text parts, and the `start`
 * adapter that lets the stream feed a `ReadableStream` controller.
 */
function driverLineStream(lineStream, puter, upgradePrompt) {
    const stream = (async function* () {
        for await (const line of lineStream) {
            promptIfUpgradeRequired(line, upgradePrompt, puter);
            promptEmailConfirmation(puter, line?.error);
            if (typeof line.text === 'string') {
                Object.defineProperty(line, 'toString', {
                    enumerable: false,
                    value: () => line.text,
                });
            } else if (SILENT_TOSTRING_CHUNK_TYPES.has(line?.type)) {
                Object.defineProperty(line, 'toString', {
                    enumerable: false,
                    value: () => '',
                });
            }
            yield line;
        }
    })();

    const returnStream = stream.return.bind(stream);
    stream.return = async (value) => {
        await lineStream.return();
        return returnStream(value);
    };
    Object.defineProperty(stream, 'cancel', {
        enumerable: false,
        value: () => stream.return(),
    });
    Object.defineProperty(stream, 'start', {
        enumerable: false,
        value: async (controller) => {
            try {
                const encoder = new TextEncoder();
                for await (const part of stream) {
                    controller.enqueue(encoder.encode(part));
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
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
 *     responseType?: '' | 'text' | 'blob';
 *     readonly?: boolean;
 *     transform?: (result: unknown) => unknown;
 *     onError?: (error: unknown) => void;
 *     upgradePrompt?: UpgradePromptContext;
 *     timeout?: number;
 * }} [opts]
 *   `readonly` marks the method retry-safe on transient failures (a
 *   rate/concurrency 429 replays either way — see GATE_REJECT_STATUS),
 *   `timeout` replaces the idle limits in ms (`0` turns it off),
 *   `transform` post-processes a successful result, `onError` is the legacy
 *   error callback the module APIs accept alongside the promise, and
 *   `upgradePrompt` is how the upgrade prompt names this method (defaulting to
 *   the wire `iface::method`) and explains its plan gate.
 * @returns {Promise<unknown>}
 */
async function driverCall(call, opts = {}) {
    const {
        responseType = '',
        readonly = false,
        transform,
        onError,
        upgradePrompt,
        timeout,
    } = opts;
    const puter = callInstance(call);
    const promptContext = {
        ...upgradePrompt,
        method: upgradePrompt?.method ?? `${call.iface}::${call.method}`,
    };

    const fail = (error) => {
        if (typeof onError === 'function') onError(error);
        throw error;
    };

    // A signed-out visitor on a third-party page gets the sign-in flow first.
    if (!puter.authToken && puter.env === 'web') {
        try {
            await puter.ui.authenticateWithPuter();
        } catch (e) {
            const canceled = {
                code: 'auth_canceled',
                message: 'Authentication canceled',
            };
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
        timeout,
    };

    return await sendWithRetry(spec, {
        retrySafe: readonly,
        shapeStream: (lineStream) =>
            driverLineStream(lineStream, puter, promptContext),
        // Reauth and transient retries are already spent by the time the
        // engine hands the outcome over, so this is terminal.
        shape: async (outcome) => {
            if (outcome.timedOut) {
                const error = requestTimeoutError();
                logCall(call, { error });
                return fail(error);
            }
            if (outcome.networkError) {
                logCall(call, { error: { message: 'Network error occurred' } });
                return fail(outcome.xhr);
            }

            const { status } = outcome.xhr;
            const resp = await parseResponse(outcome.xhr);
            const failed = status >= 400 || resp?.success === false;
            logCall(call, {
                result: failed ? null : resp,
                error: failed ? resp : null,
            });

            // The body carries the code; the status is on the XHR. Merge them so
            // a code-less 402 still reads as a refusal.
            promptIfUpgradeRequired(
                resp && typeof resp === 'object' ? { ...resp, status } : { status },
                promptContext,
                puter,
            );
            promptEmailConfirmation(puter, resp?.error);

            if (status === 401 || resp?.code === 'token_auth_failed') {
                return fail({ status: 401, message: 'Unauthorized' });
            }
            if (status && status !== 200) return fail(resp);
            if (resp.success === false) return fail(resp);

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
async function driverCallEnvelope(call) {
    const puter = callInstance(call);
    try {
        const resp = await fetchUrl(`${puter.APIOrigin}/drivers/call`, {
            method: 'POST',
            headers: { 'Content-Type': DRIVER_CONTENT_TYPE },
            body: callBody(call, puter),
        });

        // TODO: parser for Content-Type
        const contentType = (resp.headers.get('content-type') ?? '')
            .split(';')[0]
            .trim();
        const result = await (() => {
            switch (contentType) {
                case 'application/x-ndjson':
                    return resp.stream();
                case 'application/octet-stream':
                    return resp.blob();
                // A response that declares no type at all is JSON, the API's default.
                case 'application/json':
                case '':
                    return resp.json();
                default:
                    throw new Error(
                        `unrecognized content type: ${contentType}`,
                    );
            }
        })();

        logCall(call, { result });
        return result;
    } catch (error) {
        logCall(call, {
            error: {
                message: error?.message ?? String(error),
                stack: error?.stack,
            },
        });
        throw error;
    }
}

export {
    buildXhr,
    dedupe,
    driverCall,
    driverCallEnvelope,
    driverLineStream,
    fetchUrl,
    isVerificationGateCode,
    parseResponse,
    requestTimeoutError,
    resolveReauth,
    resolveVerificationGate,
    sendWithRetry,
};
