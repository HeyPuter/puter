import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { PEER_COSTS } from './costs.js';
import type { PeerController } from './PeerController.js';

let server: PuterServer;
let controller: PeerController;

beforeAll(async () => {
    server = await setupTestServer({
        peers: {
            signaller_url: 'wss://signal.test',
            fallback_ice: [{ urls: 'stun:stun.test' }],
            internal_auth_secret: 'test-secret',
        },
    });
    controller = server.controllers.peer as unknown as PeerController;
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
    method?: string;
}): Request => {
    return {
        body: init.body ?? {},
        query: {},
        headers: init.headers ?? {},
        actor: init.actor,
        method: init.method ?? 'POST',
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
        end: vi.fn(() => res),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

describe('PeerController', () => {
    describe('getReportedCosts', () => {
        it('reports a row per PEER cost type with the configured rate', () => {
            const rows = controller.getReportedCosts();
            expect(rows).toEqual(
                expect.arrayContaining([
                    {
                        usageType: 'turn:egress-bytes',
                        ucentsPerUnit: PEER_COSTS['turn:egress-bytes'],
                        unit: 'byte',
                        source: 'controller:peer',
                    },
                ]),
            );
            expect(rows.length).toBe(Object.keys(PEER_COSTS).length);
        });
    });

    describe('signaller-info', () => {
        it('returns the configured signaller URL and fallback ICE servers', () => {
            const { res, captured } = makeRes();
            const req = makeReq({ method: 'GET' });

            const router = new PuterRouter();
            controller.registerRoutes(router);

            const signallerRoute = router.routes.find(
                (r) => r.path === '/peer/signaller-info',
            );
            expect(signallerRoute).toBeDefined();
            signallerRoute!.handler(req, res);

            expect(captured.body).toEqual({
                url: 'wss://signal.test',
                fallbackIce: [{ urls: 'stun:stun.test' }],
            });
        });

        it('returns null url and empty fallbackIce when peers config is absent', async () => {
            const minimalServer = await setupTestServer();
            const minimalController = minimalServer.controllers
                .peer as unknown as PeerController;
            try {
                const router = new PuterRouter();
                minimalController.registerRoutes(router);
                const route = router.routes.find(
                    (r) => r.path === '/peer/signaller-info',
                );

                const { res, captured } = makeRes();
                route!.handler(makeReq({ method: 'GET' }), res);

                expect(captured.body).toEqual({
                    url: null,
                    fallbackIce: [],
                });
            } finally {
                await minimalServer.shutdown();
            }
        });
    });

    describe('generate-turn', () => {
        it('returns 503 when TURN is not configured', async () => {
            const minimalServer = await setupTestServer();
            const minimalController = minimalServer.controllers
                .peer as unknown as PeerController;
            try {
                const router = new PuterRouter();
                minimalController.registerRoutes(router);
                const route = router.routes.find(
                    (r) => r.path === '/peer/generate-turn',
                );

                const req = makeReq({
                    actor: {
                        user: { uuid: '00000000-0000-0000-0000-000000000001' },
                    },
                });

                await expect(
                    route!.handler(req, makeRes().res),
                ).rejects.toMatchObject({ statusCode: 503 });
            } finally {
                await minimalServer.shutdown();
            }
        });
    });

    describe('ingest-usage', () => {
        let ingestHandler: Function;

        beforeAll(() => {
            const router = new PuterRouter();
            controller.registerRoutes(router);
            const route = router.routes.find(
                (r) => r.path === '/turn/ingest-usage',
            );
            ingestHandler = route!.handler;
        });

        it('rejects requests without valid internal auth secret', async () => {
            const req = makeReq({
                body: { records: [] },
                headers: { 'x-puter-internal-auth': 'wrong-secret' },
            });
            await expect(ingestHandler(req, makeRes().res)).rejects.toMatchObject(
                { statusCode: 403 },
            );
        });

        it('rejects requests with missing auth header', async () => {
            const req = makeReq({ body: { records: [] } });
            await expect(ingestHandler(req, makeRes().res)).rejects.toMatchObject(
                { statusCode: 403 },
            );
        });

        it('rejects when records is not an array', async () => {
            const req = makeReq({
                body: { records: 'not-array' },
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await expect(ingestHandler(req, makeRes().res)).rejects.toMatchObject(
                { statusCode: 400 },
            );
        });

        it('returns ok for an empty records array', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({
                body: { records: [] },
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await ingestHandler(req, res);
            expect(captured.body).toEqual({ ok: true });
        });

        it('skips records with non-positive egressBytes', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({
                body: {
                    records: [
                        { egressBytes: 0, userId: 'AAAAAAAAAAAAAAAAAAAAAA' },
                        { egressBytes: -5, userId: 'AAAAAAAAAAAAAAAAAAAAAA' },
                        { userId: 'AAAAAAAAAAAAAAAAAAAAAA' },
                    ],
                },
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await ingestHandler(req, res);
            expect(captured.body).toEqual({ ok: true });
        });

        it('skips records with missing or invalid userId', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({
                body: {
                    records: [
                        { egressBytes: 100 },
                        { egressBytes: 100, userId: '' },
                        { egressBytes: 100, userId: 'not-valid-b64' },
                    ],
                },
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await ingestHandler(req, res);
            expect(captured.body).toEqual({ ok: true });
        });

        it('skips null and non-object records gracefully', async () => {
            const { res, captured } = makeRes();
            const req = makeReq({
                body: {
                    records: [null, undefined, 42, 'string'],
                },
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await ingestHandler(req, res);
            expect(captured.body).toEqual({ ok: true });
        });

        it('rejects when body is missing entirely', async () => {
            const req = makeReq({
                body: undefined,
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await expect(ingestHandler(req, makeRes().res)).rejects.toMatchObject(
                { statusCode: 400 },
            );
        });
    });

    describe('route registration', () => {
        it('registers all three expected routes', () => {
            const router = new PuterRouter();
            controller.registerRoutes(router);

            const paths = router.routes.map((r) => r.path);
            expect(paths).toContain('/peer/signaller-info');
            expect(paths).toContain('/peer/generate-turn');
            expect(paths).toContain('/turn/ingest-usage');
        });
    });
});
