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
    EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION,
    EVENTS_REGION_PENDING_CEILING,
    EVENTS_RETRY_BASE_MS,
    EVENTS_RETRY_MAX_MS,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import type { ProjectedEvent } from '../../services/events/registry.js';
import type { IConfig } from '../../types.js';
import {
    PendingDeliveryStore,
    RECONCILE_INTERVAL_SECONDS,
    RECONCILE_SCAN_CAP,
} from './PendingDeliveryStore.js';

/**
 * What a subscription is owed, and what holding it costs. Two claims run
 * through everything here: a delivery is never lost quietly — a drop is a gap
 * marker the subscriber receives — and a subscription that is keeping up owns
 * nothing at all.
 */

// The keyspace is shared per process, so each test gets its own subscription
// and the region-wide keys are cleared between them.
let seq = 0;
let subId = '';
let redis: InstanceType<typeof MockRedis.Cluster>;
let store: PendingDeliveryStore;
let commands: string[];

const INDEX_KEY = 'ev:qx';
const COUNTER_KEY = 'ev:qc';
const RECONCILE_CLAIM_KEY = 'ev:qxr';

const entriesKey = (id = subId): string => `ev:q:{${id}}`;
const pendingKey = (id = subId): string => `ev:qp:{${id}}`;
const holdKey = (id = subId): string => `ev:qt:{${id}}`;

/** Every command that crossed the client, so a test can say what was not. */
const recordingRedis = (
    inner: InstanceType<typeof MockRedis.Cluster>,
): InstanceType<typeof MockRedis.Cluster> =>
    new Proxy(inner, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || typeof value !== 'function')
                return value;
            return (...args: unknown[]) => {
                commands.push(property);
                return (value as (...a: unknown[]) => unknown).apply(
                    target,
                    args,
                );
            };
        },
    }) as InstanceType<typeof MockRedis.Cluster>;

const event = (id: string): ProjectedEvent => ({
    id,
    subject: 'fs:/u/Documents',
    op: 'write',
    uid: `uid-${id}`,
    path: `/u/Documents/${id}.txt`,
    self: true,
    ts: Date.now(),
    seq: 0,
});

/** Keys this subscription owns right now, whatever their type. */
const keysOf = async (id = subId): Promise<string[]> =>
    (await redis.keys('*')).filter((key: string) => key.includes(id));

/**
 * Put a backlog in place without paying for it one delivery at a time. The caps
 * are the point of these tests, not the path that fills them.
 */
const seedBacklog = async (id: string, count: number): Promise<void> => {
    const scored: Array<string | number> = [];
    const fields: string[] = [];
    const base = Date.now() - count;
    for (let i = 0; i < count; i++) {
        const entryId = `${base + i}-seed${i}`;
        scored.push(base + i, entryId);
        fields.push(
            entryId,
            JSON.stringify({ event: event(`seed-${i}`), socketAttempts: 0 }),
        );
    }
    await redis.zadd(pendingKey(id), ...scored);
    await redis.hset(entriesKey(id), ...fields);
    await redis.zadd(INDEX_KEY, base, id);
    await redis.incrby(COUNTER_KEY, count);
};

const pendingEvents = async (id = subId): Promise<ProjectedEvent[]> => {
    const held = await redis.hvals(entriesKey(id));
    return held.map(
        (raw: string) => (JSON.parse(raw) as { event: ProjectedEvent }).event,
    );
};

beforeEach(async () => {
    seq++;
    subId = `app-x#sub-${seq}`;
    commands = [];
    redis = recordingRedis(new MockRedis.Cluster(['redis://localhost:7001']));
    await redis.del(INDEX_KEY, COUNTER_KEY, RECONCILE_CLAIM_KEY);
    store = new PendingDeliveryStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );
});

afterEach(() => {
    vi.useRealTimers();
});

describe('what a subscription owns', () => {
    it('owns nothing until it is owed something', async () => {
        await expect(keysOf()).resolves.toEqual([]);
        await expect(store.depth(subId)).resolves.toBe(0);

        await store.enqueue(subId, event('a'));

        expect(await keysOf()).not.toEqual([]);
        await expect(store.depth(subId)).resolves.toBe(1);
    });

    it('owns nothing again once the last delivery settles', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));

        await expect(store.settle(subId, entryId)).resolves.toBe(true);

        await expect(keysOf()).resolves.toEqual([]);
        await expect(store.head(10)).resolves.toEqual([]);
        await expect(store.regionDepth()).resolves.toBe(0);
    });
});

describe('handing a delivery out', () => {
    it('hands out the oldest first, and only one at a time', async () => {
        const first = await store.enqueue(subId, event('a'));
        await store.enqueue(subId, event('b'));

        const claimed = await store.claim(subId);
        expect(claimed?.entryId).toBe(first.entryId);
        expect(claimed?.event.id).toBe('a');

        // The second is owed, but nothing else may take it while the first is
        // out — `single` promises one consumer per event.
        await expect(store.claim(subId)).resolves.toBeNull();

        await store.settle(subId, first.entryId);
        await expect(store.claim(subId)).resolves.toMatchObject({
            event: { id: 'b' },
        });
    });

    it('counts the socket attempts a delivery has spent', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.claim(subId, { leaseMs: 1 });

        await expect(store.recordSocketAttempt(subId, entryId)).resolves.toBe(
            1,
        );

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 1_000);
        await expect(store.claim(subId)).resolves.toMatchObject({
            entryId,
            socketAttempts: 1,
        });
    });

    it('counts remote candidates separately from socket attempts', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.claim(subId, { leaseMs: 1 });

        await store.recordSocketAttempt(subId, entryId);
        await expect(
            store.recordRemoteAttempt(subId, entryId),
        ).resolves.toBe(1);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 1_000);
        await expect(store.claim(subId)).resolves.toMatchObject({
            entryId,
            socketAttempts: 1,
            remoteAttempts: 1,
        });
    });

    it('gives a delivery a fresh attempt budget on request', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.claim(subId, { leaseMs: 1 });
        await store.recordSocketAttempt(subId, entryId);
        await store.recordRemoteAttempt(subId, entryId);

        await store.resetSocketAttempts(subId, entryId);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 1_000);
        await expect(store.claim(subId)).resolves.toMatchObject({
            entryId,
            socketAttempts: 0,
            remoteAttempts: 0,
        });
    });

    it('offers a delivery again once its lease lapses', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        expect(await store.claim(subId, { leaseMs: 30_000 })).not.toBeNull();
        await expect(store.claim(subId)).resolves.toBeNull();

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 31_000);

        await expect(store.claim(subId)).resolves.toMatchObject({ entryId });
    });

    it('settles once, and treats a second ack as nothing to do', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.claim(subId);

        await expect(store.settle(subId, entryId)).resolves.toBe(true);
        await expect(store.settle(subId, entryId)).resolves.toBe(false);
    });
});

describe('when a handler could not take it', () => {
    it('holds the delivery longer after each failed attempt', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.claim(subId);

        await expect(store.deferAfterFailure(subId, entryId)).resolves.toEqual({
            attempts: 1,
            retryInMs: EVENTS_RETRY_BASE_MS,
        });
        // Held: nothing may take it while the wait stands.
        await expect(store.claim(subId)).resolves.toBeNull();

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + EVENTS_RETRY_BASE_MS + 1);
        await expect(store.claim(subId)).resolves.toMatchObject({ entryId });

        await expect(store.deferAfterFailure(subId, entryId)).resolves.toEqual({
            attempts: 2,
            retryInMs: EVENTS_RETRY_BASE_MS * 2,
        });
    });

    it('never waits longer than the cap, however many have failed', async () => {
        expect(deliveryBackoffMs(1)).toBe(EVENTS_RETRY_BASE_MS);
        expect(deliveryBackoffMs(50)).toBe(EVENTS_RETRY_MAX_MS);
    });

    it('drops a refused delivery and leaves a marker naming why', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));

        await expect(
            store.discard(subId, entryId, 'handler_rejected'),
        ).resolves.toBe(true);

        const held = await pendingEvents();
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({
            op: 'gap',
            reason: 'handler_rejected',
            subject: 'fs:/u/Documents',
        });
        // A delivery that is already gone is not dropped twice.
        await expect(
            store.discard(subId, entryId, 'handler_rejected'),
        ).resolves.toBe(false);
    });

    it('counts failures in a row, and forgets them when one lands', async () => {
        await expect(store.recordFailure(subId)).resolves.toBe(1);
        await expect(store.recordFailure(subId)).resolves.toBe(2);

        await store.clearFailures(subId);

        await expect(store.recordFailure(subId)).resolves.toBe(1);
    });

    it('takes the failure count with the subscription it belongs to', async () => {
        await store.enqueue(subId, event('a'));
        await store.recordFailure(subId);

        await store.purge(subId);

        await expect(keysOf()).resolves.toEqual([]);
    });
});

describe('when there is more than can be held', () => {
    it('drops the oldest of one backlog and leaves one marker', async () => {
        await seedBacklog(subId, EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION);

        const { shed } = await store.enqueue(subId, event('newest'));

        expect(shed).toEqual([{ subId, dropped: 2, scope: 'subscription' }]);
        await expect(store.depth(subId)).resolves.toBe(
            EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION,
        );

        const held = await pendingEvents();
        const markers = held.filter((held) => held.op === 'gap');
        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({
            op: 'gap',
            reason: 'backlog_overflow',
            subject: 'fs:/u/Documents',
        });
        // The oldest went, the newest stayed.
        expect(held.some((event) => event.id === 'seed-0')).toBe(false);
        expect(held.some((event) => event.id === 'newest')).toBe(true);
    });

    it('sheds the region`s oldest backlog first, and says which', async () => {
        const older = `app-x#older-${seq}`;
        await seedBacklog(older, 4);
        // Two over the ceiling once this enqueue lands. Getting back under it
        // takes three, because the marker left behind holds a place too — and
        // the shed stops inside the oldest backlog, never reaching the newest.
        await redis.incrby(COUNTER_KEY, EVENTS_REGION_PENDING_CEILING - 3);

        const { shed } = await store.enqueue(subId, event('a'));

        expect(shed).toEqual([{ subId: older, dropped: 3, scope: 'region' }]);
        // What it lost, it was told about.
        const marked = await pendingEvents(older);
        expect(marked.filter((event) => event.op === 'gap')).toHaveLength(1);
        // What it did not lose is still owed; the newest end survives a shed.
        expect(marked.some((event) => event.id === 'seed-3')).toBe(true);
        expect(marked.some((event) => event.id === 'seed-2')).toBe(false);
        await expect(store.depth(subId)).resolves.toBe(1);
        // The region actually got back under, marker included.
        await expect(store.regionDepth()).resolves.toBe(
            EVENTS_REGION_PENDING_CEILING,
        );
    });
});

describe('sharing the sweeper between backlogs', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('hands the head to exactly one of two concurrent claimers', async () => {
        await store.enqueue(subId, event('a'));

        const claims = await Promise.all([
            store.claim(subId),
            store.claim(subId),
        ]);

        expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it('moves a claimed subscription behind the ones still waiting', async () => {
        const other = `app-x#other-${seq}`;
        vi.setSystemTime(1_000_000);
        await store.enqueue(subId, event('first'));
        vi.setSystemTime(1_001_000);
        await store.enqueue(other, event('second'));
        expect((await store.head(2)).map((h) => h.subId)).toEqual([
            subId,
            other,
        ]);

        vi.setSystemTime(1_002_000);
        await store.claim(subId);

        expect((await store.head(2)).map((h) => h.subId)).toEqual([
            other,
            subId,
        ]);
    });

    it('defers a subscription behind the others, holdings untouched', async () => {
        const other = `app-x#other-${seq}`;
        vi.setSystemTime(1_000_000);
        await store.enqueue(subId, event('first'));
        vi.setSystemTime(1_001_000);
        await store.enqueue(other, event('second'));

        vi.setSystemTime(1_002_000);
        await store.defer(subId);

        expect((await store.head(2)).map((h) => h.subId)).toEqual([
            other,
            subId,
        ]);
        await expect(store.depth(subId)).resolves.toBe(1);
    });

    it('puts a lifetime on a backlog`s keys', async () => {
        await store.enqueue(subId, event('a'));

        await expect(redis.ttl(pendingKey())).resolves.toBeGreaterThan(0);
        await expect(redis.ttl(entriesKey())).resolves.toBeGreaterThan(0);
    });
});

describe('holding a suspended backlog down', () => {
    it('puts a lifetime on the hold key itself', async () => {
        await store.enqueue(subId, event('a'));

        await store.hold(subId, 100, 1_000);

        await expect(redis.ttl(holdKey())).resolves.toBeGreaterThan(0);
    });

    it('drops the hold key once the backlog it was guarding drains', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.hold(subId, 100, 1_000);

        await store.settle(subId, entryId);

        await expect(redis.exists(holdKey())).resolves.toBe(0);
    });
});

describe('finding the work', () => {
    it('reads the oldest end of the index rather than the keyspace', async () => {
        const older = `app-x#older-${seq}`;
        await seedBacklog(older, 2);
        await store.enqueue(subId, event('a'));

        commands = [];
        const head = await store.head(10);

        expect(head.map((entry) => entry.subId)).toEqual([older, subId]);
        expect(head[0].oldestAt).toBeLessThan(head[1].oldestAt);
        expect(
            commands.filter((command) =>
                ['scan', 'keys', 'hscan', 'sscan', 'zscan'].includes(command),
            ),
        ).toEqual([]);
    });

    it('never scans the keyspace, whatever it is asked to do', async () => {
        const { entryId } = await store.enqueue(subId, event('a'));
        await store.claim(subId);
        await store.recordSocketAttempt(subId, entryId);
        await store.settle(subId, entryId);
        await store.enqueue(subId, event('b'));
        await store.purge(subId);
        await store.regionDepth();

        expect(
            commands.filter((command) =>
                ['scan', 'keys', 'hscan', 'sscan', 'zscan'].includes(command),
            ),
        ).toEqual([]);
    });
});

describe('surviving a crash between the write and the reindex', () => {
    it('keeps a first entry discoverable even if the follow-up reindex never runs', async () => {
        // The counter write is the first command after the entry's own
        // transaction lands — exactly where a crash would fall between the
        // entry existing and the follow-up reindex.
        vi.spyOn(redis, 'incrby').mockRejectedValueOnce(
            new Error('connection lost'),
        );

        await expect(store.enqueue(subId, event('a'))).rejects.toThrow();
        vi.restoreAllMocks();

        // The crash was after the index write, not before it: the sweeper
        // still finds this subscription, and the entry is still claimable.
        await expect(store.head(10)).resolves.toEqual([
            { subId, oldestAt: expect.any(Number) },
        ]);
        await expect(store.claim(subId)).resolves.toMatchObject({
            event: { id: 'a' },
        });
    });
});

describe('keeping the region counter honest', () => {
    it('corrects an inflated counter back to what is actually held', async () => {
        await store.enqueue(subId, event('a'));
        // Drift: some decrement that should have landed did not.
        await redis.incrby(COUNTER_KEY, 500);

        await expect(store.reconcileRegionDepth()).resolves.toBe(1);
        await expect(store.regionDepth()).resolves.toBe(1);
    });

    it('corrects an undercounted or negative counter the same way', async () => {
        await store.enqueue(subId, event('a'));
        await redis.set(COUNTER_KEY, -50);

        await expect(store.reconcileRegionDepth()).resolves.toBe(1);
        await expect(store.regionDepth()).resolves.toBe(1);
    });

    it('zeroes the counter when nothing is actually pending', async () => {
        await redis.incrby(COUNTER_KEY, 12);

        await expect(store.reconcileRegionDepth()).resolves.toBe(0);
        await expect(store.regionDepth()).resolves.toBe(0);
    });

    it('never scans the keyspace to do it', async () => {
        await store.enqueue(subId, event('a'));
        commands = [];

        await store.reconcileRegionDepth();

        expect(
            commands.filter((command) =>
                ['scan', 'keys', 'hscan', 'sscan', 'zscan'].includes(command),
            ),
        ).toEqual([]);
    });

    it('throttles a second pass inside the same interval, region-wide', async () => {
        await store.enqueue(subId, event('a'));
        await expect(store.reconcileRegionDepth()).resolves.toBe(1);

        // A drift a losing pass must not paper over by writing anyway.
        await redis.incrby(COUNTER_KEY, 500);
        await expect(store.reconcileRegionDepth()).resolves.toBe(501);
        await expect(store.regionDepth()).resolves.toBe(501);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + (RECONCILE_INTERVAL_SECONDS + 1) * 1000);

        await expect(store.reconcileRegionDepth()).resolves.toBe(1);
        await expect(store.regionDepth()).resolves.toBe(1);
    });

    it('leaves the counter alone when the scan is capped', async () => {
        const many: Array<string | number> = [];
        for (let i = 0; i < RECONCILE_SCAN_CAP + 1; i++)
            many.push(i, `fake-sub-${i}`);
        await redis.zadd(INDEX_KEY, ...many);
        await redis.set(COUNTER_KEY, 999);

        await store.reconcileRegionDepth();

        // Undercounts by construction; writing it would report the region as
        // far quieter than it actually is.
        await expect(store.regionDepth()).resolves.toBe(999);
    });
});

describe('giving up a backlog', () => {
    it('drops everything a subscription held and gives the room back', async () => {
        await store.enqueue(subId, event('a'));
        await store.enqueue(subId, event('b'));
        await expect(store.regionDepth()).resolves.toBe(2);

        await expect(store.purge(subId)).resolves.toBe(2);

        await expect(keysOf()).resolves.toEqual([]);
        await expect(store.regionDepth()).resolves.toBe(0);
        await expect(store.head(10)).resolves.toEqual([]);
    });
});
