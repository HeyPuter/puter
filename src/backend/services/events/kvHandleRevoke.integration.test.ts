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
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_KV_HANDLE_LIMIT,
    EVENTS_SUBSCRIBE_LIMIT,
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { SESSION_SUBSCRIPTION_TTL_SECONDS } from '../../stores/events/EventSubscriptionStore.js';
import { kvShareGrantAtEveryLevel } from '../kvShare/kvShares.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { kvAnchorToken } from './subjects.js';
import { RecordingWorkerInvoker } from './workerSeam.js';

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
const shares = () => env.server.services.kvShare;

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
    shares().mintKvHandle(
        owner.actor,
        { prefix, recipient: { username: guest.username } },
        { defaultAccess: 'watch' },
    );

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
        kv: { shareHandles: true },
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

        await shares().revokeKvHandle(owner.actor, handle);
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

        await shares().revokeKvHandle(owner.actor, handle);
        delivered.length = 0;

        await ownerWrites(`${PREFIX}live:2`, 2);
        await quiet();
        expect(delivered).toEqual([]);
    });

    describe('ending session subscriptions made through it', () => {
        let send: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            send = vi.spyOn(env.server.services.socket, 'send');
        });
        afterEach(() => {
            send.mockRestore();
        });

        const endedOn = (socketId: string, subId: string) =>
            vi.waitFor(
                () =>
                    expect(send).toHaveBeenCalledWith(
                        { socket: socketId },
                        'events.ended',
                        expect.objectContaining({
                            subId,
                            code: 'subscription_ended',
                            reason: 'permission_revoked',
                        }),
                    ),
                { timeout: 5_000, interval: 25 },
            );

        const heldOn = async (userId: number, socketId: string) =>
            (
                await env.server.stores.eventSubscription.listForSocket(
                    userId,
                    socketId,
                )
            ).map((row) => row.subId);

        it('ends them when the owner revokes it, and tells the connection', async () => {
            await clearRows();
            const { handle } = await mint();
            const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            });

            await shares().revokeKvHandle(owner.actor, handle);

            await endedOn(SOCKET_ID, sub.subId);
            expect(await heldOn(guest.id, SOCKET_ID)).toEqual([]);
            expect(await ownerWatches()).toBe(false);
        });

        it('still suspends durable subscriptions when ending them fails', async () => {
            await clearRows();
            const { handle } = await mint();
            const durable = await subscribeDurable(handle);
            await events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            });
            // Retired with the grant left alone, so only the retire settle
            // can suspend the row.
            await env.server.stores.kvShareHandle.retireMany([handle], 'owner');

            const store = env.server.stores.eventSubscription;
            const listing = vi
                .spyOn(store, 'listForKvHandles')
                .mockRejectedValue(new Error('redis unavailable'));
            try {
                await events().settleRetiredKvHandles({
                    handles: [handle],
                    userId: guest.id,
                });
                await suspendedRow(durable.subId);
            } finally {
                listing.mockRestore();
            }
        });

        it('ends them when the holder gives it up', async () => {
            await clearRows();
            const { handle } = await mint();
            const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            });

            await shares().removeKvShare(guest.actor, handle);

            await endedOn(SOCKET_ID, sub.subId);
            expect(await heldOn(guest.id, SOCKET_ID)).toEqual([]);
        });

        it('ends them on the connection`s next refresh when the handle stopped standing out of sight', async () => {
            await clearRows();
            const socketId = 'kv-revoke-refresh';
            const retired = await mint();
            const withdrawn = await mint('workspace:withdrawn:');
            const kept = await mint('workspace:kept:');

            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
            try {
                const subs = [];
                for (const { handle } of [retired, withdrawn, kept])
                    subs.push(
                        (
                            await events().subscribe(guest.actor, socketId, {
                                subject: `kv:${handle}:*`,
                            })
                        ).sub,
                    );

                // Neither goes through a retire this region hears about: a
                // handle retired from another region, and a grant withdrawn
                // with its handle left live.
                await env.server.stores.kvShareHandle.retireMany(
                    [retired.handle],
                    'owner',
                );
                const grant = await env.server.stores.kvShareHandle.getByHandle(
                    withdrawn.handle,
                );
                await env.server.services.permission.revokeUserUserPermissionSubtree(
                    owner.actor,
                    guest.username,
                    kvShareGrantAtEveryLevel(grant!.permission),
                    { reason: 'test' },
                );
                expect(await heldOn(guest.id, socketId)).toHaveLength(3);

                await vi.advanceTimersByTimeAsync(
                    (SESSION_SUBSCRIPTION_TTL_SECONDS * 1000) / 3,
                );

                await endedOn(socketId, subs[0].subId);
                await endedOn(socketId, subs[1].subId);
                expect(await heldOn(guest.id, socketId)).toEqual([
                    subs[2].subId,
                ]);
            } finally {
                await events().reapSocket(guest.id, socketId);
                vi.useRealTimers();
            }
        });
    });

    it('finds its subscriptions on the holder index, not by scanning', async () => {
        await clearRows();
        const { handle } = await mint();
        const sub = await subscribeDurable(handle);

        const store = env.server.stores.durableSubscription;
        const byHolder = vi.spyOn(store, 'listActiveForHolder');
        const settle = vi.spyOn(events(), 'settleRevokedGrant');

        try {
            await shares().revokeKvHandle(owner.actor, handle);
            await suspendedRow(sub.subId);

            // One grant settle for the holder, and a retired-handle settle
            // for each side, each a single indexed read of that user's rows —
            // no lookup keyed on the handle anywhere.
            expect(settle).toHaveBeenCalledTimes(1);
            expect(
                byHolder.mock.calls.map(([userId]) => userId).sort(),
            ).toEqual([guest.id, guest.id, owner.id].sort());
            for (const call of byHolder.mock.calls)
                expect(call.slice(1)).toEqual([
                    null,
                    { includeSuspended: true },
                ]);
        } finally {
            byHolder.mockRestore();
            settle.mockRestore();
        }
    });

    it('withdraws the grant, deeper grants included', async () => {
        await clearRows();
        const { handle } = await mint();
        const deeper = await mint(`${PREFIX}messages:`);

        await shares().revokeKvHandle(owner.actor, handle);

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
        expect((await countLive()).total).toBe(before.total + 2);

        await shares().revokeKvHandle(owner.actor, handle);

        // The deeper handle's grant died with the subtree revoke above (proven
        // by the sibling case), so its row reading live would disagree with
        // reality — both in the listing and in the slot it appears to hold.
        const page = await shares().listKvHandles(owner.actor, {
            limit: 100,
        });
        const deeperRow = page.items.find((one) => one.handle === deeper.handle);
        expect(deeperRow?.revokedAt).toBeTypeOf('number');
        expect((await countLive()).total).toBe(before.total);
    });

    it('never retires a sibling the revoked grant did not cover', async () => {
        await clearRows();
        const { handle } = await mint();
        const sibling = await mint('workspace:other:');

        await shares().revokeKvHandle(owner.actor, handle);

        const page = await shares().listKvHandles(owner.actor, {
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
        await shares().revokeKvHandle(owner.actor, first.handle);

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
            shares().revokeKvHandle(actor, handle),
        ).rejects.toMatchObject({
            legacyCode: 'subject_does_not_exist',
        });
    });

    it('is idempotent, and keeps the moment it first stopped', async () => {
        // The grant comes down before the handle is stamped, so a failure
        // between them leaves a retry to finish the job — which only works if
        // reaching a retired handle again succeeds.
        const { handle } = await mint();
        const first = await shares().revokeKvHandle(owner.actor, handle);
        const again = await shares().revokeKvHandle(owner.actor, handle);
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
            shares().revokeKvHandle(owner.actor, handle),
        ).rejects.toThrow('write failed');
        failing.mockRestore();

        // The grant is already gone, so nothing is delivered even though the
        // handle still reads as live.
        delivered.length = 0;
        await ownerWrites(`${PREFIX}messages:9`, { body: 'nope' });
        await quiet();
        expect(delivered).toEqual([]);

        // And the retry converges rather than answering "no such handle".
        const revoked = await shares().revokeKvHandle(owner.actor, handle);
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
            shares().revokeKvHandle(appActor, handle),
        ).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_owner_only',
        });
    });
});

describe('a queued row whose share can`t be checked right now', () => {
    const handles = () => env.server.stores.kvShareHandle;
    const pending = () => env.server.stores.pendingDelivery;

    /**
     * A durable `single` on a fresh handle, with a backlog waiting and the
     * lease its first hand-over took lapsed, so a sweep reads it again.
     */
    const queued = async () => {
        await clearRows();
        const { handle } = await mint();
        const sub = await subscribeDurable(handle);
        await ownerWrites(`${PREFIX}messages:1`, { body: 'queued' });
        const lease = `ev:ql:{${sub.subId}}`;
        await vi.waitFor(
            async () => {
                expect(await pending().depth(sub.subId)).toBeGreaterThan(0);
                expect(await env.server.clients.redis.zcard(lease)).toBe(1);
            },
            { timeout: 5_000, interval: 25 },
        );
        await env.server.clients.redis.del(lease);
        return { handle, sub, depth: await pending().depth(sub.subId) };
    };

    /** One sweep pass, reporting whether it went for this row's backlog. */
    const sweepClaims = async (subId: string) => {
        const claim = vi.spyOn(pending(), 'claim');
        try {
            await events().sweepPending();
            return claim.mock.calls.some(([id]) => id === subId);
        } finally {
            claim.mockRestore();
        }
    };

    it('keeps the row and its backlog when the share lookup fails', async () => {
        const { sub, depth } = await queued();

        const failing = vi
            .spyOn(handles(), 'getLive')
            .mockRejectedValue(new Error('lookup unavailable'));
        try {
            expect(await sweepClaims(sub.subId)).toBe(false);
        } finally {
            failing.mockRestore();
        }

        expect((await rowOf(sub.subId))?.suspended_reason).toBeNull();
        expect(await pending().depth(sub.subId)).toBe(depth);
        expect(await sweepClaims(sub.subId)).toBe(true);
    });

    it('holds the backlog while the owner is suspended, and hands it out after', async () => {
        const { handle, sub, depth } = await queued();
        const live = await handles().getLive(handle);

        const suspended = vi
            .spyOn(handles(), 'getLive')
            .mockResolvedValue({ ...live!, ownerSuspended: true });
        try {
            expect(await sweepClaims(sub.subId)).toBe(false);
        } finally {
            suspended.mockRestore();
        }
        expect((await rowOf(sub.subId))?.suspended_reason).toBeNull();
        expect(await pending().depth(sub.subId)).toBe(depth);

        expect(await sweepClaims(sub.subId)).toBe(true);
        expect((await rowOf(sub.subId))?.suspended_reason).toBeNull();
    });

    it('still settles a share that is gone', async () => {
        const { sub } = await queued();

        const gone = vi.spyOn(handles(), 'getLive').mockResolvedValue(null);
        try {
            expect(await sweepClaims(sub.subId)).toBe(false);
        } finally {
            gone.mockRestore();
        }

        expect((await rowOf(sub.subId))?.suspended_reason).toBe(
            'permission_revoked',
        );
        expect(await pending().depth(sub.subId)).toBe(0);
    });
});

describe('a queued backlog after its share drops to watch', () => {
    const HANDLER = 'onChange';
    const pending = () => env.server.stores.pendingDelivery;
    const socket = () => env.server.services.socket;
    const soon = (check: () => unknown) =>
        vi.waitFor(check, { timeout: 5_000, interval: 25 });

    let app: { uid: string; id: number };
    let guestApp: Actor;
    let worker: RecordingWorkerInvoker;
    let previousWorker: ReturnType<typeof events>['worker'];

    beforeAll(async () => {
        const name = `kv-queued-${uuidv4().slice(0, 8)}`;
        app = await env.server.stores.app.create(
            {
                name,
                title: 'Queued Values',
                index_url: `https://${name}.example.test/index.html`,
            },
            { ownerUserId: owner.id },
        );
        guestApp = makeActor({
            user: guest.actor.user as never,
            app: { uid: app.uid, id: app.id },
        });
        // The holder launching the app, and letting its handler run unattended.
        for (const permission of [
            'flag:app-is-authenticated',
            EVENTS_BACKGROUND_PERMISSION,
        ])
            await env.server.services.permission.grantUserAppPermission(
                guest.actor,
                app.uid,
                permission,
            );
        await events().publishHandler(owner.actor, {
            appUid: app.uid,
            name: HANDLER,
            source: 'async ({ event }) => { console.log(event.key); }',
        });
    });

    beforeEach(async () => {
        await clearRows();
        const limits = [EVENTS_KV_HANDLE_LIMIT, EVENTS_SUBSCRIBE_LIMIT];
        for (const user of [owner, guest])
            for (const limit of limits)
                await env.server.clients.redis.del(
                    `rate:${limit.scope}:${user.id}`,
                );
        previousWorker = events().worker;
        worker = new RecordingWorkerInvoker();
        events().worker = worker;
    });

    afterEach(() => {
        events().worker = previousWorker;
    });

    /** Sharing a region again is how its level changes. */
    const shareAt = (
        prefix: string,
        access: 'read' | 'watch',
        appUid?: string,
    ) =>
        shares().mintKvHandle(
            owner.actor,
            {
                prefix,
                recipient: { username: guest.username },
                access,
                ...(appUid ? { appUid } : {}),
            },
            { defaultAccess: 'watch' },
        );

    const subscribeValues = async (handle: string, actor = guest.actor) =>
        (
            await events().subscribeDurable(actor, {
                subject: `kv:${handle}:*`,
                delivery: 'single',
                handlerName: HANDLER,
                includeValue: true,
            })
        ).sub;

    const writes = (key: string, value: unknown, appUid?: string) =>
        runWithContext({ actor: owner.actor }, () =>
            env.server.drivers.kvStore.set({
                key,
                value,
                ...(appUid ? { optConfig: { appUuid: appUid } } : {}),
            }),
        );

    /** One entry queued and leased to nobody, so the next drain claims it. */
    const backlogged = async (subId: string) => {
        await soon(async () => expect(await pending().depth(subId)).toBe(1));
        await env.server.clients.redis.del(`ev:ql:{${subId}}`);
    };

    const deliveredTo = (subId: string) =>
        delivered.find((one) => one.subId === subId);

    const ranFor = (subId: string) =>
        worker.recorded
            .filter((one) => one.subId === subId)
            .map((one) => one.event);

    /** Run `step` with the holder connected in this region. */
    const connected = async (step: () => Promise<unknown>) => {
        const has = vi.spyOn(socket(), 'has').mockReturnValue(true);
        try {
            await step();
        } finally {
            has.mockRestore();
        }
    };

    it('hands a connected client the backlog without the value', async () => {
        const prefix = 'queued:socket:';
        const { handle } = await shareAt(prefix, 'read');
        const sub = await subscribeValues(handle);
        await writes(`${prefix}secret`, 'private-value');
        await backlogged(sub.subId);

        await shareAt(prefix, 'watch');
        delivered.length = 0;
        await connected(() => events().sweepPending());

        const event = deliveredTo(sub.subId)?.event;
        expect(event).toMatchObject({ key: 'secret', op: 'set' });
        expect(event).not.toHaveProperty('value');
    });

    it('leaves the value off an older entry a new write hands out', async () => {
        const prefix = 'queued:next-write:';
        const { handle } = await shareAt(prefix, 'read');
        const sub = await subscribeValues(handle);
        await writes(`${prefix}first`, 'private-value');
        await backlogged(sub.subId);

        await shareAt(prefix, 'watch');
        delivered.length = 0;
        await connected(async () => {
            await writes(`${prefix}second`, 'later');
            await soon(() => expect(deliveredTo(sub.subId)).toBeDefined());
        });

        const event = deliveredTo(sub.subId)?.event;
        expect(event).toMatchObject({ key: 'first' });
        expect(event).not.toHaveProperty('value');
    });

    it('hands a handler run the backlog without the value', async () => {
        const prefix = 'queued:worker:';
        const { handle } = await shareAt(prefix, 'read', app.uid);
        const sub = await subscribeValues(handle, guestApp);
        await writes(`${prefix}secret`, 'private-value', app.uid);
        await soon(() => expect(ranFor(sub.subId)).toHaveLength(1));
        expect(ranFor(sub.subId)[0]).toMatchObject({ value: 'private-value' });

        await shareAt(prefix, 'watch', app.uid);
        await env.server.clients.redis.del(`ev:ql:{${sub.subId}}`);
        await events().sweepPending();

        const [, again] = ranFor(sub.subId);
        expect(again).toMatchObject({ key: 'secret' });
        expect(again).not.toHaveProperty('value');
    });

    it('hands a delivery its client declined to the handler without the value', async () => {
        const prefix = 'queued:declined:';
        const { handle } = await shareAt(prefix, 'read', app.uid);
        const sub = await subscribeValues(handle, guestApp);
        delivered.length = 0;
        await connected(async () => {
            await writes(`${prefix}secret`, 'private-value', app.uid);
            await soon(() => expect(deliveredTo(sub.subId)).toBeDefined());
        });
        const envelope = deliveredTo(sub.subId)!;
        expect(envelope.event).toMatchObject({ value: 'private-value' });

        await shareAt(prefix, 'watch', app.uid);
        await events().declineDelivery(guestApp, {
            subId: sub.subId,
            id: envelope.ackId,
        });

        const [run] = ranFor(sub.subId);
        expect(run).toMatchObject({ key: 'secret' });
        expect(run).not.toHaveProperty('value');
    });

    it('leaves the owner`s own backlog its values', async () => {
        const prefix = 'queued:owner:';
        const { handle } = await shareAt(prefix, 'watch');
        const sub = await subscribeValues(handle, owner.actor);
        await writes(`${prefix}mine`, 'kept');
        await backlogged(sub.subId);

        delivered.length = 0;
        await connected(() => events().sweepPending());

        expect(deliveredTo(sub.subId)?.event).toMatchObject({
            key: 'mine',
            value: 'kept',
        });
    });
});

describe('the owner`s handle listing', () => {
    it('shows what was shared, retired handles included', async () => {
        const { handle } = await mint();
        await shares().revokeKvHandle(owner.actor, handle);

        const page = await shares().listKvHandles(owner.actor, {
            includeTotal: true,
        });
        const row = page.items.find((one) => one.handle === handle);

        expect(row).toMatchObject({
            prefix: PREFIX,
            appUid: 'os-global',
            holderUsername: guest.username,
            access: 'watch',
            revokedBy: 'owner',
        });
        expect(row?.revokedAt).toBeTypeOf('number');
        expect(page.total).toBe(page.items.length + (page.cursor ? 1 : 0));
    });

    it('shows the grantee nothing of the owner`s', async () => {
        await mint();
        const page = await shares().listKvHandles(guest.actor);
        expect(page.items).toEqual([]);
    });

    it('pages, and the cursor picks up where it left off', async () => {
        await mint();
        await mint();

        const first = await shares().listKvHandles(owner.actor, { limit: 1 });
        expect(first.items).toHaveLength(1);
        expect(first.cursor).toBeTypeOf('string');

        const second = await shares().listKvHandles(owner.actor, {
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
