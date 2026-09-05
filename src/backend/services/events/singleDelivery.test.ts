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

import MockRedis from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_REGION_PENDING_CEILING,
    EVENTS_SINGLE_DELIVERY_LIMIT,
    EVENTS_WORKER_INVOCATION_LIMIT,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { EventSubscriptionStore } from '../../stores/events/EventSubscriptionStore.js';
import { PendingDeliveryStore } from '../../stores/events/PendingDeliveryStore.js';
import type {
    DurableSubscription,
    SubscriptionTarget,
} from '../../stores/events/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { IConfig } from '../../types.js';
import type { UsageInput } from '../metering/types.js';
import { EVENTS_COSTS } from './costs.js';
import { EventsService, type DeliveryEnvelope } from './EventsService.js';
import { fsAnchorToken } from './subjects.js';
import type {
    WorkerInvocation,
    WorkerInvocationOutcome,
} from './workerSeam.js';

/**
 * The promises each delivery class makes, held against each other.
 *
 * A `single` is owed to exactly one consumer: the socket if someone is there,
 * the handler once the socket has had its turns, and never both. A `broadcast`
 * is at-most-once to everyone who is: its handler runs alongside the socket
 * copies rather than instead of them, and a row nothing can carry delivers —
 * and meters — nothing at all.
 */

let seq = 0;
let userId = 0;
let redis: InstanceType<typeof MockRedis.Cluster>;
let subscriptions: EventSubscriptionStore;
let pending: PendingDeliveryStore;
let service: EventsService;
let sent: DeliveryEnvelope[];
let delivered: DeliveryEnvelope[];
let invoked: WorkerInvocation[];
let rows: Map<string, DurableSubscription>;
let entries: Map<string, FSEntry>;
let alarms: ReturnType<typeof vi.fn>;
let notified: ReturnType<typeof vi.fn>;
let metered: MeteredLine[];
/** Whether the holder being delivered to still has budget. */
let hasCredits: boolean;

/** One buffered usage line, with the identity it was written as. */
interface MeteredLine {
    userUuid: string | undefined;
    appUid: string | null;
    usageType: string;
    usageAmount: number;
    costOverride?: number;
}

/** Whether this region holds a connection for the row being delivered to. */
let socketConnected = true;
/** What the handler seam reports back, which is what settles a lease or not. */
let workerOutcome: WorkerInvocationOutcome = 'deferred';
/** Stand-in for presence: which remote region, if any, answers one attempt. */
let candidateRegionImpl: (
    holderUserId: number,
    appUid: string | null,
    attempt: number,
) => Promise<string | null> = async () => null;
/** The attempt index each `candidateRegion` call carried, in order. */
let candidateRegionCalls: number[] = [];

const entry = (over: Partial<FSEntry> = {}): FSEntry =>
    ({
        uid: `file-${seq}`,
        uuid: `file-${seq}`,
        path: `/u${userId}/Documents/notes.txt`,
        userId,
        isDir: false,
        ...over,
    }) as FSEntry;

const actorFor = (asUserId = userId): Actor =>
    ({
        user: {
            id: asUserId,
            uuid: `user-${asUserId}`,
            username: `u${asUserId}`,
        },
        effectiveApp: null,
    }) as unknown as Actor;

const anchorUid = (): string => `docs-${seq}`;
const anchorPath = (): string => `/u${userId}/Documents`;

const ancestors = (): Array<{ uid: string; path: string }> => [
    { uid: anchorUid(), path: anchorPath() },
];

const durableRow = (
    over: Partial<DurableSubscription> = {},
): DurableSubscription => ({
    durable: true,
    subId: `app-${seq}#${over.subId ?? 'sub'}`,
    holderUserId: userId,
    ownerUserId: userId,
    subject: `fs:${anchorPath()}`,
    token: fsAnchorToken(anchorUid()),
    anchorUid: anchorUid(),
    anchorPath: anchorPath(),
    match: null,
    op: null,
    appUid: null,
    permission: 'list',
    delivery: 'single',
    targets: ['socket', 'worker'] as SubscriptionTarget[],
    handlerName: 'onWrite',
    context: null,
    expiresAt: null,
    suspendedAt: null,
    suspendedReason: null,
    createdAt: Math.floor(Date.now() / 1000),
    ...over,
});

/** Put a row where dispatch reads it, and where a later ack looks it up. */
const register = async (
    over: Partial<DurableSubscription> = {},
): Promise<DurableSubscription> => {
    const row = durableRow(over);
    rows.set(row.subId, row);
    await subscriptions.cacheDurable([row]);
    service.invalidateUser(userId);
    return row;
};

const dispatch = (node = entry()): Promise<void> =>
    service.dispatchFs('fs.write.file', node, {
        actingUserId: userId,
        ancestors: async () => ancestors(),
    });

/** Wait out the coalescing window a `broadcast` delivery sits in. */
const flushed = (count = 1): Promise<void> =>
    vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const jump = (ms: number): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + ms);
};

const keysOf = async (subId: string): Promise<string[]> =>
    (await redis.keys('*')).filter((key: string) => key.includes(subId));

beforeEach(async () => {
    seq++;
    userId = 7000 + seq;
    socketConnected = true;
    workerOutcome = 'deferred';
    candidateRegionImpl = async () => null;
    candidateRegionCalls = [];
    sent = [];
    delivered = [];
    invoked = [];
    rows = new Map();
    entries = new Map();
    alarms = vi.fn();
    notified = vi.fn();
    metered = [];
    hasCredits = true;

    redis = new MockRedis.Cluster(['redis://localhost:7001']);
    await redis.del('ev:qx', 'ev:qc', 'ev:qxr');

    subscriptions = new EventSubscriptionStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );
    pending = new PendingDeliveryStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );

    entries.set(`uid:${anchorUid()}`, entry({ uid: anchorUid(), isDir: true }));

    service = new EventsService(
        { events: { enabled: true } } as IConfig,
        {
            redis,
            event: { on: vi.fn(), emit: vi.fn() },
            alarm: { create: alarms },
        } as never,
        {
            eventSubscription: subscriptions,
            pendingDelivery: pending,
            durableSubscription: {
                warmRegion: async () => false,
                getBySubId: async (subId: string) => rows.get(subId) ?? null,
                remove: async (row: DurableSubscription) => {
                    rows.delete(row.subId);
                    return { userId: row.holderUserId, generation: 1 };
                },
                suspend: async (
                    suspending: readonly DurableSubscription[],
                    reason: string,
                ) => {
                    const suspended: DurableSubscription[] = [];
                    for (const row of suspending) {
                        const next = {
                            ...row,
                            suspendedAt: Math.floor(Date.now() / 1000),
                            suspendedReason: reason,
                        };
                        rows.set(row.subId, next);
                        suspended.push(next);
                    }
                    return { suspended, bumps: [{ userId, generation: 1 }] };
                },
            },
            fsEntry: {
                getEntryByUuid: async (uid: string) =>
                    entries.get(`uid:${uid}`) ?? null,
                getEntryByPath: async () => null,
                getEntryById: async () => null,
            },
            user: {
                getById: async (id: number) => ({ id, uuid: `user-${id}` }),
            },
            app: { getByUid: async (uid: string) => ({ uid, id: 1 }) },
            permission: { getCacheGeneration: async () => 1 },
        } as never,
        {
            eventForward: {
                // A deployment with no peers has nowhere to forward to, which
                // is what every test here is.
                region: 'local',
                isPeer: () => false,
                noteConnect: async () => undefined,
                noteDisconnect: async () => undefined,
                candidateRegion: async (
                    holderUserId: number,
                    appUid: string | null,
                    attempt: number,
                ) => {
                    candidateRegionCalls.push(attempt);
                    return candidateRegionImpl(holderUserId, appUid, attempt);
                },
                fanOut: async () => undefined,
                handOff: () => undefined,
                relayAck: () => undefined,
            },
            socket: {
                send: vi.fn(async (_spec, _key, data) => {
                    sent.push(data as DeliveryEnvelope);
                }),
                has: () => socketConnected,
            },
            fs: { getAncestorChain: async () => ancestors() },
            acl: {
                check: async () => true,
                getSafeAclError: async () => ({
                    status: 404,
                    message: 'Subject does not exist',
                    fields: { code: 'subject_does_not_exist' },
                }),
            },
            notification: { notify: notified },
            metering: {
                bufferIncrementUsages: (actor: Actor, usages: UsageInput[]) => {
                    for (const usage of usages)
                        metered.push({
                            userUuid: actor.user?.uuid,
                            appUid: actor.app?.uid ?? null,
                            ...usage,
                        });
                },
                hasAnyUsageCached: async () => hasCredits,
            },
        } as never,
    );
    service.onDelivered = (envelope) => delivered.push(envelope);
    service.worker = {
        invoke: async (invocation: WorkerInvocation) => {
            invoked.push(invocation);
            return workerOutcome;
        },
    };
});

afterEach(() => {
    vi.useRealTimers();
});

describe('a delivery owed to exactly one consumer', () => {
    it('goes to the connected socket, and not to the handler as well', async () => {
        const row = await register();

        await dispatch();

        expect(invoked).toEqual([]);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            subId: row.subId,
            ackRequired: true,
            event: { op: 'write' },
        });
        expect(sent[0].ackId).toEqual(expect.any(String));
        expect(delivered).toHaveLength(1);
    });

    it('stays owed until the client acks it', async () => {
        const row = await register();
        await dispatch();

        await expect(pending.depth(row.subId)).resolves.toBe(1);

        await service.ackDelivery(actorFor(), {
            subId: row.subId,
            id: sent[0].ackId,
        });

        await expect(pending.depth(row.subId)).resolves.toBe(0);
        // Nothing owed, nothing held.
        await expect(keysOf(row.subId)).resolves.toEqual([]);
    });

    it('takes a second ack for the same delivery as nothing to do', async () => {
        const row = await register();
        await dispatch();
        const ack = { subId: row.subId, id: sent[0].ackId };

        await service.ackDelivery(actorFor(), ack);
        await expect(
            service.ackDelivery(actorFor(), ack),
        ).resolves.toBeUndefined();
    });

    it('refuses to settle a delivery for a subscription someone else holds', async () => {
        const row = await register();
        await dispatch();
        const ack = { subId: row.subId, id: sent[0].ackId };

        await expect(
            service.ackDelivery(actorFor(userId + 1), ack),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subscription_does_not_exist',
        });

        // Untouched: the real holder can still take it.
        await expect(pending.depth(row.subId)).resolves.toBe(1);
        await service.ackDelivery(actorFor(), ack);
        await expect(pending.depth(row.subId)).resolves.toBe(0);
    });

    it('hands the next one over as soon as the last is settled', async () => {
        const row = await register();
        await dispatch(entry({ uid: `file-a-${seq}` }));
        await dispatch(entry({ uid: `file-b-${seq}` }));

        // One at a time: the second waits on the first being taken.
        expect(sent).toHaveLength(1);

        await service.ackDelivery(actorFor(), {
            subId: row.subId,
            id: sent[0].ackId,
        });

        expect(sent).toHaveLength(2);
        expect(sent[1].event.id).not.toBe(sent[0].event.id);
    });

    it('tries the socket twice, then hands it to the handler', async () => {
        const row = await register();
        await dispatch();
        expect(sent).toHaveLength(1);

        // First lease lapses with no ack: a second socket attempt, which is
        // what a reconnected client is worth.
        jump(61_000);
        await service.sweepPending();
        expect(sent).toHaveLength(2);
        expect(invoked).toEqual([]);

        // Second lapses too. Sockets are spent, so the handler takes it.
        workerOutcome = 'settled';
        jump(61_000);
        await service.sweepPending();
        expect(sent).toHaveLength(2);
        expect(invoked).toHaveLength(1);
        expect(invoked[0]).toMatchObject({
            subId: row.subId,
            handlerName: 'onWrite',
            holderUserId: userId,
        });
        // Three attempts at the one event it was never acked for — not three
        // bills. A retry after a lease expiry is not a new delivery.
        expect(metered).toHaveLength(1);
    });

    it('bills a retried delivery once, however many attempts an outage costs', async () => {
        socketConnected = false;
        const row = await register({ targets: ['worker'] });
        await dispatch();

        expect(invoked).toHaveLength(1);
        // Unreachable so far: nothing settled, so nothing is billed yet.
        expect(metered).toEqual([]);

        // The handler keeps failing to settle it: every retry is the same
        // owed event, so none of these further attempts bills anything.
        for (let i = 0; i < 4; i++) {
            jump(61_000);
            await service.sweepPending();
        }
        expect(invoked).toHaveLength(5);
        expect(metered).toEqual([]);

        // It finally lands. One bill for the one event actually delivered.
        workerOutcome = 'settled';
        jump(61_000);
        await service.sweepPending();

        expect(invoked).toHaveLength(6);
        expect(metered).toHaveLength(1);
        await expect(pending.depth(row.subId)).resolves.toBe(0);
    });

    it('does not bill or report a retriable or terminal handler outcome', async () => {
        socketConnected = false;
        workerOutcome = 'retriable';
        const row = await register({ targets: ['worker'] });

        await dispatch();

        expect(invoked).toHaveLength(1);
        expect(metered).toEqual([]);
        expect(delivered).toEqual([]);
        await expect(pending.depth(row.subId)).resolves.toBe(1);

        workerOutcome = 'terminal';
        jump(deliveryBackoffMs(1) + 1);
        await service.sweepPending();

        // Discarded with a gap marker rather than delivered — still no bill.
        expect(metered).toEqual([]);
        expect(delivered).toEqual([]);
    });

    it('resumes a socket-only account row once its client reconnects, rather than wedging forever', async () => {
        const row = await register({ appUid: null, targets: ['socket'] });
        await dispatch();
        expect(sent).toHaveLength(1);

        // A second attempt while still connected spends the whole budget —
        // there is no worker to fall back to on this row.
        jump(61_000);
        await service.sweepPending();
        expect(sent).toHaveLength(2);

        // Gone by the next attempt: with the budget spent and nothing else to
        // try, this used to stay wedged even once the client came back.
        socketConnected = false;
        jump(61_000);
        await service.sweepPending();
        expect(sent).toHaveLength(2);
        await expect(pending.depth(row.subId)).resolves.toBe(1);

        socketConnected = true;
        jump(61_000);
        await service.sweepPending();
        expect(sent).toHaveLength(3);

        await service.ackDelivery(actorFor(), {
            subId: row.subId,
            id: sent[2].ackId,
        });
        await expect(pending.depth(row.subId)).resolves.toBe(0);
    });

    it('does not skip a remote candidate when the local socket disappears between attempts', async () => {
        const regions = ['east', 'west'];
        candidateRegionImpl = async (_holderUserId, _appUid, attempt) =>
            regions[attempt] ?? null;
        await register({ targets: ['socket', 'worker'] });

        await dispatch();
        // The local socket takes the first attempt; no remote candidate is
        // spent on a first attempt that had somewhere to go.
        expect(sent).toHaveLength(1);
        expect(candidateRegionCalls).toEqual([]);

        // The local socket is gone by the next attempt.
        socketConnected = false;
        jump(61_000);
        await service.sweepPending();

        // The first remote candidate, not the second — nothing was actually
        // spent on a remote region before this.
        expect(candidateRegionCalls).toEqual([0]);
    });

    it('goes straight to the handler when nothing is connected', async () => {
        socketConnected = false;
        const row = await register();

        await dispatch();

        expect(sent).toEqual([]);
        expect(invoked).toHaveLength(1);
        // Not taken yet, so still owed.
        await expect(pending.depth(row.subId)).resolves.toBe(1);
    });

    it('settles the delivery once the handler reports it took it', async () => {
        socketConnected = false;
        workerOutcome = 'settled';
        const row = await register();

        await dispatch();

        expect(invoked).toHaveLength(1);
        await expect(pending.depth(row.subId)).resolves.toBe(0);
        await expect(keysOf(row.subId)).resolves.toEqual([]);
    });

    it('is never delivered as a broadcast copy as well', async () => {
        await register();

        await dispatch();
        await new Promise((resolve) =>
            setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
        );

        expect(sent).toHaveLength(1);
        expect(sent[0].ackRequired).toBe(true);
    });

    it('does not clear a run of handler failures when a socket ack settles a later delivery', async () => {
        socketConnected = false;
        workerOutcome = 'retriable';
        const row = await register();

        // Nothing is connected, so this one goes to the handler and fails.
        await dispatch();
        expect(invoked).toHaveLength(1);
        await expect(redis.get(`ev:qf:{${row.subId}}`)).resolves.toBe('1');

        // The client reconnects before the backoff clears; the retry finds a
        // socket this time and is acked there rather than run again.
        socketConnected = true;
        jump(deliveryBackoffMs(1) + 1);
        await service.sweepPending();
        expect(sent).toHaveLength(1);

        await service.ackDelivery(actorFor(), {
            subId: row.subId,
            id: sent[0].ackId,
        });

        await expect(pending.depth(row.subId)).resolves.toBe(0);
        // A socket taking a delivery is not the handler answering: the strike
        // the handler earned earlier stands.
        await expect(redis.get(`ev:qf:{${row.subId}}`)).resolves.toBe('1');
    });

    it('does not hand out the next delivery when an ack lands on a suspended row', async () => {
        const row = await register();
        await dispatch(entry({ uid: `file-a-${seq}` }));
        await dispatch(entry({ uid: `file-b-${seq}` }));
        expect(sent).toHaveLength(1);

        // Suspended between the first delivery and its ack — a settle hook
        // mid-flight, not a fresh dispatch decision.
        rows.set(row.subId, {
            ...row,
            suspendedAt: Math.floor(Date.now() / 1000),
            suspendedReason: 'failures',
        });

        await service.ackDelivery(actorFor(), {
            subId: row.subId,
            id: sent[0].ackId,
        });

        // The ack itself still settles; what it must not do is hand the next
        // owed delivery out to a subscription that is no longer in service.
        expect(sent).toHaveLength(1);
        await expect(pending.depth(row.subId)).resolves.toBe(1);
    });
});

describe('a delivery everyone connected gets', () => {
    it('runs the handler once, alongside the socket copy', async () => {
        const row = await register({ delivery: 'broadcast' });

        await dispatch();
        await flushed();

        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ subId: row.subId });
        expect(sent[0].ackRequired).toBeUndefined();
        expect(invoked).toHaveLength(1);
        expect(invoked[0]).toMatchObject({ subId: row.subId });
        // One delivery is one line, however many transports carried it.
        expect(delivered).toHaveLength(1);
    });

    it('runs the handler once per delivery, not once per transport', async () => {
        workerOutcome = 'settled';
        await register({ delivery: 'broadcast', targets: ['worker'] });

        await dispatch();
        await vi.waitFor(() => expect(invoked.length).toBe(1), {
            timeout: EVENTS_COALESCE_WINDOW_MS * 12,
            interval: 25,
        });

        expect(sent).toEqual([]);
        expect(delivered).toHaveLength(1);
    });

    it('delivers and meters nothing when nothing can carry it', async () => {
        await register({ delivery: 'broadcast', targets: ['push'] });

        await dispatch();
        await new Promise((resolve) =>
            setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
        );

        expect(sent).toEqual([]);
        expect(invoked).toEqual([]);
        expect(delivered).toEqual([]);
    });
});

/** No alarm text may name the storage this runs on — see AGENTS.md. */
const noInfraWording = (): RegExp =>
    /^(?!.*\b(redis|elasticache|dynamo|dynamodb|aws|memcached)\b).*$/is;

describe('when a delivery cannot be held', () => {
    it('does not fail the write, and does not let the loss pass quietly', async () => {
        await register();
        vi.spyOn(pending, 'enqueue').mockRejectedValue(
            new Error('the cache is unreachable'),
        );

        await expect(dispatch()).resolves.toBeUndefined();

        expect(sent).toEqual([]);
        expect(alarms).toHaveBeenCalledWith(
            'events_pending_enqueue_failed',
            expect.stringMatching(noInfraWording()),
            expect.objectContaining({ subId: expect.any(String) }),
            'warning',
            { dedup: true },
        );
    });

    it('sheds the oldest and alarms when the region is holding too much', async () => {
        const row = await register();
        await redis.incrby('ev:qc', EVENTS_REGION_PENDING_CEILING);

        await dispatch();

        expect(alarms).toHaveBeenCalledWith(
            'events_pending_ceiling',
            expect.stringMatching(noInfraWording()),
            expect.objectContaining({ subId: row.subId }),
            'warning',
            { dedup: true },
        );
        // What it shed, it was told about: the marker took the delivery's place.
        expect(sent).toHaveLength(1);
        expect(sent[0].event).toMatchObject({
            op: 'gap',
            reason: 'backlog_overflow',
        });
    });
});

describe('giving up a subscription', () => {
    it('drops what it was owed, and corrects the region counter', async () => {
        socketConnected = false;
        const row = await register();
        await dispatch();
        await expect(pending.regionDepth()).resolves.toBe(1);

        await service.unsubscribeDurable(actorFor(), { subId: row.subId });

        await expect(pending.depth(row.subId)).resolves.toBe(0);
        await expect(pending.regionDepth()).resolves.toBe(0);
        await expect(keysOf(row.subId)).resolves.toEqual([]);
    });
});

describe('keeping the region counter honest', () => {
    it('self-heals a drifted counter on the periodic sweep', async () => {
        socketConnected = false;
        await register();
        await dispatch();
        // Drift: as if a settle's decrement had been lost somewhere else.
        await redis.incrby('ev:qc', 41);
        await expect(pending.regionDepth()).resolves.toBe(42);

        await service.sweepPending();

        await expect(pending.regionDepth()).resolves.toBe(1);
    });
});

describe('the sweeper does not let one stuck backlog starve another', () => {
    it('still sweeps a fresh delivery behind 100+ blocked subscriptions', async () => {
        workerOutcome = 'settled';
        const rawEvent = (id: string) => ({
            id,
            subject: 'fs:/nowhere',
            op: 'write' as const,
            uid: id,
            path: `/nowhere/${id}`,
            self: true,
            ts: Date.now(),
            seq: 0,
        });

        for (let i = 0; i < 100; i++) {
            const row = await register({
                subId: `blocked-${i}`,
                targets: ['worker'],
            });
            await pending.enqueue(row.subId, rawEvent(`blocked-${i}`));
            // Already in flight for the whole pass — a subscription in retry
            // backoff answers `claim()` the same way.
            await pending.claim(row.subId, { leaseMs: 10 * 60_000 });
        }

        const fresh = await register({ subId: 'fresh', targets: ['worker'] });
        await pending.enqueue(fresh.subId, rawEvent('fresh'));

        // One pass only ever reaches the 100 blocked subscriptions ahead of
        // it in the index; the second is what proves they no longer pin the
        // head against everything behind them.
        await service.sweepPending();
        await service.sweepPending();

        await expect(pending.depth(fresh.subId)).resolves.toBe(0);
        expect(invoked.some((call) => call.subId === fresh.subId)).toBe(true);
    });
});

describe('the sweep order a busy subscription holds', () => {
    it('is untouched by a publish, and only moved by a sweep pass', async () => {
        workerOutcome = 'deferred';
        const row = await register({ targets: ['worker'] });

        await dispatch(entry({ uid: `file-a-${seq}` }));
        // Held in flight: the worker never settled it, so the lease stands.
        expect(invoked).toHaveLength(1);

        const heldAt = await redis.zscore('ev:qx', row.subId);
        expect(heldAt).not.toBeNull();

        jump(1_000);
        await dispatch(entry({ uid: `file-b-${seq}` }));

        // Publishing to a busy subscription must not push it later in the
        // sweep order — only the sweeper may send a busy entry to the back of
        // its own line. Not an equality: an append re-points the index at the
        // oldest delivery still owed, which is the entry already in flight, so
        // the score may come back *earlier* than the claim left it. That can
        // only bring the sweep forward, never starve anything behind it.
        const afterPublish = await redis.zscore('ev:qx', row.subId);
        expect(Number(afterPublish)).toBeLessThanOrEqual(Number(heldAt));

        jump(1_000);
        await service.sweepPending();

        // A sweep pass over that same busy subscription is what may move it,
        // and it moves it back — behind everything else already waiting.
        const afterSweep = await redis.zscore('ev:qx', row.subId);
        expect(Number(afterSweep)).toBeGreaterThan(Number(afterPublish));
    });
});

describe('what a delivery costs its holder', () => {
    it('bills a `single` at its own rate, to the account whose row it is', async () => {
        const appUid = `app-${seq}`;
        await register({ appUid });

        await dispatch();

        expect(delivered).toHaveLength(1);
        expect(metered).toEqual([
            {
                userUuid: `user-${userId}`,
                appUid,
                usageType: 'events:delivery:single',
                usageAmount: 1,
                costOverride: EVENTS_COSTS['events:delivery:single'],
            },
        ]);
    });

    it('bills a handler run once, and only when one actually ran', async () => {
        socketConnected = false;
        workerOutcome = 'settled';
        await register();

        await dispatch();

        expect(invoked).toHaveLength(1);
        expect(metered).toHaveLength(1);
    });

    it('stops handing out, suspends and tells the holder when the balance is gone', async () => {
        const row = await register();
        hasCredits = false;

        await dispatch();

        expect(sent).toEqual([]);
        expect(invoked).toEqual([]);
        expect(metered).toEqual([]);
        expect(rows.get(row.subId)).toMatchObject({
            suspendedReason: 'no_credit',
        });
        expect(notified).toHaveBeenCalledWith(
            [userId],
            expect.objectContaining({ reason: 'no_credit' }),
            expect.objectContaining({ type: 'app.events.ended' }),
        );
        // The event itself is held rather than dropped: the suspension's own
        // window is what decides how long it survives.
        await expect(pending.depth(row.subId)).resolves.toBe(1);
    });
});

describe('the budgets a `single` is delivered under', () => {
    it('stands a gap marker in for an event past the per-minute budget', async () => {
        const row = await register({ targets: ['socket'] });

        // One consumer holds one lease at a time, so this is the client loop:
        // take the delivery, ack it, and let the next one out.
        for (let i = 0; i <= EVENTS_SINGLE_DELIVERY_LIMIT.limit; i++) {
            await dispatch(entry({ uid: `file-${seq}-${i}` }));
            const last = sent[sent.length - 1];
            if (last?.ackId)
                await service.ackDelivery(actorFor(), {
                    subId: row.subId,
                    id: last.ackId,
                });
        }

        const ops = sent.map((envelope) => envelope.event.op);
        expect(ops.filter((op) => op !== 'gap')).toHaveLength(
            EVENTS_SINGLE_DELIVERY_LIMIT.limit,
        );
        expect(sent[sent.length - 1].event).toMatchObject({
            op: 'gap',
            reason: 'delivery_rate_limit',
        });
        // A marker is not a delivery, so the last one is not billed.
        expect(metered).toHaveLength(EVENTS_SINGLE_DELIVERY_LIMIT.limit);
    });

    it('holds a delivery whose app has spent its invocations, without failing it', async () => {
        socketConnected = false;
        workerOutcome = 'settled';
        const appUid = `app-${seq}`;
        const row = await register({ appUid, targets: ['worker'] });

        for (let i = 0; i <= EVENTS_WORKER_INVOCATION_LIMIT.limit; i++)
            await dispatch(entry({ uid: `file-${seq}-${i}` }));

        expect(invoked).toHaveLength(EVENTS_WORKER_INVOCATION_LIMIT.limit);
        // Nothing ran for the last one, so nothing was delivered or billed —
        // and it is still owed rather than failed.
        expect(metered).toHaveLength(EVENTS_WORKER_INVOCATION_LIMIT.limit);
        await expect(pending.depth(row.subId)).resolves.toBe(1);
    });
});
