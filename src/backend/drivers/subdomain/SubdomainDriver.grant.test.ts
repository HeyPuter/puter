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
import { makeActor } from '../../core/actor.js';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { SubdomainDriver } from './SubdomainDriver.js';

// `puter.perms.request('subdomains', { access })` grants an app
// `subdomains-of-user:<uuid>:read|write`, widening its scope from the rows it
// created to all of its user's rows, and never past them.

let server: PuterServer;
let driver: SubdomainDriver;

beforeAll(async () => {
    server = await setupTestServer();
    driver = server.drivers.subdomains as unknown as SubdomainDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

const rand = () => Math.random().toString(36).slice(2, 10);

const makeUser = async () => {
    const username = `sdg-${rand()}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const user = (await server.stores.user.getById(created.id))!;
    return makeActor({ user: { ...user, email_confirmed: true } as never });
};

const makeApp = async (owner: Actor) =>
    (await server.stores.app.create(
        {
            name: `sdg-app-${uuidv4()}`,
            title: 'Site manager',
            index_url: `https://sdg-${uuidv4()}.example.test/`,
        },
        { ownerUserId: owner.user!.id },
    )) as { uid: string; id: number };

const asApp = (user: Actor, app: { uid: string; id: number }) =>
    makeActor({ ...user, app: { uid: app.uid, id: app.id } });

const seedRow = (
    user: Actor,
    appOwner: number | null,
    name = `sdg-${rand()}`,
) =>
    server.stores.subdomain.create({
        userId: user.user!.id,
        subdomain: name,
        rootDirId: null,
        associatedAppId: null,
        appOwner,
    });

const grant = (user: Actor, app: { uid: string }, access: 'read' | 'write') =>
    server.services.permission.grantUserAppPermission(
        user,
        app.uid,
        `subdomains-of-user:${user.user!.uuid}:${access}`,
    );

const as = <T>(actor: Actor, fn: () => Promise<T>) =>
    runWithContext({ actor }, fn);

const listed = async (actor: Actor) =>
    (
        (await as(actor, () => driver.select({}))) as Array<{
            subdomain: string;
        }>
    ).map((row) => row.subdomain);

describe('SubdomainDriver with a subdomains grant', () => {
    it('leaves an app without the grant scoped to the rows it created', async () => {
        const user = await makeUser();
        const app = await makeApp(user);
        const own = await seedRow(user, app.id);
        const loose = await seedRow(user, null);
        const appActor = asApp(user, app);

        expect(await listed(appActor)).toEqual([own.subdomain]);
        const page = (await as(appActor, () =>
            driver.select({ includeTotal: true }),
        )) as { items: unknown[]; total: number };
        expect(page.total).toBe(1);
        for (const call of [
            () => driver.read({ uid: loose.uuid }),
            () => driver.update({ uid: loose.uuid, object: {} }),
            () => driver.delete({ uid: loose.uuid }),
        ]) {
            await expect(as(appActor, call)).rejects.toMatchObject({
                statusCode: 403,
            });
        }
    });

    it('read lets the app list and read all of its user rows, but not change them', async () => {
        const user = await makeUser();
        const app = await makeApp(user);
        const otherApp = await makeApp(user);
        const own = await seedRow(user, app.id);
        const loose = await seedRow(user, null);
        const byOtherApp = await seedRow(user, otherApp.id);
        await grant(user, app, 'read');
        const appActor = asApp(user, app);

        expect((await listed(appActor)).sort()).toEqual(
            [own.subdomain, loose.subdomain, byOtherApp.subdomain].sort(),
        );
        const page = (await as(appActor, () =>
            driver.select({ includeTotal: true }),
        )) as { total: number };
        expect(page.total).toBe(3);
        const read = (await as(appActor, () =>
            driver.read({ id: { subdomain: loose.subdomain } }),
        )) as { uid: string };
        expect(read.uid).toBe(loose.uuid);

        for (const call of [
            () => driver.update({ uid: loose.uuid, object: {} }),
            () => driver.delete({ uid: byOtherApp.uuid }),
        ]) {
            await expect(as(appActor, call)).rejects.toMatchObject({
                statusCode: 403,
            });
        }
    });

    it('write also lets the app change and delete them', async () => {
        const user = await makeUser();
        const app = await makeApp(user);
        const otherApp = await makeApp(user);
        const loose = await seedRow(user, null);
        const byOtherApp = await seedRow(user, otherApp.id);
        await grant(user, app, 'write');
        const appActor = asApp(user, app);

        expect((await listed(appActor)).sort()).toEqual(
            [loose.subdomain, byOtherApp.subdomain].sort(),
        );
        const updated = (await as(appActor, () =>
            driver.update({ uid: loose.uuid, object: {} }),
        )) as { uid: string };
        expect(updated.uid).toBe(loose.uuid);
        await as(appActor, () => driver.delete({ uid: byOtherApp.uuid }));
        expect(
            await server.stores.subdomain.getByUuid(String(byOtherApp.uuid), {
                primary: true,
            }),
        ).toBeNull();
    });

    it('never reaches another user rows, or rows of a user who granted a different app', async () => {
        const user = await makeUser();
        const stranger = await makeUser();
        const app = await makeApp(user);
        const otherApp = await makeApp(user);
        const strangers = await seedRow(stranger, app.id);
        const mine = await seedRow(user, null);
        await grant(user, otherApp, 'write');
        // The stranger's own grant names the stranger, not `user`.
        await grant(stranger, app, 'write');

        const appActor = asApp(user, app);
        expect(await listed(appActor)).toEqual([]);
        for (const call of [
            () => driver.read({ uid: mine.uuid }),
            () => driver.read({ uid: strangers.uuid }),
            () => driver.delete({ uid: strangers.uuid }),
        ]) {
            await expect(as(appActor, call)).rejects.toMatchObject({
                statusCode: 403,
            });
        }
    });
});
