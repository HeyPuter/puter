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

import { randomUUID } from 'node:crypto';
import {
    EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION,
    EVENTS_REGION_PENDING_CEILING,
} from '../../controllers/events/limits.js';
import type {
    DeliverableEvent,
    GapMarker,
} from '../../services/events/registry.js';
import { PuterStore } from '../types.js';

/**
 * Deliveries that are waiting for a consumer, in the region that emitted them.
 *
 * A `broadcast` delivery is gone the moment it is sent. A `single` one is owed
 * to exactly one consumer, so it has to survive until that consumer says it
 * took it — which is what everything here holds. Nothing is replicated: the
 * lease, the retry count and the queue belong to the region that emitted the
 * event, and the published promise is at-least-once **while that region is
 * available**.
 *
 * Three keys per subscription, all created on the first pending delivery and
 * all deleted the moment the last one settles — a subscription that is keeping
 * up owns nothing:
 *
 *     ev:q:{<subId>}    HASH  entryId -> the delivery and its attempt count
 *     ev:qp:{<subId>}   ZSET  entryId -> enqueued at; membership means unsettled
 *     ev:ql:{<subId>}   ZSET  entryId -> lease expiry; membership means in flight
 *
 * And two the region shares:
 *
 *     ev:qx             ZSET  subId -> oldest pending delivery, for the sweeper
 *     ev:qc             STR   how many deliveries the region is holding
 *
 * `ev:qx` is why nothing here ever scans the keyspace: the sweeper reads its
 * head to find the subscriptions that are behind, and a scan is exactly what
 * goes pathological when the system already is. The counter is what the region
 * ceiling is read from, and it moves only where the pending set does.
 *
 * The pending set, the lease and the attempt count are explicit rather than a
 * queue primitive's implicit ones: reclaiming an expired lease is then a score
 * comparison, and dropping a whole subscription is one delete.
 *
 * One delivery is in flight per subscription at a time. `single` promises one
 * consumer per event, and handing out the next while the last is unsettled
 * would make ordering — and the retry count that decides socket-versus-worker —
 * meaningless.
 */

// -- Keys -------------------------------------------------------------

const entriesKey = (subId: string): string => `ev:q:{${subId}}`;
const pendingKey = (subId: string): string => `ev:qp:{${subId}}`;
const leaseKey = (subId: string): string => `ev:ql:{${subId}}`;

const INDEX_KEY = 'ev:qx';
const COUNTER_KEY = 'ev:qc';

// -- Lease ------------------------------------------------------------

/**
 * How long a consumer has to settle a delivery before someone else may take it.
 * Long enough for a handler doing real work, short enough that a tab that
 * closed mid-delivery does not hold the queue.
 */
export const PENDING_LEASE_TTL_MS = 30_000;

/** Subscriptions one region-ceiling shed may take deliveries from. */
const REGION_SHED_SUBSCRIPTIONS = 32;

/** Deliveries one region-ceiling shed may drop, so a burst cannot stall here. */
const REGION_SHED_MAX_ENTRIES = 1_000;

/** Arguments one variadic command carries, so a large shed stays in batches. */
const COMMAND_BATCH = 500;

// -- Shapes -----------------------------------------------------------

/** One delivery, handed out under a lease. */
export interface ClaimedDelivery {
    entryId: string;
    event: DeliverableEvent;
    /** Socket attempts already spent, which is what decides the next one. */
    socketAttempts: number;
}

/** What one shed took, for the marker and the alarm that follow it. */
export interface PendingShed {
    subId: string;
    dropped: number;
    scope: 'subscription' | 'region';
}

/** A subscription with undelivered deliveries, oldest first. */
export interface PendingHead {
    subId: string;
    oldestAt: number;
}

interface StoredEntry {
    event: DeliverableEvent;
    socketAttempts: number;
}

const parseEntry = (raw: string | null): StoredEntry | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as StoredEntry;
        return parsed?.event ? parsed : null;
    } catch {
        return null;
    }
};

const gapMarker = (subject: string): GapMarker => ({
    id: randomUUID(),
    subject,
    op: 'gap',
    reason: 'backlog_overflow',
    ts: Date.now(),
});

/** `ZPOPMIN`/`ZRANGE … WITHSCORES` answer flat, and scores come back typed. */
const membersOf = (flat: readonly unknown[]): string[] => {
    const members: string[] = [];
    for (let i = 0; i < flat.length; i += 2) members.push(String(flat[i]));
    return members;
};

const batched = <T>(items: readonly T[]): T[][] => {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += COMMAND_BATCH)
        batches.push(items.slice(i, i + COMMAND_BATCH));
    return batches;
};

export class PendingDeliveryStore extends PuterStore {
    /** Tells this process's ids from a peer's, so two cannot mint the same. */
    readonly #minter = randomUUID().slice(0, 8);
    #minted = 0;

    // -- Writes ------------------------------------------------------

    /**
     * Hold one delivery until a consumer takes it. Returns what had to be shed
     * to make room — the subscription's own cap first, then the region's — so
     * the caller can say so out loud.
     */
    async enqueue(
        subId: string,
        event: DeliverableEvent,
    ): Promise<{ entryId: string; shed: PendingShed[] }> {
        const entryId = await this.#append(subId, event);

        const shed: PendingShed[] = [];
        const overflowed = await this.#capSubscription(subId);
        if (overflowed) shed.push(overflowed);
        shed.push(...(await this.#capRegion()));

        return { entryId, shed };
    }

    /**
     * Take the oldest delivery this subscription is owed, under a lease. Null
     * when one is already in flight or nothing is waiting; an expired lease
     * makes its delivery claimable again, which is the whole retry mechanism.
     */
    async claim(
        subId: string,
        options: { leaseMs?: number } = {},
    ): Promise<ClaimedDelivery | null> {
        const now = Date.now();

        const inFlight = await this.clients.redis.zrangebyscore(
            leaseKey(subId),
            now,
            '+inf',
            'LIMIT',
            0,
            1,
        );
        if (inFlight.length > 0) return null;

        const [entryId] = await this.clients.redis.zrange(
            pendingKey(subId),
            0,
            0,
        );
        if (!entryId) {
            // Nothing left, which is also how a drained subscription's keys go.
            await this.#reindex(subId);
            return null;
        }

        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        if (!entry) {
            await this.#settleEntry(subId, entryId);
            return null;
        }

        await this.clients.redis.zadd(
            leaseKey(subId),
            now + (options.leaseMs ?? PENDING_LEASE_TTL_MS),
            entryId,
        );
        return {
            entryId,
            event: entry.event,
            socketAttempts: entry.socketAttempts,
        };
    }

    /** Count one socket attempt against a claimed delivery. */
    async recordSocketAttempt(subId: string, entryId: string): Promise<number> {
        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        if (!entry) return 0;

        const socketAttempts = entry.socketAttempts + 1;
        await this.clients.redis.hset(
            entriesKey(subId),
            entryId,
            JSON.stringify({ ...entry, socketAttempts }),
        );
        return socketAttempts;
    }

    /**
     * Settle a delivery a consumer took. False for an id this subscription is
     * not holding — a second ack for one already settled, which at-least-once
     * makes routine and which nothing should treat as an error.
     */
    async settle(subId: string, entryId: string): Promise<boolean> {
        const removed = await this.clients.redis.zrem(
            pendingKey(subId),
            entryId,
        );
        if (Number(removed) !== 1) return false;

        await this.#forget(subId, [entryId]);
        await this.#reindex(subId);
        return true;
    }

    /** Drop everything a subscription is holding, for one that is going away. */
    async purge(subId: string): Promise<number> {
        const held = await this.depth(subId);
        await this.clients.redis.del(
            entriesKey(subId),
            pendingKey(subId),
            leaseKey(subId),
        );
        await this.clients.redis.zrem(INDEX_KEY, subId);
        if (held > 0) await this.clients.redis.decrby(COUNTER_KEY, held);
        return held;
    }

    // -- Reads -------------------------------------------------------

    /**
     * The subscriptions that have waited longest, oldest first. The sweeper's
     * whole input, and the backlog-age metric's.
     */
    async head(limit: number): Promise<PendingHead[]> {
        if (limit <= 0) return [];
        const flat = await this.clients.redis.zrange(
            INDEX_KEY,
            0,
            limit - 1,
            'WITHSCORES',
        );
        const heads: PendingHead[] = [];
        for (let i = 0; i < flat.length; i += 2)
            heads.push({
                subId: String(flat[i]),
                oldestAt: Number(flat[i + 1]) || 0,
            });
        return heads;
    }

    async depth(subId: string): Promise<number> {
        return Number(await this.clients.redis.zcard(pendingKey(subId))) || 0;
    }

    /** What the region is holding in total, and what its ceiling is read from. */
    async regionDepth(): Promise<number> {
        const raw = await this.clients.redis.get(COUNTER_KEY);
        const held = raw === null ? 0 : Number.parseInt(raw, 10);
        return Number.isFinite(held) && held > 0 ? held : 0;
    }

    /**
     * Recompute the region counter from the pending sets it is supposed to
     * total. The counter moves in a separate write from the removal it follows
     * (a settle's decrement, a shed's decrement-then-append), so a crash
     * between the two drifts it in either direction — silently undercounting
     * lets the ceiling never trip, silently overcounting trips it forever.
     * Cheap in the steady state the index is sized for: one read per
     * subscription that actually has a backlog, never the keyspace.
     */
    async reconcileRegionDepth(): Promise<number> {
        const subIds = await this.clients.redis.zrange(INDEX_KEY, 0, -1);

        let total = 0;
        for (const batch of batched(subIds)) {
            const read = this.clients.redis.pipeline();
            for (const subId of batch) read.zcard(pendingKey(subId));
            const results = (await read.exec()) ?? [];
            for (const [, count] of results) total += Number(count) || 0;
        }

        await this.clients.redis.set(COUNTER_KEY, total);
        return total;
    }

    // -- Internals ---------------------------------------------------

    /**
     * The id and the order of one delivery. Deliveries landing in the same
     * millisecond share a score, and a sorted set breaks that tie on the member
     * — so the counter is padded and comes first, and a queue keeps its order
     * under a burst instead of shuffling it.
     */
    #mintEntryId(at: number): string {
        const minted = String(++this.#minted).padStart(12, '0');
        return `${at}-${minted}-${this.#minter}`;
    }

    /**
     * Add one delivery without asking whether there is room for it.
     *
     * The index write goes in the same pipeline as the entry it describes —
     * `NX` so it never disturbs an existing (older) score — rather than waiting
     * for the follow-up `#reindex` below. A subscription's first pending entry
     * would otherwise be fully written and claimable, yet invisible to the
     * sweeper forever, if this process died in the gap between the two: `ev:qx`
     * is the only thing the sweeper ever reads, so an entry it does not know
     * about is never retried.
     */
    async #append(subId: string, event: DeliverableEvent): Promise<string> {
        const now = Date.now();
        const entryId = this.#mintEntryId(now);

        const write = this.clients.redis.pipeline();
        write.zadd(INDEX_KEY, 'NX', now, subId);
        write.hset(
            entriesKey(subId),
            entryId,
            JSON.stringify({ event, socketAttempts: 0 } satisfies StoredEntry),
        );
        write.zadd(pendingKey(subId), now, entryId);
        write.incrby(COUNTER_KEY, 1);
        await write.exec();

        await this.#reindex(subId);
        return entryId;
    }

    async #capSubscription(subId: string): Promise<PendingShed | null> {
        const held = await this.depth(subId);
        const over = held - EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION;
        if (over <= 0) return null;
        // One more than the overflow, because the marker that replaces them
        // takes a place of its own.
        return this.#shedOldest(subId, over + 1, 'subscription');
    }

    /**
     * Shed the region's oldest deliveries until it is back under the ceiling.
     * Oldest-first across subscriptions, because the index is already ordered
     * that way and a backlog nobody is draining is the one to lose.
     */
    async #capRegion(): Promise<PendingShed[]> {
        const held = await this.regionDepth();
        let over = Math.min(
            held - EVENTS_REGION_PENDING_CEILING,
            REGION_SHED_MAX_ENTRIES,
        );
        if (over <= 0) return [];

        const shed: PendingShed[] = [];
        for (const { subId } of await this.head(REGION_SHED_SUBSCRIPTIONS)) {
            if (over <= 0) break;
            const dropped = await this.#shedOldest(subId, over, 'region');
            if (!dropped) continue;
            over -= dropped.dropped;
            shed.push(dropped);
        }
        return shed;
    }

    /**
     * Drop a subscription's oldest deliveries and leave one gap marker in their
     * place — the marker is a delivery like any other, so it queues where they
     * were and reaches the subscriber the same way.
     */
    async #shedOldest(
        subId: string,
        count: number,
        scope: PendingShed['scope'],
    ): Promise<PendingShed | null> {
        const dropped = membersOf(
            await this.clients.redis.zpopmin(pendingKey(subId), count),
        );
        if (dropped.length === 0) return null;

        const subject = await this.#subjectOf(
            subId,
            dropped[dropped.length - 1],
        );
        await this.#forget(subId, dropped);
        await this.#append(subId, gapMarker(subject));

        return { subId, dropped: dropped.length, scope };
    }

    /** The subject a shed delivery carried, so its marker can name it. */
    async #subjectOf(subId: string, entryId: string): Promise<string> {
        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        return entry?.event.subject ?? '';
    }

    /** Settle one entry that is still in the pending set. */
    async #settleEntry(subId: string, entryId: string): Promise<void> {
        await this.clients.redis.zrem(pendingKey(subId), entryId);
        await this.#forget(subId, [entryId]);
        await this.#reindex(subId);
    }

    /** Forget entries already out of the pending set, and the space they held. */
    async #forget(subId: string, entryIds: readonly string[]): Promise<void> {
        if (entryIds.length === 0) return;
        for (const batch of batched(entryIds)) {
            const drop = this.clients.redis.pipeline();
            drop.hdel(entriesKey(subId), ...batch);
            drop.zrem(leaseKey(subId), ...batch);
            await drop.exec();
        }
        await this.clients.redis.decrby(COUNTER_KEY, entryIds.length);
    }

    /**
     * Point the sweeper's index at this subscription's oldest delivery, or take
     * the subscription out of the region entirely once it has none — which is
     * where every key it owned goes.
     */
    async #reindex(subId: string): Promise<void> {
        const [entryId, oldestAt] = await this.clients.redis.zrange(
            pendingKey(subId),
            0,
            0,
            'WITHSCORES',
        );
        if (!entryId) {
            await this.clients.redis.del(
                entriesKey(subId),
                pendingKey(subId),
                leaseKey(subId),
            );
            await this.clients.redis.zrem(INDEX_KEY, subId);
            return;
        }
        await this.clients.redis.zadd(INDEX_KEY, Number(oldestAt) || 0, subId);
    }
}
