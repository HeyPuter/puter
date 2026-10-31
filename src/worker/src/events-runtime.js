/*
 * The events worker runtime: prepended to an app's generated handler code, and
 * the whole of what that code runs inside. Import-free so it can be inlined
 * into `template/puter-events.template` as-is.
 *
 * Unlike the router runtime it has no `router` and no `me` — no worker token
 * is deployed with an events worker, so a handler acts as the subscriber whose
 * delivery it is running, from the token on the invocation.
 *
 * Every answer carries `x-puter-events-handled: 1`, built from a `Response`
 * captured before handler code can run — so a handler cannot spoof it — and,
 * on the runtime's own failure answers, a machine-readable `x-puter-events-error`
 * naming which one: `bad-key`, `bad-body`, `handler-broken`, `unknown-handler`,
 * `no-token`, `platform-error`, `handler-threw`, `handler-terminal`.
 *
 * A handler that throws a retryable error (see `isRetryableError`, inlined
 * ahead of this file) answers 500 and is retried; any other throw answers 400
 * and drops the event. A throw after a Puter API call from `user` failed with
 * a 429, a 5xx or a network error answers 500 `platform-error`, with that
 * call's `retry-after` when it had one, unless the handler marked it terminal.
 *
 * An unauthorized invocation answers 500 rather than 401: the only way to get
 * one is a platform-side fault (a key rotated under a resident script), which
 * a redeploy fixes, and a 4xx would retire the delivery instead.
 */

(() => {
    'use strict';

    // Captured before any handler code can run, so a handler cannot forge the
    // handled header by reassigning the global `Response`.
    const NativeResponse = Response;
    // Captured for the same reason: handler code cannot replace it.
    const isRetryable =
        typeof isRetryableError === 'function' ? isRetryableError : () => false;
    const isTerminal =
        typeof isTerminalError === 'function' ? isTerminalError : () => false;
    const isFailureStatus =
        typeof isRetryableStatus === 'function'
            ? isRetryableStatus
            : () => false;
    const nativeFetch = globalThis.fetch.bind(globalThis);

    const INVOKE_PATH = '/__events/invoke';
    const HANDLED_HEADER = 'x-puter-events-handled';
    const ERROR_HEADER = 'x-puter-events-error';

    const handlers = Object.create(null);
    const broken = Object.create(null);

    /** What generated code registers into. The only global the runtime adds. */
    globalThis.__puterEvents = Object.freeze({
        register(name, fn) {
            handlers[name] = fn;
        },
        /** Published, but its stored source does not parse as a function. */
        markBroken(name) {
            broken[name] = true;
        },
    });

    // Taken out of the global scope before any handler code has run, so the
    // key cannot be read back out of the isolate by the app's own handlers.
    // Reaching the dispatcher needs a separate secret this worker never sees,
    // so a leaked key is not by itself an invocation — but there is no reason
    // for it to be readable.
    const invokeKey =
        typeof globalThis.events_invoke_key === 'string'
            ? globalThis.events_invoke_key
            : '';
    try {
        delete globalThis.events_invoke_key;
    } catch {
        globalThis.events_invoke_key = undefined;
    }

    const apiOrigin = globalThis.puter_endpoint || 'https://api.puter.com';
    const apiHost = new URL(apiOrigin).origin;

    /** Seconds from a `retry-after` header, as ms; 0 when absent or a date. */
    const retryAfterMs = (value) => {
        const seconds = Number(value);
        return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
    };

    const isApiRequest = (input) => {
        try {
            const url = typeof input === 'string' ? input : input?.url;
            return new URL(String(url), apiOrigin).origin === apiHost;
        } catch {
            return false;
        }
    };

    /**
     * The fetch a client's puter.js calls go through, counting Puter API
     * answers that were Puter's failure against the run holding the client when
     * the call was made.
     */
    const observedFetch = (entry) => async (input, init) => {
        const failures = entry.failures;
        const toApi = failures !== null && isApiRequest(input);
        let response;
        try {
            response = await nativeFetch(input, init);
        } catch (err) {
            if (toApi && err?.name !== 'AbortError') {
                failures.count++;
                failures.retryAfterMs = 0;
            }
            throw err;
        }
        if (toApi && isFailureStatus(response.status)) {
            failures.count++;
            failures.retryAfterMs = retryAfterMs(
                response.headers.get('retry-after'),
            );
        }
        return response;
    };

    // Deliveries arriving on the same token reuse its clients rather than
    // rebuilding puter.js each time. Keyed on the token itself so a client is
    // only ever handed back to the identity it was built for — the JWT carries
    // an `iat`, so this hits within a burst rather than across a quiet gap.
    // A client serves one run at a time, so the failures it sees are that
    // run's: a run overlapping another on the same token gets its own client.
    // Idle clients are bounded and kept in release order, oldest dropped first.
    const MAX_IDLE_CLIENTS = 32;
    const idleByToken = new Map();
    let idleCount = 0;

    const takeClient = (token) => {
        const idle = idleByToken.get(token);
        if (idle) {
            idleCount--;
            if (idle.length === 1) idleByToken.delete(token);
            return idle.pop();
        }
        const entry = { client: null, failures: null };
        entry.client = init_puter_portable(token, apiOrigin, 'userPuter', {
            // No delivery room, no presence, no per-invocation socket: this
            // client only ever makes plain API calls on the handler's behalf.
            socket: false,
            fetch: observedFetch(entry),
        });
        return entry;
    };

    const releaseClient = (token, entry) => {
        entry.failures = null;
        const idle = idleByToken.get(token) ?? [];
        idleByToken.delete(token);
        idle.push(entry);
        idleByToken.set(token, idle);
        if (++idleCount > MAX_IDLE_CLIENTS) {
            const [oldestToken, oldest] = idleByToken.entries().next().value;
            oldest.shift();
            idleCount--;
            if (oldest.length === 0) idleByToken.delete(oldestToken);
        }
    };

    /**
     * Every answer is provably this runtime's own — built from the `Response`
     * captured before handler code ran — and carries the handled header.
     * `errorCode` names one of the runtime's own failure modes; a handler's
     * own 2xx/4xx/500 carries none.
     */
    const answer = (status, body, errorCode, retryAfter = 0) => {
        const headers = {
            'content-type': 'application/json',
            [HANDLED_HEADER]: '1',
        };
        if (errorCode) headers[ERROR_HEADER] = errorCode;
        if (retryAfter > 0)
            headers['retry-after'] = String(Math.ceil(retryAfter / 1000));
        return new NativeResponse(JSON.stringify(body), { status, headers });
    };

    /**
     * Constant-time compare, so the key cannot be recovered a byte at a time
     * from how long the comparison took. `timingSafeEqual` is not in this
     * runtime.
     */
    const keysEqual = (a, b) => {
        if (typeof a !== 'string' || typeof b !== 'string') return false;
        if (a.length !== b.length || a.length === 0) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) {
            diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return diff === 0;
    };

    const handle = async (request) => {
        if (
            request.method !== 'POST' ||
            new URL(request.url).pathname !== INVOKE_PATH
        ) {
            return answer(404, { error: 'not an invocation' });
        }
        if (
            !keysEqual(
                request.headers.get('x-puter-events-key') ?? '',
                invokeKey,
            )
        ) {
            return answer(
                500,
                { error: 'not an authorized invocation' },
                'bad-key',
            );
        }

        let body = null;
        try {
            body = await request.json();
        } catch {
            /* answered below */
        }
        if (!body || typeof body !== 'object') {
            return answer(400, { error: 'body must be a JSON object' }, 'bad-body');
        }

        const name = typeof body.handler === 'string' ? body.handler : '';
        // Published but not runnable: retriable, so republishing a fixed
        // source is picked up rather than the delivery being dropped.
        if (broken[name])
            return answer(
                500,
                { error: 'handler failed to load' },
                'handler-broken',
            );
        const run = handlers[name];
        if (!run)
            return answer(404, { error: 'unknown handler' }, 'unknown-handler');

        // Nothing to run the handler as. Platform-side, so retriable.
        const token = typeof body.token === 'string' ? body.token : '';
        if (!token)
            return answer(500, { error: 'missing delivery token' }, 'no-token');

        // `ack()` releases the delivery early; a later throw does not unsay it.
        let acked = false;
        const ack = () => {
            acked = true;
            return Promise.resolve();
        };
        const ctx = Object.freeze(
            body.ctx === null || body.ctx === undefined ? {} : body.ctx,
        );

        const user = takeClient(token);
        const failures = { count: 0, retryAfterMs: 0 };
        user.failures = failures;
        try {
            await run({
                event: body.event,
                ctx,
                user: user.client,
                fetch: globalThis.fetch.bind(globalThis),
                ack,
            });
            return answer(200, { ok: true });
        } catch (err) {
            if (acked) return answer(200, { ok: true });
            const message =
                err && err.message ? String(err.message) : String(err);
            if (failures.count > 0 && !isTerminal(err))
                return answer(
                    500,
                    { error: message },
                    'platform-error',
                    failures.retryAfterMs,
                );
            const retry = isRetryable(err);
            return answer(
                retry ? 500 : 400,
                { error: message },
                retry ? 'handler-threw' : 'handler-terminal',
            );
        } finally {
            releaseClient(token, user);
        }
    };

    self.addEventListener('fetch', (event) => {
        event.respondWith(handle(event.request));
    });
})();
