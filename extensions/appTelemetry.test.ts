import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithContext } from '../src/backend/core/context.ts';
import { PuterServer } from '../src/backend/server.ts';
import { setupTestServer } from '../src/backend/testUtil.ts';
// Importing the module registers the `appTelemetry` driver into the shared
// extensionStore, so `setupTestServer` instantiates it on `server.drivers`.
import { AppTelemetryDriver } from './appTelemetry.ts';

let server: PuterServer;
let driver: AppTelemetryDriver;

// `get_users` reads `Context.get('actor')` for the ownership gate. Wrap
// actor-dependent calls in `runWithContext` so the ALS lookup resolves.
const callWithActor = <T>(
    actor: { user: { uuid: string; id?: number } } | undefined,
    fn: () => Promise<T>,
) => runWithContext({ actor }, fn);

beforeAll(async () => {
    server = await setupTestServer();
    driver = (server.drivers as unknown as Record<string, AppTelemetryDriver>)
        .appTelemetry;
    // Guard: the driver must have been wired onto the server. If this is
    // undefined the extension didn't register, and every test below would
    // fail with a confusing "cannot read property of undefined".
    expect(driver).toBeInstanceOf(AppTelemetryDriver);
});

afterAll(async () => {
    await server.shutdown();
});

const seedOwnedApp = async (prefix: string) => {
    const owner = await server.stores.user.create({
        username: `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
        uuid: uuidv4(),
        password: 'x',
        email: null,
    });
    const slug = Math.random().toString(36).slice(2, 8);
    const app = await server.stores.app.create(
        {
            name: `${prefix}_${slug}`,
            title: `${prefix} ${slug}`,
            index_url: `https://example.com/${slug}`,
        },
        { ownerUserId: owner.id as number },
    );
    return { owner, app: app! };
};

describe('appTelemetry driver — get_users', () => {
    it('throws HttpError(400) when app_uuid is missing', async () => {
        await expect(driver.get_users({})).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('app_uuid'),
        });
    });

    it('throws HttpError(400) for a non-numeric limit', async () => {
        await expect(
            driver.get_users({ app_uuid: 'app-anything', limit: 'banana' }),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('limit'),
        });
    });

    it('throws HttpError(400) when offset exceeds the allowed maximum', async () => {
        await expect(
            driver.get_users({ app_uuid: 'app-anything', offset: 1_000_001 }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws HttpError(404) when the app cannot be found', async () => {
        await expect(
            driver.get_users({ app_uuid: 'app-does-not-exist' }),
        ).rejects.toMatchObject({
            statusCode: 404,
            message: 'App not found',
        });
    });

    it('throws HttpError(403) when the caller does not own the app', async () => {
        // Seed an owner + their app, then call as a *different* user. The
        // real permission service should reject: the caller has no
        // `apps-of-user:<owner>:write`.
        const { app } = await seedOwnedApp('owner');
        const intruder = await server.stores.user.create({
            username: `intruder_${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'x',
            email: null,
        });

        await callWithActor(
            { user: { uuid: intruder.uuid, id: intruder.id as number } },
            async () => {
                await expect(
                    driver.get_users({ app_uuid: app.uid }),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    message: 'Permission denied',
                });
            },
        );
    });

    it('returns an empty list for an owned app with no authenticated users', async () => {
        const { owner, app } = await seedOwnedApp('owner2');

        const result = await callWithActor(
            { user: { uuid: owner.uuid, id: owner.id as number } },
            () => driver.get_users({ app_uuid: app.uid }),
        );

        expect(result).toEqual([]);
    });
});

describe('appTelemetry driver — user_count', () => {
    it('throws HttpError(400) when app_uuid is missing', async () => {
        await expect(driver.user_count({})).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it('throws HttpError(404) for an unknown app_uuid', async () => {
        await expect(
            driver.user_count({ app_uuid: 'app-not-here' }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 0 for an app with no authenticated users', async () => {
        const { app } = await seedOwnedApp('appcount');
        await expect(driver.user_count({ app_uuid: app.uid })).resolves.toBe(0);
    });
});
