/**
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

import type { Request, Response } from 'express';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../../types';
import { createLocalWorkerProxyMiddleware } from './localWorkerProxy.ts';

const ENABLED = {
    workers: { localServer: 'http://127.0.0.1:8787' },
} as unknown as IConfig;

/**
 * Express response stand-in: a writable stream that also records the status
 * line and headers the middleware sets.
 */
class FakeRes extends PassThrough {
    statusCode = 0;
    headers: Record<string, string> = {};
    destroyed_ = false;

    status(code: number) {
        this.statusCode = code;
        return this;
    }
    setHeader(key: string, value: string) {
        this.headers[key.toLowerCase()] = value;
        return this;
    }
    override destroy(err?: Error) {
        this.destroyed_ = true;
        return super.destroy(err);
    }
    async text(): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of this) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks).toString();
    }
}

interface ReqInit {
    hostname?: string | null;
    method?: string;
    originalUrl?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: string;
}

const makeReq = (init: ReqInit = {}): Request => {
    const stream = Readable.from([Buffer.from(init.body ?? '')]);
    return Object.assign(stream, {
        hostname: init.hostname,
        method: init.method ?? 'GET',
        originalUrl: init.originalUrl ?? '/',
        headers: init.headers ?? { host: init.hostname ?? '' },
    }) as unknown as Request;
};

// Minimal stand-in for the Miniflare response the LocalWorkerService returns.
const makeWorkerResponse = (
    status: number,
    headers: Record<string, string>,
    body: string | null,
) => ({
    status,
    headers: {
        forEach(cb: (value: string, key: string) => void) {
            for (const [k, v] of Object.entries(headers)) cb(v, k);
        },
    },
    body:
        body === null
            ? null
            : (Readable.toWeb(
                  Readable.from([Buffer.from(body)]),
              ) as ReadableStream<Uint8Array>),
});

const makeLayers = (cfCallLocal: (name: string, req: Request) => unknown) =>
    ({
        clients: {},
        stores: {},
        services: { localworkerservice: { cfCallLocal } },
    }) as never;

describe('createLocalWorkerProxyMiddleware', () => {
    it('is a pass-through when no local worker server is configured', async () => {
        const next = vi.fn();
        const cfCallLocal = vi.fn();
        const middleware = createLocalWorkerProxyMiddleware(
            {} as IConfig,
            makeLayers(cfCallLocal),
        );

        await middleware(
            makeReq({ hostname: 'demo.workers.puter.localhost' }),
            new FakeRes() as unknown as Response,
            next,
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(cfCallLocal).not.toHaveBeenCalled();
    });

    it.each([
        ['a host outside the worker zone', 'api.puter.localhost'],
        ['the bare worker zone itself', 'workers.puter.localhost'],
        ['a leading-dot bare zone', '.workers.puter.localhost'],
        ['a lookalike suffix', 'evil-workers.puter.localhost'],
        ['an empty hostname', ''],
        ['a whitespace hostname', '   '],
    ])('passes %s through untouched', async (_label, hostname) => {
        const next = vi.fn();
        const cfCallLocal = vi.fn();
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers(cfCallLocal),
        );

        await middleware(
            makeReq({ hostname }),
            new FakeRes() as unknown as Response,
            next,
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(cfCallLocal).not.toHaveBeenCalled();
    });

    it('passes through when express reports no hostname at all', async () => {
        const next = vi.fn();
        const cfCallLocal = vi.fn();
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers(cfCallLocal),
        );

        await middleware(
            makeReq({ hostname: null }),
            new FakeRes() as unknown as Response,
            next,
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(cfCallLocal).not.toHaveBeenCalled();
    });

    it('dispatches to the worker named by the leftmost label, case-insensitively', async () => {
        const seen: string[] = [];
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers((name) => {
                seen.push(name);
                return makeWorkerResponse(200, {}, 'ok');
            }),
        );

        for (const hostname of [
            'demo.workers.puter.localhost',
            'DEMO.Workers.Puter.Localhost',
            'demo.workers.puter.localhost:4100',
        ]) {
            await middleware(
                makeReq({ hostname }),
                new FakeRes() as unknown as Response,
                vi.fn(),
            );
        }

        expect(seen).toEqual(['demo', 'demo', 'demo']);
    });

    it('forwards the method, URL and headers to the worker', async () => {
        let received: Request | undefined;
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers((_name, request) => {
                received = request;
                return makeWorkerResponse(204, {}, null);
            }),
        );

        await middleware(
            makeReq({
                hostname: 'demo.workers.puter.localhost',
                method: 'post',
                originalUrl: '/api/thing?x=1',
                headers: {
                    host: 'demo.workers.puter.localhost',
                    'x-custom': 'v',
                    'x-multi': ['a', 'b'],
                    'x-absent': undefined,
                },
                body: 'payload',
            }),
            new FakeRes() as unknown as Response,
            vi.fn(),
        );

        const fetchRequest = received as unknown as globalThis.Request;
        expect(fetchRequest.method).toBe('POST');
        expect(fetchRequest.url).toBe(
            'http://demo.workers.puter.localhost/api/thing?x=1',
        );
        expect(fetchRequest.headers.get('x-custom')).toBe('v');
        expect(fetchRequest.headers.get('x-multi')).toBe('a, b');
        expect(fetchRequest.headers.has('x-absent')).toBe(false);
        expect(await fetchRequest.text()).toBe('payload');
    });

    it('sends no request body for GET and HEAD', async () => {
        const bodies: (ReadableStream | null)[] = [];
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers((_name, request) => {
                bodies.push((request as unknown as globalThis.Request).body);
                return makeWorkerResponse(200, {}, null);
            }),
        );

        for (const method of ['GET', 'HEAD']) {
            await middleware(
                makeReq({
                    hostname: 'demo.workers.puter.localhost',
                    method,
                }),
                new FakeRes() as unknown as Response,
                vi.fn(),
            );
        }

        expect(bodies).toEqual([null, null]);
    });

    it('falls back to the worker zone when the request carries no host header', async () => {
        let received: Request | undefined;
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers((_name, request) => {
                received = request;
                return makeWorkerResponse(200, {}, null);
            }),
        );

        await middleware(
            makeReq({
                hostname: 'demo.workers.puter.localhost',
                originalUrl: '/x',
                headers: {},
            }),
            new FakeRes() as unknown as Response,
            vi.fn(),
        );

        expect((received as unknown as globalThis.Request).url).toBe(
            'http://workers.puter.localhost/x',
        );
    });

    it('copies the worker status and headers onto the express response', async () => {
        const res = new FakeRes();
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers(() =>
                makeWorkerResponse(
                    201,
                    {
                        'Content-Type': 'text/plain',
                        // Node owns framing — these must be dropped.
                        'Content-Length': '999',
                        'Transfer-Encoding': 'chunked',
                    },
                    'hello worker',
                ),
            ),
        );

        const next = vi.fn();
        await middleware(
            makeReq({ hostname: 'demo.workers.puter.localhost' }),
            res as unknown as Response,
            next,
        );

        expect(await res.text()).toBe('hello worker');
        expect(res.statusCode).toBe(201);
        expect(res.headers['content-type']).toBe('text/plain');
        expect(res.headers['content-length']).toBeUndefined();
        expect(res.headers['transfer-encoding']).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('ends the response immediately when the worker returns no body', async () => {
        const res = new FakeRes();
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers(() => makeWorkerResponse(304, { etag: 'w/"1"' }, null)),
        );

        await middleware(
            makeReq({ hostname: 'demo.workers.puter.localhost' }),
            res as unknown as Response,
            vi.fn(),
        );

        expect(res.statusCode).toBe(304);
        expect(res.headers.etag).toBe('w/"1"');
        expect(await res.text()).toBe('');
    });

    it('tears the response down when the worker body stream errors', async () => {
        const res = new FakeRes();
        const failing = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new Error('worker stream blew up'));
            },
        });
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers(() => ({
                status: 200,
                headers: { forEach: () => undefined },
                body: failing,
            })),
        );

        await middleware(
            makeReq({ hostname: 'demo.workers.puter.localhost' }),
            res as unknown as Response,
            vi.fn(),
        );

        await new Promise((r) => setTimeout(r, 10));
        expect(res.destroyed_).toBe(true);
    });

    it('forwards a dispatch failure to the error handler', async () => {
        const next = vi.fn();
        const failure = new Error('miniflare is down');
        const middleware = createLocalWorkerProxyMiddleware(
            ENABLED,
            makeLayers(() => {
                throw failure;
            }),
        );

        await middleware(
            makeReq({ hostname: 'demo.workers.puter.localhost' }),
            new FakeRes() as unknown as Response,
            next,
        );

        expect(next).toHaveBeenCalledWith(failure);
    });
});
