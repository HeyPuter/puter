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

const seedUser = async (prefix: string, email: string | null = null) =>
    server.stores.user.create({
        username: `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
        uuid: uuidv4(),
        password: 'x',
        email,
    });

const grantAuthenticated = async (appId: number, userId: number) => {
    await server.clients.db.write(
        `INSERT INTO user_to_app_permissions (user_id, app_id, permission, extra) VALUES (?, ?, ?, ?)`,
        [userId, appId, 'flag:app-is-authenticated', null],
    );
};

const grantEmailRead = async (
    appId: number,
    userId: number,
    userUuid: string,
) => {
    await server.clients.db.write(
        `INSERT INTO user_to_app_permissions (user_id, app_id, permission, extra) VALUES (?, ?, ?, ?)`,
        [userId, appId, `user:${userUuid}:email:read`, null],
    );
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

    it('omits user_email for a user who did not grant email:read', async () => {
        const { owner, app } = await seedOwnedApp('noemail');
        const member = await seedUser('member', 'secret@example.com');
        await grantAuthenticated(app.id as number, member.id as number);

        const [row] = (await callWithActor(
            { user: { uuid: owner.uuid, id: owner.id as number } },
            () => driver.get_users({ app_uuid: app.uid }),
        )) as Array<Record<string, unknown>>;

        expect(row.user).toBe(member.username);
        expect(row.user_uuid).toBe(member.uuid);
        // No grant → the field must be absent (not just null), so the email
        // never leaks to the app owner.
        expect(Object.prototype.hasOwnProperty.call(row, 'user_email')).toBe(
            false,
        );
    });

    it('returns user_email when the user granted email:read to the app', async () => {
        const { owner, app } = await seedOwnedApp('withemail');
        const member = await seedUser('member', 'shared@example.com');
        await grantAuthenticated(app.id as number, member.id as number);
        await grantEmailRead(
            app.id as number,
            member.id as number,
            member.uuid,
        );

        const [row] = (await callWithActor(
            { user: { uuid: owner.uuid, id: owner.id as number } },
            () => driver.get_users({ app_uuid: app.uid }),
        )) as Array<Record<string, unknown>>;

        expect(row.user_uuid).toBe(member.uuid);
        expect(row.user_email).toBe('shared@example.com');
    });

    it('does not leak email granted to a *different* app', async () => {
        const { owner, app } = await seedOwnedApp('appA');
        const { app: otherApp } = await seedOwnedApp('appB');
        const member = await seedUser('member', 'crossapp@example.com');
        await grantAuthenticated(app.id as number, member.id as number);
        // Grant email:read against the OTHER app only.
        await grantEmailRead(
            otherApp.id as number,
            member.id as number,
            member.uuid,
        );

        const [row] = (await callWithActor(
            { user: { uuid: owner.uuid, id: owner.id as number } },
            () => driver.get_users({ app_uuid: app.uid }),
        )) as Array<Record<string, unknown>>;

        expect(Object.prototype.hasOwnProperty.call(row, 'user_email')).toBe(
            false,
        );
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
