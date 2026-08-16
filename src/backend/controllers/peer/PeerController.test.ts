import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
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
            await expect(
                ingestHandler(req, makeRes().res),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects requests with missing auth header', async () => {
            const req = makeReq({ body: { records: [] } });
            await expect(
                ingestHandler(req, makeRes().res),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects when records is not an array', async () => {
            const req = makeReq({
                body: { records: 'not-array' },
                headers: { 'x-puter-internal-auth': 'test-secret' },
            });
            await expect(
                ingestHandler(req, makeRes().res),
            ).rejects.toMatchObject({ statusCode: 400 });
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
            await expect(
                ingestHandler(req, makeRes().res),
            ).rejects.toMatchObject({ statusCode: 400 });
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

// -- TURN credential generation + usage ingest -------------------------
//
// `generate-turn` talks to Cloudflare over `fetch` — the one real external
// boundary here, so that (and only that) is stubbed. `ingest-usage` runs
// against the real user store and metering service.

describe('PeerController TURN', () => {
    let turnServer: PuterServer;
    let generateTurn: Function;
    let ingestUsage: Function;

    beforeAll(async () => {
        turnServer = await setupTestServer({
            peers: {
                signaller_url: 'wss://signal.test',
                internal_auth_secret: 'turn-secret',
                turn: {
                    cloudflare_turn_service_id: 'svc-1',
                    cloudflare_turn_api_token: 'token-1',
                    ttl: 3600,
                },
            },
        } as never);
        const router = new PuterRouter();
        (
            turnServer.controllers.peer as unknown as PeerController
        ).registerRoutes(router);
        generateTurn = router.routes.find(
            (r) => r.path === '/peer/generate-turn',
        )!.handler;
        ingestUsage = router.routes.find(
            (r) => r.path === '/turn/ingest-usage',
        )!.handler;
    });

    afterAll(async () => {
        await turnServer?.shutdown();
    });

    const userActor = {
        user: { uuid: '11111111-2222-3333-4444-555555555555' },
    };

    it('returns the ttl and Cloudflare ICE servers for a user actor', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ iceServers: [{ urls: 'turn:cf.test' }] }),
        } as never);
        try {
            const { res, captured } = makeRes();
            await generateTurn(makeReq({ actor: userActor }), res);
            expect(captured.body).toEqual({
                ttl: 3600,
                iceServers: [{ urls: 'turn:cf.test' }],
            });

            const [url, init] = fetchSpy.mock.calls[0]! as [
                string,
                RequestInit,
            ];
            expect(url).toContain('/turn/keys/svc-1/credentials/');
            expect((init.headers as Record<string, string>).Authorization).toBe(
                'Bearer token-1',
            );
            // The identifier attributes egress back to the user, base64url of
            // the raw uuid bytes — never the uuid itself.
            const body = JSON.parse(init.body as string) as {
                ttl: number;
                customIdentifier: string;
            };
            expect(body.ttl).toBe(3600);
            expect(body.customIdentifier).toBe(
                Buffer.from(
                    userActor.user.uuid.replaceAll('-', ''),
                    'hex',
                ).toString('base64url'),
            );
            expect(body.customIdentifier).not.toContain('-');
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('appends the app segment for an app-under-user actor', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ iceServers: [] }),
        } as never);
        try {
            const appActor = {
                ...userActor,
                app: { uid: 'app-66666666-7777-8888-9999-aaaaaaaaaaaa' },
            };
            await generateTurn(makeReq({ actor: appActor }), makeRes().res);
            const init = fetchSpy.mock.calls[0]![1] as RequestInit;
            const { customIdentifier } = JSON.parse(init.body as string) as {
                customIdentifier: string;
            };
            expect(customIdentifier.split(':')).toHaveLength(2);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('maps a Cloudflare failure to a 500 without echoing its body', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 403,
            text: async () => 'cloudflare said no',
        } as never);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await expect(
                generateTurn(makeReq({ actor: userActor }), makeRes().res),
            ).rejects.toMatchObject({
                statusCode: 500,
                message: 'TURN credential generation failed',
                legacyCode: 'internal_error',
            });
        } finally {
            fetchSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it('meters egress against the user the record names', async () => {
        const username = `peer-${Math.random().toString(36).slice(2, 10)}`;
        const created = await turnServer.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        });
        const encodedUserId = Buffer.from(
            created.uuid.replaceAll('-', ''),
            'hex',
        ).toString('base64url');

        const meterSpy = vi
            .spyOn(turnServer.services.metering, 'incrementUsage')
            .mockResolvedValue(undefined as never);
        try {
            const { res, captured } = makeRes();
            await ingestUsage(
                makeReq({
                    body: {
                        records: [{ egressBytes: 2048, userId: encodedUserId }],
                    },
                    headers: { 'x-puter-internal-auth': 'turn-secret' },
                }),
                res,
            );
            expect(captured.body).toEqual({ ok: true });
            expect(meterSpy).toHaveBeenCalledTimes(1);
            const [actorArg, usageType, amount, cost] = meterSpy.mock.calls[0]!;
            expect(usageType).toBe('turn:egress-bytes');
            expect(amount).toBe(2048);
            expect(cost).toBe(2048 * PEER_COSTS['turn:egress-bytes']);
            expect(actorArg).toEqual({
                user: {
                    uuid: created.uuid,
                    id: created.id,
                    username: created.username,
                },
                effectiveApp: null,
            });
        } finally {
            meterSpy.mockRestore();
        }
    });

    it('skips a record whose user uuid is unknown', async () => {
        const meterSpy = vi.spyOn(
            turnServer.services.metering,
            'incrementUsage',
        );
        try {
            const { res, captured } = makeRes();
            await ingestUsage(
                makeReq({
                    body: {
                        records: [
                            {
                                egressBytes: 100,
                                userId: Buffer.from(
                                    uuidv4().replaceAll('-', ''),
                                    'hex',
                                ).toString('base64url'),
                            },
                        ],
                    },
                    headers: { 'x-puter-internal-auth': 'turn-secret' },
                }),
                res,
            );
            expect(captured.body).toEqual({ ok: true });
            expect(meterSpy).not.toHaveBeenCalled();
        } finally {
            meterSpy.mockRestore();
        }
    });

    it('keeps going when metering one record throws', async () => {
        const username = `peer-${Math.random().toString(36).slice(2, 10)}`;
        const created = await turnServer.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        });
        const encodedUserId = Buffer.from(
            created.uuid.replaceAll('-', ''),
            'hex',
        ).toString('base64url');

        const meterSpy = vi
            .spyOn(turnServer.services.metering, 'incrementUsage')
            .mockRejectedValue(new Error('metering down'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { res, captured } = makeRes();
            await ingestUsage(
                makeReq({
                    body: {
                        records: [
                            { egressBytes: 10, userId: encodedUserId },
                            { egressBytes: 20, userId: encodedUserId },
                        ],
                    },
                    headers: { 'x-puter-internal-auth': 'turn-secret' },
                }),
                res,
            );
            expect(captured.body).toEqual({ ok: true });
            expect(meterSpy).toHaveBeenCalledTimes(2);
        } finally {
            meterSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it('rejects usage ingest when no internal secret is configured', async () => {
        const openServer = await setupTestServer();
        try {
            const router = new PuterRouter();
            (
                openServer.controllers.peer as unknown as PeerController
            ).registerRoutes(router);
            const handler = router.routes.find(
                (r) => r.path === '/turn/ingest-usage',
            )!.handler;
            await expect(
                handler(
                    makeReq({
                        body: { records: [] },
                        headers: { 'x-puter-internal-auth': 'anything' },
                    }),
                    makeRes().res,
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        } finally {
            await openServer.shutdown();
        }
    });
});
