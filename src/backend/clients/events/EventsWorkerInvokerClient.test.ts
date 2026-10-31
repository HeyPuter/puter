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
import { describe, expect, it } from 'vitest';
import type { IConfig } from '../../types.js';
import {
    DispatcherInvokeTransport,
    EVENTS_DEPLOYED_HEADER,
    EVENTS_DISPATCH_ERROR_HEADER,
    EVENTS_DISPATCH_PATH,
    EVENTS_ERROR_HEADER,
    EVENTS_HANDLED_HEADER,
    EventsWorkerInvokerClient,
    outcomeForStatus,
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
const capturingFetch = (
    calls: string[],
    status = 200,
): FetchImpl =>
    (async (url: string) => {
        calls.push(url);
        return new Response(null, { status });
    }) as unknown as FetchImpl;

describe('DispatcherInvokeTransport', () => {
    it('reports a handled 400 with no error — the handler`s own refusal', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: stubFetch(400, { [EVENTS_HANDLED_HEADER]: '1' }),
        });
        expect(await transport.send(CALL)).toEqual({
            status: 400,
            handled: true,
        });
    });

    it('reports an unmarked 404 with no dispatch-error header as unhandled', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: stubFetch(404),
        });
        expect(await transport.send(CALL)).toEqual({
            status: 404,
            handled: false,
        });
    });

    it('turns a dispatch-error header into a null status with the reason', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: stubFetch(502, { [EVENTS_DISPATCH_ERROR_HEADER]: 'deploy-failed' }),
        });
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
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl,
        });

        await transport.send(CALL);
        await transport.send({ ...CALL, deployed: true });

        expect(headers[0][EVENTS_DEPLOYED_HEADER]).toBeUndefined();
        expect(headers[1][EVENTS_DEPLOYED_HEADER]).toBe('1');
    });

    it('reports a handled 200 as settled with no error', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: stubFetch(200, { [EVENTS_HANDLED_HEADER]: '1' }),
        });
        expect(await transport.send(CALL)).toEqual({
            status: 200,
            handled: true,
        });
    });

    it('passes a 429 through as-is', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: stubFetch(429),
        });
        expect(await transport.send(CALL)).toEqual({
            status: 429,
            handled: false,
        });
    });

    it('answers null and says so when the request times out', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: hangingFetch,
        });
        const result = await transport.send({ ...CALL, timeoutMs: 10 });
        expect(result.status).toBeNull();
        expect(result.timedOut).toBe(true);
    });

    it('answers null without a timeout when the request fails outright', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: refusedFetch,
        });
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
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: stubFetch(500, {
                [EVENTS_HANDLED_HEADER]: '1',
                [EVENTS_ERROR_HEADER]: 'handler-threw',
            }),
        });
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
        expect(calls).toEqual([`http://dispatcher/prefix${EVENTS_DISPATCH_PATH}`]);
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

const makeClient = () => new EventsWorkerInvokerClient({} as unknown as IConfig);

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
