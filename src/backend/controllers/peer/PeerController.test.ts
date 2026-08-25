import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { PEER_COSTS } from './costs.js';
import { signGuestGrant, verifyGuestGrant } from './guestGrant.js';
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
        // Distinguish "no body key" from an explicit `body: undefined`, so a
        // test can exercise a request that never had a parsed body at all.
        body: 'body' in init ? init.body : {},
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
        it('registers every expected route', () => {
            const router = new PuterRouter();
            controller.registerRoutes(router);

            const paths = router.routes.map((r) => r.path);
            expect(paths).toContain('/peer/signaller-info');
            expect(paths).toContain('/peer/generate-turn');
            expect(paths).toContain('/peer/turn-grant');
            expect(paths).toContain('/peer/guest-turn');
            expect(paths).toContain('/turn/ingest-usage');
        });

        it('keeps minting credentials behind auth and redeeming open', () => {
            const router = new PuterRouter();
            controller.registerRoutes(router);
            const optionsFor = (path: string) =>
                router.routes.find((r) => r.path === path)!.options;

            // The authenticated path must stay authenticated: everything that
            // rides on `requireAuth` (suspended accounts, pending
            // verification, access-token rejection) is attached to it.
            expect(optionsFor('/peer/generate-turn').requireAuth).toBe(true);
            expect(optionsFor('/peer/turn-grant').requireAuth).toBe(true);
            // The guest path is open by design — the grant is the credential.
            expect(optionsFor('/peer/guest-turn').requireAuth).toBeUndefined();
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

// -- Guest TURN access -------------------------------------------------
//
// A host mints a grant; someone it invited redeems that grant for relay
// credentials without an account. The tests that matter here are about
// attribution — a guest's credentials must be stamped with the *host's*
// identifier, so the usage ingest above bills the host — and about refusing
// anything the host didn't sign.

describe('PeerController guest TURN', () => {
    let guestServer: PuterServer;
    let generateTurn: Function;
    let createTurnGrant: Function;
    let guestTurn: Function;
    let guestTurnKey: (req: Request) => string;

    const GRANT_SECRET = 'guest-grant-secret';
    const hostActor = {
        user: { uuid: '11111111-2222-3333-4444-555555555555' },
    };
    const hostIdentifier = Buffer.from(
        hostActor.user.uuid.replaceAll('-', ''),
        'hex',
    ).toString('base64url');

    beforeAll(async () => {
        guestServer = await setupTestServer({
            peers: {
                signaller_url: 'wss://signal.test',
                turn: {
                    cloudflare_turn_service_id: 'svc-1',
                    cloudflare_turn_api_token: 'token-1',
                    ttl: 3600,
                },
                guest_turn: {
                    grant_secret: GRANT_SECRET,
                    grant_ttl: 900,
                    credential_ttl: 600,
                },
            },
        } as never);
        const router = new PuterRouter();
        (
            guestServer.controllers.peer as unknown as PeerController
        ).registerRoutes(router);
        const route = (path: string) =>
            router.routes.find((r) => r.path === path)!;
        generateTurn = route('/peer/generate-turn').handler;
        createTurnGrant = route('/peer/turn-grant').handler;
        guestTurn = route('/peer/guest-turn').handler;
        guestTurnKey = (route('/peer/guest-turn').options.rateLimit as
            { key: (req: Request) => string }).key;
    });

    afterAll(async () => {
        await guestServer?.shutdown();
    });

    const mintGrant = (actor: unknown = hostActor): string => {
        const { res, captured } = makeRes();
        createTurnGrant(makeReq({ actor }), res);
        return (captured.body as { grant: string }).grant;
    };

    const stubCloudflare = () =>
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ iceServers: [{ urls: 'turn:cf.test' }] }),
        } as never);

    /** The `{ ttl, customIdentifier }` body sent upstream on the last call. */
    const upstreamBody = (spy: ReturnType<typeof stubCloudflare>) =>
        JSON.parse(
            (spy.mock.calls.at(-1)![1] as RequestInit).body as string,
        ) as { ttl: number; customIdentifier: string };

    describe('turn-grant', () => {
        it('issues a grant carrying the caller as the paying account', () => {
            const { res, captured } = makeRes();
            createTurnGrant(makeReq({ actor: hostActor }), res);

            const body = captured.body as {
                grant: string;
                expiresAt: number;
            };
            expect(typeof body.grant).toBe('string');
            expect(verifyGuestGrant({
                grant: body.grant,
                secret: GRANT_SECRET,
            })).toEqual({
                status: 'ok',
                customIdentifier: hostIdentifier,
                expiresAt: body.expiresAt,
            });
        });

        it('honors the configured grant ttl', () => {
            const { res, captured } = makeRes();
            createTurnGrant(makeReq({ actor: hostActor }), res);

            const { expiresAt } = captured.body as { expiresAt: number };
            const ttl = expiresAt - Math.floor(Date.now() / 1000);
            expect(ttl).toBeGreaterThan(890);
            expect(ttl).toBeLessThanOrEqual(900);
        });

        it('carries the app segment for an app-under-user host', () => {
            const grant = mintGrant({
                ...hostActor,
                app: { uid: 'app-66666666-7777-8888-9999-aaaaaaaaaaaa' },
            });

            const verified = verifyGuestGrant({
                grant,
                secret: GRANT_SECRET,
            });
            expect(verified).toMatchObject({ status: 'ok' });
            expect(
                (verified as { customIdentifier: string }).customIdentifier
                    .split(':'),
            ).toHaveLength(2);
        });

        it('never signs two identical grants for the same host', () => {
            expect(mintGrant()).not.toBe(mintGrant());
        });

        it('does not reach the upstream credential API', () => {
            const fetchSpy = stubCloudflare();
            try {
                mintGrant();
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    describe('guest-turn', () => {
        it('mints credentials attributed to the host, not the guest', async () => {
            const grant = mintGrant();
            const fetchSpy = stubCloudflare();
            try {
                const { res, captured } = makeRes();
                await guestTurn(makeReq({ body: { grant } }), res);

                expect(captured.body).toEqual({
                    ttl: 600,
                    iceServers: [{ urls: 'turn:cf.test' }],
                });
                expect(upstreamBody(fetchSpy).customIdentifier).toBe(
                    hostIdentifier,
                );
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('stamps the same identifier the host would get for itself', async () => {
            const grant = mintGrant();
            const fetchSpy = stubCloudflare();
            try {
                await guestTurn(makeReq({ body: { grant } }), makeRes().res);
                const guestIdentifier =
                    upstreamBody(fetchSpy).customIdentifier;

                await generateTurn(
                    makeReq({ actor: hostActor }),
                    makeRes().res,
                );
                expect(upstreamBody(fetchSpy).customIdentifier).toBe(
                    guestIdentifier,
                );
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('ignores any session the guest happens to carry', async () => {
            const grant = mintGrant();
            const fetchSpy = stubCloudflare();
            try {
                // A signed-in caller redeeming someone else's grant is still
                // billed to the grant's host — attribution comes from the
                // ticket, never from the request.
                await guestTurn(
                    makeReq({
                        body: { grant },
                        actor: {
                            user: {
                                uuid: '99999999-8888-7777-6666-555555555555',
                            },
                        },
                    }),
                    makeRes().res,
                );
                expect(upstreamBody(fetchSpy).customIdentifier).toBe(
                    hostIdentifier,
                );
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('clamps the guest credential ttl to the host ttl', async () => {
            const shortServer = await setupTestServer({
                peers: {
                    turn: {
                        cloudflare_turn_service_id: 'svc-1',
                        cloudflare_turn_api_token: 'token-1',
                        ttl: 120,
                    },
                    guest_turn: {
                        grant_secret: GRANT_SECRET,
                        credential_ttl: 99_999,
                    },
                },
            } as never);
            const fetchSpy = stubCloudflare();
            try {
                const router = new PuterRouter();
                (
                    shortServer.controllers.peer as unknown as PeerController
                ).registerRoutes(router);
                const handler = router.routes.find(
                    (r) => r.path === '/peer/guest-turn',
                )!.handler;

                const { res, captured } = makeRes();
                await handler(makeReq({ body: { grant: mintGrant() } }), res);

                expect(captured.body).toMatchObject({ ttl: 120 });
                expect(upstreamBody(fetchSpy).ttl).toBe(120);
            } finally {
                fetchSpy.mockRestore();
                await shortServer.shutdown();
            }
        });

        it('rejects a missing grant with 400 without calling upstream', async () => {
            const fetchSpy = stubCloudflare();
            try {
                await expect(
                    guestTurn(makeReq({ body: {} }), makeRes().res),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    code: 'peer_grant_malformed',
                });
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('rejects a forged grant with 403 without calling upstream', async () => {
            const forged = signGuestGrant({
                customIdentifier: hostIdentifier,
                ttlSeconds: 900,
                secret: 'not-our-secret',
            }).grant;
            const fetchSpy = stubCloudflare();
            try {
                await expect(
                    guestTurn(makeReq({ body: { grant: forged } }), makeRes().res),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    code: 'peer_grant_invalid',
                });
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('reports an expired grant distinctly so the app can ask for a new one', async () => {
            const expired = signGuestGrant({
                customIdentifier: hostIdentifier,
                ttlSeconds: 60,
                secret: GRANT_SECRET,
                now: Date.now() - 3_600_000,
            }).grant;
            const fetchSpy = stubCloudflare();
            try {
                await expect(
                    guestTurn(
                        makeReq({ body: { grant: expired } }),
                        makeRes().res,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    code: 'peer_grant_expired',
                });
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('maps an upstream failure to 500 without echoing its body', async () => {
            const grant = mintGrant();
            const fetchSpy = vi
                .spyOn(globalThis, 'fetch')
                .mockResolvedValue({
                    ok: false,
                    status: 403,
                    text: async () => 'cloudflare said no',
                } as never);
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            try {
                await expect(
                    guestTurn(makeReq({ body: { grant } }), makeRes().res),
                ).rejects.toMatchObject({
                    statusCode: 500,
                    message: 'TURN credential generation failed',
                });
            } finally {
                fetchSpy.mockRestore();
                warnSpy.mockRestore();
            }
        });
    });

    describe('rate-limit bucketing', () => {
        it('buckets a host and its guests together', () => {
            const req = makeReq({ body: { grant: mintGrant() } });
            expect(guestTurnKey(req)).toBe(`host:${hostIdentifier}`);
            // A second guest of the same host lands in the same bucket even
            // though the grant string differs.
            expect(
                guestTurnKey(makeReq({ body: { grant: mintGrant() } })),
            ).toBe(guestTurnKey(req));
        });

        it('separates two hosts', () => {
            const otherGrant = mintGrant({
                user: { uuid: '99999999-8888-7777-6666-555555555555' },
            });
            expect(
                guestTurnKey(makeReq({ body: { grant: otherGrant } })),
            ).not.toBe(
                guestTurnKey(makeReq({ body: { grant: mintGrant() } })),
            );
        });

        it('falls back to the caller network when no grant parses', () => {
            expect(guestTurnKey(makeReq({ body: {} }))).toMatch(/^net:/);
            expect(
                guestTurnKey(makeReq({ body: { grant: 'garbage' } })),
            ).toMatch(/^net:/);
        });
    });

    describe('default lifetimes', () => {
        // The defaults are the security-relevant knob — a deployment that sets
        // only the secret still gets short-lived grants and credentials, and a
        // guest credential still cannot outlive the host's own.
        it('falls back to an hour for grants and guest credentials', async () => {
            const defaultsServer = await setupTestServer({
                peers: {
                    turn: {
                        cloudflare_turn_service_id: 'svc-1',
                        cloudflare_turn_api_token: 'token-1',
                        ttl: 86_400,
                    },
                    guest_turn: { grant_secret: GRANT_SECRET },
                },
            } as never);
            const fetchSpy = stubCloudflare();
            try {
                const router = new PuterRouter();
                (
                    defaultsServer.controllers.peer as unknown as PeerController
                ).registerRoutes(router);
                const handlerFor = (path: string) =>
                    router.routes.find((r) => r.path === path)!.handler;

                const grantRes = makeRes();
                handlerFor('/peer/turn-grant')(
                    makeReq({ actor: hostActor }),
                    grantRes.res,
                );
                const { grant, expiresAt } = grantRes.captured.body as {
                    grant: string;
                    expiresAt: number;
                };
                const grantTtl = expiresAt - Math.floor(Date.now() / 1000);
                expect(grantTtl).toBeGreaterThan(3590);
                expect(grantTtl).toBeLessThanOrEqual(3600);

                const turnRes = makeRes();
                await handlerFor('/peer/guest-turn')(
                    makeReq({ body: { grant } }),
                    turnRes.res,
                );
                // An hour, not the host's 24 — the guest ceiling wins here.
                expect(turnRes.captured.body).toMatchObject({ ttl: 3600 });
                expect(upstreamBody(fetchSpy).ttl).toBe(3600);
            } finally {
                fetchSpy.mockRestore();
                await defaultsServer.shutdown();
            }
        });
    });

    describe('when guest access is not configured', () => {
        it('refuses to issue or redeem a grant', async () => {
            const noGuestServer = await setupTestServer({
                peers: {
                    turn: {
                        cloudflare_turn_service_id: 'svc-1',
                        cloudflare_turn_api_token: 'token-1',
                        ttl: 3600,
                    },
                },
            } as never);
            try {
                const router = new PuterRouter();
                (
                    noGuestServer.controllers.peer as unknown as PeerController
                ).registerRoutes(router);
                const handlerFor = (path: string) =>
                    router.routes.find((r) => r.path === path)!.handler;

                expect(() =>
                    handlerFor('/peer/turn-grant')(
                        makeReq({ actor: hostActor }),
                        makeRes().res,
                    ),
                ).toThrow(expect.objectContaining({ statusCode: 503 }));

                await expect(
                    handlerFor('/peer/guest-turn')(
                        makeReq({ body: { grant: mintGrant() } }),
                        makeRes().res,
                    ),
                ).rejects.toMatchObject({ statusCode: 503 });
            } finally {
                await noGuestServer.shutdown();
            }
        });

        it('refuses to issue a grant it could not redeem', async () => {
            const noTurnServer = await setupTestServer({
                peers: { guest_turn: { grant_secret: GRANT_SECRET } },
            } as never);
            try {
                const router = new PuterRouter();
                (
                    noTurnServer.controllers.peer as unknown as PeerController
                ).registerRoutes(router);
                const handler = router.routes.find(
                    (r) => r.path === '/peer/turn-grant',
                )!.handler;

                expect(() =>
                    handler(makeReq({ actor: hostActor }), makeRes().res),
                ).toThrow(expect.objectContaining({ statusCode: 503 }));
            } finally {
                await noTurnServer.shutdown();
            }
        });
    });
});
