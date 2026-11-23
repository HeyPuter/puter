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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { APP_AUTHENTICATED_FLAG } from './PermissionStore.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async () => {
    const username = `pau-${Math.random().toString(36).slice(2, 10)}`;
    return (await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
    } as never)) as unknown as { id: number; uuid: string; username: string };
};

const makeApp = async (ownerUserId: number, title = 'App') => {
    const name = `pau-app-${Math.random().toString(36).slice(2, 10)}`;
    return server.stores.app.create(
        { name, title, index_url: `https://${name}.example.com/` },
        { ownerUserId },
    );
};

const grant = (userId: number, appId: number, permission: string) =>
    server.stores.permission.upsertUserAppPerm(userId, appId, permission, {});

describe('PermissionStore.listAppAuthenticatedUsers / countAppUsers', () => {
    it('lists users who signed in to the app and marks who shared an email', async () => {
        const dev = await makeUser();
        const app = await makeApp(dev.id);
        const sharer = await makeUser();
        const quiet = await makeUser();
        const unrelated = await makeUser();
        await grant(sharer.id, app.id, APP_AUTHENTICATED_FLAG);
        await grant(sharer.id, app.id, `user:${sharer.uuid}:email:read`);
        await grant(quiet.id, app.id, APP_AUTHENTICATED_FLAG);
        await grant(unrelated.id, app.id, 'some:other:perm');

        const users = await server.stores.permission.listAppAuthenticatedUsers(
            app.id,
            { limit: 10, offset: 0 },
        );

        expect(users.map((u) => [u.uuid, u.emailShared]).sort()).toEqual(
            [
                [sharer.uuid, true],
                [quiet.uuid, false],
            ].sort(),
        );
        expect(await server.stores.permission.countAppUsers(app.id)).toBe(2);
    });

    it('pages with limit and offset', async () => {
        const dev = await makeUser();
        const app = await makeApp(dev.id);
        for (let i = 0; i < 3; i++) {
            const user = await makeUser();
            await grant(user.id, app.id, APP_AUTHENTICATED_FLAG);
        }

        const page = await server.stores.permission.listAppAuthenticatedUsers(
            app.id,
            { limit: 2, offset: 2 },
        );

        expect(page).toHaveLength(1);
        expect(await server.stores.permission.countAppUsers(app.id)).toBe(3);
    });
});

describe('PermissionStore.listAppsGrantedByUser', () => {
    it("returns the user's granted apps once each, in the requested order", async () => {
        const dev = await makeUser();
        const user = await makeUser();
        const zed = await makeApp(dev.id, 'Zed');
        const alpha = await makeApp(dev.id, 'Alpha');
        await grant(user.id, zed.id, APP_AUTHENTICATED_FLAG);
        await grant(user.id, zed.id, 'another:perm');
        await grant(user.id, alpha.id, APP_AUTHENTICATED_FLAG);

        const byTitle = await server.stores.permission.listAppsGrantedByUser(
            user.id,
            { orderBy: 'title', descending: false, limit: 10, offset: 0 },
        );
        const byTitleDesc =
            await server.stores.permission.listAppsGrantedByUser(user.id, {
                orderBy: 'title',
                descending: true,
                limit: 10,
                offset: 0,
            });

        expect(byTitle.map((app) => app.uid)).toEqual([alpha.uid, zed.uid]);
        expect(byTitleDesc.map((app) => app.uid)).toEqual([zed.uid, alpha.uid]);
        expect(byTitle[0]).toHaveProperty('installed_at');
    });
});

describe('PermissionStore.listAppsWithUserAppPerm', () => {
    it('lists the apps holding one permission, by title, with the grant’s via', async () => {
        const dev = await makeUser();
        const user = await makeUser();
        const zed = await makeApp(dev.id, 'Zed');
        const alpha = await makeApp(dev.id, 'Alpha');
        const other = await makeApp(dev.id, 'Other');
        await server.stores.permission.upsertUserAppPerm(
            user.id,
            zed.id,
            'notifications:push',
            { via: 'webpush' },
        );
        await grant(user.id, alpha.id, 'notifications:push');
        await grant(user.id, other.id, APP_AUTHENTICATED_FLAG);

        const rows = await server.stores.permission.listAppsWithUserAppPerm(
            user.id,
            'notifications:push',
            { limit: 10 },
        );
        expect(rows).toEqual([
            {
                uid: alpha.uid,
                name: alpha.name,
                title: 'Alpha',
                index_url: alpha.index_url,
                description: alpha.description ?? null,
                via: null,
            },
            {
                uid: zed.uid,
                name: zed.name,
                title: 'Zed',
                index_url: zed.index_url,
                description: zed.description ?? null,
                via: 'webpush',
            },
        ]);

        const limited = await server.stores.permission.listAppsWithUserAppPerm(
            user.id,
            'notifications:push',
            { limit: 1, withIcon: true },
        );
        expect(limited.map((row) => row.uid)).toEqual([alpha.uid]);
        expect(limited[0]).toHaveProperty('icon');
    });
});

describe('PermissionStore.hasAnyUserAppPermByUuids', () => {
    it('tells whether a user uuid granted an app uid anything, from the primary', async () => {
        const dev = await makeUser();
        const user = await makeUser();
        const app = await makeApp(dev.id);
        const untouched = await makeApp(dev.id);
        await grant(user.id, app.id, 'some:perm');

        const store = server.stores.permission;
        expect(await store.hasAnyUserAppPermByUuids(user.uuid, app.uid)).toBe(
            true,
        );
        expect(
            await store.hasAnyUserAppPermByUuids(user.uuid, untouched.uid),
        ).toBe(false);
        expect(await store.hasAnyUserAppPermByUuids(dev.uuid, app.uid)).toBe(
            false,
        );
    });
});
