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
 * Taking a shared key-value region back.
 *
 * Revoking a handle is not its own settle mechanism: it withdraws the grant,
 * and the revocation pass that already handles an unshare does the rest. What
 * these cases pin is that the handle really is 1:1 with what has to be settled
 * — the holder index answers it, nothing scans for the handle — and that
 * everything a revocation is supposed to take with it actually goes.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { kvAnchorToken } from './subjects.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'kv-revoke-socket';
const TABLE = 'event_subscriptions';
const PREFIX = 'workspace:abc:';

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
    uuid: string;
}

let env: PuterTestEnv;
let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;

const settled = (count = 1) =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
        uuid: row!.uuid as string,
    };
};

const ownerWrites = (key: string, value: unknown): Promise<unknown> =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.drivers.kvStore.set({ key, value }),
    );

const mint = (prefix = PREFIX) =>
    events().mintKvHandle(owner.actor, {
        granteeUsername: guest.username,
        prefix,
    });

/** A durable `single` row, which is the only kind that holds a backlog. */
const subscribeDurable = async (handle: string) =>
    (
        await events().subscribeDurable(guest.actor, {
            subject: `kv:${handle}:*`,
            delivery: 'single',
            handlerName: 'onChange',
        })
    ).sub;

const rowOf = async (subId: string) => {
    const [row] = await env.server.clients.db.pread(
        `SELECT \`suspended_reason\` FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
        [subId],
    );
    return row as { suspended_reason: unknown } | undefined;
};

const suspendedRow = (subId: string) =>
    vi.waitFor(
        async () =>
            expect((await rowOf(subId))?.suspended_reason).toBe(
                'permission_revoked',
            ),
        { timeout: 5_000, interval: 25 },
    );

/** Whether the shared region is still watched in its owner's keyspace. */
const ownerWatches = async (): Promise<boolean> => {
    const watched = await env.server.stores.eventSubscription.watchedTokens(
        owner.id,
        [kvAnchorToken(owner.uuid, 'os-global', PREFIX)],
    );
    return watched.length > 0;
};

const clearRows = async () => {
    await env.server.clients.db.write(`DELETE FROM \`${TABLE}\``, []);
    for (const id of [owner.id, guest.id, stranger.id]) {
        await events().reapSocket(id, SOCKET_ID);
        events().invalidateUser(id);
        await env.server.stores.eventSubscription.markRegionCold(id);
        await env.server.stores.durableSubscription.warmRegion(id);
    }
    delivered.length = 0;
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        unlimitedMetering: true,
    } as IConfig);

    const strangerName = `kv-onlooker-${uuidv4().slice(0, 8)}`;
    await createTestUser(env.server, {
        username: strangerName,
        password: 'pw-test-1234',
    });

    owner = await userFor(env.users.user.username);
    guest = await userFor(env.users.other.username);
    stranger = await userFor(strangerName);

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('revoking a handle', () => {
    it('settles the subscriptions it was holding up, and takes their backlog', async () => {
        await clearRows();
        const { handle } = await mint();
        const sub = await subscribeDurable(handle);

        await ownerWrites(`${PREFIX}messages:1`, { body: 'before' });
        await vi.waitFor(
            async () =>
                expect(
                    await env.server.stores.pendingDelivery.depth(sub.subId),
                ).toBeGreaterThan(0),
            { timeout: 5_000, interval: 25 },
        );
        expect(await ownerWatches()).toBe(true);

        await events().revokeKvHandle(owner.actor, handle);
        await suspendedRow(sub.subId);

        // The anchor leaves the *owner's* watched set, which is the keyspace a
        // write looks in.
        expect(await ownerWatches()).toBe(false);
        // Purged, not held: the backlog names keys its holder has just lost the
        // right to see.
        expect(await env.server.stores.pendingDelivery.depth(sub.subId)).toBe(
            0,
        );

        delivered.length = 0;
        await ownerWrites(`${PREFIX}messages:2`, { body: 'after' });
        await quiet();
        expect(delivered).toEqual([]);
    });

    it('stops a session subscription through the delivery re-check', async () => {
        await clearRows();
        const { handle } = await mint();
        const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${handle}:*`,
        });

        await ownerWrites(`${PREFIX}live:1`, 1);
        await settled();
        expect(delivered[0].subId).toBe(sub.subId);

        await events().revokeKvHandle(owner.actor, handle);
        delivered.length = 0;

        await ownerWrites(`${PREFIX}live:2`, 2);
        await quiet();
        expect(delivered).toEqual([]);
    });

    it('finds its subscriptions on the holder index, not by scanning', async () => {
        await clearRows();
        const { handle } = await mint();
        const sub = await subscribeDurable(handle);

        const store = env.server.stores.durableSubscription;
        const byHolder = vi.spyOn(store, 'listActiveForHolder');
        const settle = vi.spyOn(events(), 'settleRevokedGrant');

        try {
            await events().revokeKvHandle(owner.actor, handle);
            await suspendedRow(sub.subId);

            // One announcement, one settle pass, one indexed read of the
            // holder's rows — no lookup keyed on the handle anywhere.
            expect(settle).toHaveBeenCalledTimes(1);
            expect(byHolder).toHaveBeenCalledTimes(1);
            expect(byHolder).toHaveBeenCalledWith(guest.id, null);
        } finally {
            byHolder.mockRestore();
            settle.mockRestore();
        }
    });

    it('withdraws the grant, deeper grants included', async () => {
        await clearRows();
        const { handle } = await mint();
        const deeper = await mint(`${PREFIX}messages:`);

        await events().revokeKvHandle(owner.actor, handle);

        // The subtree goes with the region: a grant left underneath would keep
        // access to part of what was just taken back.
        await expect(
            events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${deeper.handle}:*`,
            }),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });

    it('retires a narrower handle to the same grantee that the subtree just took with it', async () => {
        await clearRows();
        const countLive = () =>
            env.server.stores.kvShareHandle.countLiveForOwner(owner.id);
        const before = await countLive();

        const { handle } = await mint();
        const deeper = await mint(`${PREFIX}messages:`);
        expect(await countLive()).toBe(before + 2);

        await events().revokeKvHandle(owner.actor, handle);

        // The deeper handle's grant died with the subtree revoke above (proven
        // by the sibling case), so its row reading live would disagree with
        // reality — both in the listing and in the slot it appears to hold.
        const page = await events().listKvHandles(owner.actor, {
            limit: 100,
        });
        const deeperRow = page.items.find((one) => one.handle === deeper.handle);
        expect(deeperRow?.revokedAt).toBeTypeOf('number');
        expect(await countLive()).toBe(before);
    });

    it('never retires a sibling the revoked grant did not cover', async () => {
        await clearRows();
        const { handle } = await mint();
        const sibling = await mint('workspace:other:');

        await events().revokeKvHandle(owner.actor, handle);

        const page = await events().listKvHandles(owner.actor, {
            limit: 100,
        });
        const siblingRow = page.items.find(
            (one) => one.handle === sibling.handle,
        );
        expect(siblingRow?.revokedAt).toBeNull();
    });

    it('lets a fresh handle over the same region work, and leaves the old one dead', async () => {
        await clearRows();
        const first = await mint();
        await events().revokeKvHandle(owner.actor, first.handle);

        const second = await mint();
        expect(second.handle).not.toBe(first.handle);

        const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${second.handle}:*`,
        });
        delivered.length = 0;
        await ownerWrites(`${PREFIX}messages:3`, { body: 'again' });
        await settled();
        expect(delivered[0].subId).toBe(sub.subId);

        await expect(
            events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${first.handle}:*`,
            }),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });

    it.each([
        ['a handle nobody minted', async () => `kvh-${uuidv4()}`],
        ['one this account did not mint', async () => (await mint()).handle],
    ])('answers %s as absent', async (label, handleFor) => {
        const handle = await handleFor();
        const actor =
            label === 'one this account did not mint'
                ? stranger.actor
                : owner.actor;

        await expect(
            events().revokeKvHandle(actor, handle),
        ).rejects.toMatchObject({
            legacyCode: 'subject_does_not_exist',
        });
    });

    it('is idempotent, and keeps the moment it first stopped', async () => {
        // The grant comes down before the handle is stamped, so a failure
        // between them leaves a retry to finish the job — which only works if
        // reaching a retired handle again succeeds.
        const { handle } = await mint();
        const first = await events().revokeKvHandle(owner.actor, handle);
        const again = await events().revokeKvHandle(owner.actor, handle);
        expect(again).toEqual(first);
    });

    it('leaves nothing standing when the handle stamp fails', async () => {
        // The half that stops delivery is the grant, so a failure after it
        // must not leave access behind — and the owner must be able to retry.
        await clearRows();
        const { handle } = await mint();
        await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${handle}:*`,
        });

        const store = env.server.stores.kvShareHandle;
        const retire = store.retire.bind(store);
        const failing = vi
            .spyOn(store, 'retire')
            .mockRejectedValueOnce(new Error('write failed'));
        await expect(
            events().revokeKvHandle(owner.actor, handle),
        ).rejects.toThrow('write failed');
        failing.mockRestore();

        // The grant is already gone, so nothing is delivered even though the
        // handle still reads as live.
        delivered.length = 0;
        await ownerWrites(`${PREFIX}messages:9`, { body: 'nope' });
        await quiet();
        expect(delivered).toEqual([]);

        // And the retry converges rather than answering "no such handle".
        const revoked = await events().revokeKvHandle(owner.actor, handle);
        expect(revoked.handle).toBe(handle);
        expect(await retire(handle, owner.id)).toMatchObject({
            revokedAt: revoked.revokedAt,
        });
    });

    it('refuses an app acting for the owner', async () => {
        const { handle } = await mint();
        const uid = `app-${uuidv4()}`;
        await env.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [uid, uid, uid, `https://${uid}.example/`, owner.id],
        );
        const app = await env.server.stores.app.getByUid(uid);
        const appActor = makeActor({
            user: owner.actor.user as never,
            app: { uid, id: app!.id },
        });

        await expect(
            events().revokeKvHandle(appActor, handle),
        ).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_owner_only',
        });
    });
});

describe('the owner`s handle listing', () => {
    it('shows what was shared, retired handles included', async () => {
        const { handle } = await mint();
        await events().revokeKvHandle(owner.actor, handle);

        const page = await events().listKvHandles(owner.actor, {
            includeTotal: true,
        });
        const row = page.items.find((one) => one.handle === handle);

        expect(row).toMatchObject({
            prefix: PREFIX,
            appUid: 'os-global',
            granteeUsername: guest.username,
        });
        expect(row?.revokedAt).toBeTypeOf('number');
        expect(page.total).toBe(page.items.length + (page.cursor ? 1 : 0));
    });

    it('shows the grantee nothing of the owner`s', async () => {
        await mint();
        const page = await events().listKvHandles(guest.actor);
        expect(page.items).toEqual([]);
    });

    it('pages, and the cursor picks up where it left off', async () => {
        await mint();
        await mint();

        const first = await events().listKvHandles(owner.actor, { limit: 1 });
        expect(first.items).toHaveLength(1);
        expect(first.cursor).toBeTypeOf('string');

        const second = await events().listKvHandles(owner.actor, {
            limit: 1,
            cursor: first.cursor,
        });
        expect(second.items).toHaveLength(1);
        expect(second.items[0].handle).not.toBe(first.items[0].handle);
    });
});

describe('the handle routes over HTTP', () => {
    const call = (
        method: string,
        path: string,
        token: string,
        body?: unknown,
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    it('mints, lists and revokes over the wire', async () => {
        const minted = await call(
            'POST',
            '/events/kv-handles',
            env.users.user.token,
            { granteeUsername: guest.username, prefix: 'over-http:' },
        );
        expect(minted.status).toBe(200);
        const { handle, prefix } = (await minted.json()) as {
            handle: string;
            prefix: string;
        };
        expect(prefix).toBe('over-http:');

        const listed = await call(
            'GET',
            '/events/kv-handles?limit=100',
            env.users.user.token,
        );
        const page = (await listed.json()) as {
            items: Array<{ handle: string }>;
        };
        expect(page.items.some((row) => row.handle === handle)).toBe(true);

        const revoked = await call(
            'DELETE',
            `/events/kv-handles/${handle}`,
            env.users.user.token,
        );
        expect(revoked.status).toBe(200);
        await expect(revoked.json()).resolves.toMatchObject({ handle });
    });

    it('shows one account nothing of another`s, and revokes nothing of theirs', async () => {
        const { handle } = await mint();

        const listed = await call(
            'GET',
            '/events/kv-handles',
            env.users.other.token,
        );
        const page = (await listed.json()) as { items: unknown[] };
        expect(page.items).toEqual([]);

        const revoked = await call(
            'DELETE',
            `/events/kv-handles/${handle}`,
            env.users.other.token,
        );
        expect(revoked.status).toBe(404);
    });

    it('turns an anonymous caller away', async () => {
        const res = await fetch(new URL('/events/kv-handles', env.apiOrigin), {
            method: 'GET',
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});
