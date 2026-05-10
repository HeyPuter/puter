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
    handleAppTelemetryUserCount,
    handleAppTelemetryUsers,
} from './appTelemetry.ts';

interface CapturedResponse {
    body: unknown;
}

const makeReq = (query: Record<string, unknown> = {}): Request =>
    ({ query }) as unknown as Request;

const makeRes = () => {
    const captured: CapturedResponse = { body: undefined };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

// `handleAppTelemetryUsers` calls `Context.get('actor')` for the permission
// gate. Wrap test calls in `runWithContext` so the ALS lookup resolves.
const callWithActor = async (
    actor: { user: { uuid: string; id?: number }; app?: null } | undefined,
    fn: () => Promise<void>,
) => runWithContext({ actor }, fn);

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server.shutdown();
});

describe('appTelemetry extension — handleAppTelemetryUsers', () => {
    it('throws HttpError(400) when app_uuid is missing', async () => {
        const { res } = makeRes();
        await expect(
            handleAppTelemetryUsers(makeReq({}), res),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('app_uuid'),
        });
    });

    it('throws HttpError(400) for a non-numeric limit', async () => {
        const { res } = makeRes();
        await expect(
            handleAppTelemetryUsers(
                makeReq({ app_uuid: 'app-anything', limit: 'banana' }),
                res,
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('limit'),
        });
    });

    it('throws HttpError(400) when offset exceeds the allowed maximum', async () => {
        const { res } = makeRes();
        await expect(
            handleAppTelemetryUsers(
                makeReq({ app_uuid: 'app-anything', offset: 1_000_001 }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws HttpError(404) when the app cannot be found', async () => {
        const { res } = makeRes();
        await expect(
            handleAppTelemetryUsers(
                makeReq({ app_uuid: 'app-does-not-exist' }),
                res,
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            message: 'App not found',
        });
    });

    it('throws HttpError(403) when the caller does not own the app', async () => {
        // Seed an owner user + an app belonging to them, then call the
        // handler as a *different* user. The real permission service should
        // reject since the caller has no `apps-of-user:<owner>:write` perm.
        const owner = await server.stores.user.create({
            username: `owner_${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'x',
            email: null,
        });
        const slug = Math.random().toString(36).slice(2, 8);
        const app = await server.stores.app.create(
            {
                name: `app_${slug}`,
                title: `App ${slug}`,
                index_url: `https://example.com/${slug}`,
            },
            { ownerUserId: owner.id as number },
        );

        const intruder = await server.stores.user.create({
            username: `intruder_${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'x',
            email: null,
        });

        const { res } = makeRes();
        await callWithActor(
            { user: { uuid: intruder.uuid, id: intruder.id as number } },
            async () => {
                await expect(
                    handleAppTelemetryUsers(
                        makeReq({ app_uuid: app!.uid }),
                        res,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    message: 'Permission denied',
                });
            },
        );
    });

    it('returns an empty list for an owned app with no authenticated users', async () => {
        const owner = await server.stores.user.create({
            username: `owner2_${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'x',
            email: null,
        });
        const slug = Math.random().toString(36).slice(2, 8);
        const app = await server.stores.app.create(
            {
                name: `app2_${slug}`,
                title: `App2 ${slug}`,
                index_url: `https://example.com/${slug}`,
            },
            { ownerUserId: owner.id as number },
        );

        const { res, captured } = makeRes();
        await callWithActor(
            { user: { uuid: owner.uuid, id: owner.id as number } },
            async () => {
                await handleAppTelemetryUsers(
                    makeReq({ app_uuid: app!.uid }),
                    res,
                );
            },
        );

        expect(captured.body).toEqual([]);
    });
});

describe('appTelemetry extension — handleAppTelemetryUserCount', () => {
    it('throws HttpError(400) when app_uuid is missing', async () => {
        const { res } = makeRes();
        await expect(
            handleAppTelemetryUserCount(makeReq({}), res),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws HttpError(404) for an unknown app_uuid', async () => {
        const { res } = makeRes();
        await expect(
            handleAppTelemetryUserCount(
                makeReq({ app_uuid: 'app-not-here' }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns { count: 0 } for an app with no authenticated users', async () => {
        const owner = await server.stores.user.create({
            username: `counto_${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'x',
            email: null,
        });
        const slug = Math.random().toString(36).slice(2, 8);
        const app = await server.stores.app.create(
            {
                name: `appcount_${slug}`,
                title: `AppCount ${slug}`,
                index_url: `https://example.com/${slug}`,
            },
            { ownerUserId: owner.id as number },
        );

        const { res, captured } = makeRes();
        await handleAppTelemetryUserCount(
            makeReq({ app_uuid: app!.uid }),
            res,
        );

        expect(captured.body).toEqual({ count: 0 });
    });
});
