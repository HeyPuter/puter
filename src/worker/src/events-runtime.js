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
 * `no-token`, `handler-threw`, `handler-terminal`.
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

    // Deliveries arriving on the same token reuse one client rather than
    // rebuilding puter.js each time. Keyed on the token itself so a client is
    // only ever handed back to the identity it was built for — the JWT carries
    // an `iat`, so this hits within a burst rather than across a quiet gap.
    // Bounded and insertion-ordered: a hit is re-inserted to mark it
    // most-recently-used, and the oldest entry is dropped once it is full.
    const MAX_CLIENTS = 32;
    const clientsByToken = new Map();

    const clientForToken = (token) => {
        const cached = clientsByToken.get(token);
        if (cached) {
            clientsByToken.delete(token);
            clientsByToken.set(token, cached);
            return cached;
        }
        const client = init_puter_portable(token, apiOrigin, 'userPuter', {
            // No delivery room, no presence, no per-invocation socket: this
            // client only ever makes plain API calls on the handler's behalf.
            socket: false,
        });
        clientsByToken.set(token, client);
        if (clientsByToken.size > MAX_CLIENTS) {
            clientsByToken.delete(clientsByToken.keys().next().value);
        }
        return client;
    };

    /**
     * Every answer is provably this runtime's own — built from the `Response`
     * captured before handler code ran — and carries the handled header.
     * `errorCode` names one of the runtime's own failure modes; a handler's
     * own 2xx/4xx/500 carries none.
     */
    const answer = (status, body, errorCode) => {
        const headers = {
            'content-type': 'application/json',
            [HANDLED_HEADER]: '1',
        };
        if (errorCode) headers[ERROR_HEADER] = errorCode;
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
                user: clientForToken(token),
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
            return answer(
                terminal ? 400 : 500,
                { error: message },
                terminal ? 'handler-terminal' : 'handler-threw',
            );
        }
    };

    self.addEventListener('fetch', (event) => {
        event.respondWith(handle(event.request));
    });
})();
