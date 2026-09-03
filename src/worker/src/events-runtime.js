/*
 * The events worker runtime: prepended to an app's generated handler code, and
 * the whole of what that code runs inside. Import-free so it can be inlined
 * into `template/puter-events.template` as-is.
 *
 * Unlike the router runtime it has no `router` (one route exists and it is this
 * file's) and no `me` — no worker token is deployed with an events worker, so a
 * handler acts as the subscriber whose delivery it is running, from the token
 * on the invocation, and within that token's grant.
 *
 * What an invocation answers with is the whole protocol:
 *
 * - 2xx — the handler took the delivery (resolved, or called `ack()`).
 * - 404 — no handler by that name, or not the invoke route; terminal.
 * - 400 — the body was not a delivery, or the handler refused it by throwing an
 *   error marked terminal (`terminal: true` or `code: 'events_terminal'`).
 * - 500 — the handler threw, or the invocation could not be trusted; retriable.
 *
 * An unauthorized invocation answers 500 rather than 401 because the only way
 * to get one is a platform-side fault — a key rotated out from under a script
 * that is still resident — which a redeploy fixes. 4xx would retire the
 * delivery instead.
 */

(() => {
    'use strict';

    const INVOKE_PATH = '/__events/invoke';

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

    const answer = (status, body) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        });

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
            return answer(500, { error: 'not an authorized invocation' });
        }

        let body = null;
        try {
            body = await request.json();
        } catch {
            /* answered below */
        }
        if (!body || typeof body !== 'object') {
            return answer(400, { error: 'body must be a JSON object' });
        }

        const name = typeof body.handler === 'string' ? body.handler : '';
        // Published but not runnable: retriable, so republishing a fixed
        // source is picked up rather than the delivery being dropped.
        if (broken[name])
            return answer(500, { error: 'handler failed to load' });
        const run = handlers[name];
        if (!run) return answer(404, { error: 'unknown handler' });

        // Nothing to run the handler as. Platform-side, so retriable.
        const token = typeof body.token === 'string' ? body.token : '';
        if (!token) return answer(500, { error: 'missing delivery token' });

        // `ack()` marks the delivery taken; a later throw does not unsay it.
        let acked = false;
        const ack = () => {
            acked = true;
            return Promise.resolve();
        };
        const ctx = Object.freeze(
            body.ctx === null || body.ctx === undefined ? {} : body.ctx,
        );

        try {
            await run({
                event: body.event,
                ctx,
                user: init_puter_portable(token, apiOrigin, 'userPuter'),
                fetch: globalThis.fetch.bind(globalThis),
                ack,
            });
            return answer(200, { ok: true });
        } catch (err) {
            if (acked) return answer(200, { ok: true });
            const terminal =
                !!err &&
                (err.terminal === true || err.code === 'events_terminal');
            const message =
                err && err.message ? String(err.message) : String(err);
            return answer(terminal ? 400 : 500, { error: message });
        }
    };

    self.addEventListener('fetch', (event) => {
        event.respondWith(handle(event.request));
    });
})();
