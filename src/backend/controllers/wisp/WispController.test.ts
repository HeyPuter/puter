// This tests wisp controller but not wisp itself. That is out of process and out of this repo
// This simply tests the authentication methods that puter wisp expects and uses.
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
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
        const relayTokenFor = async (actor: unknown) => {
            const { res, captured } = makeRes();
            await createHandler(makeReq({ actor }), res);
            return (captured.body as { token: string }).token;
        };

        const verifyStatus = async (token: string) => {
            const { res, captured } = makeRes();
            try {
                await verifyHandler(makeReq({ body: { token } }), res);
                return captured.statusCode;
            } catch (e) {
                return (e as { statusCode: number }).statusCode;
            }
        };

        const freshUser = async () => {
            const username = `wisp_${Math.random().toString(36).slice(2, 10)}`;
            const creds = await createTestUser(server, {
                username,
                password: 'wisp-test-password',
            });
            const row = (await server.stores.user.getByUsername(username))!;
            const actorFor = async (token: string) =>
                (await server.services.auth.authenticateFromToken(token))!;
            return {
                row,
                sessionActor: await actorFor(creds.token),
                apiTokenActor: await actorFor(creds.apiToken),
                apiToken: creds.apiToken,
            };
        };

        it('verifies a token minted by a live session', async () => {
            const { sessionActor } = await freshUser();
            const token = await relayTokenFor(sessionActor);

            const { res, captured } = makeRes();
            await verifyHandler(makeReq({ body: { token } }), res);

            expect(captured.statusCode).toBe(200);
            expect((captured.body as { allow: boolean }).allow).toBe(true);
        });

        it('rejects a token once the account is suspended', async () => {
            const { row, sessionActor } = await freshUser();
            const token = await relayTokenFor(sessionActor);

            await server.stores.user.update(row.id, { suspended: 1 });

            expect(await verifyStatus(token)).toBe(403);
        });

        it('rejects a token once the account is pending verification', async () => {
            const { row, sessionActor } = await freshUser();
            const token = await relayTokenFor(sessionActor);

            await server.stores.user.update(row.id, {
                requires_email_confirmation: 1,
                email_confirmed: 0,
            });

            expect(await verifyStatus(token)).toBe(403);
        });

        it('rejects a token whose user no longer exists', async () => {
            const token = await relayTokenFor({
                user: { uuid: '00000000-0000-0000-0000-000000000001' },
            });

            expect(await verifyStatus(token)).toBe(403);
        });

        it('rejects a token once its session is revoked', async () => {
            const { sessionActor } = await freshUser();
            const token = await relayTokenFor(sessionActor);
            expect(await verifyStatus(token)).toBe(200);

            await server.services.auth.revokeSession(sessionActor.session!.uid);

            expect(await verifyStatus(token)).toBe(403);
        });

        it('binds a token minted by an access token to that token', async () => {
            const { sessionActor, apiTokenActor, apiToken } = await freshUser();
            const token = await relayTokenFor(apiTokenActor);
            expect(await verifyStatus(token)).toBe(200);

            await server.services.auth.revokeAccessToken(
                sessionActor,
                apiToken,
            );

            expect(await verifyStatus(token)).toBe(403);
        });

        it('applies the account checks to a token with no session claim', async () => {
            const { row } = await freshUser();
            const token = server.services.token.sign(
                'wisp',
                { $: 'token:wisp', $v: '0.0.0', user_uid: row.uuid },
                { expiresIn: '1d' },
            );
            expect(await verifyStatus(token)).toBe(200);

            await server.stores.user.update(row.id, { suspended: 1 });

            expect(await verifyStatus(token)).toBe(403);
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
