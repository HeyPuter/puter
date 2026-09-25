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

import type { Request, RequestHandler, Response } from 'express';
import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { kv } from '../../util/kvSingleton.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock
// redis) and re-registers SystemController's inline lambda routes
// onto a fresh PuterRouter so each handler is reachable. Tests then
// drive the captured handler with stub req/res — the underlying
// services (health, db, drivers) are the live wired ones.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.system.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `sysc-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, unknown>;
}

const makeReq = (init: {
    body?: unknown;
    actor?: Actor;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
}): Request => {
    return {
        body: init.body ?? {},
        query: init.query ?? {},
        headers: init.headers ?? {},
        actor: init.actor,
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = {
        statusCode: 200,
        body: undefined,
        headers: {},
    };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        setHeader: vi.fn((name: string, value: unknown) => {
            captured.headers[name] = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

const findHandler = (method: string, path: string): RequestHandler => {
    const route = router.routes.find(
        (r) => r.method === method && r.path === path,
    );
    if (!route) throw new Error(`No ${method.toUpperCase()} ${path} route`);
    return route.handler;
};

const callRoute = async (
    method: string,
    path: string,
    req: Request,
    res: Response,
) => {
    const handler = findHandler(method, path);
    await handler(req, res, () => {
        throw new Error('handler called next() unexpectedly');
    });
};

// ── /healthcheck ────────────────────────────────────────────────────

describe('SystemController GET /healthcheck', () => {
    // This route decides whether a node stays in rotation, so its rate limit
    // must not reach for a backing service. The default backend is redis,
    // whose client queues rather than fails fast while it is unreachable —
    // enough to push a probe past the 4s the load balancer allows and evict
    // every target during a redis degradation. In-process counting keeps the
    // liveness path free of anything it is itself reporting on.
    it('counts in-process, so liveness never waits on redis', () => {
        const route = router.routes.find(
            (r) => r.method === 'get' && r.path === '/healthcheck',
        );
        expect(route?.options.rateLimit?.backend).toBe('memory');
    });

    it('returns the live ServerHealthService status payload', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/healthcheck', makeReq({}), res);
        // Live status — boot is complete and the in-memory DB is up,
        // so ok=true is the expected steady state for this harness.
        expect(captured.body).toMatchObject({ ok: true });
        expect(captured.statusCode).toBe(200);
    });

    it('parses ?ignore and ?marked-degraded into trimmed name lists', async () => {
        const spy = vi
            .spyOn(server.services.health, 'getStatus')
            .mockResolvedValue({ ok: true });
        try {
            const { res } = makeRes();
            await callRoute(
                'get',
                '/healthcheck',
                makeReq({
                    query: {
                        ignore: 'database-liveness, thumbnailer',
                        'marked-degraded': ' socket-initialized ',
                    },
                }),
                res,
            );
            expect(spy).toHaveBeenCalledWith({
                ignore: ['database-liveness', 'thumbnailer'],
                degrade: ['socket-initialized'],
            });
        } finally {
            spy.mockRestore();
        }
    });

    it('returns ok:true + 200 when the only failures are ignored', async () => {
        const spy = vi
            .spyOn(server.services.health, 'getStatus')
            .mockImplementation(async ({ ignore = [] } = {}) => {
                const failed = ['database-liveness'].filter(
                    (name) => !ignore.includes(name),
                );
                return failed.length === 0
                    ? { ok: true }
                    : { ok: false, failed };
            });
        try {
            const { res, captured } = makeRes();
            await callRoute(
                'get',
                '/healthcheck',
                makeReq({ query: { ignore: 'database-liveness' } }),
                res,
            );
            expect(captured.body).toEqual({ ok: true });
            expect(captured.statusCode).toBe(200);
        } finally {
            spy.mockRestore();
        }
    });

    it('returns ok:true + 207 when the only failures are marked degraded', async () => {
        const spy = vi
            .spyOn(server.services.health, 'getStatus')
            .mockResolvedValue({ ok: true, degraded: ['database-liveness'] });
        try {
            const { res, captured } = makeRes();
            await callRoute(
                'get',
                '/healthcheck',
                makeReq({ query: { 'marked-degraded': 'database-liveness' } }),
                res,
            );
            expect(captured.body).toEqual({
                ok: true,
                degraded: ['database-liveness'],
            });
            expect(captured.statusCode).toBe(207);
        } finally {
            spy.mockRestore();
        }
    });

    it('still 503s when a non-ignored failure remains', async () => {
        const spy = vi
            .spyOn(server.services.health, 'getStatus')
            .mockImplementation(async ({ ignore = [] } = {}) => {
                const failed = ['database-liveness', 'socket-initialized'].filter(
                    (name) => !ignore.includes(name),
                );
                return failed.length === 0
                    ? { ok: true }
                    : { ok: false, failed };
            });
        try {
            const { res, captured } = makeRes();
            await callRoute(
                'get',
                '/healthcheck',
                makeReq({ query: { ignore: 'database-liveness' } }),
                res,
            );
            expect(captured.statusCode).toBe(503);
            expect(captured.body).toEqual({
                ok: false,
                failed: ['socket-initialized'],
            });
        } finally {
            spy.mockRestore();
        }
    });
});

// ── ServerHealthService.getStatus ignore / degrade filtering ────────
//
// Exercises the real service by seeding the in-process status cache
// (the kv.js singleton) it reads from, so the actual per-request
// classification runs — not a stubbed getStatus.

describe('ServerHealthService.getStatus ignore/degrade filtering', () => {
    const STATUS_CACHE_KEY = 'server-health:status';

    const seedStatus = (status: unknown) => {
        kv.set(STATUS_CACHE_KEY, status, { EX: 5 });
    };

    afterEach(() => {
        kv.del(STATUS_CACHE_KEY);
    });

    it('collapses to ok:true when every failure is ignored', async () => {
        seedStatus({ ok: false, failed: ['database-liveness', 'thumbnailer'] });
        const status = await server.services.health.getStatus({
            ignore: ['database-liveness', 'thumbnailer'],
        });
        expect(status).toEqual({ ok: true });
    });

    it('keeps the non-ignored failures', async () => {
        seedStatus({ ok: false, failed: ['database-liveness', 'thumbnailer'] });
        const status = await server.services.health.getStatus({
            ignore: ['database-liveness'],
        });
        expect(status).toEqual({ ok: false, failed: ['thumbnailer'] });
    });

    it('is a no-op for a healthy status', async () => {
        seedStatus({ ok: true });
        const status = await server.services.health.getStatus({
            ignore: ['database-liveness'],
        });
        expect(status).toEqual({ ok: true });
    });

    it('ignores unknown names without affecting real failures', async () => {
        seedStatus({ ok: false, failed: ['database-liveness'] });
        const status = await server.services.health.getStatus({
            ignore: ['not-a-check'],
        });
        expect(status).toEqual({ ok: false, failed: ['database-liveness'] });
    });

    it('demotes marked failures to degraded and stays ok:true', async () => {
        seedStatus({ ok: false, failed: ['database-liveness'] });
        const status = await server.services.health.getStatus({
            degrade: ['database-liveness'],
        });
        expect(status).toEqual({ ok: true, degraded: ['database-liveness'] });
    });

    it('reports degraded alongside remaining hard failures (ok:false)', async () => {
        seedStatus({
            ok: false,
            failed: ['database-liveness', 'socket-initialized'],
        });
        const status = await server.services.health.getStatus({
            degrade: ['database-liveness'],
        });
        expect(status).toEqual({
            ok: false,
            failed: ['socket-initialized'],
            degraded: ['database-liveness'],
        });
    });

    it('lets ignore take precedence over degrade for the same name', async () => {
        seedStatus({ ok: false, failed: ['database-liveness'] });
        const status = await server.services.health.getStatus({
            ignore: ['database-liveness'],
            degrade: ['database-liveness'],
        });
        expect(status).toEqual({ ok: true });
    });
});

// ── /version ────────────────────────────────────────────────────────

describe('SystemController GET /version', () => {
    it('returns version-shape JSON with environment + deploy_timestamp', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/version', makeReq({}), res);
        const body = captured.body as Record<string, unknown>;
        // Default config has no `version` set — falls through to
        // npm_package_version (set when running under vitest) or 'unknown'.
        expect(typeof body.version).toBe('string');
        // Default test config carries env='dev' from config.default.json.
        expect(body.environment).toBe('dev');
        expect(typeof body.deploy_timestamp).toBe('number');
    });

    it('is cacheable per-client but never by a shared cache', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/version', makeReq({}), res);
        expect(captured.headers['Cache-Control']).toBe('private, max-age=60');
    });
});

// ── /contactUs ──────────────────────────────────────────────────────

describe('SystemController POST /contactUs', () => {
    it('throws 400 when message is missing', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({ body: {}, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when message is not a string', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({ body: { message: 12345 }, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when message exceeds 100,000 characters', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({
                    body: { message: 'x'.repeat(100_001) },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('persists feedback into the DB on success', async () => {
        const { actor, userId } = await makeUser();
        const message = `hello ${Math.random().toString(36).slice(2)}`;
        const { res, captured } = makeRes();
        await callRoute(
            'post',
            '/contactUs',
            makeReq({ body: { message }, actor }),
            res,
        );
        expect(captured.body).toEqual({});

        // The row landed in the real `feedback` table for the right user.
        const rows = (await server.clients.db.read(
            'SELECT `user_id`, `message`, `attachments` FROM `feedback` WHERE `user_id` = ? AND `message` = ?',
            [userId, message],
        )) as Array<{
            user_id: number;
            message: string;
            attachments: string | null;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.message).toBe(message);
        // No files sent — the column stays null rather than an empty array.
        expect(rows[0]?.attachments ?? null).toBeNull();
    });
});

// ── /contactUs attachments ──────────────────────────────────────────

describe('SystemController POST /contactUs — attachments', () => {
    // A real PNG signature with a filler body; the sniffer only reads the
    // first eight bytes, and nothing downstream decodes the image.
    const pngBytes = (size = 64): Buffer =>
        Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(size - 8, 0x61),
        ]);

    type Part =
        | { field: string; value: string }
        | { field: string; filename: string; data: Buffer };

    const BOUNDARY = '----contact-us-test';
    const multipart = (parts: Part[]): Buffer =>
        Buffer.concat([
            ...parts.flatMap((part) =>
                'value' in part
                    ? [
                          Buffer.from(
                              `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.field}"\r\n\r\n${part.value}\r\n`,
                          ),
                      ]
                    : [
                          Buffer.from(
                              `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.field}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
                          ),
                          part.data,
                          Buffer.from('\r\n'),
                      ],
            ),
            Buffer.from(`--${BOUNDARY}--\r\n`),
        ]);

    const submitMultipart = async (
        parts: Part[],
        headers: Record<string, string> = {},
    ) => {
        const { actor, userId } = await makeUser();
        const { res, captured } = makeRes();
        const body = multipart(parts);
        const req = Object.assign(Readable.from([body]), {
            headers: {
                'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
                'content-length': String(body.length),
                ...headers,
            },
            actor,
            query: {},
        }) as unknown as Request;
        const call = callRoute('post', '/contactUs', req, res);
        return { call, captured, userId };
    };

    const readAttachments = async (userId: number, message: string) => {
        const rows = (await server.clients.db.read(
            'SELECT `attachments` FROM `feedback` WHERE `user_id` = ? AND `message` = ?',
            [userId, message],
        )) as Array<{ attachments: string | null }>;
        return rows[0]?.attachments ?? null;
    };

    it('stores attachment metadata — names, types and sizes, no payloads', async () => {
        const message = `attached ${Math.random().toString(36).slice(2)}`;
        const { call, captured, userId } = await submitMultipart([
            { field: 'message', value: message },
            {
                field: 'attachments',
                filename: 'repro-step-3.png',
                data: pngBytes(128),
            },
        ]);
        await call;
        expect(captured.body).toEqual({});

        const stored = await readAttachments(userId, message);
        expect(JSON.parse(stored!)).toEqual([
            { name: 'repro-step-3.png', type: 'image/png', size: 128 },
        ]);
    });

    it('emails the files to support with sanitized names and a manifest', async () => {
        const sendRaw = vi
            .spyOn(server.clients.email, 'sendRaw')
            .mockResolvedValue(null);
        try {
            const message = `attached ${Math.random().toString(36).slice(2)}`;
            const { call } = await submitMultipart([
                { field: 'message', value: message },
                // Declares .html, but the bytes are a PNG: the stored and
                // emailed extension must follow the bytes.
                {
                    field: 'attachments',
                    filename: 'payload.html',
                    data: pngBytes(64),
                },
            ]);
            await call;

            expect(sendRaw).toHaveBeenCalledTimes(1);
            const sent = sendRaw.mock.calls[0][0] as {
                text: string;
                attachments: Array<{
                    filename: string;
                    content: Buffer;
                    contentType: string;
                    contentDisposition: string;
                }>;
            };
            expect(sent.attachments).toHaveLength(1);
            expect(sent.attachments[0].filename).toBe('payload.png');
            expect(sent.attachments[0].contentType).toBe('image/png');
            expect(sent.attachments[0].contentDisposition).toBe('attachment');
            expect(sent.attachments[0].content.equals(pngBytes(64))).toBe(true);
            // The body records what should have arrived, in case a gateway
            // strips the files on the way.
            expect(sent.text).toContain(message);
            expect(sent.text).toContain('payload.png');
        } finally {
            sendRaw.mockRestore();
        }
    });

    it('accepts a multipart submission with no files', async () => {
        const sendRaw = vi
            .spyOn(server.clients.email, 'sendRaw')
            .mockResolvedValue(null);
        try {
            const message = `plain ${Math.random().toString(36).slice(2)}`;
            const { call, captured } = await submitMultipart([
                { field: 'message', value: message },
            ]);
            await call;
            expect(captured.body).toEqual({});
            const sent = sendRaw.mock.calls[0][0] as {
                text: string;
                attachments: unknown[];
            };
            expect(sent.attachments).toEqual([]);
            expect(sent.text).toBe(message);
        } finally {
            sendRaw.mockRestore();
        }
    });

    it('rejects base64 attachments in a JSON body', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({
                    body: {
                        message: 'hi',
                        attachments: [{ data: pngBytes().toString('base64') }],
                    },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it.each([
        [
            'too many files',
            [
                { field: 'message', value: 'hi' },
                ...Array.from({ length: 6 }, (_, i) => ({
                    field: 'attachments',
                    filename: `${i}.png`,
                    data: pngBytes(),
                })),
            ],
        ],
        [
            'an unsupported type',
            [
                { field: 'message', value: 'hi' },
                {
                    field: 'attachments',
                    filename: 'a.pdf',
                    data: Buffer.from('%PDF-1.7 x'),
                },
            ],
        ],
        [
            'a script-capable SVG',
            [
                { field: 'message', value: 'hi' },
                {
                    field: 'attachments',
                    filename: 'a.svg',
                    data: Buffer.from('<svg><script/></svg>'),
                },
            ],
        ],
        [
            'a missing message',
            [{ field: 'attachments', filename: 'a.png', data: pngBytes() }],
        ],
    ] as [string, Part[]][])('rejects %s with 400', async (_label, parts) => {
        const { call, captured } = await submitMultipart(parts);
        await expect(call).rejects.toMatchObject({ statusCode: 400 });
        expect(captured.body).toBeUndefined();
    });

    it('refuses a body whose declared length is over budget before reading it', async () => {
        const { call, captured } = await submitMultipart(
            [{ field: 'message', value: 'hi' }],
            { 'content-length': String(64 * 1024 * 1024) },
        );
        await expect(call).rejects.toMatchObject({ statusCode: 413 });
        expect(captured.headers.Connection).toBe('close');
    });

    it('closes the connection when an upload breaks a limit mid-stream', async () => {
        const { call, captured } = await submitMultipart(
            [
                { field: 'message', value: 'hi' },
                {
                    field: 'attachments',
                    filename: 'big.png',
                    data: pngBytes(10 * 1024 * 1024 + 1),
                },
            ],
            // Chunked uploads carry no length to check up front.
            { 'content-length': '' },
        );
        await expect(call).rejects.toMatchObject({ statusCode: 413 });
        expect(captured.headers.Connection).toBe('close');
    });
});

// ── /whoarewe ───────────────────────────────────────────────────────

describe('SystemController GET /whoarewe', () => {
    it('returns the configured Puter identity payload', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/whoarewe', makeReq({}), res);
        expect(captured.body).toMatchObject({
            name: 'Puter',
            environment: 'dev',
            disable_user_signup: false,
        });
    });
});

// ── /lsmod ──────────────────────────────────────────────────────────

describe('SystemController GET /lsmod', () => {
    it('lists wired drivers grouped by interface', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/lsmod', makeReq({}), res);
        const body = captured.body as {
            interfaces: Record<
                string,
                { implementors: Record<string, { isDefault: boolean }> }
            >;
        };
        expect(body.interfaces).toBeDefined();
        // Test harness wires the full driver registry; at least one
        // driver/interface pair must come through.
        expect(Object.keys(body.interfaces).length).toBeGreaterThan(0);
        for (const iface of Object.values(body.interfaces)) {
            expect(Object.keys(iface.implementors).length).toBeGreaterThan(0);
        }
    });
});

// ── rate-limit scopes ───────────────────────────────────────────────

describe('SystemController public route rate limits', () => {
    const rateLimitOf = (path: string) => {
        const route = router.routes.find(
            (r) => r.method === 'get' && r.path === path,
        );
        if (!route) throw new Error(`No GET ${path} route`);
        return route.options.rateLimit as {
            scope: string;
            limit: number;
            window: number;
            key: string;
        };
    };

    it('gives /healthcheck, /version and /whoarewe separate buckets', () => {
        // These once shared one scope, which meant clients polling /version
        // could exhaust the budget that liveness probes depend on. Keep them
        // apart: a 429 on /healthcheck is read as an unhealthy node.
        const scopes = [
            rateLimitOf('/healthcheck').scope,
            rateLimitOf('/version').scope,
            rateLimitOf('/whoarewe').scope,
        ];
        expect(new Set(scopes).size).toBe(3);
        expect(scopes).toEqual(['healthcheck', 'version', 'whoarewe']);
    });

    it('sizes the unauthenticated buckets for a shared address, not one client', () => {
        // All three key on IP, and an IP is a NAT, a campus or a carrier
        // gateway — the bucket aggregates everyone behind it, and the
        // limiter counts region-wide rather than per process.
        for (const path of ['/healthcheck', '/version', '/whoarewe']) {
            const limit = rateLimitOf(path);
            expect(limit.key).toBe('ip');
            expect(limit.window).toBe(60_000);
            expect(limit.limit).toBeGreaterThanOrEqual(6_000);
        }
        // Liveness polling is the most generous of the three by design.
        expect(rateLimitOf('/healthcheck').limit).toBe(30_000);
        expect(rateLimitOf('/version').limit).toBe(6_000);
        expect(rateLimitOf('/whoarewe').limit).toBe(6_000);
    });
});

// ── lifecycle ───────────────────────────────────────────────────────

describe('SystemController.onServerPrepareShutdown', () => {
    it('flips the global drain flag', () => {
        // Reset before the call so the assertion is meaningful even
        // when earlier code in the same process already tripped it.
        (
            globalThis as unknown as { __puter_draining?: boolean }
        ).__puter_draining = false;
        server.controllers.system.onServerPrepareShutdown();
        expect(
            (globalThis as unknown as { __puter_draining?: boolean })
                .__puter_draining,
        ).toBe(true);
    });
});
