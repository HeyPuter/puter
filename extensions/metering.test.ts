import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { makeActor, type Actor } from '../src/backend/core/actor.ts';
import { runWithContext } from '../src/backend/core/context.ts';
import { PuterServer } from '../src/backend/server.ts';
import { setupTestServer } from '../src/backend/testUtil.ts';
import {
    handleMeteringAllCosts,
    handleMeteringGlobalUsage,
    handleMeteringUsage,
    handleMeteringUsageForApp,
} from './metering.ts';

interface CapturedResponse {
    body: unknown;
}

const makeReq = (
    init: { params?: Record<string, unknown> } = {},
): Request =>
    ({
        params: init.params ?? {},
        query: {},
    }) as unknown as Request;

const makeRes = () => {
    const captured: CapturedResponse = { body: undefined };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const seedUser = async () => {
    const slug = Math.random().toString(36).slice(2, 8);
    return server.stores.user.create({
        username: `muser_${slug}`,
        uuid: uuidv4(),
        password: 'x',
        email: null,
    });
};

describe('metering extension — handleMeteringUsage', () => {
    it('throws HttpError(401) when no user actor is on the context', async () => {
        const { res } = makeRes();
        await expect(
            runWithContext({ actor: undefined }, () =>
                handleMeteringUsage(makeReq(), res),
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns usage details merged with allowanceInfo for an authenticated user', async () => {
        const user = await seedUser();
        const { res, captured } = makeRes();

        await runWithContext(
            { actor: { user: { uuid: user.uuid, id: user.id as number } } },
            () => handleMeteringUsage(makeReq(), res),
        );

        // We don't assert the inner shape (provider-specific) — only that
        // the handler returned a JSON object that carries `allowanceInfo`.
        expect(typeof captured.body).toBe('object');
        expect(captured.body).not.toBeNull();
        expect(
            (captured.body as Record<string, unknown>).allowanceInfo,
        ).toBeDefined();
    });

    describe('usage split across apps', () => {
        const seedUsage = async () => {
            const user = await seedUser();
            const owner = { uuid: user.uuid, id: user.id as number };
            const metering = server.services.metering;
            await metering.incrementUsage(
                makeActor({ user: owner, app: { uid: 'app-mine' } }),
                'kv:read',
                1,
                10,
            );
            await metering.incrementUsage(
                makeActor({ user: owner, app: { uid: 'app-other' } }),
                'kv:write',
                1,
                20,
            );
            await metering.incrementUsage(
                makeActor({ user: owner }),
                'kv:list',
                1,
                40,
            );
            await server.stores.meteringBuffer.flushCycle();
            return owner;
        };

        const usageAs = async (actor: Actor) => {
            const { res, captured } = makeRes();
            await runWithContext({ actor }, () =>
                handleMeteringUsage(makeReq(), res),
            );
            return captured.body as {
                usage: Record<string, unknown> & { total: number };
                appTotals: Record<string, unknown>;
                allowanceInfo: Record<string, unknown>;
            };
        };

        it('reports only the calling app’s own usage to an app actor', async () => {
            const owner = await seedUsage();
            const body = await usageAs(
                makeActor({ user: owner, app: { uid: 'app-mine' } }),
            );

            expect(body.usage.total).toBe(10);
            expect(Object.keys(body.usage).sort()).toEqual([
                'kv:read',
                'total',
            ]);
            expect(body.appTotals).toEqual({
                'app-mine': { total: 10, count: 1 },
            });
            expect(body.allowanceInfo).toMatchObject({
                remaining: expect.any(Number),
                monthUsageAllowance: expect.any(Number),
            });
        });

        it('still reports the whole account to the user', async () => {
            const owner = await seedUsage();
            const body = await usageAs(makeActor({ user: owner }));

            expect(body.usage.total).toBe(70);
            expect(body.usage).toHaveProperty('kv:read');
            expect(body.usage).toHaveProperty('kv:write');
            expect(body.usage).toHaveProperty('kv:list');
            expect(body.appTotals).toMatchObject({
                'app-mine': { total: 10, count: 1 },
                'app-other': { total: 20, count: 1 },
            });
        });
    });
});

describe('metering extension — handleMeteringUsageForApp', () => {
    it('throws HttpError(401) when no user actor is on the context', async () => {
        const { res } = makeRes();
        await expect(
            runWithContext({ actor: undefined }, () =>
                handleMeteringUsageForApp(
                    makeReq({ params: { appIdOrName: 'any' } }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws HttpError(400) when no appId is supplied', async () => {
        const user = await seedUser();
        const { res } = makeRes();
        await expect(
            runWithContext(
                { actor: { user: { uuid: user.uuid, id: user.id as number } } },
                () =>
                    handleMeteringUsageForApp(
                        makeReq({ params: { appIdOrName: '' } }),
                        res,
                    ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws HttpError(404) when looking up an unknown app by name', async () => {
        const user = await seedUser();
        const { res } = makeRes();
        await expect(
            runWithContext(
                { actor: { user: { uuid: user.uuid, id: user.id as number } } },
                () =>
                    handleMeteringUsageForApp(
                        makeReq({ params: { appIdOrName: 'no-such-app' } }),
                        res,
                    ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('scoped to the calling app', () => {
        const appUsageAs = async (actor: Actor, appIdOrName: string) => {
            const { res, captured } = makeRes();
            await runWithContext({ actor }, () =>
                handleMeteringUsageForApp(
                    makeReq({ params: { appIdOrName } }),
                    res,
                ),
            );
            return captured.body as { total: number };
        };

        const seedApps = async () => {
            const user = await seedUser();
            const owner = { uuid: user.uuid, id: user.id as number };
            const mine = `app-${uuidv4()}`;
            const other = `app-${uuidv4()}`;
            await server.services.metering.incrementUsage(
                makeActor({ user: owner, app: { uid: mine } }),
                'kv:read',
                1,
                10,
            );
            await server.services.metering.incrementUsage(
                makeActor({ user: owner, app: { uid: other } }),
                'kv:write',
                1,
                20,
            );
            await server.stores.meteringBuffer.flushCycle();
            return {
                owner,
                mine,
                other,
                asMine: makeActor({ user: owner, app: { uid: mine } }),
            };
        };

        it('lets an app read its own usage', async () => {
            const { mine, asMine } = await seedApps();
            expect((await appUsageAs(asMine, mine)).total).toBe(10);
        });

        it('refuses an app another app’s usage', async () => {
            const { other, asMine } = await seedApps();
            await expect(appUsageAs(asMine, other)).rejects.toMatchObject({
                statusCode: 403,
            });
        });

        it('refuses an app another app’s usage by name', async () => {
            const { owner, other, asMine } = await seedApps();
            const name = `other-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [other, name, name, `https://${name}.example/`, owner.id],
            );
            await expect(appUsageAs(asMine, name)).rejects.toMatchObject({
                statusCode: 403,
            });
        });

        it('refuses an app the usage outside any app', async () => {
            const { asMine } = await seedApps();
            await expect(appUsageAs(asMine, 'os-global')).rejects.toMatchObject(
                { statusCode: 403 },
            );
        });

        it('still lets the user read any of their apps', async () => {
            const { owner, mine, other } = await seedApps();
            const asUser = makeActor({ user: owner });
            expect((await appUsageAs(asUser, mine)).total).toBe(10);
            expect((await appUsageAs(asUser, other)).total).toBe(20);
        });

        it('lets the user read their usage outside any app', async () => {
            const { owner } = await seedApps();
            const asUser = makeActor({ user: owner });
            await server.services.metering.incrementUsage(
                asUser,
                'kv:read',
                1,
                5,
            );
            await server.stores.meteringBuffer.flushCycle();
            expect((await appUsageAs(asUser, 'os-global')).total).toBe(5);
        });
    });
});

describe('metering extension — handleMeteringGlobalUsage', () => {
    it('returns the global usage payload from MeteringService', async () => {
        const { res, captured } = makeRes();
        await handleMeteringGlobalUsage(makeReq(), res);
        // Just confirm a JSON body was returned. Inner shape comes from
        // MeteringService and is covered elsewhere.
        expect(captured.body).toBeDefined();
    });
});

describe('metering extension — handleMeteringAllCosts', () => {
    it('returns a { costs: [...] } payload', async () => {
        const { res, captured } = makeRes();
        await handleMeteringAllCosts(makeReq(), res);
        const body = captured.body as { costs: unknown };
        expect(Array.isArray(body.costs)).toBe(true);
    });

    it('caches the costs catalogue across calls (same array reference)', async () => {
        const a = makeRes();
        const b = makeRes();
        await handleMeteringAllCosts(makeReq(), a.res);
        await handleMeteringAllCosts(makeReq(), b.res);

        const costsA = (a.captured.body as { costs: unknown[] }).costs;
        const costsB = (b.captured.body as { costs: unknown[] }).costs;
        // Cache fields the same array instance — this is the property we
        // actually want to lock down (no rewalk of every driver/controller
        // per request).
        expect(costsA).toBe(costsB);
    });
});
