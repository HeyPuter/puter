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
import { EVENTS_INVOKE_TIMEOUT_MS } from '../../clients/events/EventsWorkerInvokerClient.js';
import {
    EVENTS_FAILURE_COUNTER_TTL_MS,
    EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION,
    EVENTS_REGION_PENDING_CEILING,
    deliveryBackoffMs,
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
 *     ev:q:{<subId>}    HASH  entryId -> the delivery, its attempt counts and billed flag
 *     ev:qp:{<subId>}   ZSET  entryId -> enqueued at; membership means unsettled
 *     ev:ql:{<subId>}   ZSET  entryId -> lease expiry; membership means in flight
 *     ev:qf:{<subId>}   STR   handler failures in a row, expiring on its own
 *
 * Plus `ev:qt:{<subId>}`, only while a suspension holds the backlog down.
 *
 * And the region shares:
 *
 *     ev:qx             ZSET  subId -> oldest pending delivery, for the sweeper
 *     ev:qc             STR   how many deliveries the region is holding
 *     ev:qxr            STR   claim key throttling the region-wide reconcile
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
const holdKey = (subId: string): string => `ev:qt:{${subId}}`;
const failureKey = (subId: string): string => `ev:qf:{${subId}}`;

const INDEX_KEY = 'ev:qx';
const COUNTER_KEY = 'ev:qc';

/** Subscriptions one region-ceiling shed may take deliveries from. */
const REGION_SHED_SUBSCRIPTIONS = 32;

/** Deliveries one region-ceiling shed may drop, so a burst cannot stall here. */
const REGION_SHED_MAX_ENTRIES = 1_000;

/** Arguments one variadic command carries, so a large shed stays in batches. */
const COMMAND_BATCH = 500;

/** Queues the reconciler measures at once, one command each. */
const RECONCILE_CONCURRENCY = 50;

/** Claim key that lets one reconcile pass stand for the whole region. */
const RECONCILE_CLAIM_KEY = 'ev:qxr';

/** How often the region counter is recomputed, region-wide. */
export const RECONCILE_INTERVAL_SECONDS = 60;

/**
 * Most index members one reconcile pass scans. A region already this wide is
 * not what the sweeper's per-subscription reads were sized for, and the counter
 * is better left alone than written from a partial scan.
 */
export const RECONCILE_SCAN_CAP = 5_000;

/**
 * Backstop for keys nothing indexes any more: a claim refreshes it, so a
 * backlog still being retried never lapses, while one left behind by a purge
 * that raced an enqueue does not sit in Redis forever.
 */
export const PENDING_BACKLOG_TTL_SECONDS = 7 * 24 * 60 * 60;

// -- Scripts ----------------------------------------------------------
// The three keys a subscription owns share its `{subId}` hash tag, so a script
// over them runs on one node under cluster mode. The index and the counter hash
// elsewhere and are moved by plain commands around the scripts.

/**
 * Lease the oldest delivery, if none is in flight. KEYS: entries, pending,
 * lease. ARGV: now, leaseUntil, ttlSeconds. Returns a status-first tuple.
 */
const CLAIM_SCRIPT = `
local inflight = redis.call('ZRANGEBYSCORE', KEYS[3], ARGV[1], '+inf', 'LIMIT', 0, 1)
if #inflight > 0 then return { 'inflight' } end
local head = redis.call('ZRANGE', KEYS[2], 0, 0)
if #head == 0 then return { 'empty' } end
local raw = redis.call('HGET', KEYS[1], head[1])
if not raw then
    redis.call('ZREM', KEYS[2], head[1])
    redis.call('ZREM', KEYS[3], head[1])
    return { 'missing', head[1] }
end
redis.call('ZADD', KEYS[3], ARGV[2], head[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return { 'claimed', head[1], raw }
`;

/**
 * The oldest pending score, or '-1' after deleting a drained subscription's
 * keys. Checking and deleting in one step is what keeps a concurrent append
 * from being wiped between the two. KEYS: entries, pending, lease, hold.
 */
const REINDEX_SCRIPT = `
local head = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
if #head == 0 then
    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
    return '-1'
end
return head[2]
`;

interface PendingScripts {
    pendingClaim(
        entries: string,
        pending: string,
        lease: string,
        now: string,
        leaseUntil: string,
        ttlSeconds: string,
    ): Promise<[string, string?, string?]>;
    pendingReindex(
        entries: string,
        pending: string,
        lease: string,
        hold: string,
    ): Promise<string>;
}

// -- Shapes -----------------------------------------------------------

/** One delivery, handed out under a lease. */
export interface ClaimedDelivery {
    entryId: string;
    event: DeliverableEvent;
    /** Socket attempts already spent, which is what decides the next one. */
    socketAttempts: number;
    /** Remote candidates already spent, which is what indexes the next one. */
    remoteAttempts: number;
}

/** What one failed handler attempt left behind. */
export interface DeferredDelivery {
    /** Handler attempts this delivery has now had. */
    attempts: number;
    /** How long it is held before anything may claim it again. */
    retryInMs: number;
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
    /** Remote candidates spent; absent on entries written before this field. */
    remoteAttempts?: number;
    /** Handler attempts spent, which is what the retry wait is derived from. */
    handlerAttempts?: number;
    /** Set once this entry has been charged for, however many attempts follow. */
    billed?: boolean;
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

const gapMarker = (
    subject: string,
    reason: GapMarker['reason'] = 'backlog_overflow',
): GapMarker => ({
    id: randomUUID(),
    subject,
    op: 'gap',
    reason,
    ts: Date.now(),
});

/** `ZPOPMIN`/`ZRANGE … WITHSCORES` answer flat, and scores come back typed. */
const membersOf = (flat: readonly unknown[]): string[] => {
    const members: string[] = [];
    for (let i = 0; i < flat.length; i += 2) members.push(String(flat[i]));
    return members;
};

const batched = <T>(items: readonly T[], size = COMMAND_BATCH): T[][] => {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size)
        batches.push(items.slice(i, i + size));
    return batches;
};

export class PendingDeliveryStore extends PuterStore {
    /** Tells this process's ids from a peer's, so two cannot mint the same. */
    readonly #minter = randomUUID().slice(0, 8);
    #minted = 0;
    #definedScripts = false;

    #scripts(): PendingScripts {
        if (!this.#definedScripts) {
            this.#definedScripts = true;
            this.clients.redis.defineCommand('pendingClaim', {
                numberOfKeys: 3,
                lua: CLAIM_SCRIPT,
            });
            this.clients.redis.defineCommand('pendingReindex', {
                numberOfKeys: 4,
                lua: REINDEX_SCRIPT,
            });
        }
        return this.clients.redis as unknown as PendingScripts;
    }

    /**
     * Long enough for a handler doing real work — twice the invoke timeout the
     * invoker resolves the same way, so a slow but successful run is never
     * re-invoked mid-flight — and short enough that a tab that closed
     * mid-delivery does not hold the queue.
     */
    #leaseTtlMs(): number {
        const configured = this.config.events?.invokeTimeoutMs;
        const invokeTimeoutMs =
            typeof configured === 'number' && configured > 0
                ? configured
                : EVENTS_INVOKE_TIMEOUT_MS;
        return invokeTimeoutMs * 2;
    }

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
        // One script, so two claimers racing for the same head cannot both
        // walk away holding it.
        const [status, entryId, raw] = await this.#scripts().pendingClaim(
            entriesKey(subId),
            pendingKey(subId),
            leaseKey(subId),
            String(now),
            String(now + (options.leaseMs ?? this.#leaseTtlMs())),
            String(PENDING_BACKLOG_TTL_SECONDS),
        );
        if (status === 'inflight') return null;
        if (status === 'empty') {
            // Nothing left, which is also how a drained subscription's keys go.
            await this.#reindex(subId);
            return null;
        }
        if (status === 'missing') {
            // A queue position with no entry behind it: half a write. The
            // script already dropped the position; this drops its share.
            await this.clients.redis.decrby(COUNTER_KEY, 1);
            await this.#reindex(subId);
            return null;
        }

        const entry = parseEntry(raw ?? null);
        if (!entryId || !entry) {
            await this.clients.redis.zrem(pendingKey(subId), String(entryId));
            await this.#forget(subId, [String(entryId)]);
            await this.#reindex(subId);
            return null;
        }

        // To the back of the sweeper's line: a delivery nobody ever settles
        // must not hold the head against every other backlog in the region.
        await this.clients.redis.zadd(INDEX_KEY, 'XX', now, subId);
        return {
            entryId,
            event: entry.event,
            socketAttempts: entry.socketAttempts,
            remoteAttempts: entry.remoteAttempts ?? 0,
        };
    }

    /**
     * Send a subscription to the back of the sweeper's line, holdings
     * untouched. What a blocked claim (already in flight) has to do too — a
     * subscription in retry backoff must not keep answering `null` at the head
     * of `ev:qx` and starving everything behind it.
     */
    async defer(subId: string): Promise<void> {
        await this.clients.redis.zadd(INDEX_KEY, 'XX', Date.now(), subId);
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
     * Count one remote candidate spent. Separate from `socketAttempts`, which a
     * local attempt also spends — this is what indexes the next presence
     * candidate, so a local attempt that stops being possible cannot shift it.
     */
    async recordRemoteAttempt(subId: string, entryId: string): Promise<number> {
        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        if (!entry) return 0;

        const remoteAttempts = (entry.remoteAttempts ?? 0) + 1;
        await this.clients.redis.hset(
            entriesKey(subId),
            entryId,
            JSON.stringify({ ...entry, remoteAttempts }),
        );
        return remoteAttempts;
    }

    /**
     * Give a delivery a fresh socket budget. For a row with no worker to fall
     * back to, a socket that disappeared mid-attempt would otherwise spend the
     * whole budget on nobody and wedge the entry forever once it reappears.
     */
    async resetSocketAttempts(subId: string, entryId: string): Promise<void> {
        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        if (!entry) return;

        await this.clients.redis.hset(
            entriesKey(subId),
            entryId,
            JSON.stringify({ ...entry, socketAttempts: 0, remoteAttempts: 0 }),
        );
    }

    /**
     * Count one failed handler attempt and hold the delivery until its wait is
     * over. The lease is the hold: a score in the future is what `claim` reads
     * as "in flight", so pushing it out paces the retry with no second
     * mechanism to keep in step.
     */
    async deferAfterFailure(
        subId: string,
        entryId: string,
    ): Promise<DeferredDelivery> {
        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        const attempts = (entry?.handlerAttempts ?? 0) + 1;
        const retryInMs = deliveryBackoffMs(attempts);

        const write = this.clients.redis.pipeline();
        if (entry)
            write.hset(
                entriesKey(subId),
                entryId,
                JSON.stringify({ ...entry, handlerAttempts: attempts }),
            );
        write.zadd(leaseKey(subId), Date.now() + retryInMs, entryId);
        await write.exec();

        return { attempts, retryInMs };
    }

    /**
     * Drop one delivery nothing will ever take, leaving a gap marker in its
     * place. A refused delivery is still an event its subscription was
     * promised, so the marker is what keeps the silence from reading as
     * "nothing happened".
     */
    async discard(
        subId: string,
        entryId: string,
        reason: GapMarker['reason'],
    ): Promise<boolean> {
        const subject = await this.#subjectOf(subId, entryId);
        const removed = await this.clients.redis.zrem(
            pendingKey(subId),
            entryId,
        );
        if (Number(removed) !== 1) return false;

        await this.#forget(subId, [entryId]);
        await this.#append(subId, gapMarker(subject, reason));
        return true;
    }

    /**
     * Claim this entry's one bill, if nothing already has. A `single` retries
     * the same entry across a lease expiry — a second socket attempt, then the
     * handler — and every one of those is the same undelivered event, not a new
     * one: only the attempt that gets here first is charged for it.
     */
    async markBilled(subId: string, entryId: string): Promise<boolean> {
        const entry = parseEntry(
            await this.clients.redis.hget(entriesKey(subId), entryId),
        );
        if (!entry || entry.billed) return false;

        await this.clients.redis.hset(
            entriesKey(subId),
            entryId,
            JSON.stringify({ ...entry, billed: true }),
        );
        return true;
    }

    /**
     * Count one failure against the subscription and answer how many are in a
     * row. Region-local like the rest of the delivery state: the lease that
     * produced the failure is this region's, and a row update per 5xx would put
     * a write on the table for every failed attempt.
     */
    async recordFailure(subId: string): Promise<number> {
        const count = Number(await this.clients.redis.incr(failureKey(subId)));
        await this.clients.redis.pexpire(
            failureKey(subId),
            EVENTS_FAILURE_COUNTER_TTL_MS,
        );
        return Number.isFinite(count) ? count : 0;
    }

    /** Forget a run of failures, for a delivery that landed. */
    async clearFailures(subId: string): Promise<void> {
        await this.clients.redis.del(failureKey(subId));
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
            holdKey(subId),
            failureKey(subId),
        );
        await this.clients.redis.zrem(INDEX_KEY, subId);
        if (held > 0) await this.clients.redis.decrby(COUNTER_KEY, held);
        return held;
    }

    /**
     * Take a subscription's backlog down to `cap` and put a deadline on what is
     * left. What a suspension does to what it is owed: a suspended subscription
     * stops being metered, so holding its full backlog is an unbilled memory
     * hold, and holding it forever is one that never comes back.
     *
     * The deadline is enforced by the sweeper rather than by a key TTL — the
     * entries have to be dropped with a marker in their place, and an expiring
     * key would take them silently.
     */
    async hold(
        subId: string,
        cap: number,
        ttlMs: number,
    ): Promise<PendingShed | null> {
        // Backstopped like the rest of a backlog's keys: the deadline itself
        // is still the sweeper's to enforce, but a hold nothing ever releases
        // (a purge that raced this write) must not sit in Redis forever.
        await this.clients.redis.set(
            holdKey(subId),
            Date.now() + ttlMs,
            'EX',
            PENDING_BACKLOG_TTL_SECONDS,
        );

        const held = await this.depth(subId);
        const over = held - Math.max(0, Math.floor(cap));
        if (over <= 0) return null;
        // One more than the overflow, because the marker that replaces them
        // takes a place of its own.
        return this.#shedOldest(subId, over + 1, 'subscription');
    }

    /**
     * Drop a held backlog whose deadline has passed, leaving a gap marker so
     * its subscription learns there were events rather than reading the silence
     * as "nothing happened". Returns how many went, or 0 while the hold
     * stands.
     */
    async expireHold(subId: string): Promise<number> {
        const raw = await this.clients.redis.get(holdKey(subId));
        if (raw === null) return 0;
        const expiresAt = Number(raw);
        if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return 0;

        const [oldest] = await this.clients.redis.zrange(
            pendingKey(subId),
            0,
            0,
        );
        const subject = oldest ? await this.#subjectOf(subId, oldest) : '';
        const dropped = await this.purge(subId);
        if (dropped === 0) return 0;

        await this.#append(
            subId,
            gapMarker(subject, 'suspended_backlog_expired'),
        );
        return dropped;
    }

    /** Lift a hold, for a subscription that is back in service. */
    async releaseHold(subId: string): Promise<void> {
        await this.clients.redis.del(holdKey(subId));
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
     * Claimed region-wide with `SET NX`, so one node per interval does the scan
     * and the rest report the counter as it stands.
     */
    async reconcileRegionDepth(): Promise<number> {
        const claimed = await this.clients.redis.set(
            RECONCILE_CLAIM_KEY,
            '1',
            'EX',
            RECONCILE_INTERVAL_SECONDS,
            'NX',
        );
        if (claimed !== 'OK') return this.regionDepth();

        const subIds = await this.clients.redis.zrange(
            INDEX_KEY,
            0,
            RECONCILE_SCAN_CAP - 1,
        );
        // A capped scan undercounts by construction; writing it would report
        // the region as far quieter than it actually is, so measure nothing.
        if (subIds.length >= RECONCILE_SCAN_CAP) return this.regionDepth();

        let total = 0;
        // One command per subscription: the queues hash to different slots,
        // so under cluster mode they cannot share a pipeline.
        for (const batch of batched(subIds, RECONCILE_CONCURRENCY)) {
            const counts = await Promise.all(
                batch.map((subId) => this.depth(subId)),
            );
            for (const count of counts) total += count;
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
     * The index write is its own command, ahead of the entry's own pipeline —
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

        // Index first, so a crash after the entry lands still leaves the
        // sweeper a way to find it; `NX` keeps an older score in place.
        await this.clients.redis.zadd(INDEX_KEY, 'NX', now, subId);
        // The entry and its queue position land together, so a concurrent
        // drain can never see one without the other. Same slot, so this is a
        // real transaction under cluster mode.
        const write = this.clients.redis.multi();
        write.hset(
            entriesKey(subId),
            entryId,
            JSON.stringify({ event, socketAttempts: 0 } satisfies StoredEntry),
        );
        write.zadd(pendingKey(subId), now, entryId);
        write.expire(entriesKey(subId), PENDING_BACKLOG_TTL_SECONDS);
        write.expire(pendingKey(subId), PENDING_BACKLOG_TTL_SECONDS);
        await write.exec();
        await this.clients.redis.incrby(COUNTER_KEY, 1);

        // A drain that emptied this subscription in between took it out of
        // the index again; this puts it back, with the right score.
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
            // One more than the overflow, as the marker left behind takes a
            // place of its own; counting it is what lets the region actually
            // get back under the ceiling rather than hover one over it.
            const dropped = await this.#shedOldest(subId, over + 1, 'region');
            if (!dropped) continue;
            over -= dropped.dropped - 1;
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
        const oldest = await this.#scripts().pendingReindex(
            entriesKey(subId),
            pendingKey(subId),
            leaseKey(subId),
            holdKey(subId),
        );
        if (oldest !== '-1') {
            await this.clients.redis.zadd(
                INDEX_KEY,
                Number(oldest) || 0,
                subId,
            );
            return;
        }
        await this.clients.redis.zrem(INDEX_KEY, subId);
        // The index hashes to another slot, so no script can cover both it and
        // the queue: an append that landed since the script ran has entries
        // the ZREM just hid from the sweeper. Put it back if so.
        if ((await this.depth(subId)) > 0)
            await this.clients.redis.zadd(INDEX_KEY, 'NX', Date.now(), subId);
    }
}
