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
 * The generated events worker, executed against a stub of the worker router.
 *
 * The generated source only assumes `router`, `Response` and `fetch`, all of
 * which Node provides or this file stubs — so the whole invoke protocol (the
 * ack and error convention included) is pinned here without a worker runtime.
 * What the real runtime adds on top — the `puter-auth` header becoming
 * `event.user.puter` — is the router's own behavior, exercised end to end in
 * the integration suite.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    hashContent,
    type EventHandler,
} from '../../stores/events/EventHandlerStore.js';
import {
    generateEventsWorkerSource,
    handlerSetHash,
    EVENTS_WORKER_MARKER,
} from './workerSource.js';

const handler = (name: string, source: string): EventHandler => ({
    appUid: 'app-x',
    name,
    source,
    sourceHash: hashContent(source),
    createdAt: 0,
    updatedAt: 0,
});

type RouteFn = (event: unknown) => Promise<Response>;

/** Load the generated worker the way the runtime would: run it. */
const loadWorker = (handlers: EventHandler[]) => {
    const generated = generateEventsWorkerSource(handlers);
    const routes = new Map<string, RouteFn>();
    const router = {
        post: (route: string, fn: RouteFn) => routes.set(route, fn),
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('router', generated.source)(router);
    return { generated, routes };
};

interface InvokeOptions {
    body?: unknown;
    rawBody?: string;
    user?: unknown;
    anonymous?: boolean;
}

const invoke = async (
    fn: RouteFn,
    options: InvokeOptions = {},
): Promise<Response> => {
    const raw = options.rawBody ?? JSON.stringify(options.body ?? {});
    const event: Record<string, unknown> = {
        request: { json: () => Promise.resolve(JSON.parse(raw)) },
    };
    if (!options.anonymous)
        event.user = { puter: options.user ?? { stub: true } };
    return fn(event);
};

const SINK = 'async ({ event, ctx, user, fetch, ack }) => { await ack(); }';

describe('generateEventsWorkerSource', () => {
    it('registers exactly the invoke route and nothing else', () => {
        const { routes } = loadWorker([handler('a', SINK)]);
        expect([...routes.keys()]).toEqual(['/__events/invoke']);
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

    it('refuses a call that carries no delivery token', async () => {
        const { routes } = loadWorker([handler('a', SINK)]);
        const res = await invoke(routes.get('/__events/invoke')!, {
            anonymous: true,
            body: { handler: 'a' },
        });
        expect(res.status).toBe(401);
    });

    it('refuses a body that is not a delivery', async () => {
        const { routes } = loadWorker([handler('a', SINK)]);
        const fn = routes.get('/__events/invoke')!;
        expect((await invoke(fn, { rawBody: '"nope"' })).status).toBe(400);
        expect((await invoke(fn, { rawBody: 'null' })).status).toBe(400);
    });

    it('answers 404 for a name that is not baked in', async () => {
        const { routes } = loadWorker([handler('a', SINK)]);
        const res = await invoke(routes.get('/__events/invoke')!, {
            body: { handler: 'missing' },
        });
        expect(res.status).toBe(404);
    });

    it('runs the named handler against the adapter environment', async () => {
        const seen = vi.fn();
        const source = `async ({ event, ctx, user, fetch, ack }) => {
            user.seen(event.path, ctx, typeof fetch, typeof ack);
        }`;
        const { routes } = loadWorker([handler('a', source)]);

        const res = await invoke(routes.get('/__events/invoke')!, {
            body: {
                handler: 'a',
                event: { path: '/x/y.txt' },
                ctx: { label: 'l' },
            },
            user: { seen },
        });

        expect(res.status).toBe(200);
        expect(seen).toHaveBeenCalledWith(
            '/x/y.txt',
            { label: 'l' },
            'function',
            'function',
        );
        const ctx = seen.mock.calls[0][1] as Record<string, unknown>;
        expect(Object.isFrozen(ctx)).toBe(true);
    });

    it('defaults a missing context to a frozen empty bag', async () => {
        const seen = vi.fn();
        const { routes } = loadWorker([
            handler('a', 'async ({ ctx, user }) => { user.seen(ctx); }'),
        ]);
        await invoke(routes.get('/__events/invoke')!, {
            body: { handler: 'a' },
            user: { seen },
        });
        expect(seen).toHaveBeenCalledWith({});
        expect(Object.isFrozen(seen.mock.calls[0][0])).toBe(true);
    });

    it('takes resolution as the ack, and a throw as retriable', async () => {
        const { routes } = loadWorker([
            handler('ok', 'async () => {}'),
            handler('boom', 'async () => { throw new Error("kaput"); }'),
        ]);
        const fn = routes.get('/__events/invoke')!;

        expect((await invoke(fn, { body: { handler: 'ok' } })).status).toBe(
            200,
        );
        const failed = await invoke(fn, { body: { handler: 'boom' } });
        expect(failed.status).toBe(500);
        expect(await failed.json()).toEqual({ error: 'kaput' });
    });

    it('does not unsay an ack a later throw follows', async () => {
        const { routes } = loadWorker([
            handler(
                'a',
                'async ({ ack }) => { await ack(); throw new Error("after"); }',
            ),
        ]);
        const res = await invoke(routes.get('/__events/invoke')!, {
            body: { handler: 'a' },
        });
        expect(res.status).toBe(200);
    });

    it('maps a terminal-shaped failure to a refusal', async () => {
        const { routes } = loadWorker([
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
        const fn = routes.get('/__events/invoke')!;
        expect(
            (await invoke(fn, { body: { handler: 'flagged' } })).status,
        ).toBe(400);
        expect((await invoke(fn, { body: { handler: 'coded' } })).status).toBe(
            400,
        );
    });

    it('isolates a handler whose source does not parse', async () => {
        const { generated, routes } = loadWorker([
            handler('good', SINK),
            handler('bad', 'async ( => {'),
        ]);
        expect(generated.broken).toEqual(['bad']);

        const fn = routes.get('/__events/invoke')!;
        expect((await invoke(fn, { body: { handler: 'good' } })).status).toBe(
            200,
        );
        // Retriable rather than terminal: a republished fix is picked up.
        expect((await invoke(fn, { body: { handler: 'bad' } })).status).toBe(
            500,
        );
    });
});
