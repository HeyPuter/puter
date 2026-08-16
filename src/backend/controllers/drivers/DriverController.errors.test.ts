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

/**
 * Upstream-error translation and rate-limit rejection in `/drivers/call`.
 *
 * When a driver's upstream provider fails, the caller must see a stable Puter
 * error code rather than a raw vendor payload. Each SDK reports its status
 * differently (`status`, `response.status`, an AWS `$metadata` block, or only a
 * message), so the controller sniffs all four — this suite pins the mapping for
 * every shape and asserts the resulting `legacyCode` / `statusCode`, plus the
 * `upstreamStatus` / `upstreamCode` diagnostic fields.
 *
 * The synthetic driver stands in for a provider-backed one: it is the input to
 * the translation under test, and it lets a single controller instance cover
 * every failure shape without real provider credentials.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Readable, Writable } from 'node:stream';
import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverMethodLifecycleEvent } from '../../clients/event/types.js';
import { runWithContext } from '../../core/context.js';
import { configureRateLimit } from '../../core/http/middleware/rateLimit.js';
import { DriverController } from './DriverController.js';

// -- Harness ---------------------------------------------------------

const captureCallHandler = (controller: DriverController): RequestHandler => {
    let handler: RequestHandler | undefined;
    const fakeRouter = {
        post: (path: string, _opts: unknown, h: RequestHandler) => {
            if (path === '/call') handler = h;
            return fakeRouter;
        },
        get: () => fakeRouter,
        use: () => fakeRouter,
    };
    controller.registerRoutes(fakeRouter as any);
    if (!handler) throw new Error('failed to capture POST /call handler');
    return handler;
};

// A real Writable so `result.stream.pipe(res)` behaves like the express
// response it stands in for.
class MockRes extends Writable {
    statusCode = 200;
    body: unknown;
    headers: Record<string, string> = {};
    chunks: Buffer[] = [];
    override _write(
        chunk: Buffer,
        _enc: BufferEncoding,
        cb: (e?: Error) => void,
    ) {
        this.chunks.push(Buffer.from(chunk));
        cb();
    }
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    json(body: unknown) {
        this.body = body;
        return this;
    }
    setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
        return this;
    }
}

const makeReq = (body: Record<string, unknown>): Request =>
    ({
        body,
        headers: {},
        query: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as Request;

interface BuildOptions {
    run?: () => unknown;
    rateLimit?: unknown;
    /**
     * Rate-limit buckets are keyed by iface+method, so give tests that exercise
     * limits their own namespace.
     */
    iface?: string;
}

/**
 * Build a controller around one synthetic driver. No actor is attached, so the
 * permission scan is skipped and the call reaches the driver method.
 */
const build = (opts: BuildOptions = {}) => {
    const events: DriverMethodLifecycleEvent[] = [];
    const eventClient = {
        emitAndWait: vi.fn(async () => {}),
        emit: vi.fn((_key: string, payload: unknown) => {
            events.push(payload as DriverMethodLifecycleEvent);
        }),
        on: vi.fn(),
    };
    const alarms: Array<{ id: string; severity: string }> = [];
    const iface = opts.iface ?? 'test-iface';
    const driver = {
        driverInterface: iface,
        driverName: 'test-driver',
        isDefault: true,
        ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
        run:
            opts.run ??
            (() => {
                throw new Error('no run configured');
            }),
    };
    const controller = new DriverController(
        {} as any,
        {
            event: eventClient,
            alarm: {
                create: (id: string, _t: string, _f: unknown, sev: string) => {
                    alarms.push({ id, severity: sev });
                },
            },
        } as any,
        {} as any,
        {} as any,
        { testDriver: driver } as any,
    );
    return {
        handler: captureCallHandler(controller),
        events,
        alarms,
        driver,
        iface,
    };
};

const callWith = async (run: () => unknown) => {
    const { handler, events } = build({ run });
    const res = new MockRes();
    const err = await runWithContext({}, () =>
        handler(
            makeReq({ interface: 'test-iface', method: 'run' }),
            res as unknown as Response,
            () => {},
        ),
    ).then(
        () => null,
        (e: unknown) => e,
    );
    return { err, res, events };
};

const throwing = (payload: unknown) => () => {
    throw payload;
};

// -- Upstream status extraction --------------------------------------

describe('DriverController upstream error translation', () => {
    it('maps an upstream 429 to a Puter 429 with upstream_rate_limited', async () => {
        const { err } = await callWith(
            throwing(
                Object.assign(new Error('slow down'), {
                    status: 429,
                    code: 'rate_limit_exceeded',
                }),
            ),
        );
        expect(err).toMatchObject({
            statusCode: 429,
            legacyCode: 'upstream_rate_limited',
            message: 'slow down',
            fields: {
                upstreamStatus: 429,
                upstreamCode: 'rate_limit_exceeded',
            },
        });
    });

    it('maps upstream 401 and 403 to a 500 upstream_auth_failed — never leaking auth state to the caller', async () => {
        for (const status of [401, 403]) {
            const { err } = await callWith(
                throwing(Object.assign(new Error('bad key'), { status })),
            );
            expect(err).toMatchObject({
                statusCode: 500,
                legacyCode: 'upstream_auth_failed',
                fields: { upstreamStatus: status },
            });
        }
    });

    it('maps any upstream 5xx to a 400 upstream_provider_unavailable with a generic message', async () => {
        const { err } = await callWith(
            throwing(
                Object.assign(new Error('internal provider stack trace'), {
                    status: 503,
                }),
            ),
        );
        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_provider_unavailable',
            message: 'AI provider unavailable',
            fields: { upstreamStatus: 503 },
        });
    });

    it('maps a generic upstream 4xx to a 400 upstream_bad_request', async () => {
        const { err } = await callWith(
            throwing(
                Object.assign(new Error('unsupported parameter'), {
                    status: 422,
                }),
            ),
        );
        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            message: 'unsupported parameter',
            fields: { upstreamStatus: 422 },
        });
    });

    it('prefers the nested error.message and error.code over the top-level ones', async () => {
        const { err } = await callWith(
            throwing({
                status: 400,
                message: 'outer',
                code: 'outer_code',
                error: { message: 'inner detail', code: 'inner_code' },
            }),
        );
        expect(err).toMatchObject({
            legacyCode: 'upstream_bad_request',
            message: 'inner detail',
            fields: { upstreamStatus: 400, upstreamCode: 'inner_code' },
        });
    });

    it('reads the status from statusCode when `status` is absent', async () => {
        const { err } = await callWith(throwing({ statusCode: 429 }));
        expect(err).toMatchObject({
            statusCode: 429,
            legacyCode: 'upstream_rate_limited',
        });
    });

    it('reads the status from a nested response object (axios-style)', async () => {
        const { err } = await callWith(
            throwing({ response: { status: 429 }, message: 'axios rejected' }),
        );
        expect(err).toMatchObject({
            statusCode: 429,
            legacyCode: 'upstream_rate_limited',
            fields: { upstreamStatus: 429 },
        });
    });

    it('reads the status from an AWS $metadata block', async () => {
        const { err } = await callWith(
            throwing({
                $metadata: { httpStatusCode: 400 },
                message: 'ValidationException',
            }),
        );
        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            fields: { upstreamStatus: 400 },
        });
    });

    it('sniffs a status out of the message when nothing else carries one', async () => {
        const { err } = await callWith(
            throwing(new Error('Request failed with status code 422')),
        );
        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            fields: { upstreamStatus: 422 },
        });
    });

    it('does not treat a bare 4xx-looking number in the message as a status', async () => {
        const raw = new Error('the answer contained 404 rows');
        const { err } = await callWith(throwing(raw));
        // No status could be derived, so the original error passes through
        // untranslated rather than being mislabelled.
        expect(err).toBe(raw);
    });

    it('passes an HttpError from the driver straight through', async () => {
        const { HttpError } = await import('../../core/http/HttpError.js');
        const raw = new HttpError(404, 'no such key', {
            legacyCode: 'not_found',
        });
        const { err } = await callWith(throwing(raw));
        expect(err).toBe(raw);
    });

    it('passes non-object throwables through untouched', async () => {
        const { err } = await callWith(throwing('a bare string'));
        expect(err).toBe('a bare string');
    });

    it('passes an error with a sub-400 status through untranslated', async () => {
        const raw = { status: 302, message: 'redirected' };
        const { err } = await callWith(throwing(raw));
        expect(err).toBe(raw);
    });

    it('emits the error lifecycle event with the original (untranslated) error', async () => {
        const raw = Object.assign(new Error('provider down'), { status: 500 });
        const { events, err } = await callWith(throwing(raw));

        const errorEvent = events.find(
            (e) => (e as { phase?: string }).phase === 'error',
        ) as unknown as Record<string, unknown>;
        expect(errorEvent).toBeDefined();
        expect(errorEvent.iface).toBe('test-iface');
        expect(errorEvent.method).toBe('run');
        expect(errorEvent.driver).toBe('test-driver');
        expect(errorEvent.error).toBe(raw);
        expect(typeof errorEvent.durationMs).toBe('number');
        // The caller still sees the translated error.
        expect(err).toMatchObject({
            legacyCode: 'upstream_provider_unavailable',
        });
    });
});

// -- Stream results --------------------------------------------------

describe('DriverController stream responses', () => {
    it('sets Transfer-Encoding: chunked for a chunked stream result', async () => {
        const { handler } = build({
            run: () => ({
                dataType: 'stream',
                content_type: 'audio/mpeg',
                chunked: true,
                stream: Readable.from(['a', 'b']),
            }),
        });
        const res = new MockRes();

        await runWithContext({}, () =>
            handler(
                makeReq({ interface: 'test-iface', method: 'run' }),
                res as unknown as Response,
                () => {},
            ),
        );

        expect(res.headers['content-type']).toBe('audio/mpeg');
        expect(res.headers['transfer-encoding']).toBe('chunked');
        // A piped stream never produces a JSON body.
        expect(res.body).toBeUndefined();
    });

    it('omits Transfer-Encoding for a non-chunked stream result', async () => {
        const { handler } = build({
            run: () => ({
                dataType: 'stream',
                content_type: 'audio/mpeg',
                stream: Readable.from(['a']),
            }),
        });
        const res = new MockRes();

        await runWithContext({}, () =>
            handler(
                makeReq({ interface: 'test-iface', method: 'run' }),
                res as unknown as Response,
                () => {},
            ),
        );

        expect(res.headers['content-type']).toBe('audio/mpeg');
        expect('transfer-encoding' in res.headers).toBe(false);
    });
});

// -- Rate limiting ---------------------------------------------------

describe('DriverController per-method rate limiting', () => {
    beforeEach(() => {
        configureRateLimit({ disabled: false } as never);
    });

    it('answers 429 without alarming once the per-method budget is spent', async () => {
        const { handler, alarms, iface } = build({
            run: () => ({ ok: true }),
            rateLimit: { default: { limit: 1, window: 60_000 } },
            iface: 'rate-limited-iface',
        });
        const call = () =>
            runWithContext({}, () =>
                handler(
                    makeReq({ interface: iface, method: 'run' }),
                    new MockRes() as unknown as Response,
                    () => {},
                ),
            );

        await call();
        await expect(call()).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });

        // Spending your own budget is the limit working as designed, so it
        // must not raise anything — the 429 is the whole signal.
        expect(alarms).toEqual([]);
    });
});
