// This tests wisp controller but not wisp itself. That is out of process and out of this repo
// This simply tests the authentication methods that puter wisp expects and uses.
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { WispController } from './WispController.js';

let server: PuterServer;
let controller: WispController;
let createHandler: Function;
let verifyHandler: Function;

beforeAll(async () => {
    server = await setupTestServer({
        wisp: { server: 'wss://wisp.test' },
    });
    controller = server.controllers.wisp as unknown as WispController;

    const router = new PuterRouter();
    controller.registerRoutes(router);

    createHandler = router.routes.find(
        (r) => r.path === '/wisp/relay-token/create',
    )!.handler;
    verifyHandler = router.routes.find(
        (r) => r.path === '/wisp/relay-token/verify',
    )!.handler;
});

afterAll(async () => {
    await server?.shutdown();
});

interface CapturedResponse {
    statusCode: number;
    body: unknown;
}

const makeReq = (init: {
    body?: unknown;
    headers?: Record<string, string>;
    actor?: unknown;
}): Request => {
    return {
        body: init.body ?? {},
        query: {},
        headers: init.headers ?? {},
        actor: init.actor,
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        setHeader: vi.fn(() => res),
        set: vi.fn(() => res),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        end: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

describe('WispController', () => {
    describe('route registration', () => {
        it('registers both expected routes', () => {
            const router = new PuterRouter();
            controller.registerRoutes(router);
            const paths = router.routes.map((r) => r.path);
            expect(paths).toContain('/wisp/relay-token/create');
            expect(paths).toContain('/wisp/relay-token/verify');
        });
    });

    describe('create', () => {
        it('returns a token and server for an authenticated user', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({
                actor: {
                    user: {
                        uuid: '00000000-0000-0000-0000-000000000001',
                    },
                },
            });
            await createHandler(req, res);

            const body = captured.body as { token: string; server: string };
            expect(body.token).toBeDefined();
            expect(typeof body.token).toBe('string');
            expect(body.token.length).toBeGreaterThan(0);
            expect(body.server).toBe('wss://wisp.test');
        });

        it('returns a guest token when actor has no user uuid', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({ actor: { user: {} } });
            await createHandler(req, res);

            const body = captured.body as { token: string; server: string };
            expect(body.token).toBeDefined();
            expect(typeof body.token).toBe('string');
            expect(body.server).toBe('wss://wisp.test');
        });

        it('returns a guest token when actor is absent', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({});
            await createHandler(req, res);

            const body = captured.body as { token: string; server: string };
            expect(body.token).toBeDefined();
            expect(body.server).toBe('wss://wisp.test');
        });

        it('returns null server when wisp config has no server', async () => {
            const minServer = await setupTestServer();
            const minController = minServer.controllers
                .wisp as unknown as WispController;
            try {
                const router = new PuterRouter();
                minController.registerRoutes(router);
                const handler = router.routes.find(
                    (r) => r.path === '/wisp/relay-token/create',
                )!.handler;

                const { res, captured } = makeRes();
                await handler(makeReq({ actor: { user: {} } }), res);

                const body = captured.body as { token: string; server: unknown };
                expect(body.server).toBeNull();
            } finally {
                await minServer.shutdown();
            }
        });
    });

    describe('verify', () => {
        it('verifies a valid authenticated-user token', async () => {
            const { res: createRes, captured: createCaptured } = makeRes();
            await createHandler(
                makeReq({
                    actor: {
                        user: {
                            uuid: '00000000-0000-0000-0000-000000000001',
                        },
                    },
                }),
                createRes,
            );
            const token = (createCaptured.body as { token: string }).token;

            const { res, captured } = makeRes();
            await verifyHandler(makeReq({ body: { token } }), res);

            expect(captured.statusCode).toBe(200);
            const body = captured.body as { allow: boolean };
            expect(body.allow).toBe(true);
        });

        it('verifies a valid guest token', async () => {
            const { res: createRes, captured: createCaptured } = makeRes();
            await createHandler(makeReq({ actor: { user: {} } }), createRes);
            const token = (createCaptured.body as { token: string }).token;

            const { res, captured } = makeRes();
            await verifyHandler(makeReq({ body: { token } }), res);

            expect(captured.statusCode).toBe(200);
            const body = captured.body as { allow: boolean };
            expect(body.allow).toBe(true);
        });

        it('rejects when token is missing', async () => {
            await expect(
                verifyHandler(makeReq({ body: {} }), makeRes().res),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when token is not a string', async () => {
            await expect(
                verifyHandler(
                    makeReq({ body: { token: 12345 } }),
                    makeRes().res,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an invalid/tampered token', async () => {
            await expect(
                verifyHandler(
                    makeReq({ body: { token: 'not-a-valid-jwt' } }),
                    makeRes().res,
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects when body is undefined', async () => {
            await expect(
                verifyHandler(
                    makeReq({ body: undefined }),
                    makeRes().res,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });
});
