/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

const PICTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

describe('profile routes over HTTP', () => {
    let env: PuterTestEnv;
    let userUuid = '';
    /** The plan `env.users.user` is on; see the resolver below. */
    let plan: string | null = null;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        userUuid = (await env.server.stores.user.getByUsername(
            env.users.user.username,
        ))!.uuid;
        env.server.services.metering.registerPolicy({
            id: 'business',
            monthUsageAllowance: 45 * 1_000_000 * 100,
            monthlyStorageAllowance: 1024 ** 3,
        });
        env.server.services.metering.registerSubscriptionResolver((actor) =>
            actor.user?.uuid === userUuid ? plan : null,
        );
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const withSubscription = async <T>(
        id: string | null,
        fn: () => Promise<T>,
    ): Promise<T> => {
        plan = id;
        env.server.services.metering.invalidateActorSubscription(userUuid);
        try {
            return await fn();
        } finally {
            plan = null;
            env.server.services.metering.invalidateActorSubscription(userUuid);
        }
    };

    const get = (query: string, token?: string) =>
        fetch(new URL(`/profile${query}`, env.apiOrigin), {
            headers: token ? { authorization: `Bearer ${token}` } : {},
        });

    const post = (body: unknown, token: string) =>
        fetch(new URL('/profile', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    it('lets a user write and read their own profile on any plan', async () => {
        const write = await post(
            { picture: PICTURE, displayName: 'Test' },
            env.users.user.token,
        );
        expect(write.status).toBe(200);
        expect(await write.json()).toEqual({
            picture: PICTURE,
            displayName: 'Test',
            bio: null,
        });

        const own = await get('', env.users.user.token);
        expect(own.status).toBe(200);
        expect(await own.json()).toMatchObject({ picture: PICTURE });

        const byName = await get(
            `?username=${env.users.user.username}`,
            env.users.user.token,
        );
        expect(byName.status).toBe(200);
        expect(await byName.json()).toMatchObject({ displayName: 'Test' });
    });

    it('hides a free user from anonymous and third-party readers as a 404', async () => {
        const anonymous = await get(`?username=${env.users.user.username}`);
        expect(anonymous.status).toBe(404);
        const other = await get(
            `?username=${env.users.user.username}`,
            env.users.other.token,
        );
        expect(other.status).toBe(404);
        // Same shape as an account that does not exist.
        const missing = await get('?username=nobody-here');
        expect(missing.status).toBe(404);
    });

    it('serves a paid user to anyone, and hides them again when the plan ends', async () => {
        await withSubscription('business', async () => {
            const anonymous = await get(`?username=${env.users.user.username}`);
            expect(anonymous.status).toBe(200);
            expect(await anonymous.json()).toMatchObject({ picture: PICTURE });
            const other = await get(
                `?username=${env.users.user.username}`,
                env.users.other.token,
            );
            expect(other.status).toBe(200);
        });
        expect((await get(`?username=${env.users.user.username}`)).status).toBe(
            404,
        );
    });

    it('requires a username or a signed-in caller, and validates the username shape', async () => {
        expect((await get('')).status).toBe(401);
        expect((await get('?username=not%20valid')).status).toBe(400);
    });

    it('rejects a bad patch with a stable code and refuses app and anonymous writers', async () => {
        const bad = await post({ name: 'x' }, env.users.user.token);
        expect(bad.status).toBe(400);
        expect(await bad.json()).toMatchObject({
            code: 'profile_field_not_allowed',
        });

        const anonymous = await fetch(new URL('/profile', env.apiOrigin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bio: 'x' }),
        });
        expect(anonymous.status).toBe(401);
    });
});
