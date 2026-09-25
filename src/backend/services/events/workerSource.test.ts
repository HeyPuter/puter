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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * The generated events worker, executed inside the runtime it is deployed with.
 *
 * The runtime file is the one production prepends — loaded here into a `vm`
 * context with the handful of globals a worker provides (`Response`, `URL`,
 * `fetch`, an `init_puter_portable` stub, the invoke-key binding) — so the
 * whole invoke protocol is pinned without a worker runtime to boot.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { EVENTS_WORKER_SOURCE_MAX_BYTES } from '../../controllers/events/limits.js';
import {
    hashContent,
    type EventHandler,
} from '../../stores/events/EventHandlerStore.js';
import { EVENTS_INVOKE_PATH } from '../../clients/events/EventsWorkerInvokerClient.js';
import {
    generateEventsWorkerSource,
    handlerSetHash,
    EVENTS_GENERATED_SOURCE_MAX_BYTES,
    EVENTS_WORKER_MARKER,
} from './workerSource.js';

const RUNTIME_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../worker/src/events-runtime.js',
);
const RUNTIME_SOURCE = readFileSync(RUNTIME_PATH, 'utf8');

const INVOKE_KEY = 'k1:test-key';
const INVOKE_URL = `http://evw-test.example${EVENTS_INVOKE_PATH}`;

const handler = (name: string, source: string): EventHandler => ({
    appUid: 'app-x',
    name,
    source,
    sourceHash: hashContent(source),
    createdAt: 0,
    updatedAt: 0,
});

type FetchHandler = (request: Request) => Promise<Response>;

interface LoadedWorker {
    generated: ReturnType<typeof generateEventsWorkerSource>;
    /** The one fetch listener the runtime registers. */
    dispatch: FetchHandler;
    /** What the runtime built `user` from, per invocation. */
    userTokens: string[];
    /** Globals left behind once the runtime has initialized. */
    sandbox: Record<string, unknown>;
}

/**
 * Deploy a handler set the way the driver does — runtime first, generated
 * source after — into a context that stands in for the isolate.
 */
const loadWorker = (
    handlers: EventHandler[],
    options: { invokeKey?: string } = {},
): LoadedWorker => {
    const generated = generateEventsWorkerSource(handlers);
    const userTokens: string[] = [];
    let dispatch: FetchHandler | null = null;

    const sandbox: Record<string, unknown> = {
        Response,
        Request,
        URL,
        fetch: () => Promise.resolve(new Response('')),
        console,
        events_invoke_key: options.invokeKey ?? INVOKE_KEY,
        puter_endpoint: 'https://api.example',
        init_puter_portable: (token: string) => {
            userTokens.push(token);
            return { authToken: token };
        },
        self: {
            addEventListener: (_type: string, listener: unknown) => {
                dispatch = (request: Request) =>
                    new Promise<Response>((resolve) => {
                        (listener as (event: unknown) => void)({
                            request,
                            respondWith: resolve,
                        });
                    });
            },
        },
    };
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);
    vm.runInContext(RUNTIME_SOURCE + generated.source, context, {
        filename: 'worker.js',
    });
    if (!dispatch) throw new Error('the runtime registered no fetch listener');
    return { generated, dispatch, userTokens, sandbox };
};

interface InvokeOptions {
    body?: unknown;
    rawBody?: string;
    key?: string;
    path?: string;
    method?: string;
}

const invoke = (worker: LoadedWorker, options: InvokeOptions = {}) => {
    const method = options.method ?? 'POST';
    return worker.dispatch(
        new Request(
            options.path
                ? `http://evw-test.example${options.path}`
                : INVOKE_URL,
            {
                method,
                headers: {
                    'content-type': 'application/json',
                    'x-puter-events-key': options.key ?? INVOKE_KEY,
                },
                ...(method === 'GET' || method === 'HEAD'
                    ? {}
                    : {
                          body:
                              options.rawBody ??
                              JSON.stringify(options.body ?? {}),
                      }),
            },
        ),
    );
};

/** The delivery shape an invocation carries, with a token to run as. */
const delivery = (over: Record<string, unknown> = {}) => ({
    handler: 'a',
    token: 'delivery-token',
    ...over,
});

const SINK = 'async ({ event, ctx, user, fetch, ack }) => { await ack(); }';

describe('the generated worker inside its runtime', () => {
    it('answers the invoke route and nothing else', async () => {
        const worker = loadWorker([handler('a', SINK)]);

        expect((await invoke(worker, { body: delivery() })).status).toBe(200);
        expect(
            (await invoke(worker, { path: '/anything', body: delivery() }))
                .status,
        ).toBe(404);
        expect(
            (await invoke(worker, { method: 'GET', body: delivery() })).status,
        ).toBe(404);
    });

    it('gives handler code no token and no router of its own', () => {
        const { sandbox } = loadWorker([handler('a', SINK)]);

        // The three the ordinary runtime defines, and the token behind them.
        for (const name of ['me', 'my', 'myself', 'router', 'puter_auth'])
            expect(sandbox[name]).toBeUndefined();
        // The invoke key is read once and taken out of reach of handler code.
        expect(sandbox.events_invoke_key).toBeUndefined();
    });

    it('is deterministic, and its set hash ignores publish order', () => {
        const a = handler('a', SINK);
        const b = handler('b', 'async () => {}');
        expect(generateEventsWorkerSource([a, b]).source).toBe(
            generateEventsWorkerSource([b, a]).source,
        );
        expect(handlerSetHash([a, b])).toBe(handlerSetHash([b, a]));
        expect(handlerSetHash([a, b])).not.toBe(
            handlerSetHash([a, handler('b', 'async () => { changed(); }')]),
        );
        expect(
            generateEventsWorkerSource([a]).source.startsWith(
                `${EVENTS_WORKER_MARKER} ${handlerSetHash([a])}`,
            ),
        ).toBe(true);
    });

    it('runs nothing for an invocation that cannot be the platform', async () => {
        const worker = loadWorker([handler('a', SINK)]);

        for (const key of ['', 'k1:wrong', `${INVOKE_KEY}x`]) {
            const res = await invoke(worker, { key, body: delivery() });
            // Retriable: a key that no longer matches is ours to fix.
            expect(res.status).toBe(500);
            expect(await res.json()).toEqual({
                error: 'not an authorized invocation',
            });
        }
        expect(worker.userTokens).toEqual([]);
    });

    it('refuses a body that is not a delivery', async () => {
        const worker = loadWorker([handler('a', SINK)]);
        expect((await invoke(worker, { rawBody: '"nope"' })).status).toBe(400);
        expect((await invoke(worker, { rawBody: 'null' })).status).toBe(400);
        expect((await invoke(worker, { rawBody: 'not json' })).status).toBe(
            400,
        );
    });

    it('answers 404 for a name that is not baked in', async () => {
        const worker = loadWorker([handler('a', SINK)]);
        const res = await invoke(worker, {
            body: delivery({ handler: 'missing' }),
        });
        expect(res.status).toBe(404);
    });

    it('will not run a handler with no delivery token', async () => {
        const worker = loadWorker([handler('a', SINK)]);
        const res = await invoke(worker, { body: { handler: 'a' } });
        expect(res.status).toBe(500);
        expect(worker.userTokens).toEqual([]);
    });

    it('runs the named handler against the delivered environment', async () => {
        const seen = vi.fn();
        const source = `async ({ event, ctx, user, fetch, ack }) => {
            globalThis.seen(event.path, ctx, typeof fetch, typeof ack, user.authToken);
        }`;
        const worker = loadWorker([handler('a', source)]);
        worker.sandbox.seen = seen;

        const res = await invoke(worker, {
            body: delivery({
                event: { path: '/x/y.txt' },
                ctx: { label: 'l' },
            }),
        });

        expect(res.status).toBe(200);
        expect(seen).toHaveBeenCalledWith(
            '/x/y.txt',
            { label: 'l' },
            'function',
            'function',
            'delivery-token',
        );
        const ctx = seen.mock.calls[0][1] as Record<string, unknown>;
        expect(Object.isFrozen(ctx)).toBe(true);
        // `user` is built from the invocation's token, per invocation.
        expect(worker.userTokens).toEqual(['delivery-token']);
    });

    it('defaults a missing context to a frozen empty bag', async () => {
        const seen = vi.fn();
        const worker = loadWorker([
            handler('a', 'async ({ ctx }) => { globalThis.seen(ctx); }'),
        ]);
        worker.sandbox.seen = seen;

        await invoke(worker, { body: delivery() });
        expect(seen).toHaveBeenCalledWith({});
        expect(Object.isFrozen(seen.mock.calls[0][0])).toBe(true);
    });

    it('takes resolution as the ack, and a throw as retriable', async () => {
        const worker = loadWorker([
            handler('ok', 'async () => {}'),
            handler('boom', 'async () => { throw new Error("kaput"); }'),
        ]);

        expect(
            (await invoke(worker, { body: delivery({ handler: 'ok' }) }))
                .status,
        ).toBe(200);
        const failed = await invoke(worker, {
            body: delivery({ handler: 'boom' }),
        });
        expect(failed.status).toBe(500);
        expect(await failed.json()).toEqual({ error: 'kaput' });
    });

    it('does not unsay an ack a later throw follows', async () => {
        const worker = loadWorker([
            handler(
                'a',
                'async ({ ack }) => { await ack(); throw new Error("after"); }',
            ),
        ]);
        const res = await invoke(worker, { body: delivery() });
        expect(res.status).toBe(200);
    });

    it('maps a terminal-shaped failure to a refusal', async () => {
        const worker = loadWorker([
            handler(
                'flagged',
                `async () => {
                    const err = new Error('do not retry');
                    err.terminal = true;
                    throw err;
                }`,
            ),
            handler(
                'coded',
                `async () => {
                    const err = new Error('same');
                    err.code = 'events_terminal';
                    throw err;
                }`,
            ),
        ]);
        expect(
            (await invoke(worker, { body: delivery({ handler: 'flagged' }) }))
                .status,
        ).toBe(400);
        expect(
            (await invoke(worker, { body: delivery({ handler: 'coded' }) }))
                .status,
        ).toBe(400);
    });

    it('isolates a handler whose source does not parse', async () => {
        const worker = loadWorker([
            handler('good', SINK),
            handler('bad', 'async ( => {'),
        ]);
        expect(worker.generated.broken).toEqual(['bad']);

        expect(
            (await invoke(worker, { body: delivery({ handler: 'good' }) }))
                .status,
        ).toBe(200);
        // Retriable rather than terminal: a republished fix is picked up.
        expect(
            (await invoke(worker, { body: delivery({ handler: 'bad' }) }))
                .status,
        ).toBe(500);
    });

    it('catches a source that parses as `return (...)` but not as the emitted register call', async () => {
        // Valid as `return (\n${source}\n);` but a SyntaxError once embedded
        // as `__puterEvents.register(key, (\n${source}\n));` — the old check
        // validated the wrong text and would have taken the whole script down.
        const source = '1); globalThis.x = 2; (function(){}';
        const worker = loadWorker([handler('good', SINK), handler('bad', source)]);

        expect(worker.generated.broken).toEqual(['bad']);
        expect(
            (await invoke(worker, { body: delivery({ handler: 'good' }) }))
                .status,
        ).toBe(200);
    });
});

describe('the handled marker', () => {
    it('carries the handled header on every answer, success or failure', async () => {
        const worker = loadWorker([
            handler('ok', SINK),
            handler('boom', 'async () => { throw new Error("x"); }'),
        ]);

        const ok = await invoke(worker, { body: delivery({ handler: 'ok' }) });
        expect(ok.headers.get('x-puter-events-handled')).toBe('1');

        const notFound = await invoke(worker, {
            body: delivery({ handler: 'missing' }),
        });
        expect(notFound.headers.get('x-puter-events-handled')).toBe('1');

        const threw = await invoke(worker, {
            body: delivery({ handler: 'boom' }),
        });
        expect(threw.headers.get('x-puter-events-handled')).toBe('1');
    });

    it('names the runtime`s own failure with a machine-readable error code', async () => {
        const worker = loadWorker([
            handler('ok', SINK),
            handler('flagged', `async () => {
                const err = new Error('no');
                err.terminal = true;
                throw err;
            }`),
            handler('boom', 'async () => { throw new Error("x"); }'),
            handler('bad', 'async ( => {'),
        ]);

        const cases: Array<[InvokeOptions, string]> = [
            [{ key: 'wrong', body: delivery() }, 'bad-key'],
            [{ rawBody: 'not json' }, 'bad-body'],
            [{ body: delivery({ handler: 'bad' }) }, 'handler-broken'],
            [{ body: delivery({ handler: 'missing' }) }, 'unknown-handler'],
            [{ body: { handler: 'ok' } }, 'no-token'],
            [{ body: delivery({ handler: 'boom' }) }, 'handler-threw'],
            [{ body: delivery({ handler: 'flagged' }) }, 'handler-terminal'],
        ];
        for (const [options, code] of cases)
            expect(
                (await invoke(worker, options)).headers.get(
                    'x-puter-events-error',
                ),
            ).toBe(code);
    });

    it('cannot be spoofed by handler code that replaces the global Response', async () => {
        const worker = loadWorker([
            handler(
                'hijack',
                `async () => {
                    globalThis.Response = class {
                        constructor() { this.status = 200; this.headers = new Map([['x-puter-events-handled', '0']]); }
                    };
                }`,
            ),
        ]);
        const res = await invoke(worker, {
            body: delivery({ handler: 'hijack' }),
        });
        // The runtime's own answer, built from the Response it captured
        // before this handler ran — not the one the handler installed.
        expect(res.headers.get('x-puter-events-handled')).toBe('1');
    });
});

describe('generateEventsWorkerSource', () => {
    it('falls back to marking every handler broken if the assembled file will not parse', () => {
        const a = handler('a', SINK);
        const b = handler('b', 'async () => {}');
        const RealFunction = Function;
        vi.stubGlobal(
            'Function',
            function (this: unknown, ...args: string[]) {
                const body = args[args.length - 1] ?? '';
                // Only the final whole-file compile is forced to fail — the
                // per-handler checks (which never see the marker line) still
                // run against the real constructor.
                if (body.includes(EVENTS_WORKER_MARKER))
                    throw new SyntaxError('forced');
                return new RealFunction(...args);
            },
        );
        try {
            const generated = generateEventsWorkerSource([a, b]);
            expect(generated.broken).toEqual(['a', 'b']);
            expect(generated.source).not.toContain('__puterEvents.register');
            expect(generated.source).toContain('markBroken("a")');
            expect(generated.source).toContain('markBroken("b")');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('flags a set whose generated source exceeds the size cap, and not an ordinary one', () => {
        expect(generateEventsWorkerSource([handler('a', SINK)]).tooLarge).toBe(
            false,
        );

        const huge = handler(
            'huge',
            `async () => { /* ${'x'.repeat(EVENTS_GENERATED_SOURCE_MAX_BYTES)} */ }`,
        );
        expect(generateEventsWorkerSource([huge]).tooLarge).toBe(true);
    });

    it('still deploys a set published right at the handler-source cap', () => {
        // The publish side caps the handlers' own bytes; the registration
        // wrapper this generator adds is not the app's, so a set that was
        // allowed to publish must not come out undeployable.
        const shell = (pad: string) => `async () => { /*${pad}*/ }`;
        const source = shell(
            'x'.repeat(EVENTS_WORKER_SOURCE_MAX_BYTES - shell('').length),
        );
        expect(Buffer.byteLength(source, 'utf8')).toBe(
            EVENTS_WORKER_SOURCE_MAX_BYTES,
        );

        const generated = generateEventsWorkerSource([
            handler('at-cap', source),
        ]);
        expect(generated.broken).toEqual([]);
        expect(generated.tooLarge).toBe(false);
    });
});
