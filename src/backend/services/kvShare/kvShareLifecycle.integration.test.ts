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
import { kvSharePermission, type KvShareAccess } from './kvShares.js';
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

const guestGet = (handle: string, key: string, actor = guest.actor) =>
    runWithContext({ actor }, () =>
        env.server.drivers.kvStore.get({ key, optConfig: { handle } }),
    );

const ownerWrites = (key: string, value: unknown, appUid: string) =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.drivers.kvStore.set({
            key,
            value,
            optConfig: { appUuid: appUid },
        }),
    );

/** Make a handle look minted `seconds` ago, past the clock-skew allowance. */
const age = (handle: string, seconds = 2 * 60 * 60) =>
    env.server.clients.db.write(
        'UPDATE `kv_share_handles` SET `created_at` = `created_at` - ? WHERE `handle` = ?',
        [seconds, handle],
    );

/** The job record for one deleted app, as every node of this domain reads it. */
const appJobKey = (appUid: string, domain = new URL(env.origin).hostname) =>
    `kvShareJob#${domain}#app#${appUid}`;

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

    const originFor = (label: string) =>
        `https://${label}-${uuidv4().slice(0, 8)}.example.com`;

    /**
     * An origin app with an old share in it, deleted without its retire
     * running, so the handle and its grant are still live.
     */
    const deletedWithShare = async () => {
        const origin = originFor('kv-reuse');
        const appUid = await env.server.services.auth.appUidFromOrigin(origin);
        const app = await env.server.stores.app.createFromOrigin(
            appUid,
            origin,
        );
        const prefix = region('reuse');
        const { handle } = await share(prefix, 'read', { appUid });
        await age(handle);
        await env.server.stores.app.delete(app.id);
        return { origin, appUid, prefix, handle };
    };

    it('refuses a handle older than the app, through the driver and the delegate, with nothing retired', async () => {
        const { origin, appUid, prefix, handle } = await deletedWithShare();
        // Registered again the way any bootstrap does, with no retire.
        const app = await env.server.stores.app.createFromOrigin(
            appUid,
            origin,
        );
        await env.server.services.permission.grantUserAppPermission(
            guest.actor,
            appUid,
            'flag:app-is-authenticated',
        );
        const guestInApp = makeActor({
            user: guest.actor.user as never,
            app: { uid: appUid, id: app.id },
        });

        for (const actor of [guest.actor, guestInApp])
            await expect(guestGet(handle, 'k', actor)).rejects.toMatchObject({
                legacyCode: 'kv_handle_not_found',
            });
        expect(
            await env.server.services.permission.check(
                guestInApp,
                kvSharePermission(owner.uuid, appUid, prefix, 'read'),
            ),
        ).toBe(false);
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        // A share made for the new app works as usual.
        const fresh = await share(region('fresh'), 'read', { appUid });
        expect(await guestGet(fresh.handle, 'k', guestInApp)).toBeNull();
        expect(
            await env.server.services.permission.check(
                guestInApp,
                kvSharePermission(owner.uuid, appUid, fresh.prefix, 'read'),
            ),
        ).toBe(true);
    });

    it('makes a new share when the owner shares an old region again', async () => {
        const { origin, appUid, prefix, handle } = await deletedWithShare();
        const app = await env.server.stores.app.createFromOrigin(
            appUid,
            origin,
        );

        const again = await share(prefix, 'read', { appUid });

        expect(again.handle).not.toBe(handle);
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
        await ownerWrites(`${prefix}k`, 'v', appUid);
        expect(await guestGet(again.handle, 'k')).toBe('v');

        // The cleanup a launch starts leaves the new share's grant alone.
        shares().retireSharesOlderThanApp(app);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await guestGet(again.handle, 'k')).toBe('v');
    });

    it('leaves the old shares out of both sides` listings', async () => {
        const { origin, appUid, handle } = await deletedWithShare();
        const app = await env.server.stores.app.createFromOrigin(
            appUid,
            origin,
        );
        const guestInApp = makeActor({
            user: guest.actor.user as never,
            app: { uid: appUid, id: app.id },
        });

        for (const actor of [guest.actor, guestInApp]) {
            const held = await shares().listKvSharesWithMe(actor, {
                appUid,
                includeTotal: true,
            });
            expect(held.items).toEqual([]);
            expect(held.total).toBe(0);
        }
        for (const state of ['all', 'live'] as const) {
            const mine = await shares().listKvHandles(owner.actor, {
                appUid,
                state,
                includeTotal: true,
            });
            expect(mine.items).toEqual([]);
            expect(mine.total).toBe(0);
        }

        // Once the cleanup retires it, the owner sees when it stopped.
        shares().retireSharesOlderThanApp(app);
        await vi.waitFor(async () =>
            expect(
                (await shares().listKvHandles(owner.actor, { appUid })).items,
            ).toEqual([
                expect.objectContaining({ handle, revokedBy: 'system' }),
            ]),
        );
    });

    it('launches without waiting on the retire, which cleans up in the background', async () => {
        const { origin, appUid, handle } = await deletedWithShare();

        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const store = handles();
        const retireMany = store.retireMany.bind(store);
        const stalled = vi
            .spyOn(store, 'retireMany')
            .mockImplementation(async (...args) => {
                await held;
                return retireMany(...args);
            });
        try {
            const res = await call({ origin });
            expect(res.status).toBe(200);
            expect(((await res.json()) as { app_uid: string }).app_uid).toBe(
                appUid,
            );
            await expect(guestGet(handle, 'k')).rejects.toMatchObject({
                legacyCode: 'kv_handle_not_found',
            });
        } finally {
            release();
            stalled.mockRestore();
        }
        await vi.waitFor(async () =>
            expect(await handles().getByHandle(handle)).toMatchObject({
                revokedBy: 'system',
            }),
        );
    });

    it('launches when the retire fails', async () => {
        const { origin, handle } = await deletedWithShare();

        const failing = vi
            .spyOn(
                env.server.services.permission,
                'revokeUserUserPermissionSubtree',
            )
            .mockRejectedValue(new Error('database went away'));
        try {
            expect((await call({ origin })).status).toBe(200);
            await expect(guestGet(handle, 'k')).rejects.toMatchObject({
                legacyCode: 'kv_handle_not_found',
            });
        } finally {
            failing.mockRestore();
        }
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

    it('runs anyway, with an alarm, when its record can`t be written', async () => {
        const app = await makeApp();
        const { handle } = await share(region('unrecorded'), 'read', {
            appUid: app.uid,
        });
        const alarm = vi.spyOn(env.server.clients.alarm, 'create');
        const unwritable = vi
            .spyOn(env.server.stores.kv, 'updateReservedItemIf')
            .mockRejectedValueOnce(new Error('throttled'));
        try {
            await deleteApp(app);
            expect(alarm).toHaveBeenCalledWith(
                `kv_share_job_record_failed:${appJobKey(app.uid)}`,
                expect.any(String),
                expect.objectContaining({ error: expect.any(Error) }),
                'warning',
                { dedup: true },
            );
        } finally {
            unwritable.mockRestore();
            alarm.mockRestore();
        }
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
    });

    it('keeps its backoff when it`s recorded again', async () => {
        const app = await makeApp();
        const { handle } = await share(region('backoff'), 'read', {
            appUid: app.uid,
        });
        const failing = vi
            .spyOn(
                env.server.services.permission,
                'revokeUserUserPermissionSubtree',
            )
            .mockRejectedValueOnce(new Error('database went away'));
        try {
            await deleteApp(app);
        } finally {
            failing.mockRestore();
        }

        // What a periodic sweep of deleted apps does.
        await shares().retireForDeletedApps([app.uid]);
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        await later(2 * 60_000, () =>
            resumeUntil(async () =>
                expect(await handles().getByHandle(handle)).toMatchObject({
                    revokedBy: 'system',
                }),
            ),
        );
    });

    it('never runs a record written for another domain', async () => {
        const app = await makeApp();
        const { handle } = await share(region('other-domain'), 'read', {
            appUid: app.uid,
        });
        await env.server.stores.app.delete(app.id);
        const key = appJobKey(app.uid, 'staging.example.test');
        await env.server.stores.kv.putReservedItem(key, {
            kind: 'app',
            appUid: app.uid,
            cutoff: Math.floor(Date.now() / 1000),
            state: 'pending',
            attempts: 0,
            runAfter: 0,
            home: env.server.services.broadcast.regionId,
            touched: 0,
            leaseUntil: 0,
        });
        try {
            await later(60 * 60_000, async () => {
                for (let look = 0; look < 3; look++)
                    await shares().resumeKvShareJobs();
            });
            expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();
        } finally {
            await env.server.stores.kv.deleteReservedItemIf(
                key,
                'attribute_exists(#c)',
                {},
                { '#c': 'cutoff' },
            );
        }
    });

    it('gives a share made meanwhile inside a retired region its grant back', async () => {
        const app = await makeApp();
        const outer = region('outer');
        const before = await share(outer, 'read', { appUid: app.uid });
        // Dated after the deletion, as one made while the retire runs would be.
        const after = await share(`${outer}inner:`, 'read', {
            appUid: app.uid,
        });
        await env.server.clients.db.write(
            'UPDATE `kv_share_handles` SET `created_at` = `created_at` + 60 WHERE `handle` = ?',
            [after.handle],
        );

        await deleteApp(app);

        expect(await handles().getByHandle(before.handle)).toMatchObject({
            revokedBy: 'system',
        });
        const kept = await handles().getByHandle(after.handle);
        expect(kept?.revokedAt).toBeNull();
        expect(
            await env.server.services.permission.hasUserUserGrant(
                guest.id,
                owner.id,
                [kept!.permission],
            ),
        ).toBe(true);
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
        try {
            await deleteApp(app);
        } finally {
            slow.mockRestore();
            clock.mockRestore();
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

    it('runs once when two runners race for it', async () => {
        const app = await makeApp();
        const { handle } = await share(region('race-job'), 'read', {
            appUid: app.uid,
        });
        await env.server.stores.app.delete(app.id);

        const store = handles();
        const retireMany = vi.spyOn(store, 'retireMany');
        try {
            await Promise.all([
                shares().retireForDeletedApps([app.uid]),
                shares().retireForDeletedApps([app.uid]),
            ]);
            const runs = retireMany.mock.calls.filter(([named]) =>
                named.includes(handle),
            );
            expect(runs).toHaveLength(1);
        } finally {
            retireMany.mockRestore();
        }
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
    });

    it('is left to the deployment that holds it until it goes unclaimed', async () => {
        const app = await makeApp();
        const { handle } = await share(region('elsewhere'), 'read', {
            appUid: app.uid,
        });
        const failing = vi
            .spyOn(
                env.server.services.permission,
                'revokeUserUserPermissionSubtree',
            )
            .mockRejectedValueOnce(new Error('database went away'));
        try {
            await deleteApp(app);
        } finally {
            failing.mockRestore();
        }
        // Another deployment ran it last, a moment ago, and it's due now.
        await env.server.stores.kv.updateReservedItemIf(
            appJobKey(app.uid),
            { set: { home: 'elsewhere', touched: Date.now(), runAfter: 0 } },
            'attribute_exists(#c)',
            {},
            { '#c': 'cutoff' },
        );

        await later(5 * 60_000, async () => {
            await shares().resumeKvShareJobs();
            await shares().resumeKvShareJobs();
        });
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        await later(31 * 60_000, () =>
            resumeUntil(async () =>
                expect(await handles().getByHandle(handle)).toMatchObject({
                    revokedBy: 'system',
                }),
            ),
        );
    });

    it('stops retrying after repeated failures, with an alarm', async () => {
        const app = await makeApp();
        const { handle } = await share(region('gave-up'), 'read', {
            appUid: app.uid,
        });
        const alarm = vi.spyOn(env.server.clients.alarm, 'create');
        const failing = vi
            .spyOn(
                env.server.services.permission,
                'revokeUserUserPermissionSubtree',
            )
            .mockRejectedValue(new Error('database went away'));
        const gaveUp = () =>
            alarm.mock.calls.some(
                ([id]) =>
                    id.startsWith('kv_share_job_gave_up:') &&
                    id.includes(app.uid),
            );
        try {
            await deleteApp(app);
            // Each check comes after the longest wait between retries.
            for (let hours = 7; hours < 7 * 20 && !gaveUp(); hours += 7)
                await later(hours * 60 * 60_000, async () => {
                    for (let look = 0; look < 5; look++)
                        await shares().resumeKvShareJobs();
                });
            expect(gaveUp()).toBe(true);

            failing.mockClear();
            await later(1_000 * 60 * 60_000, async () => {
                for (let look = 0; look < 5; look++)
                    await shares().resumeKvShareJobs();
            });
            expect(failing).not.toHaveBeenCalled();
        } finally {
            failing.mockRestore();
            alarm.mockRestore();
        }
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        // A new deletion event records it again.
        await deleteApp(app);
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
    });

    it('reaches a due job behind a page of ones that are waiting', async () => {
        const waiting: string[] = [];
        for (let i = 0; i < 150; i++) {
            const appUid = `app-0000-wait-${String(i).padStart(4, '0')}`;
            waiting.push(appJobKey(appUid));
            await env.server.stores.kv.putReservedItem(appJobKey(appUid), {
                kind: 'app',
                appUid,
                cutoff: 0,
                state: 'pending',
                attempts: 1,
                runAfter: Date.now() + 1_000 * 60 * 60_000,
                home: env.server.services.broadcast.regionId,
                touched: Date.now(),
                leaseUntil: 0,
            });
        }
        try {
            const app = await makeApp();
            const { handle } = await share(region('behind'), 'read', {
                appUid: app.uid,
            });
            const failing = vi
                .spyOn(
                    env.server.services.permission,
                    'revokeUserUserPermissionSubtree',
                )
                .mockRejectedValueOnce(new Error('database went away'));
            try {
                await deleteApp(app);
            } finally {
                failing.mockRestore();
            }

            await later(2 * 60_000, async () => {
                for (let look = 0; look < 4; look++)
                    await shares().resumeKvShareJobs();
            });
            expect(await handles().getByHandle(handle)).toMatchObject({
                revokedBy: 'system',
            });
        } finally {
            for (const key of waiting)
                await env.server.stores.kv.deleteReservedItemIf(
                    key,
                    'attribute_exists(#c)',
                    {},
                    { '#c': 'cutoff' },
                );
        }
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

    it('hands a call that waited out the lock the share made meanwhile', async () => {
        const prefix = region('slow');
        const store = handles();
        const mint = store.mint.bind(store);
        const pause = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
        // The first mint inserts after the second has looked and found
        // nothing, then holds the lock well past how long the second waits.
        const slow = vi
            .spyOn(store, 'mint')
            .mockImplementationOnce(async (input) => {
                await pause(300);
                const row = await mint(input);
                await pause(2_000);
                return row;
            });
        try {
            const first = share(prefix, 'read');
            await pause(100);
            const second = await share(prefix, 'read');
            expect(second.handle).toBe((await first).handle);
        } finally {
            slow.mockRestore();
        }
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
