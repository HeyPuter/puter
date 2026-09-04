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
import {
    DispatcherInvokeTransport,
    EVENTS_DISPATCH_ERROR_HEADER,
    EVENTS_DISPATCH_PATH,
    EVENTS_ERROR_HEADER,
    EVENTS_HANDLED_HEADER,
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

/** A stub fetch that never answers until the abort signal fires. */
const hangingFetch: FetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
            reject(new Error('This operation was aborted')),
        );
    })) as unknown as FetchImpl;

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
        });
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

    it('answers null with an error when the request times out', async () => {
        const transport = new DispatcherInvokeTransport('http://dispatcher', 's', {
            fetchImpl: hangingFetch,
        });
        const result = await transport.send({ ...CALL, timeoutMs: 10 });
        expect(result.status).toBeNull();
        expect(result.error).toMatch(/abort/i);
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
