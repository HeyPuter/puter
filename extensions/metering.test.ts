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
    await server.shutdown();
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
