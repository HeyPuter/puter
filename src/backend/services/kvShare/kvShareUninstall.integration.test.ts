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

/**
 * A user removing an app, with and without its data: what happens to the
 * app's key-value data in their account and to the shares made out of it.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';

const BOOT_TIMEOUT_MS = 120_000;

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
    uuid: string;
}

let env: PuterTestEnv;
let owner: TestUser;
let guest: TestUser;

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
        uuid: row!.uuid as string,
    };
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        kv: { shareHandles: true },
        unlimitedMetering: true,
    } as IConfig);
    owner = await userFor(env.users.user.username);
    guest = await userFor(env.users.other.username);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

const makeApp = async () => {
    const name = `kv-uninstall-${uuidv4().slice(0, 8)}`;
    return env.server.stores.app.create(
        {
            name,
            title: 'Uninstall App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId: owner.id },
    );
};

const share = (from: TestUser, to: TestUser, appUid: string) =>
    env.server.services.kvShare.mintKvHandle(
        from.actor,
        {
            prefix: `region-${uuidv4().slice(0, 8)}:`,
            recipient: { username: to.username },
            access: 'read',
            appUid,
        },
        { defaultAccess: 'read' },
    );

const kvOpts = (user: TestUser, appUid: string) => ({
    actor: user.actor,
    appUuid: appUid,
});

const keysIn = async (user: TestUser, appUid: string) =>
    (await env.server.stores.kv.list({ as: 'keys' }, kvOpts(user, appUid)))
        .res as string[];

const uninstall = (appUid: string, deleteData: boolean) =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.services.auth.uninstallApp(owner.actor, appUid, {
            deleteData,
        }),
    );

const revokedBy = async (handle: string) =>
    (await env.server.stores.kvShareHandle.getByHandle(handle))?.revokedBy ??
    null;

describe('uninstalling an app', () => {
    it('keeps the data and the shares made out of it without deleteData', async () => {
        const app = await makeApp();
        await env.server.stores.kv.set(
            { key: 'kept', value: 1 },
            kvOpts(owner, app.uid),
        );
        const owned = await share(owner, guest, app.uid);

        await uninstall(app.uid, false);

        expect(await keysIn(owner, app.uid)).toEqual(['kept']);
        expect(await revokedBy(owned.handle)).toBeNull();
    });

    it('with deleteData retires the shares the user made out of the app, then deletes its data', async () => {
        const app = await makeApp();
        const otherApp = await makeApp();
        await env.server.stores.kv.batchPut(
            {
                items: Array.from({ length: 30 }, (_, i) => ({
                    key: `item-${i}`,
                    value: i,
                })),
            },
            kvOpts(owner, app.uid),
        );
        await env.server.stores.kv.set(
            { key: 'elsewhere', value: 1 },
            kvOpts(owner, otherApp.uid),
        );
        await env.server.stores.kv.set(
            { key: 'theirs', value: 1 },
            kvOpts(guest, app.uid),
        );
        const owned = await share(owner, guest, app.uid);
        const ownedElsewhere = await share(owner, guest, otherApp.uid);
        const held = await share(guest, owner, app.uid);

        await uninstall(app.uid, true);

        expect(await revokedBy(owned.handle)).toBe('system');
        expect(await revokedBy(ownedElsewhere.handle)).toBeNull();
        expect(await revokedBy(held.handle)).toBeNull();

        await vi.waitFor(async () =>
            expect(await keysIn(owner, app.uid)).toEqual([]),
        );
        expect(await keysIn(owner, otherApp.uid)).toEqual(['elsewhere']);
        expect(await keysIn(guest, app.uid)).toEqual(['theirs']);
    });

    it('stops deleting once the user authorizes the app again', async () => {
        const app = await makeApp();
        await env.server.stores.kv.set(
            { key: 'after-reinstall', value: 1 },
            kvOpts(owner, app.uid),
        );
        await env.server.stores.permission.upsertUserAppPerm(
            owner.id,
            app.id as number,
            'flag:app-is-authenticated',
            {},
        );
        const purge = vi.spyOn(env.server.stores.kv, 'purgeNamespace');
        try {
            await env.server.clients.event.emitAndWait(
                'app.uninstalled',
                {
                    userId: owner.id,
                    userUuid: owner.uuid,
                    appUid: app.uid,
                    deleteData: true,
                },
                {},
            );
            // The purge runs in the background; give it a turn to act.
            await new Promise((resolve) => setTimeout(resolve, 200));
            expect(purge).not.toHaveBeenCalled();
        } finally {
            purge.mockRestore();
        }
        expect(await keysIn(owner, app.uid)).toEqual(['after-reinstall']);
    });
});
