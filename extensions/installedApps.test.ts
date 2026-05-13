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
import { handleInstalledApps } from './installedApps.ts';

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
        username: `iauser_${slug}`,
        uuid: uuidv4(),
        password: 'x',
        email: null,
    });
};

const seedApp = async (ownerUserId: number) => {
    const slug = Math.random().toString(36).slice(2, 8);
    return server.stores.app.create(
        {
            name: `iaapp_${slug}`,
            title: `Installed App ${slug}`,
            index_url: `https://example.com/${slug}`,
        },
        { ownerUserId },
    );
};

const grantInstalled = async (appId: number, userId: number) => {
    // Mimic the `flag:app-is-authenticated` perm row the handler joins on.
    await server.clients.db.write(
        `INSERT INTO user_to_app_permissions (user_id, app_id, permission, extra) VALUES (?, ?, ?, ?)`,
        [userId, appId, 'flag:app-is-authenticated', null],
    );
};

describe('installedApps extension — handleInstalledApps', () => {
    it('throws HttpError(401) when no actor is on the context', async () => {
        const { res } = makeRes();
        await expect(
            runWithContext({ actor: undefined }, () =>
                handleInstalledApps(makeReq({}), res),
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws HttpError(400) when orderBy is not in the allowlist', async () => {
        const user = await seedUser();
        const { res } = makeRes();
        await expect(
            runWithContext(
                {
                    actor: {
                        user: { uuid: user.uuid, id: user.id as number },
                    },
                },
                () =>
                    handleInstalledApps(
                        // SQL injection attempt — must be rejected.
                        makeReq({ orderBy: 'apps.id; DROP TABLE apps;--' }),
                        res,
                    ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('Invalid orderBy'),
        });
    });

    it('returns an empty list for a user with no installed apps', async () => {
        const user = await seedUser();
        const { res, captured } = makeRes();

        await runWithContext(
            { actor: { user: { uuid: user.uuid, id: user.id as number } } },
            () => handleInstalledApps(makeReq({}), res),
        );

        expect(captured.body).toEqual([]);
    });

    it('returns the caller’s installed apps with an iconUrl field', async () => {
        const user = await seedUser();
        const app = await seedApp(user.id as number);
        await grantInstalled(app!.id as number, user.id as number);

        const { res, captured } = makeRes();
        await runWithContext(
            { actor: { user: { uuid: user.uuid, id: user.id as number } } },
            () => handleInstalledApps(makeReq({}), res),
        );

        const list = captured.body as Array<Record<string, unknown>>;
        expect(list).toHaveLength(1);
        expect(list[0].uid).toBe(app!.uid);
        expect(list[0].name).toBe(app!.name);
        expect(list[0].title).toBe(app!.title);
        expect(Object.prototype.hasOwnProperty.call(list[0], 'iconUrl')).toBe(
            true,
        );
    });

    it('clamps page/limit to safe ranges (page>=1, 1<=limit<=100)', async () => {
        const user = await seedUser();
        const { res, captured } = makeRes();

        // page=0 and limit=999 should be clamped without throwing.
        await runWithContext(
            { actor: { user: { uuid: user.uuid, id: user.id as number } } },
            () =>
                handleInstalledApps(
                    makeReq({ page: 0, limit: 999, desc: '1' }),
                    res,
                ),
        );

        expect(Array.isArray(captured.body)).toBe(true);
    });
});
