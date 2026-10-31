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
 * What happens to shares when what they hang off goes away: an app deleted and
 * registered again under the same uid, a deletion whose retire fails or runs
 * long, a holder's account deleted, and racing shares of one region.
 */

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { EVENTS_KV_HANDLE_LIMIT } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { KV_HANDLE_RETIRE_BATCH } from '../../stores/events/KvShareHandleStore.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { KvShareAccess } from './kvShares.js';
import { seedKvShareHandles } from './kvShareTestUtil.js';

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

const shares = () => env.server.services.kvShare;
const handles = () => env.server.stores.kvShareHandle;

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
        uuid: row!.uuid as string,
    };
};

const newUser = async (label: string): Promise<TestUser> => {
    const username = `${label}-${uuidv4().slice(0, 8)}`;
    await createTestUser(env.server, { username, password: 'pw-test-1234' });
    return userFor(username);
};

const region = (label = 'r') => `${label}-${uuidv4().slice(0, 8)}:`;

const share = (
    prefix: string,
    access: KvShareAccess,
    opts: { holder?: TestUser; appUid?: string } = {},
) =>
    shares().mintKvHandle(
        owner.actor,
        {
            prefix,
            recipient: { username: (opts.holder ?? guest).username },
            access,
            ...(opts.appUid ? { appUid: opts.appUid } : {}),
        },
        { defaultAccess: 'read' },
    );

const makeApp = async () => {
    const name = `kv-life-${uuidv4().slice(0, 8)}`;
    return env.server.stores.app.create(
        {
            name,
            title: 'Lifecycle App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId: owner.id },
    );
};

/** An app deleted the way the app driver does it: the row, then the event. */
const deleteApp = async (app: { id: number; uid: string }) => {
    await env.server.stores.app.delete(app.id);
    await env.server.clients.event.emitAndWait(
        'app.changed',
        { app_uid: app.uid, app: null, old_app: app, action: 'deleted' },
        {},
    );
};

const liveInApp = async (appUid: string) =>
    (await handles().listLiveForApps([appUid], 5_000)).length;

const guestGet = (handle: string, key: string) =>
    runWithContext({ actor: guest.actor }, () =>
        env.server.drivers.kvStore.get({ key, optConfig: { handle } }),
    );

const suspendedReason = async (subId: string) => {
    const [row] = await env.server.clients.db.pread(
        'SELECT `suspended_reason` FROM `event_subscriptions` WHERE `sub_id` = ?',
        [subId],
    );
    return (row as { suspended_reason: unknown } | undefined)?.suspended_reason;
};

/** Run `fn` with the clock `ms` ahead, past any retry wait shorter than that. */
const later = async <T>(ms: number, fn: () => Promise<T>): Promise<T> => {
    const now = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + ms);
    try {
        return await fn();
    } finally {
        clock.mockRestore();
    }
};

/** Check for recorded jobs until `check` passes. */
const resumeUntil = (check: () => Promise<void>) =>
    vi.waitFor(
        async () => {
            await shares().resumeKvShareJobs();
            await check();
        },
        { timeout: 4_000, interval: 100 },
    );

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

beforeEach(async () => {
    for (const user of [owner, guest])
        await env.server.clients.redis.del(
            `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${user.id}`,
        );
});

describe('an origin app registered again under a deleted app`s uid', () => {
    const call = (body: unknown) =>
        fetch(new URL('/auth/get-user-app-token', env.apiOrigin), {
            method: 'POST',
            headers: {
                authorization: `Bearer ${env.users.user.token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        });

    const launch = async (origin: string) => {
        const res = await call({ origin });
        expect(res.status).toBe(200);
        return (await res.json()) as { app_uid: string };
    };

    const originFor = (label: string) =>
        `https://${label}-${uuidv4().slice(0, 8)}.example.com`;

    /** An origin app with a share in it, deleted without its retire running. */
    const deletedWithShare = async () => {
        const origin = originFor('kv-reuse');
        const { app_uid: appUid } = await launch(origin);
        const shared = await share(region('reuse'), 'read', { appUid });
        const app = await env.server.stores.app.getByUid(appUid);
        await env.server.stores.app.delete(app!.id);
        expect(
            (await handles().getByHandle(shared.handle))?.revokedAt,
        ).toBeNull();
        return { origin, appUid, handle: shared.handle };
    };

    it('retires the old app`s shares before the new app exists', async () => {
        const { origin, appUid, handle } = await deletedWithShare();

        const again = await launch(origin);

        expect(again.app_uid).toBe(appUid);
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
        await expect(guestGet(handle, 'k')).rejects.toMatchObject({
            legacyCode: 'kv_handle_not_found',
        });
    });

    it('refuses the launch and registers no app while the retire fails', async () => {
        const { origin, appUid, handle } = await deletedWithShare();

        const failing = vi
            .spyOn(
                env.server.services.permission,
                'revokeUserUserPermissionSubtree',
            )
            .mockRejectedValueOnce(new Error('database went away'));
        try {
            expect((await call({ origin })).status).toBe(500);
        } finally {
            failing.mockRestore();
        }
        const rows = await env.server.clients.db.pread(
            'SELECT `id` FROM `apps` WHERE `uid` = ?',
            [appUid],
        );
        expect(rows).toEqual([]);
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        await launch(origin);
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
    });
});

describe('a deleted app`s retire', () => {
    it('alarms when it fails, and the next check retries it from its record', async () => {
        const app = await makeApp();
        const { handle } = await share(region('retry'), 'read', {
            appUid: app.uid,
        });

        const alarm = vi.spyOn(env.server.clients.alarm, 'create');
        const failing = vi
            .spyOn(
                env.server.services.permission,
                'revokeUserUserPermissionSubtree',
            )
            .mockRejectedValueOnce(new Error('database went away'));
        try {
            await deleteApp(app);
            expect(alarm).toHaveBeenCalledWith(
                expect.stringContaining(app.uid),
                expect.any(String),
                expect.objectContaining({ error: expect.any(Error) }),
                'warning',
                { dedup: true },
            );
        } finally {
            failing.mockRestore();
            alarm.mockRestore();
        }
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        // Backing off after the failure, so an immediate check leaves it.
        await shares().resumeKvShareJobs();
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        await later(2 * 60_000, () =>
            resumeUntil(async () =>
                expect(await handles().getByHandle(handle)).toMatchObject({
                    revokedBy: 'system',
                }),
            ),
        );
    });

    it('carries on from its record when one run runs out of time', async () => {
        const app = await makeApp();
        // Spread over holders, as the per-holder cap would spread them.
        const holders = await Promise.all(
            [0, 1, 2].map(() => newUser('kv-seed')),
        );
        const perHolder = Math.ceil((KV_HANDLE_RETIRE_BATCH + 1) / 3);
        for (const holder of holders)
            await seedKvShareHandles(env.server, {
                ownerUserId: owner.id,
                ownerUuid: owner.uuid,
                granteeUserId: holder.id,
                count: perHolder,
                appUid: () => app.uid,
            });
        const seeded = perHolder * holders.length;

        // The first batch takes the run past its deadline.
        const store = handles();
        const retireMany = store.retireMany.bind(store);
        const now = Date.now.bind(Date);
        const clock = vi.spyOn(Date, 'now');
        const slow = vi
            .spyOn(store, 'retireMany')
            .mockImplementationOnce(async (...args) => {
                await retireMany(...args);
                clock.mockImplementation(() => now() + 2 * 60_000);
            });
        const alarm = vi.spyOn(env.server.clients.alarm, 'create');
        try {
            await deleteApp(app);
            expect(alarm).toHaveBeenCalledWith(
                expect.stringContaining(app.uid),
                expect.any(String),
                expect.anything(),
                'info',
                { dedup: true },
            );
        } finally {
            slow.mockRestore();
            clock.mockRestore();
            alarm.mockRestore();
        }
        expect(await liveInApp(app.uid)).toBe(seeded - KV_HANDLE_RETIRE_BATCH);

        await resumeUntil(async () => expect(await liveInApp(app.uid)).toBe(0));
    });

    it('leaves alone shares made after the deletion under the same uid', async () => {
        const app = await makeApp();
        const before = await share(region('old'), 'read', { appUid: app.uid });
        // Dated after the deletion, as one made by an app registered again
        // under the uid would be.
        const after = await share(region('new'), 'read', { appUid: app.uid });
        await env.server.clients.db.write(
            'UPDATE `kv_share_handles` SET `created_at` = `created_at` + 60 WHERE `handle` = ?',
            [after.handle],
        );

        await deleteApp(app);

        expect(await handles().getByHandle(before.handle)).toMatchObject({
            revokedBy: 'system',
        });
        expect(
            (await handles().getByHandle(after.handle))?.revokedAt,
        ).toBeNull();
    });
});

describe('shares of one region made at the same time', () => {
    it('make one handle, and every call gets it', async () => {
        const prefix = region('race');

        const minted = await Promise.all(
            [0, 1, 2].map(() => share(prefix, 'read')),
        );

        expect(new Set(minted.map((one) => one.handle)).size).toBe(1);
        const live = (
            await handles().listLiveForOwnerAndGrantee(owner.id, guest.id)
        ).filter((row) => row.keyPrefix === prefix);
        expect(live.map((row) => row.handle)).toEqual([minted[0].handle]);
    });
});

describe('deleting an account', () => {
    const subscribe = (user: TestUser, handle: string) =>
        env.server.services.events.subscribeDurable(user.actor, {
            subject: `kv:${handle}:*`,
        });

    it('ends what the owner subscribed to through a share the account held', async () => {
        const holder = await newUser('kv-holder');
        const { handle } = await share(region('held'), 'read', { holder });
        const { sub } = await subscribe(owner, handle);

        await env.server.services.userAccount.cascadeDelete(holder.id);

        expect(await suspendedReason(sub.subId)).toBe('permission_revoked');
    });
});
