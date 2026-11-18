/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { WorkerDriver } from './WorkerDriver.js';

// A user uninstalling an app takes down the workers it runs in their account,
// so no later redeploy (an edge rehydrate, a hot reload, an unsuspension) can
// read the row's app and mint it a token again.

let server: PuterServer;
let target: WorkerDriver;
let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
    server = await setupTestServer({
        workers: { XAUTHKEY: 'k', ACCOUNTID: 'acct' },
    } as never);
    target = server.drivers.workers as unknown as WorkerDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, errors: [] }),
    } as unknown as Response);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const requests = (method: string) =>
    fetchSpy.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === method,
    );

let seq = 0;
const makeUser = async () => {
    const username = `wkun${seq++}${Math.random().toString(36).slice(2, 6)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 50 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const user = (await server.stores.user.getById(created.id))!;
    const actor: Actor = {
        user: {
            id: user.id,
            uuid: user.uuid,
            username: user.username,
            email: user.email ?? null,
            email_confirmed: true,
        } as Actor['user'],
    };
    return { user, actor };
};

const makeApp = (label: string, ownerUserId: number, appOwner?: number) =>
    server.stores.app.create(
        {
            name: `${label}-${uuidv4()}`,
            title: label,
            index_url: `https://${label}-${uuidv4()}.example.com/`,
        },
        { ownerUserId, appOwner },
    );

/** Deploys `name` from a file in the user's account, bound to `appUid`. */
const deploy = async (
    { user, actor }: Awaited<ReturnType<typeof makeUser>>,
    appUid: string,
    name: string,
) => {
    const path = `/${user.username}/Documents/${name}.js`;
    const write = (src: string) =>
        runWithContext({ actor }, () =>
            server.services.fs.write(user.id, {
                fileMetadata: {
                    path,
                    size: Buffer.byteLength(src),
                    contentType: 'application/javascript',
                    overwrite: true,
                },
                fileContent: Buffer.from(src),
            }),
        );
    await write('v1');
    await runWithContext({ actor }, () =>
        target.create({ appId: appUid, workerName: name, filePath: path }),
    );
    return { path, write };
};

const rowOf = (name: string) =>
    server.stores.subdomain.getBySubdomain(`${WORKER_SUBDOMAIN_PREFIX}${name}`);

describe('WorkerDriver on an app uninstall', () => {
    it("takes down a third-party app's worker in the account, row and script", async () => {
        const dev = await makeUser();
        const app = await makeApp('thirdparty', dev.user.id);
        const owner = await makeUser();
        const name = `tp-${owner.user.username}`;
        const { write } = await deploy(owner, app.uid, name);
        expect((await rowOf(name))?.app_owner).toBe(app.id);
        fetchSpy.mockClear();

        await server.services.auth.uninstallApp(owner.actor, app.uid);

        expect(await rowOf(name)).toBeNull();
        expect(
            requests('DELETE').some(([url]) =>
                String(url).includes(`/scripts/${name}/`),
            ),
        ).toBe(true);

        // A save of the source no longer redeploys it.
        fetchSpy.mockClear();
        await write('v2');
        await new Promise((r) => setTimeout(r, 100));
        expect(requests('PUT')).toHaveLength(0);
    });

    it('also takes down workers bound to an app the uninstalled app made in the account', async () => {
        const dev = await makeUser();
        const app = await makeApp('builder', dev.user.id);
        const owner = await makeUser();
        const child = await makeApp('generated', owner.user.id, app.id);
        const name = `child-${owner.user.username}`;
        await deploy(owner, child.uid, name);

        await server.services.auth.uninstallApp(owner.actor, app.uid);

        expect(await rowOf(name)).toBeNull();
    });

    it('keeps a worker bound to an app the user owns', async () => {
        const owner = await makeUser();
        const app = await makeApp('own', owner.user.id);
        const name = `own-${owner.user.username}`;
        await deploy(owner, app.uid, name);
        fetchSpy.mockClear();

        await server.services.auth.uninstallApp(owner.actor, app.uid);

        expect((await rowOf(name))?.app_owner).toBe(app.id);
        expect(requests('DELETE')).toHaveLength(0);
    });

    it("leaves other users' workers for the same app alone", async () => {
        const dev = await makeUser();
        const app = await makeApp('shared', dev.user.id);
        const first = await makeUser();
        const second = await makeUser();
        const firstName = `a-${first.user.username}`;
        const secondName = `b-${second.user.username}`;
        await deploy(first, app.uid, firstName);
        await deploy(second, app.uid, secondName);

        await server.services.auth.uninstallApp(first.actor, app.uid);

        expect(await rowOf(firstName)).toBeNull();
        expect((await rowOf(secondName))?.app_owner).toBe(app.id);
    });

    it('removes the row even when the edge refuses to delete the script', async () => {
        const dev = await makeUser();
        const app = await makeApp('edgefail', dev.user.id);
        const owner = await makeUser();
        const name = `ef-${owner.user.username}`;
        await deploy(owner, app.uid, name);
        fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

        await server.services.auth.uninstallApp(owner.actor, app.uid);

        expect(await rowOf(name)).toBeNull();
    });
});
