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
 * `DispatcherInvokeTransport` against an injected fetch, so the handled/error
 * header contract is pinned without a real dispatcher on the other end.
 */

import type { fetch as undiciFetch } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.js';
import {
    DispatcherInvokeTransport,
    EVENTS_DEPLOYED_HEADER,
    EVENTS_DEADLINE_MARGIN_MS,
    EVENTS_DISPATCH_BATCH_PATH,
    EVENTS_DISPATCH_ERROR_HEADER,
    EVENTS_DISPATCH_PATH,
    EVENTS_ERROR_HEADER,
    EVENTS_HANDLED_HEADER,
    EVENTS_HOLDER_HEADER,
    EVENTS_INVOKE_TIMEOUT_MS,
    EVENTS_WORKER_LEASE_FACTOR,
    EventsWorkerInvokerClient,
    INVOKE_CONNECTIONS,
    SCHEDULE_INVOKE_CONNECTIONS,
    outcomeForStatus,
    parseAnswerLine,
    type WorkerInvokeRequest,
} from './EventsWorkerInvokerClient.js';

type FetchImpl = typeof undiciFetch;

const CALL = {
    script: 'evw-test',
    appUid: 'app-test',
    key: 'k1:test',
    body: '{}',
    timeoutMs: 5_000,
};

/** A stub fetch that answers the same way on every call. */
const stubFetch = (
    status: number,
    headers: Record<string, string> = {},
): FetchImpl =>
    (async () =>
        new Response(null, { status, headers })) as unknown as FetchImpl;

/**
 * A stub fetch that never answers until the abort signal fires, then rejects
 * with the signal's reason the way undici does.
 */
const hangingFetch: FetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason),
        );
    })) as unknown as FetchImpl;

/** A stub fetch that fails before any answer, as a refused connection does. */
const refusedFetch: FetchImpl = (async () => {
    throw new TypeError('fetch failed');
}) as unknown as FetchImpl;

/** A stub fetch that records the URL it was called with. */
const capturingFetch = (calls: string[], status = 200): FetchImpl =>
    (async (url: string) => {
        calls.push(url);
        return new Response(null, { status });
    }) as unknown as FetchImpl;

describe('DispatcherInvokeTransport', () => {
    it('reports a handled 400 with no error — the handler`s own refusal', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: stubFetch(400, { [EVENTS_HANDLED_HEADER]: '1' }),
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: 400,
            handled: true,
        });
    });

    it('reports an unmarked 404 with no dispatch-error header as unhandled', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: stubFetch(404),
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: 404,
            handled: false,
        });
    });

    it('turns a dispatch-error header into a null status with the reason', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: stubFetch(502, {
                    [EVENTS_DISPATCH_ERROR_HEADER]: 'deploy-failed',
                }),
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: null,
            error: 'dispatcher: deploy-failed (502)',
            dispatchReason: 'deploy-failed',
        });
    });

    it('adds the deployed header when the call says so', async () => {
        const headers: Array<Record<string, string>> = [];
        const fetchImpl = (async (_url: string, init?: RequestInit) => {
            headers.push(init?.headers as Record<string, string>);
            return new Response(null, { status: 200 });
        }) as unknown as FetchImpl;
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl,
            },
        );

        await transport.send(CALL);
        await transport.send({ ...CALL, deployed: true });

        expect(headers[0][EVENTS_DEPLOYED_HEADER]).toBeUndefined();
        expect(headers[1][EVENTS_DEPLOYED_HEADER]).toBe('1');
    });

    it('reports a handled 200 as settled with no error', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: stubFetch(200, { [EVENTS_HANDLED_HEADER]: '1' }),
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: 200,
            handled: true,
        });
    });

    it('passes a 429 through as-is', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: stubFetch(429),
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: 429,
            handled: false,
        });
    });

    it('answers null and says so when the request times out', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: hangingFetch,
            },
        );
        const result = await transport.send({ ...CALL, timeoutMs: 10 });
        expect(result.status).toBeNull();
        expect(result.timedOut).toBe(true);
    });

    it('answers null without a timeout when the request fails outright', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: refusedFetch,
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: null,
            error: 'fetch failed',
        });
    });

    it('reads a retry-after in seconds, and ignores a date', async () => {
        const answer = (value: string) =>
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: stubFetch(500, {
                    [EVENTS_HANDLED_HEADER]: '1',
                    [EVENTS_ERROR_HEADER]: 'platform-error',
                    'retry-after': value,
                }),
            }).send(CALL);

        expect((await answer('30')).retryAfterMs).toBe(30_000);
        expect(
            (await answer('Wed, 21 Oct 2015 07:28:00 GMT')).retryAfterMs,
        ).toBeUndefined();
    });

    it('surfaces the runtime`s own error header alongside its status', async () => {
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            {
                fetchImpl: stubFetch(500, {
                    [EVENTS_HANDLED_HEADER]: '1',
                    [EVENTS_ERROR_HEADER]: 'handler-threw',
                }),
            },
        );
        expect(await transport.send(CALL)).toEqual({
            status: 500,
            handled: true,
            error: 'handler-threw',
        });
    });

    it('preserves a path prefix on the dispatcher URL', async () => {
        const calls: string[] = [];
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher/prefix/',
            's',
            { fetchImpl: capturingFetch(calls) },
        );
        await transport.send(CALL);
        expect(calls).toEqual([
            `http://dispatcher/prefix${EVENTS_DISPATCH_PATH}`,
        ]);
    });
});

describe('DispatcherInvokeTransport with every connection busy', () => {
    /** A fetch that answers 200 to one call at a time, when told to. */
    const heldFetch = () => {
        const held: Array<{ answer: () => void; signal: AbortSignal }> = [];
        const fetchImpl = ((_url: string, init: RequestInit) =>
            new Promise((resolve, reject) => {
                const signal = init.signal!;
                signal.addEventListener('abort', () => reject(signal.reason));
                held.push({
                    signal,
                    answer: () =>
                        resolve(
                            new Response(null, {
                                status: 200,
                                headers: { [EVENTS_HANDLED_HEADER]: '1' },
                            }),
                        ),
                });
            })) as unknown as FetchImpl;
        return { fetchImpl, held };
    };

    /** Every connection taken by a call nobody has answered yet. */
    const saturated = async () => {
        const { fetchImpl, held } = heldFetch();
        // Slots are per call, batched or not; one request per call keeps
        // the count readable.
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            { fetchImpl, batchSize: 1 },
        );
        const busy = Array.from({ length: INVOKE_CONNECTIONS }, () =>
            transport.send(CALL),
        );
        await vi.waitFor(() => expect(held).toHaveLength(INVOKE_CONNECTIONS));
        const answerAll = async () => {
            for (const call of held) call.answer();
            await Promise.all(busy);
        };
        return { transport, held, answerAll };
    };

    it('waits for a free connection, then gives the run its whole timeout', async () => {
        const { transport, held, answerAll } = await saturated();

        const waiting = transport.send({ ...CALL, timeoutMs: 400 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(held).toHaveLength(INVOKE_CONNECTIONS);

        held[0].answer();
        await vi.waitFor(() =>
            expect(held).toHaveLength(INVOKE_CONNECTIONS + 1),
        );
        // Past 400 ms from when the call was made, not from when it got its
        // connection.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(held[INVOKE_CONNECTIONS].signal.aborted).toBe(false);

        await answerAll();
        await expect(waiting).resolves.toMatchObject({ status: 200 });
    });

    it('fails a call that never got a connection as Puter`s, not the handler`s', async () => {
        const { transport, held, answerAll } = await saturated();

        await expect(
            transport.send({ ...CALL, timeoutMs: 40 }),
        ).resolves.toEqual({
            status: null,
            error: 'no free connection to the events dispatcher',
        });

        const client = new EventsWorkerInvokerClient({
            events: { invokeTimeoutMs: 40 },
        } as unknown as IConfig);
        client.setTransport(transport);
        await expect(client.invoke(REQUEST)).resolves.toMatchObject({
            outcome: 'unavailable',
        });
        expect(held).toHaveLength(INVOKE_CONNECTIONS);

        // The slots come back once the calls holding them are answered.
        await answerAll();
        const after = transport.send(CALL);
        await vi.waitFor(() =>
            expect(held).toHaveLength(INVOKE_CONNECTIONS + 1),
        );
        held[INVOKE_CONNECTIONS].answer();
        await expect(after).resolves.toMatchObject({ status: 200 });
    });

    it('rechecks the guard once a connection frees, and drops a superseded call', async () => {
        const { transport, held, answerAll } = await saturated();

        let current = true;
        const guard = vi.fn(async () => current);
        const waiting = transport.send({ ...CALL, beforeSend: guard });
        current = false;
        held[0].answer();

        await expect(waiting).resolves.toEqual({
            status: null,
            error: 'invocation superseded',
        });
        expect(guard).toHaveBeenCalledTimes(1);
        expect(held).toHaveLength(INVOKE_CONNECTIONS);
        await answerAll();
    });

    it('fails a call whose guard throws after the wait, and frees its slot', async () => {
        const { transport, held, answerAll } = await saturated();

        const waiting = transport.send({
            ...CALL,
            beforeSend: async () => {
                throw new Error('lease store down');
            },
        });
        held[0].answer();
        await expect(waiting).rejects.toThrow('lease store down');
        expect(held).toHaveLength(INVOKE_CONNECTIONS);

        await answerAll();
        const after = transport.send(CALL);
        await vi.waitFor(() =>
            expect(held).toHaveLength(INVOKE_CONNECTIONS + 1),
        );
        held[INVOKE_CONNECTIONS].answer();
        await expect(after).resolves.toMatchObject({ status: 200 });
    });
});

describe('DispatcherInvokeTransport schedule lane', () => {
    const heldFetch = () => {
        const held: Array<{ answer: () => void; body: string }> = [];
        const fetchImpl = ((_url: string, init: RequestInit) =>
            new Promise((resolve) => {
                held.push({
                    body: String(init.body),
                    answer: () =>
                        resolve(
                            new Response(null, {
                                status: 200,
                                headers: { [EVENTS_HANDLED_HEADER]: '1' },
                            }),
                        ),
                });
            })) as unknown as FetchImpl;
        return { fetchImpl, held };
    };

    it('holds schedule runs to their share and keeps serving deliveries', async () => {
        const { fetchImpl, held } = heldFetch();
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            { fetchImpl, batchSize: 1 },
        );
        const scheduled = Array.from(
            { length: SCHEDULE_INVOKE_CONNECTIONS + 5 },
            () => transport.send({ ...CALL, lane: 'schedule' as const }),
        );
        await vi.waitFor(() =>
            expect(held).toHaveLength(SCHEDULE_INVOKE_CONNECTIONS),
        );
        // A delivery waiting behind the schedule queue still gets a connection.
        const delivery = transport.send(CALL);
        await vi.waitFor(() =>
            expect(held).toHaveLength(SCHEDULE_INVOKE_CONNECTIONS + 1),
        );
        held[SCHEDULE_INVOKE_CONNECTIONS].answer();
        await expect(delivery).resolves.toMatchObject({ status: 200 });

        // A schedule run's slot goes to the next schedule run waiting.
        held[0].answer();
        await vi.waitFor(() =>
            expect(held).toHaveLength(SCHEDULE_INVOKE_CONNECTIONS + 2),
        );
        for (let i = 0; i < 4; i++) held[i + 1].answer();
        await vi.waitFor(() =>
            expect(held).toHaveLength(SCHEDULE_INVOKE_CONNECTIONS + 6),
        );
        for (const call of held) call.answer();
        await Promise.all(scheduled);
    });

    it('builds the body after the connection wait, so a stamp is the send time', async () => {
        const { fetchImpl, held } = heldFetch();
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            { fetchImpl, batchSize: 1 },
        );
        const busy = Array.from({ length: SCHEDULE_INVOKE_CONNECTIONS }, () =>
            transport.send({ ...CALL, lane: 'schedule' as const }),
        );
        await vi.waitFor(() =>
            expect(held).toHaveLength(SCHEDULE_INVOKE_CONNECTIONS),
        );
        let renders = 0;
        const stamped = transport.send({
            ...CALL,
            lane: 'schedule',
            render: () => `{"n":${++renders}}`,
        });
        held[0].answer();
        await vi.waitFor(() =>
            expect(held).toHaveLength(SCHEDULE_INVOKE_CONNECTIONS + 1),
        );
        expect(held[SCHEDULE_INVOKE_CONNECTIONS].body).toBe('{"n":1}');
        for (const call of held) call.answer();
        await Promise.all([...busy, stamped]);
    });
});

describe('DispatcherInvokeTransport batches', () => {
    interface BatchRequest {
        url: string;
        body: { calls: Array<Record<string, unknown>> };
        signal: AbortSignal;
        /** Streams one answer line back. */
        answer: (line: Record<string, unknown>) => void;
        end: () => void;
    }

    /**
     * A fetch whose batch answers stream only when told to; single calls get a
     * handled 200 straight away.
     */
    const streamingFetch = () => {
        const batches: BatchRequest[] = [];
        const singles: Array<{ url: string; headers: Record<string, string> }> =
            [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            if (!url.endsWith(EVENTS_DISPATCH_BATCH_PATH)) {
                singles.push({
                    url,
                    headers: init.headers as Record<string, string>,
                });
                return new Response(null, {
                    status: 200,
                    headers: { [EVENTS_HANDLED_HEADER]: '1' },
                });
            }
            let controller!: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({
                start: (c) => {
                    controller = c;
                },
            });
            const encoder = new TextEncoder();
            init.signal?.addEventListener('abort', () => {
                try {
                    controller.error(init.signal!.reason);
                } catch {
                    // already closed
                }
            });
            batches.push({
                url,
                body: JSON.parse(String(init.body)),
                signal: init.signal!,
                answer: (line) =>
                    controller.enqueue(
                        encoder.encode(`${JSON.stringify(line)}\n`),
                    ),
                end: () => controller.close(),
            });
            return new Response(stream, {
                status: 200,
                headers: { 'content-type': 'application/x-ndjson' },
            });
        }) as unknown as FetchImpl;
        return { fetchImpl, batches, singles };
    };

    const transportFor = (
        fetchImpl: FetchImpl,
        options: { batchSize?: number; batchWindowMs?: number } = {},
    ) =>
        new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl,
            ...options,
        });

    it('sends calls made together as one request, and answers each from its own line', async () => {
        const { fetchImpl, batches, singles } = streamingFetch();
        const transport = transportFor(fetchImpl);
        const first = transport.send({ ...CALL, script: 'evw-a', key: 'k1:a' });
        const second = transport.send({
            ...CALL,
            script: 'evw-b',
            deployed: true,
            body: '{"b":1}',
        });
        await vi.waitFor(() => expect(batches).toHaveLength(1));

        expect(batches[0].url).toBe(
            `http://dispatcher${EVENTS_DISPATCH_BATCH_PATH}`,
        );
        expect(batches[0].body.calls).toEqual([
            {
                script: 'evw-a',
                appUid: 'app-test',
                key: 'k1:a',
                body: '{}',
                waitMs: expect.any(Number),
            },
            {
                script: 'evw-b',
                appUid: 'app-test',
                key: 'k1:test',
                deployed: true,
                body: '{"b":1}',
                waitMs: expect.any(Number),
            },
        ]);
        // What is left of half the timeout, the share a call may wait.
        expect(batches[0].body.calls[0].waitMs).toBeLessThanOrEqual(2_500);
        expect(batches[0].body.calls[0].waitMs).toBeGreaterThan(2_400);

        // Out of order: each line names the call it answers.
        batches[0].answer({ i: 1, status: 400, handled: true });
        await expect(second).resolves.toEqual({ status: 400, handled: true });
        batches[0].answer({
            i: 0,
            status: 503,
            handled: true,
            error: 'platform-error',
            retryAfter: '3',
        });
        await expect(first).resolves.toEqual({
            status: 503,
            handled: true,
            error: 'platform-error',
            retryAfterMs: 3000,
        });
        // Every call answered, so the request is let go.
        expect(batches[0].signal.aborted).toBe(true);
        expect(singles).toEqual([]);
    });

    it('sends a call with nobody to batch with on the single route', async () => {
        const { fetchImpl, batches, singles } = streamingFetch();
        const transport = transportFor(fetchImpl);
        await expect(transport.send(CALL)).resolves.toMatchObject({
            status: 200,
        });
        expect(batches).toEqual([]);
        expect(singles[0].url).toBe(`http://dispatcher${EVENTS_DISPATCH_PATH}`);
    });

    it('sends a full batch at once, without waiting out the window', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl, {
            batchSize: 2,
            batchWindowMs: 60_000,
        });
        const sent = [transport.send(CALL), transport.send(CALL)];
        const third = transport.send(CALL);
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        expect(batches[0].body.calls).toHaveLength(2);
        batches[0].answer({ i: 0, status: 200, handled: true });
        batches[0].answer({ i: 1, status: 200, handled: true });
        await Promise.all(sent);
        transport.close();
        await expect(third).resolves.toMatchObject({ status: 200 });
    });

    it('gives each call its own timeout, without failing the rest of the batch', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl);
        const quick = transport.send({ ...CALL, timeoutMs: 50 });
        const slow = transport.send({ ...CALL, timeoutMs: 5_000 });
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        batches[0].answer({ i: 0, started: true });
        batches[0].answer({ i: 1, started: true });

        await expect(quick).resolves.toMatchObject({
            status: null,
            timedOut: true,
        });
        expect(batches[0].signal.aborted).toBe(false);
        batches[0].answer({ i: 1, status: 200, handled: true });
        await expect(slow).resolves.toEqual({ status: 200, handled: true });
    });

    it('runs a call`s timeout from its started line, not from the send', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl);
        let settled = false;
        const queued = transport
            .send({ ...CALL, timeoutMs: 200 })
            .then((answer) => {
                settled = true;
                return answer;
            });
        const other = transport.send(CALL);
        await vi.waitFor(() => expect(batches).toHaveLength(1));

        // Queued behind other calls for longer than its whole timeout.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(settled).toBe(false);
        batches[0].answer({ i: 0, started: true });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        await expect(queued).resolves.toMatchObject({
            status: null,
            timedOut: true,
        });

        batches[0].answer({ i: 1, status: 200, handled: true });
        await other;
    });

    it('puts a call that never started on Puter, not on its handler', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl);
        const never = transport.send({ ...CALL, timeoutMs: 20 });
        const queueTimedOut = transport.send(CALL);
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        batches[0].answer({ i: 1, status: 503, dispatch: 'queue-timeout' });

        await expect(queueTimedOut).resolves.toEqual({
            status: null,
            error: 'dispatcher: queue-timeout (503)',
            dispatchReason: 'queue-timeout',
        });
        // Its wait plus the grace for the started line to arrive.
        await expect(never).resolves.toEqual({
            status: null,
            error: 'dispatcher: call never started',
        });
        const client = new EventsWorkerInvokerClient({} as IConfig);
        client.setTransport({ send: async () => queueTimedOut });
        await expect(client.invoke(REQUEST)).resolves.toMatchObject({
            outcome: 'unavailable',
        });
    });

    it('puts a call the stream ended without answering on Puter', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl);
        const answered = transport.send(CALL);
        const dropped = transport.send(CALL);
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        batches[0].answer({ i: 0, status: 200, handled: true });
        batches[0].end();

        await expect(answered).resolves.toEqual({ status: 200, handled: true });
        await expect(dropped).resolves.toEqual({
            status: null,
            error: 'dispatcher: batch ended without an answer',
        });
    });

    it('carries a dispatch failure in a line as that call`s reason', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl);
        const missing = transport.send(CALL);
        const other = transport.send(CALL);
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        batches[0].answer({ i: 0, status: 404, dispatch: 'missing' });
        batches[0].answer({ i: 1, status: 200, handled: true });

        await expect(missing).resolves.toEqual({
            status: null,
            error: 'dispatcher: missing (404)',
            dispatchReason: 'missing',
        });
        await expect(other).resolves.toMatchObject({ status: 200 });
    });

    it('fails every call of a batch the dispatcher refused, or something else answered', async () => {
        for (const [response, expected] of [
            [
                new Response('forbidden', {
                    status: 403,
                    headers: { [EVENTS_DISPATCH_ERROR_HEADER]: 'forbidden' },
                }),
                {
                    status: null,
                    error: 'dispatcher: forbidden (403)',
                    dispatchReason: 'forbidden',
                },
            ],
            [
                new Response('not found', { status: 404 }),
                {
                    status: null,
                    error: 'dispatcher: unmarked 404 for a batch',
                },
            ],
        ] as const) {
            const transport = transportFor(
                (async () => response) as unknown as FetchImpl,
            );
            const answers = await Promise.all([
                transport.send(CALL),
                transport.send(CALL),
            ]);
            expect(answers).toEqual([expected, expected]);
        }
    });

    it('fails every call when the batch request itself fails', async () => {
        const transport = transportFor(refusedFetch);
        const answers = await Promise.all([
            transport.send(CALL),
            transport.send(CALL),
        ]);
        expect(answers).toEqual([
            { status: null, error: 'fetch failed' },
            { status: null, error: 'fetch failed' },
        ]);
    });

    it('falls back to single calls on a dispatcher without the batch route', async () => {
        const urls: string[] = [];
        const fetchImpl = (async (url: string) => {
            urls.push(url);
            if (url.endsWith(EVENTS_DISPATCH_BATCH_PATH))
                return new Response('no-such-route', {
                    status: 404,
                    headers: {
                        [EVENTS_DISPATCH_ERROR_HEADER]: 'no-such-route',
                    },
                });
            return new Response(null, {
                status: 200,
                headers: { [EVENTS_HANDLED_HEADER]: '1' },
            });
        }) as unknown as FetchImpl;
        const transport = transportFor(fetchImpl);

        const first = await Promise.all([
            transport.send(CALL),
            transport.send(CALL),
        ]);
        expect(first).toEqual([
            { status: 200, handled: true },
            { status: 200, handled: true },
        ]);
        // The next pair goes straight to the single route.
        await Promise.all([transport.send(CALL), transport.send(CALL)]);
        expect(urls.map((url) => new URL(url).pathname)).toEqual([
            EVENTS_DISPATCH_BATCH_PATH,
            EVENTS_DISPATCH_PATH,
            EVENTS_DISPATCH_PATH,
            EVENTS_DISPATCH_PATH,
            EVENTS_DISPATCH_PATH,
        ]);
    });

    it('leaves a call superseded while gathered out of the batch', async () => {
        const { fetchImpl, batches, singles } = streamingFetch();
        const transport = transportFor(fetchImpl, { batchWindowMs: 20 });
        let current = true;
        const sent = [
            transport.send(CALL),
            transport.send({ ...CALL, beforeSend: async () => current }),
            transport.send({ ...CALL, script: 'evw-other' }),
        ];
        current = false;
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        expect(batches[0].body.calls.map((call) => call.script)).toEqual([
            'evw-test',
            'evw-other',
        ]);
        await expect(sent[1]).resolves.toEqual({
            status: null,
            error: 'invocation superseded',
        });
        batches[0].answer({ i: 0, status: 200, handled: true });
        batches[0].answer({ i: 1, status: 200, handled: true });
        await expect(Promise.all([sent[0], sent[2]])).resolves.toEqual([
            { status: 200, handled: true },
            { status: 200, handled: true },
        ]);
        expect(singles).toHaveLength(0);
    });

    it('sends nothing when every gathered call was superseded', async () => {
        const fetchImpl = vi.fn(
            stubFetch(200, { [EVENTS_HANDLED_HEADER]: '1' }),
        );
        const transport = transportFor(fetchImpl as unknown as FetchImpl);
        const superseded = { ...CALL, beforeSend: async () => false };
        await expect(
            Promise.all([
                transport.send(superseded),
                transport.send(superseded),
            ]),
        ).resolves.toEqual([
            { status: null, error: 'invocation superseded' },
            { status: null, error: 'invocation superseded' },
        ]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fails only the call whose guard throws at flush', async () => {
        const { fetchImpl, batches, singles } = streamingFetch();
        const transport = transportFor(fetchImpl);
        const failing = transport.send({
            ...CALL,
            beforeSend: async () => {
                throw new Error('lease store down');
            },
        });
        const kept = transport.send(CALL);
        await expect(failing).rejects.toThrow('lease store down');
        // One call left, so it goes alone.
        await expect(kept).resolves.toEqual({ status: 200, handled: true });
        expect(batches).toHaveLength(0);
        expect(singles).toHaveLength(1);
    });

    it('rechecks the guard before resending a batch call on its own', async () => {
        const urls: string[] = [];
        let current = true;
        const fetchImpl = (async (url: string) => {
            urls.push(url);
            if (url.endsWith(EVENTS_DISPATCH_BATCH_PATH)) {
                // Superseded while the batch was out.
                current = false;
                return new Response('no-such-route', {
                    status: 404,
                    headers: {
                        [EVENTS_DISPATCH_ERROR_HEADER]: 'no-such-route',
                    },
                });
            }
            return new Response(null, {
                status: 200,
                headers: { [EVENTS_HANDLED_HEADER]: '1' },
            });
        }) as unknown as FetchImpl;
        const transport = transportFor(fetchImpl);

        await expect(
            Promise.all([
                transport.send({ ...CALL, beforeSend: async () => current }),
                transport.send(CALL),
            ]),
        ).resolves.toEqual([
            { status: null, error: 'invocation superseded' },
            { status: 200, handled: true },
        ]);
        expect(urls.map((url) => new URL(url).pathname)).toEqual([
            EVENTS_DISPATCH_BATCH_PATH,
            EVENTS_DISPATCH_PATH,
        ]);
    });

    it('answers a schedule run superseded in the batch as the early check does', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const client = new EventsWorkerInvokerClient({
            events: { invokeTimeoutMs: 5_000 },
        } as unknown as IConfig);
        client.setTransport(transportFor(fetchImpl, { batchWindowMs: 20 }));
        let current = true;
        const guard = vi.fn(async () => current);

        const run = client.invoke(REQUEST, {
            lane: 'schedule',
            beforeSend: guard,
        });
        const other = client.invoke(REQUEST);
        const another = client.invoke(REQUEST);
        await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
        current = false;

        await vi.waitFor(() => expect(batches).toHaveLength(1));
        expect(batches[0].body.calls).toHaveLength(2);
        await expect(run).resolves.toEqual(
            await client.invoke(REQUEST, { beforeSend: async () => false }),
        );
        await expect(run).resolves.toMatchObject({
            outcome: 'unavailable',
            error: 'invocation superseded',
        });
        batches[0].answer({ i: 0, status: 200, handled: true });
        batches[0].answer({ i: 1, status: 200, handled: true });
        await Promise.all([other, another]);
    });

    it('builds each body when the batch goes out', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const transport = transportFor(fetchImpl);
        let renders = 0;
        const sent = [
            transport.send({ ...CALL, render: () => `{"n":${++renders}}` }),
            transport.send(CALL),
        ];
        expect(renders).toBe(0);
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        expect(batches[0].body.calls[0].body).toBe('{"n":1}');
        batches[0].answer({ i: 0, status: 200, handled: true });
        batches[0].answer({ i: 1, status: 200, handled: true });
        await Promise.all(sent);
    });

    it('deploys a call`s missing script and retries it, batched with the rest', async () => {
        const { fetchImpl, batches } = streamingFetch();
        const client = new EventsWorkerInvokerClient({
            events: { invokeTimeoutMs: 5_000 },
        } as unknown as IConfig);
        client.setTransport(transportFor(fetchImpl));
        const missHandler = vi.fn(async () => 'deployed' as const);
        client.setMissHandler(missHandler);

        const missing = client.invoke({ ...REQUEST, script: 'evw-gone' });
        const resident = client.invoke(REQUEST);
        await vi.waitFor(() => expect(batches).toHaveLength(1));
        batches[0].answer({ i: 0, status: 404, dispatch: 'missing' });
        batches[0].answer({ i: 1, status: 200, handled: true });
        await expect(resident).resolves.toMatchObject({ outcome: 'settled' });

        // The retry is alone, so it goes on the single route.
        await expect(missing).resolves.toMatchObject({ outcome: 'settled' });
        expect(missHandler).toHaveBeenCalledWith('app-test', 'evw-gone', {
            lane: undefined,
        });
    });

    it('reads only well-formed answer lines', () => {
        expect(parseAnswerLine('not json')).toBeNull();
        expect(parseAnswerLine('{"status":200}')).toBeNull();
        expect(parseAnswerLine('{"i":-1,"status":200}')).toBeNull();
        expect(parseAnswerLine('{"i":0}')).toBeNull();
        expect(parseAnswerLine('{"i":1,"started":true}')).toEqual({
            i: 1,
            started: true,
        });
        expect(parseAnswerLine('{"i":2,"status":200}')).toEqual({
            i: 2,
            answer: { status: 200, handled: false },
        });
    });
});

describe('EventsWorkerInvokerClient invoke options', () => {
    it('does not send a superseded invocation', async () => {
        const client = makeClient();
        const send = vi.fn(async () => ({ status: 200, handled: true }));
        client.setTransport({ send });
        const result = await client.invoke(REQUEST, { beforeSend: async () => false });
        expect(result.outcome).toBe('unavailable');
        expect(send).not.toHaveBeenCalled();
    });

    it('rechecks before resending after a deployment', async () => {
        const client = makeClient();
        let current = true;
        const send = vi.fn(async () => ({ status: null, dispatchReason: 'missing' }));
        client.setTransport({ send });
        client.setMissHandler(async () => { current = false; return 'deployed'; });
        const result = await client.invoke(REQUEST, { beforeSend: async () => current });
        expect(result.outcome).toBe('unavailable');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('stamps the event as each attempt goes out', async () => {
        const bodies: string[] = [];
        const client = makeClient();
        client.setTransport({
            send: async (call) => {
                bodies.push(call.body);
                return { status: 200, handled: true };
            },
        });
        let n = 0;
        await client.invoke(REQUEST, {
            stampEvent: (event) => ({ ...(event as object), sentAt: ++n }),
        });
        expect(JSON.parse(bodies[0]).event).toEqual({ sentAt: 1 });
    });

    it('gives a call up as Puter`s when its deploy is put off for another', async () => {
        const headersSeen: Array<Record<string, string>> = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: missUntilDeployedFetch(headersSeen),
            }),
        );
        client.setMissHandler(async () => 'busy');
        await expect(client.invoke(REQUEST)).resolves.toMatchObject({
            outcome: 'unavailable',
            deployBusy: true,
        });
        expect(headersSeen).toHaveLength(1);
    });

    it('tells the miss handler whose call needs the deploy', async () => {
        const lanes: unknown[] = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: missUntilDeployedFetch([]),
            }),
        );
        client.setMissHandler(async (_appUid, _script, options) => {
            lanes.push(options.lane);
            return 'deployed';
        });
        await client.invoke(REQUEST, { lane: 'schedule' });
        await client.invoke(REQUEST);
        expect(lanes).toEqual(['schedule', undefined]);
    });
});

const REQUEST: WorkerInvokeRequest = {
    script: 'evw-test',
    appUid: 'app-test',
    handler: 'h',
    token: 't',
    key: 'k1:test',
    event: {},
    ctx: {},
};

const makeClient = () =>
    new EventsWorkerInvokerClient({} as unknown as IConfig);

/** Answers `missing` until it sees the deployed header, then settles. */
const missUntilDeployedFetch = (
    headersSeen: Array<Record<string, string>>,
): FetchImpl =>
    (async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        headersSeen.push(headers);
        if (headers[EVENTS_DEPLOYED_HEADER] === '1')
            return new Response(null, {
                status: 200,
                headers: { [EVENTS_HANDLED_HEADER]: '1' },
            });
        return new Response(null, {
            status: 404,
            headers: { [EVENTS_DISPATCH_ERROR_HEADER]: 'missing' },
        });
    }) as unknown as FetchImpl;

/** Answers `missing` no matter what, deployed header included. */
const alwaysMissingFetch = (calls: unknown[]): FetchImpl =>
    (async () => {
        calls.push(null);
        return new Response(null, {
            status: 404,
            headers: { [EVENTS_DISPATCH_ERROR_HEADER]: 'missing' },
        });
    }) as unknown as FetchImpl;

/**
 * Answers `deploy-timeout` once, then 200 once it sees the deployed header —
 * the shape of a script that finished propagating between the two calls.
 */
const deployTimeoutThenOkFetch = (
    headersSeen: Array<Record<string, string>>,
): FetchImpl =>
    (async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        headersSeen.push(headers);
        if (headers[EVENTS_DEPLOYED_HEADER] === '1')
            return new Response(null, {
                status: 200,
                headers: { [EVENTS_HANDLED_HEADER]: '1' },
            });
        return new Response(null, {
            status: 503,
            headers: { [EVENTS_DISPATCH_ERROR_HEADER]: 'deploy-timeout' },
        });
    }) as unknown as FetchImpl;

describe('EventsWorkerInvokerClient deploy-on-miss', () => {
    it('deploys the script and retries once with the deployed header', async () => {
        const headersSeen: Array<Record<string, string>> = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: missUntilDeployedFetch(headersSeen),
            }),
        );
        const missCalls: Array<[string, string]> = [];
        client.setMissHandler(async (appUid, script) => {
            missCalls.push([appUid, script]);
            return 'deployed';
        });

        const result = await client.invoke(REQUEST);

        expect(missCalls).toEqual([[REQUEST.appUid, REQUEST.script]]);
        expect(headersSeen).toHaveLength(2);
        expect(headersSeen[0][EVENTS_DEPLOYED_HEADER]).toBeUndefined();
        expect(headersSeen[1][EVENTS_DEPLOYED_HEADER]).toBe('1');
        expect(result).toEqual({ outcome: 'settled', status: 200 });
    });

    it('does not retry when the miss handler reports the script is stale', async () => {
        const calls: unknown[] = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: alwaysMissingFetch(calls),
            }),
        );
        client.setMissHandler(async () => 'stale');

        const result = await client.invoke(REQUEST);

        expect(calls).toHaveLength(1);
        expect(result).toEqual({
            outcome: 'unavailable',
            status: null,
            error: 'deploy: stale',
        });
    });

    it('never asks the miss handler twice for one invocation', async () => {
        const calls: unknown[] = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: alwaysMissingFetch(calls),
            }),
        );
        let handlerCalls = 0;
        client.setMissHandler(async () => {
            handlerCalls++;
            return 'deployed';
        });

        const result = await client.invoke(REQUEST);

        expect(handlerCalls).toBe(1);
        // The first send plus the one retry — never a third.
        expect(calls).toHaveLength(2);
        expect(result.outcome).toBe('unavailable');
        expect(result.status).toBeNull();
    });

    it('leaves behavior unchanged with no miss handler set', async () => {
        const calls: unknown[] = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: alwaysMissingFetch(calls),
            }),
        );

        const result = await client.invoke(REQUEST);

        expect(calls).toHaveLength(1);
        expect(result).toEqual({
            outcome: 'unavailable',
            status: null,
            error: 'dispatcher: missing (404)',
        });
    });

    it('does not trigger the miss handler for a forbidden dispatch reason', async () => {
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: stubFetch(403, {
                    [EVENTS_DISPATCH_ERROR_HEADER]: 'forbidden',
                }),
            }),
        );
        let handlerCalled = false;
        client.setMissHandler(async () => {
            handlerCalled = true;
            return 'deployed';
        });

        const result = await client.invoke(REQUEST);

        expect(handlerCalled).toBe(false);
        expect(result).toEqual({
            outcome: 'unavailable',
            status: null,
            error: 'dispatcher: forbidden (403)',
        });
    });

    it('retries a deploy-timeout with the deployed header instead of redeploying', async () => {
        const headersSeen: Array<Record<string, string>> = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: deployTimeoutThenOkFetch(headersSeen),
            }),
        );
        const deployCalls: unknown[] = [];
        client.setMissHandler(async () => {
            deployCalls.push(null);
            return 'deployed';
        });

        const result = await client.invoke(REQUEST);

        // The script was already deployed once — the one that led to this
        // deploy-timeout answer — so this client must not add a second.
        expect(deployCalls).toHaveLength(0);
        expect(headersSeen).toHaveLength(2);
        expect(headersSeen[0][EVENTS_DEPLOYED_HEADER]).toBeUndefined();
        expect(headersSeen[1][EVENTS_DEPLOYED_HEADER]).toBe('1');
        expect(result).toEqual({ outcome: 'settled', status: 200 });
    });

    it('gives up after one retry when propagation is still not done', async () => {
        const calls: unknown[] = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: (async () => {
                    calls.push(null);
                    return new Response(null, {
                        status: 503,
                        headers: {
                            [EVENTS_DISPATCH_ERROR_HEADER]: 'deploy-timeout',
                        },
                    });
                }) as unknown as FetchImpl,
            }),
        );
        const deployCalls: unknown[] = [];
        client.setMissHandler(async () => {
            deployCalls.push(null);
            return 'deployed';
        });

        const result = await client.invoke(REQUEST);

        // The first send plus the one retry — never a third, and never a
        // deploy. The delivery comes back on its own backoff instead.
        expect(calls).toHaveLength(2);
        expect(deployCalls).toHaveLength(0);
        expect(result).toEqual({
            outcome: 'unavailable',
            status: null,
            error: 'dispatcher: deploy-timeout (503)',
        });
    });

    describe('a script still bound to a rotated key', () => {
        /** Answers `bad-key` until it sees the deployed header, then settles. */
        const badKeyUntilDeployedFetch = (
            headersSeen: Array<Record<string, string>>,
        ): FetchImpl =>
            (async (_url: string, init?: RequestInit) => {
                const headers = (init?.headers ?? {}) as Record<string, string>;
                headersSeen.push(headers);
                return headers[EVENTS_DEPLOYED_HEADER] === '1'
                    ? new Response(null, {
                          status: 200,
                          headers: { [EVENTS_HANDLED_HEADER]: '1' },
                      })
                    : new Response(null, {
                          status: 500,
                          headers: {
                              [EVENTS_HANDLED_HEADER]: '1',
                              [EVENTS_ERROR_HEADER]: 'bad-key',
                          },
                      });
            }) as unknown as FetchImpl;

        const clientWith = (fetchImpl: FetchImpl) => {
            const client = makeClient();
            client.setTransport(
                new DispatcherInvokeTransport('http://dispatcher', 's', {
                    fetchImpl,
                }),
            );
            return client;
        };

        it('is redeployed, then retried once with the deployed header', async () => {
            const headersSeen: Array<Record<string, string>> = [];
            const client = clientWith(badKeyUntilDeployedFetch(headersSeen));
            const deploys: Array<[string, string]> = [];
            client.setMissHandler(async (appUid, script) => {
                deploys.push([appUid, script]);
                return 'deployed';
            });

            const result = await client.invoke(REQUEST);

            expect(deploys).toEqual([[REQUEST.appUid, REQUEST.script]]);
            expect(headersSeen).toHaveLength(2);
            expect(headersSeen[1][EVENTS_DEPLOYED_HEADER]).toBe('1');
            expect(result).toEqual({ outcome: 'settled', status: 200 });
        });

        it('backs off, uncounted, when the redeploy is throttled', async () => {
            const headersSeen: Array<Record<string, string>> = [];
            const client = clientWith(badKeyUntilDeployedFetch(headersSeen));
            client.setMissHandler(async () => 'throttled');

            const result = await client.invoke(REQUEST);

            expect(headersSeen).toHaveLength(1);
            expect(result).toEqual({
                outcome: 'unavailable',
                status: null,
                error: 'deploy: throttled',
            });
        });

        it('stops after the one retry when the old key is still being served', async () => {
            const calls: unknown[] = [];
            const client = clientWith((async () => {
                calls.push(null);
                return new Response(null, {
                    status: 500,
                    headers: {
                        [EVENTS_HANDLED_HEADER]: '1',
                        [EVENTS_ERROR_HEADER]: 'bad-key',
                    },
                });
            }) as unknown as FetchImpl);
            let deploys = 0;
            client.setMissHandler(async () => {
                deploys++;
                return 'deployed';
            });

            const result = await client.invoke(REQUEST);

            expect(deploys).toBe(1);
            expect(calls).toHaveLength(2);
            expect(result.outcome).toBe('unavailable');
        });

        it('deploys nothing for a handler`s own failure', async () => {
            const client = clientWith(
                stubFetch(500, {
                    [EVENTS_HANDLED_HEADER]: '1',
                    [EVENTS_ERROR_HEADER]: 'handler-threw',
                }),
            );
            let deploys = 0;
            client.setMissHandler(async () => {
                deploys++;
                return 'deployed';
            });

            expect((await client.invoke(REQUEST)).outcome).toBe('retriable');
            expect(deploys).toBe(0);
        });
    });

    it('reports a deploy that was throttled as Puter`s failure', async () => {
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: alwaysMissingFetch([]),
            }),
        );
        client.setMissHandler(async () => 'throttled');

        expect((await client.invoke(REQUEST)).outcome).toBe('unavailable');
    });
});

describe('whose failure an invocation was', () => {
    const invokeWith = (fetchImpl: FetchImpl, timeoutMs?: number) => {
        const client = new EventsWorkerInvokerClient({
            events: timeoutMs ? { invokeTimeoutMs: timeoutMs } : {},
        } as unknown as IConfig);
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl,
            }),
        );
        return client.invoke(REQUEST);
    };

    it('counts a run past the timeout against the handler', async () => {
        expect((await invokeWith(hangingFetch, 10)).outcome).toBe('retriable');
    });

    it('puts a request that never got an answer on Puter', async () => {
        expect((await invokeWith(refusedFetch)).outcome).toBe('unavailable');
    });

    it('puts an unmarked 5xx, 429 or 4xx on Puter', async () => {
        for (const status of [500, 502, 429, 404]) {
            const result = await invokeWith(stubFetch(status));
            expect(result).toEqual({
                outcome: 'unavailable',
                status,
                error: `unmarked ${status}`,
            });
        }
    });

    it('puts a handler failed by a Puter API call on Puter, with its wait', async () => {
        const result = await invokeWith(
            stubFetch(500, {
                [EVENTS_HANDLED_HEADER]: '1',
                [EVENTS_ERROR_HEADER]: 'platform-error',
                'retry-after': '20',
            }),
        );
        expect(result).toEqual({
            outcome: 'unavailable',
            status: 500,
            error: 'platform-error',
            retryAfterMs: 20_000,
        });
    });

    it('answers unavailable with no dispatcher configured', async () => {
        const result = await makeClient().invoke(REQUEST);
        expect(result.outcome).toBe('unavailable');
    });
});

describe('outcomeForStatus', () => {
    it.each([
        [200, true, undefined, 'settled'],
        [204, false, undefined, 'settled'],
        [400, true, 'handler-terminal', 'terminal'],
        [404, true, 'unknown-handler', 'terminal'],
        [500, true, 'handler-threw', 'retriable'],
        [500, true, 'handler-broken', 'retriable'],
        [429, true, undefined, 'retriable'],
        [500, true, 'bad-key', 'unavailable'],
        [500, true, 'no-token', 'unavailable'],
        [500, true, 'platform-error', 'unavailable'],
        [500, false, undefined, 'unavailable'],
        [429, false, undefined, 'unavailable'],
        [403, false, undefined, 'unavailable'],
    ] as const)(
        'reads %i (handled: %s, %s) as %s',
        (status, handled, errorCode, expected) => {
            expect(outcomeForStatus(status, handled, errorCode)).toBe(expected);
        },
    );
});

describe('EventsWorkerInvokerClient overall deadline', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const LEASE_MS = EVENTS_INVOKE_TIMEOUT_MS * EVENTS_WORKER_LEASE_FACTOR;

    /**
     * A transport on a fake clock: each send costs what `cost` says, and
     * answers a miss until the deployed header, then a handled 200.
     */
    const timedTransport = (cost: (deployed: boolean) => number) => {
        const sends: Array<{ deployed: boolean; timeoutMs: number }> = [];
        const transport = {
            send: async (call: {
                deployed?: boolean;
                timeoutMs: number;
            }): Promise<unknown> => {
                const deployed = call.deployed === true;
                sends.push({ deployed, timeoutMs: call.timeoutMs });
                // A send never outlasts its own timeout.
                vi.advanceTimersByTime(
                    Math.min(cost(deployed), call.timeoutMs * 1.5),
                );
                return deployed
                    ? { status: 200, handled: true }
                    : {
                          status: null,
                          dispatchReason: 'missing',
                          error: 'dispatcher: missing (404)',
                      };
            },
        };
        return { transport, sends };
    };

    const run = async (
        cost: (deployed: boolean) => number,
        deployMs: number,
    ) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { transport, sends } = timedTransport(cost);
        const client = makeClient();
        client.setTransport(transport as never);
        client.setMissHandler(async () => {
            vi.advanceTimersByTime(deployMs);
            return 'deployed';
        });
        const started = Date.now();
        const result = await client.invoke(REQUEST);
        return { result, sends, elapsed: Date.now() - started };
    };

    it('leaves a fast miss as it was: a full-timeout resend', async () => {
        const { result, sends } = await run(() => 100, 2_000);
        expect(result).toEqual({ outcome: 'settled', status: 200 });
        expect(sends).toEqual([
            { deployed: false, timeoutMs: EVENTS_INVOKE_TIMEOUT_MS },
            { deployed: true, timeoutMs: EVENTS_INVOKE_TIMEOUT_MS },
        ]);
    });

    it('shortens the resend after a slow deploy, so the call ends before the lease', async () => {
        // A miss that took 12 s, a deploy that took 30 s, and a resend that
        // would use everything it is given.
        const { result, sends, elapsed } = await run(
            (deployed) => (deployed ? 1e9 : 12_000),
            30_000,
        );
        expect(result.outcome).toBe('settled');
        expect(sends[1].deployed).toBe(true);
        expect(sends[1].timeoutMs).toBeLessThan(EVENTS_INVOKE_TIMEOUT_MS);
        expect(elapsed).toBeLessThanOrEqual(
            LEASE_MS - EVENTS_DEADLINE_MARGIN_MS,
        );
    });

    it('gives up on a deploy that never settles before the lease, leaving it running', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { transport, sends } = timedTransport(() => 0);
        const client = makeClient();
        client.setTransport(transport as never);
        let rejectDeploy!: (err: Error) => void;
        client.setMissHandler(
            () =>
                new Promise<string>((_resolve, reject) => {
                    rejectDeploy = reject;
                }),
        );
        let finished: unknown = null;
        const pending = client.invoke(REQUEST).then((r) => (finished = r));

        // Up to where the call must have ended, and no further.
        await vi.advanceTimersByTimeAsync(LEASE_MS - EVENTS_DEADLINE_MARGIN_MS);
        expect(finished).toMatchObject({
            outcome: 'unavailable',
            status: null,
        });
        await pending;
        expect(sends).toHaveLength(1);
        // The deploy was not cancelled; its late failure is logged, not thrown.
        rejectDeploy(new Error('stalled'));
        await vi.advanceTimersByTimeAsync(0);
        expect(warn).toHaveBeenCalledWith(
            '[events] deploy failed late',
            expect.any(Error),
        );
        warn.mockRestore();
    });

    it('does not resend when the deploy leaves less than the margin', async () => {
        const { result, sends } = await run(
            () => 100,
            LEASE_MS - EVENTS_DEADLINE_MARGIN_MS * 2 + 1_000,
        );
        expect(sends).toHaveLength(1);
        expect(result).toMatchObject({ outcome: 'unavailable', status: null });
    });
});

describe('the holder of a user scope on the wire', () => {
    const HOLDER = 'user-uuid-1';

    it('sends the holder header on a single invoke, and none for an app scope', async () => {
        const seen: Array<Record<string, string>> = [];
        const fetchImpl = (async (_url: string, init?: RequestInit) => {
            seen.push((init?.headers ?? {}) as Record<string, string>);
            return new Response(null, {
                status: 200,
                headers: { [EVENTS_HANDLED_HEADER]: '1' },
            });
        }) as unknown as FetchImpl;
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl,
                batchSize: 1,
            }),
        );

        await client.invoke({ ...REQUEST, holder: HOLDER });
        await client.invoke(REQUEST);

        expect(seen[0][EVENTS_HOLDER_HEADER]).toBe(HOLDER);
        expect(EVENTS_HOLDER_HEADER in seen[1]).toBe(false);
    });

    it('puts a holder field on a batch call of a user scope only', async () => {
        const bodies: Array<{ calls: Array<Record<string, unknown>> }> = [];
        const fetchImpl = (async (_url: string, init?: RequestInit) => {
            bodies.push(JSON.parse(String(init?.body)));
            return new Response(
                '{"i":0,"status":200,"handled":true}\n{"i":1,"status":200,"handled":true}\n',
                { status: 200 },
            );
        }) as unknown as FetchImpl;
        const transport = new DispatcherInvokeTransport(
            'http://dispatcher',
            's',
            { fetchImpl },
        );

        await Promise.all([
            transport.send({ ...CALL, holder: HOLDER }),
            transport.send(CALL),
        ]);

        expect(bodies).toHaveLength(1);
        expect(bodies[0].calls[0].holder).toBe(HOLDER);
        expect('holder' in bodies[0].calls[1]).toBe(false);
    });

    it('hands the holder to the miss handler, and nothing for an app scope', async () => {
        const seen: Array<{ holder?: string }> = [];
        const client = makeClient();
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl: missUntilDeployedFetch([]),
                batchSize: 1,
            }),
        );
        client.setMissHandler(async (_appUid, _script, options) => {
            seen.push(options);
            return 'deployed';
        });

        await client.invoke({ ...REQUEST, holder: HOLDER });
        await client.invoke(REQUEST);

        expect(seen[0].holder).toBe(HOLDER);
        expect('holder' in seen[1]).toBe(false);
    });

    it('keeps the holder out of the body the script sees', async () => {
        const bodies: string[] = [];
        const client = makeClient();
        client.setTransport({
            send: async (call) => {
                bodies.push(call.body);
                expect(call.holder).toBe(HOLDER);
                return { status: 200, handled: true };
            },
        });
        await client.invoke({ ...REQUEST, holder: HOLDER });
        expect(Object.keys(JSON.parse(bodies[0])).sort()).toEqual([
            'ctx',
            'event',
            'handler',
            'token',
        ]);
    });
});
