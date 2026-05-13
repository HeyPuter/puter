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
import { handleWhoami } from './whoami.ts';

interface CapturedResponse {
    statusCode: number;
    body: unknown;
}

const makeReq = (query: Record<string, unknown> = {}): Request =>
    ({ query }) as unknown as Request;

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
    };
    return { res: res as unknown as Response, captured };
};

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer({
        // Feature flag allowlist is enforced in the handler. We seed
        // both an allow-listed flag and an internal flag to verify the
        // internal one never reaches the response.
        feature_flags: {
            create_shortcut: true,
            payment_bypass: true,
        },
    } as never);
});

afterAll(async () => {
    await server.shutdown();
});

const seedUser = async () => {
    const slug = Math.random().toString(36).slice(2, 8);
    return server.stores.user.create({
        username: `wuser_${slug}`,
        uuid: uuidv4(),
        password: 'hashedpw',
        email: `${slug}@example.com`,
    });
};

describe('whoami extension — handleWhoami', () => {
    it('returns 401 when no actor is on the context', async () => {
        const { res, captured } = makeRes();

        await runWithContext({ actor: undefined }, () =>
            handleWhoami(makeReq(), res),
        );

        expect(captured.statusCode).toBe(401);
        expect(captured.body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 when the actor’s user no longer exists', async () => {
        const { res, captured } = makeRes();

        await runWithContext(
            {
                actor: {
                    user: { uuid: 'ghost-uuid', id: 99_999_999 },
                },
            },
            () => handleWhoami(makeReq(), res),
        );

        expect(captured.statusCode).toBe(404);
        expect(captured.body).toEqual({ error: 'User not found' });
    });

    it('returns full user details for a user actor', async () => {
        const user = await seedUser();
        const { res, captured } = makeRes();

        await runWithContext(
            { actor: { user: { uuid: user.uuid, id: user.id as number } } },
            () => handleWhoami(makeReq(), res),
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.username).toBe(user.username);
        expect(body.uuid).toBe(user.uuid);
        expect(body.email).toBe(user.email);
        expect(body.is_temp).toBe(false);
        expect(body.oidc_only).toBe(false);
        // `directories` is only sent to user actors — confirm it’s present.
        expect(body.directories).toBeDefined();
        // taskbar_items is only sent to user actors.
        expect(body).toHaveProperty('taskbar_items');
    });

    it('only forwards allow-listed feature flags', async () => {
        const user = await seedUser();
        const { res, captured } = makeRes();

        await runWithContext(
            { actor: { user: { uuid: user.uuid, id: user.id as number } } },
            () => handleWhoami(makeReq(), res),
        );

        const flags = (captured.body as Record<string, unknown>)
            .feature_flags as Record<string, boolean>;
        // Allowed flag is forwarded as a coerced boolean.
        expect(flags.create_shortcut).toBe(true);
        // Internal flag must never leak.
        expect(flags.payment_bypass).toBeUndefined();
    });

    it('strips desktop_bg_* and human_readable_age fields for app actors', async () => {
        const user = await seedUser();
        const { res, captured } = makeRes();

        await runWithContext(
            {
                actor: {
                    user: { uuid: user.uuid, id: user.id as number },
                    app: { uid: 'app-test-actor' },
                },
            },
            () => handleWhoami(makeReq(), res),
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.app_name).toBe('app-test-actor');
        expect(body.desktop_bg_url).toBeUndefined();
        expect(body.desktop_bg_color).toBeUndefined();
        expect(body.desktop_bg_fit).toBeUndefined();
        expect(body.human_readable_age).toBeUndefined();
        // Directories are user-only.
        expect(body.directories).toBeUndefined();
    });

    it('marks the user as oidc_only when password is null', async () => {
        const slug = Math.random().toString(36).slice(2, 8);
        const oidcUser = await server.stores.user.create({
            username: `oidc_${slug}`,
            uuid: uuidv4(),
            password: null,
            email: `${slug}@oidc.test`,
        });

        const { res, captured } = makeRes();
        await runWithContext(
            {
                actor: {
                    user: {
                        uuid: oidcUser.uuid,
                        id: oidcUser.id as number,
                    },
                },
            },
            () => handleWhoami(makeReq(), res),
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.oidc_only).toBe(true);
        // No email yet means temp account.
        expect(body.is_temp).toBe(false);
    });
});
