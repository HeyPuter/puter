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
import { metrics } from '@opentelemetry/api';
import murmurhash from 'murmurhash';
import {
    chunkPathsForIncr,
    type RecursiveRecord,
} from '../systemKv/SystemKVStore';
import { PuterStore } from '../types';

// -- Metrics ----------------------------------------------------------

/**
 * Counters rather than log lines, because the interesting numbers here are ones
 * nothing downstream notices: amounts given up on, and claims whose amounts
 * left the cache without being written. A log line can be read after the fact;
 * only a metric can be alarmed on.
 *
 * Deliberately undimensioned — the natural dimensions (counter key, actor) are
 * unbounded, and each distinct combination is its own CloudWatch series.
 */
const meter = metrics.getMeter('puter-backend');

const absorbedCounter = meter.createCounter('metering.buffer.absorbed', {
    description: 'Metering increments taken into the cache buffer',
});

const settledCounter = meter.createCounter('metering.buffer.settled', {
    description: 'Buffered counters written onward to the KV store',
});

const droppedPathsCounter = meter.createCounter('metering.buffer.dropped', {
    description:
        'Counter paths the KV store would not accept, given up on and lost',
});

const lostClaimsCounter = meter.createCounter('metering.buffer.lost_claims', {
    description:
        'Claims whose amounts left the cache before they were written onward',
});

const recoveredCounter = meter.createCounter('metering.buffer.recovered', {
    description:
        'Buffered counters the reconciliation sweep put back on a dirty set',
});

// -- Types ------------------------------------------------------------

/** Matches the operation shape of `SystemKVStore.incr`. */
interface IncrInput {
    key: string;
    pathAndAmountMap: Record<string, number>;
}

type FlatAmounts = Record<string, number>;

// -- Constants --------------------------------------------------------

/**
 * Buffered keys are grouped into buckets, and the bucket is the hash tag, so a
 * counter's delta, its base, and its bucket's bookkeeping all live in one slot
 * and a single script can touch them together. Tagging on the counter's own key
 * instead would put the per-bucket sets in a different slot from the deltas
 * they track, which a clustered cache refuses.
 *
 * A counter always maps to exactly one bucket — buckets group different
 * counters together, they never split one.
 */
const BUCKET_COUNT = 64;

/**
 * How long an increment can sit in the cache before it is written onward. This
 * is the durability bound: a host lost without warning takes at most this much
 * usage with it.
 */
const FLUSH_INTERVAL_MS = 5000;

/**
 * Deployments start at fixed offsets, so without jitter two that boot near each
 * other would contend on every cycle rather than occasionally.
 */
const FLUSH_JITTER_MS = 500;

/** Per bucket, per cycle. Anything above this flushes on the next cycle. */
const CLAIMS_PER_BUCKET = 100;

/** A claim left unfinished this long is assumed abandoned and re-driven. */
const ORPHAN_AGE_MS = 30_000;

/** Long enough that a counter for the current month can never expire. */
const BUFFER_TTL_MS = 40 * 24 * 60 * 60 * 1000;

/** How many counters are written onward at once, to keep the load even. */
const SETTLE_CONCURRENCY = 20;

/** Roughly a minute between compression reports, so they don't flood the log. */
const CYCLES_PER_COMPRESSION_REPORT = 12;

/**
 * Roughly a minute between reconciliation sweeps. Cheap enough to run more
 * often, but what it recovers has already waited on whatever lost it, so a
 * minute of extra delay changes nothing.
 */
const CYCLES_PER_RECONCILE = 12;

/**
 * How many path names this deployment remembers as unwritable. Bounded because
 * the names come from usage types, and a caller can invent those; forgetting
 * one costs the handful of writes that identify it again.
 */
const UNWRITABLE_PATH_MEMO_LIMIT = 1000;

// -- Keys -------------------------------------------------------------

export const bucketTag = (key: string): string =>
    `m${murmurhash.v3(key) % BUCKET_COUNT}`;

const deltaKey = (tag: string, key: string): string =>
    `meter:d:{${tag}}:${key}`;
const baseKey = (tag: string, key: string): string => `meter:b:{${tag}}:${key}`;
const dirtyKey = (tag: string): string => `meter:dirty:{${tag}}`;
const pendingKey = (tag: string, nonce: string): string =>
    `meter:p:{${tag}}:${nonce}`;
const pendingIndexKey = (tag: string): string => `meter:pending:{${tag}}`;
/** Counters taken off the dirty set but not yet claimed, scored by when. */
const inflightKey = (tag: string): string => `meter:inflight:{${tag}}`;
/**
 * Every counter this bucket holds amounts for, whether or not anything is
 * currently pointing at it.
 *
 * The dirty set is what a flush works from, so a counter missing from it is a
 * counter nothing will ever flush: its delta sits there until the TTL takes it,
 * while reads keep answering from it as though it were fine. That is the one
 * way amounts leave without anything saying so. This set is the second record
 * the sweep compares against, so a delta can be found again by what it is
 * rather than by a pointer that may not have survived.
 */
const trackedKey = (tag: string): string => `meter:tracked:{${tag}}`;

/**
 * Bookkeeping field kept on a claim for as long as the claim exists.
 *
 * Amounts come off a claim as they are applied, and a hash with no fields left
 * is a hash that does not exist — so without this, a claim that finished and a
 * claim whose amounts were lost look identical from the outside, and the sweep
 * cannot tell which of them it is looking at. With it, the claim's key is
 * present exactly while the claim is, and a missing one means real loss.
 */
const CLAIM_FIELD = '__claim';

// -- Shape helpers ----------------------------------------------------

/** `['a', '1', 'b', '2']` (a cache hash reply) to `{ a: 1, b: 2 }`. */
export const pairsToAmounts = (pairs: string[]): FlatAmounts => {
    const out: FlatAmounts = {};
    for (let i = 0; i < pairs.length - 1; i += 2) {
        out[pairs[i]!] = Number(pairs[i + 1]);
    }
    return out;
};

/** A claim's amounts, without the bookkeeping field every claim carries. */
export const claimAmounts = (pairs: string[]): FlatAmounts => {
    const amounts = pairsToAmounts(pairs);
    delete amounts[CLAIM_FIELD];
    return amounts;
};

/**
 * Cache hashes are flat, but stored counters nest on `.` the same way `incr`
 * paths do — so `{'a.units': 1}` becomes `{a: {units: 1}}`.
 */
export const unflattenAmounts = (
    flat: FlatAmounts,
): RecursiveRecord<number> => {
    const out: Record<string, unknown> = {};
    for (const [path, amount] of Object.entries(flat)) {
        const parts = path.split('.');
        let node = out;
        for (const part of parts.slice(0, -1)) {
            if (typeof node[part] !== 'object' || node[part] === null)
                node[part] = {};
            node = node[part] as Record<string, unknown>;
        }
        node[parts[parts.length - 1]!] = amount;
    }
    return out as RecursiveRecord<number>;
};

/** Inverse of `unflattenAmounts`, for values read back from the KV store. */
export const flattenAmounts = (value: unknown): FlatAmounts => {
    const out: FlatAmounts = {};
    const walk = (node: unknown, prefix: string): void => {
        if (typeof node === 'number') {
            if (prefix) out[prefix] = node;
            return;
        }
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [k, v] of Object.entries(node)) {
            walk(v, prefix ? `${prefix}.${k}` : k);
        }
    };
    walk(value, '');
    return out;
};

const addAmounts = (a: FlatAmounts, b: FlatAmounts): FlatAmounts => {
    const out: FlatAmounts = { ...a };
    for (const [path, amount] of Object.entries(b)) {
        out[path] = (out[path] ?? 0) + amount;
    }
    return out;
};

const toScriptArgs = (amounts: Record<string, number>): string[] => {
    const args: string[] = [];
    for (const [path, amount] of Object.entries(amounts)) {
        args.push(path, String(amount));
    }
    return args;
};

/** The subset of `amounts` at `paths`. */
const pickAmounts = (amounts: FlatAmounts, paths: string[]): FlatAmounts =>
    Object.fromEntries(paths.map((path) => [path, amounts[path]!]));

/**
 * Split a counter into pieces the KV store will each accept in one write.
 *
 * Sized by what the write will actually be, not by how many paths it carries: a
 * path's name is what makes an update expression long, and usage types name
 * themselves, so a fixed count of long ones overflows where the same count of
 * short ones is nowhere near.
 */
export const chunkAmounts = (amounts: FlatAmounts): FlatAmounts[] =>
    chunkPathsForIncr(Object.keys(amounts)).map((paths) =>
        pickAmounts(amounts, paths),
    );

/**
 * Whether sending this write again unchanged would fail the same way. Such a
 * write is worth narrowing down rather than retrying; a failure that isn't one
 * of these is left for the sweep to re-drive.
 */
const isPermanentSettleError = (err: Error): boolean => {
    if (err.name === 'ValidationException') return true;
    const status = (err as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' && status >= 400 && status < 500;
};

/**
 * Whether this counter is the one an actor's own spending is read from, as
 * opposed to the aggregates that only feed reporting. Both are worth keeping,
 * but losing amounts from this one under-bills a specific account, so it is
 * escalated differently. Matches the per-actor month record `MeteringService`
 * builds, and deliberately not its per-app or per-shard siblings.
 */
export const isBilledCounter = (key: string): boolean =>
    /:actor:[^:]+:\d{4}-\d{2}$/.test(key);

// -- Scripts ----------------------------------------------------------

/**
 * KEYS: delta, base, dirty set, tracked set. ARGV: ttl, member, then
 * path/amount pairs.
 *
 * Returns the delta and the base together so a running total can be served
 * without a second round trip. Amounts are floats — costs are fractional.
 *
 * The counter joins both sets here. The dirty set is the working list a flush
 * takes from and hands back; the tracked set is only ever added to here and
 * removed from once the amounts are gone, so it stays true even when the
 * working list does not.
 */
const INCR_SCRIPT = `
for i = 3, #ARGV, 2 do
    redis.call('HINCRBYFLOAT', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[2])
redis.call('PEXPIRE', KEYS[3], ARGV[1])
redis.call('SADD', KEYS[4], ARGV[2])
redis.call('PEXPIRE', KEYS[4], ARGV[1])
return { redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[2]) }
`;

/** KEYS: delta, base. Reads both without marking the counter for flushing. */
const READ_SCRIPT = `
return { redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[2]) }
`;

/**
 * KEYS: dirty set, in-flight set. ARGV: how many, now, ttl, abandoned-before.
 *
 * Takes a slice of a bucket's counters for this deployment alone to flush, and
 * records what it took. Taking them means two deployments flushing the same
 * bucket divide it between them instead of both working through the same
 * counters from the front, so the drain keeps up by adding deployments.
 *
 * What was taken has to be written down in the same step, because between here
 * and the claim the counter has nothing else pointing at it: a deployment lost
 * in that window would leave a delta nobody ever looks at again. Anything taken
 * long enough ago to mean that happened goes back on the dirty set to be taken
 * again — by whichever deployment gets to it, this one included.
 */
const DRAIN_SCRIPT = `
local abandoned = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[4]) or {}
for i = 1, #abandoned do
    redis.call('SADD', KEYS[1], abandoned[i])
    redis.call('ZREM', KEYS[2], abandoned[i])
end
local taken = redis.call('SPOP', KEYS[1], ARGV[1]) or {}
for i = 1, #taken do
    redis.call('ZADD', KEYS[2], ARGV[2], taken[i])
end
if #taken > 0 then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
return { taken, redis.call('SCARD', KEYS[1]) }
`;

/**
 * KEYS: delta, pending, pending index, in-flight set. ARGV: nonce, index value,
 * ttl, in-flight member, claim time.
 *
 * The rename is the claim, and it is atomic: if two flushes race for one delta,
 * one takes all of it and the other sees nothing. Increments arriving mid-flush
 * start a fresh delta and go out on the next cycle.
 *
 * The claim is also where the counter stops being in flight, in the same step:
 * from here the pending key is what records that it has amounts waiting, so
 * this hands the counter from one durable record to the next without a gap in
 * between. A counter whose delta is already gone was flushed by someone else,
 * and stops being in flight just the same.
 */
const CLAIM_SCRIPT = `
redis.call('ZREM', KEYS[4], ARGV[4])
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
redis.call('RENAME', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[2], '${CLAIM_FIELD}', ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
return redis.call('HGETALL', KEYS[2])
`;

/**
 * KEYS: pending (abandoned), pending (fresh), pending index. ARGV: abandoned
 * nonce, fresh nonce, fresh index value, ttl, claim time.
 *
 * Re-claims an abandoned claim under a new nonce. The pending index is read
 * without removing anything, so every deployment sees every abandoned claim at
 * once; this rename is what stops more than one of them from writing the same
 * amounts onward. Re-stamping the claim time also restarts the clock, so a
 * deployment that dies holding the re-claim doesn't have it swept instantly.
 *
 * Returns `{1, amounts}` when the re-claim was taken. When it wasn't, returns
 * `{0, had}` where `had` says whether this call is the one that removed the
 * index entry — which is the difference between another deployment having
 * re-keyed the claim first, and the claim's amounts having left the cache while
 * the entry pointing at them stayed. The first is routine; the second is usage
 * lost. Only doing the removal here can tell them apart, because between a
 * separate read and delete the other deployment could land either way.
 */
const RECLAIM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
    return { 0, redis.call('HDEL', KEYS[3], ARGV[1]) }
end
redis.call('RENAME', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[2], '${CLAIM_FIELD}', ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
return { 1, redis.call('HGETALL', KEYS[2]) }
`;

/**
 * KEYS: base, pending, pending index, delta, tracked set. ARGV: nonce, ttl, new
 * total (or ''), member, then the authoritative path/value pairs.
 *
 * Replaces the base with what the KV store now holds, which is how the base
 * picks up other deployments' contributions without a separate read. The total
 * may not move backwards: two flushes settling out of order would otherwise
 * briefly under-report, and this total decides whether someone may spend.
 *
 * The counter leaves the tracked set here, but only if nothing has started a
 * fresh delta for it in the meantime — checking and removing in the same step
 * is what stops an increment that landed mid-settle from being forgotten.
 */
const SETTLE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'total')
local replace = true
if ARGV[3] ~= '' and current then
    if tonumber(current) > tonumber(ARGV[3]) then replace = false end
end
if replace then
    redis.call('DEL', KEYS[1])
    for i = 5, #ARGV, 2 do
        redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
    end
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
redis.call('DEL', KEYS[2])
redis.call('HDEL', KEYS[3], ARGV[1])
if redis.call('EXISTS', KEYS[4]) == 0 then
    redis.call('SREM', KEYS[5], ARGV[4])
end
return 1
`;

/**
 * KEYS: pending, pending index, delta, tracked set. ARGV: nonce, member.
 *
 * Forgets a claim without touching the base, for the cases where nothing was
 * written onward and replacing the base would throw away a good one. Leaves the
 * tracked set on the same terms as a settle.
 */
const RETIRE_SCRIPT = `
redis.call('DEL', KEYS[1])
redis.call('HDEL', KEYS[2], ARGV[1])
if redis.call('EXISTS', KEYS[3]) == 0 then
    redis.call('SREM', KEYS[4], ARGV[2])
end
return 1
`;

/**
 * KEYS: tracked set, dirty set, in-flight set. ARGV: ttl, delta key prefix.
 *
 * Puts back anything the working list has lost. A counter still holding a
 * delta, but on neither the dirty set nor in flight, is one no flush will ever
 * reach: nothing points at it any more, and it will sit there being read from
 * until its TTL takes it and the amounts go with it.
 *
 * A tracked counter with no delta left is the ordinary case — it settled, or it
 * is between the claim and the write — and its entry is simply retired, so this
 * sweep costs the same next time regardless of how much has passed through the
 * bucket.
 *
 * The delta key is built here rather than declared, which is safe only because
 * every key in this scheme carries the bucket as its hash tag and so lives in
 * the one slot this script is already running against.
 */
const RECONCILE_SCRIPT = `
local tracked = redis.call('SMEMBERS', KEYS[1])
local recovered = 0
for i = 1, #tracked do
    local member = tracked[i]
    if redis.call('SISMEMBER', KEYS[2], member) == 0
        and not redis.call('ZSCORE', KEYS[3], member) then
        if redis.call('EXISTS', ARGV[2] .. member) == 1 then
            redis.call('SADD', KEYS[2], member)
            recovered = recovered + 1
        else
            redis.call('SREM', KEYS[1], member)
        end
    end
end
if recovered > 0 then redis.call('PEXPIRE', KEYS[2], ARGV[1]) end
return recovered
`;

/** KEYS: base. ARGV: ttl, then path/value pairs. Returns the base. */
const SEED_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
    for i = 2, #ARGV, 2 do
        redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
    end
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return redis.call('HGETALL', KEYS[1])
`;

type ScriptRunner = {
    meterIncr(...args: string[]): Promise<[string[], string[]]>;
    meterRead(...args: string[]): Promise<[string[], string[]]>;
    meterDrain(...args: string[]): Promise<[string[], number]>;
    meterClaim(...args: string[]): Promise<string[] | null>;
    /** `[1, amounts]` when re-claimed, `[0, hadIndexEntry]` when not. */
    meterReclaim(...args: string[]): Promise<[number, string[] | number]>;
    meterSettle(...args: string[]): Promise<number>;
    meterRetire(...args: string[]): Promise<number>;
    meterReconcile(...args: string[]): Promise<number>;
    meterSeed(...args: string[]): Promise<string[]>;
};

// -- MeteringBufferStore ----------------------------------------------

/**
 * Absorbs metering counter increments in the cache and writes each counter
 * onward once per cycle instead of once per call.
 *
 * This stands in for the `incr` and `get` operations of `stores.kv` for
 * metering counters, and it is the only place that knows any buffering happens:
 * callers pass the same arguments and read the same running totals either way.
 *
 * The running total a caller gets back is this deployment's view — its own
 * buffered increments plus everything the KV store held as of the last cycle.
 * For an actor served by a single deployment that is exact at all times. When a
 * decision genuinely turns on the number, `readExact` is the way to be sure.
 */
export class MeteringBufferStore extends PuterStore {
    #flushTimer: ReturnType<typeof setTimeout> | null = null;
    #stopped = false;
    #definedScripts = false;
    #absorbedCount = 0;
    #flushedCount = 0;
    #droppedPathCount = 0;
    #cyclesSinceReport = 0;
    #cyclesSinceReconcile = 0;

    /** Path names the KV store has refused on their own; see `#settle`. */
    #unwritablePaths = new Set<string>();

    // -- Lifecycle ----------------------------------------------------

    override onServerStart(): void {
        this.#defineScripts();
        this.#scheduleFlush();
    }

    override async onServerShutdown(): Promise<void> {
        this.#stopped = true;
        if (this.#flushTimer) {
            clearTimeout(this.#flushTimer);
            this.#flushTimer = null;
        }

        // Best-effort drain. The flush interval, not this, is what bounds how
        // much can be lost — a host that dies gives no signal at all.
        try {
            for (let pass = 0; pass < 10; pass++) {
                if ((await this.flushCycle()) === 0) break;
            }
        } catch (e) {
            console.warn('[metering] shutdown flush failed', e);
        }
    }

    // -- Public API ---------------------------------------------------

    /**
     * Increment a counter whose running total the caller acts on. Returns the
     * counter's value after the increment, as `stores.kv.incr` does, plus
     * whether that value is known to account for every deployment.
     */
    async incr(
        input: IncrInput,
    ): Promise<{ res: RecursiveRecord<number>; exact: boolean }> {
        try {
            const { delta, base } = await this.#buffer(input);
            const resolved =
                Object.keys(base).length > 0
                    ? base
                    : await this.#seedBase(input.key);
            return {
                res: unflattenAmounts(addAmounts(resolved, delta)),
                exact: false,
            };
        } catch (e) {
            // A counter that decides whether someone may spend is never worth
            // dropping, so fall back to writing it directly. That value is
            // authoritative, hence exact.
            console.warn(
                `[metering] buffered incr failed, writing through: ${(e as Error).message}`,
            );
            const { res } = await this.#writeThrough(input);
            return { res, exact: true };
        }
    }

    /**
     * Increment an aggregate counter that only feeds reporting. Nothing reads
     * these to make a decision, so there is no running total to return.
     */
    async incrAux(input: IncrInput): Promise<void> {
        try {
            await this.#buffer(input);
        } catch (e) {
            console.warn(
                `[metering] buffered aux incr failed, writing through: ${(e as Error).message}`,
            );
            await this.#writeThrough(input);
        }
    }

    /**
     * Read counters, including increments buffered but not yet written onward.
     * Mirrors `stores.kv.get`: one key in, one value out; an array in, an array
     * out.
     */
    async get({
        key,
    }: {
        key: string | string[];
    }): Promise<{ res: unknown | null | (unknown | null)[] }> {
        const keys = Array.isArray(key) ? key : [key];
        const values = await Promise.all(
            keys.map((k) =>
                this.#readThrough(k).catch((e: Error) => {
                    console.warn(
                        `[metering] buffered read failed, reading through: ${e.message}`,
                    );
                    return this.stores.kv
                        .get({ key: k })
                        .then(({ res }) => res ?? null);
                }),
            ),
        );
        return { res: Array.isArray(key) ? values : values[0]! };
    }

    /**
     * Read a counter with everything this deployment has buffered for it
     * written onward first, then read back strongly consistently. This is the
     * only read that costs extra; it exists for decisions taken close enough to
     * a limit that an approximate total would be the wrong answer.
     */
    async readExact({ key }: { key: string }): Promise<{ res: unknown }> {
        try {
            await this.#flushOne(bucketTag(key), key);
        } catch (e) {
            console.warn(
                `[metering] exact read could not flush ${key}: ${(e as Error).message}`,
            );
        }
        return this.stores.kv.get({ key, consistentRead: true });
    }

    // -- Internals: client & scripts ----------------------------------

    get #redis(): ScriptRunner {
        this.#defineScripts();
        return this.clients.redis as unknown as ScriptRunner;
    }

    #defineScripts(): void {
        if (this.#definedScripts) return;
        this.#definedScripts = true;
        const client = this.clients.redis;
        client.defineCommand('meterIncr', {
            numberOfKeys: 4,
            lua: INCR_SCRIPT,
        });
        client.defineCommand('meterRead', {
            numberOfKeys: 2,
            lua: READ_SCRIPT,
        });
        client.defineCommand('meterDrain', {
            numberOfKeys: 2,
            lua: DRAIN_SCRIPT,
        });
        client.defineCommand('meterClaim', {
            numberOfKeys: 4,
            lua: CLAIM_SCRIPT,
        });
        client.defineCommand('meterReclaim', {
            numberOfKeys: 3,
            lua: RECLAIM_SCRIPT,
        });
        client.defineCommand('meterSettle', {
            numberOfKeys: 5,
            lua: SETTLE_SCRIPT,
        });
        client.defineCommand('meterRetire', {
            numberOfKeys: 4,
            lua: RETIRE_SCRIPT,
        });
        client.defineCommand('meterReconcile', {
            numberOfKeys: 3,
            lua: RECONCILE_SCRIPT,
        });
        client.defineCommand('meterSeed', {
            numberOfKeys: 1,
            lua: SEED_SCRIPT,
        });
    }

    // -- Internals: writes --------------------------------------------

    #writeThrough(input: IncrInput): Promise<{ res: RecursiveRecord<number> }> {
        return this.stores.kv.incr(input) as Promise<{
            res: RecursiveRecord<number>;
        }>;
    }

    async #buffer({
        key,
        pathAndAmountMap,
    }: IncrInput): Promise<{ delta: FlatAmounts; base: FlatAmounts }> {
        const tag = bucketTag(key);
        const [delta, base] = await this.#redis.meterIncr(
            deltaKey(tag, key),
            baseKey(tag, key),
            dirtyKey(tag),
            trackedKey(tag),
            String(BUFFER_TTL_MS),
            key,
            ...toScriptArgs(pathAndAmountMap),
        );
        this.#absorbedCount++;
        absorbedCounter.add(1);
        return { delta: pairsToAmounts(delta), base: pairsToAmounts(base) };
    }

    /**
     * The base mirrors what the KV store holds, so a counter the cache has not
     * seen yet — a new month, or one whose entry has since gone — has to be
     * fetched once. From the first flush onward the base is maintained from
     * what the KV store returns, and increments are served from the cache
     * alone. A counter with nothing stored against it yet seeds nothing, so it
     * keeps reading for that first cycle; reads are the cheap direction and it
     * is over within seconds.
     */
    async #seedBase(key: string): Promise<FlatAmounts> {
        const { res } = await this.stores.kv.get({ key });
        const persisted = flattenAmounts(res);
        const seeded = await this.#redis.meterSeed(
            baseKey(bucketTag(key), key),
            String(BUFFER_TTL_MS),
            ...toScriptArgs(persisted),
        );
        return pairsToAmounts(seeded);
    }

    // -- Internals: reads ---------------------------------------------

    async #readThrough(key: string): Promise<unknown | null> {
        const tag = bucketTag(key);
        const [delta, base] = await this.#redis.meterRead(
            deltaKey(tag, key),
            baseKey(tag, key),
        );
        const deltaAmounts = pairsToAmounts(delta);
        const baseAmounts = pairsToAmounts(base);
        const resolved =
            Object.keys(baseAmounts).length > 0
                ? baseAmounts
                : flattenAmounts((await this.stores.kv.get({ key })).res);

        const merged = addAmounts(resolved, deltaAmounts);
        if (Object.keys(merged).length === 0) return null;
        return unflattenAmounts(merged);
    }

    // -- Internals: flush ---------------------------------------------

    #scheduleFlush(): void {
        if (this.#stopped) return;
        const delay =
            FLUSH_INTERVAL_MS + (Math.random() * 2 - 1) * FLUSH_JITTER_MS;
        this.#flushTimer = setTimeout(() => {
            this.flushCycle()
                .catch((e) => {
                    console.error('[metering] flush cycle failed', e);
                })
                .finally(() => this.#scheduleFlush());
        }, delay);
        this.#flushTimer.unref?.();
    }

    /**
     * Write one cycle's worth of buffered counters onward. Driven by the flush
     * timer; returns how many counters it handled so a drain loop knows when
     * there is nothing left.
     */
    async flushCycle(): Promise<number> {
        const work: Array<() => Promise<void>> = [];
        let truncated = 0;

        // Before the drain, so anything put back joins this cycle rather than
        // waiting for the next one.
        if (++this.#cyclesSinceReconcile >= CYCLES_PER_RECONCILE) {
            this.#cyclesSinceReconcile = 0;
            await this.reconcile();
        }

        // Settled, not all-or-nothing: one bucket the cache could not answer
        // for must not discard the other 63 buckets' work for this cycle.
        const drained = await Promise.allSettled(
            Array.from({ length: BUCKET_COUNT }, (_, bucket) =>
                this.#drainBucket(`m${bucket}`),
            ),
        );

        const buckets = [];
        for (const outcome of drained) {
            if (outcome.status === 'fulfilled') {
                buckets.push(outcome.value);
                continue;
            }
            console.warn(
                `[metering] could not take a bucket's counters: ${(outcome.reason as Error)?.message}`,
            );
        }

        for (const bucket of buckets) {
            if (bucket.truncated) truncated++;
            for (const key of bucket.keys) {
                work.push(() => this.#flushOne(bucket.tag, key));
            }
            for (const orphan of bucket.orphans) {
                work.push(() => this.#settleOrphan(bucket.tag, orphan));
            }
        }

        if (truncated > 0) {
            console.warn(
                `[metering] ${truncated} bucket(s) still held counters after this deployment took its share; they go out on a following cycle, or to another deployment`,
            );
        }

        for (let i = 0; i < work.length; i += SETTLE_CONCURRENCY) {
            await Promise.all(
                work.slice(i, i + SETTLE_CONCURRENCY).map((run) =>
                    run().catch((e: Error) => {
                        // Leaving the claim in place is what makes this safe:
                        // the sweep re-drives it.
                        console.warn(`[metering] settle failed: ${e.message}`);
                    }),
                ),
            );
        }

        settledCounter.add(work.length);
        this.#reportCompression(work.length);
        return work.length;
    }

    /**
     * Put back anything the dirty sets have lost, across every bucket.
     *
     * Settled per bucket for the same reason the drain is: a bucket the cache
     * could not answer for is one bucket's worth of counters left for the next
     * sweep, not a reason to skip the other 63.
     */
    async reconcile(): Promise<void> {
        const swept = await Promise.allSettled(
            Array.from({ length: BUCKET_COUNT }, (_, bucket) => {
                const tag = `m${bucket}`;
                return this.#redis.meterReconcile(
                    trackedKey(tag),
                    dirtyKey(tag),
                    inflightKey(tag),
                    String(BUFFER_TTL_MS),
                    `meter:d:{${tag}}:`,
                );
            }),
        );

        let recovered = 0;
        for (const outcome of swept) {
            if (outcome.status === 'fulfilled') {
                recovered += Number(outcome.value);
                continue;
            }
            console.warn(
                `[metering] could not reconcile a bucket: ${(outcome.reason as Error)?.message}`,
            );
        }

        if (recovered === 0) return;

        recoveredCounter.add(recovered);
        // Loud because the amounts were on their way out of the cache with
        // nothing left pointing at them: this is the sweep earning its keep,
        // and a steady rate of it means something upstream keeps losing them.
        console.error(
            `[metering] recovered ${recovered} buffered counter(s) that had fallen off their dirty set — usage that would otherwise have expired unwritten`,
        );
    }

    /**
     * How many increments each write onward stood in for. This is the number
     * that says whether buffering is earning anything: a ratio near 1 means
     * calls for the same counter arrive too far apart to batch.
     */
    #reportCompression(flushed: number): void {
        this.#flushedCount += flushed;
        if (++this.#cyclesSinceReport < CYCLES_PER_COMPRESSION_REPORT) return;

        const absorbed = this.#absorbedCount;
        const writes = this.#flushedCount;
        const dropped = this.#droppedPathCount;
        this.#absorbedCount = 0;
        this.#flushedCount = 0;
        this.#droppedPathCount = 0;
        this.#cyclesSinceReport = 0;

        if (writes === 0) return;
        console.log(
            `[metering] buffer absorbed ${absorbed} increments into ${writes} writes (${(absorbed / writes).toFixed(2)}x)` +
                (dropped > 0 ? `, dropped ${dropped} unwritable path(s)` : ''),
        );
    }

    /**
     * Take this deployment's share of a bucket's counters, and list the claims
     * in it that look abandoned.
     */
    async #drainBucket(tag: string): Promise<{
        tag: string;
        keys: string[];
        orphans: Array<{ nonce: string; key: string }>;
        truncated: boolean;
    }> {
        const now = Date.now();
        const cutoff = now - ORPHAN_AGE_MS;

        const [drained, pending] = await Promise.all([
            this.#redis.meterDrain(
                dirtyKey(tag),
                inflightKey(tag),
                String(CLAIMS_PER_BUCKET),
                String(now),
                String(BUFFER_TTL_MS),
                String(cutoff),
            ),
            this.clients.redis.hgetall(pendingIndexKey(tag)),
        ]);

        const [taken, remaining] = drained ?? [[], 0];

        const orphans: Array<{ nonce: string; key: string }> = [];
        for (const [nonce, encoded] of Object.entries(pending ?? {})) {
            const parsed = parsePendingEntry(encoded);
            if (!parsed || parsed.claimedAt > cutoff) continue;
            orphans.push({ nonce, key: parsed.key });
        }

        return {
            tag,
            keys: taken ?? [],
            orphans,
            // What the bucket still holds after this deployment took its share,
            // which another deployment may be taking at the same moment.
            truncated: Number(remaining) > 0,
        };
    }

    async #flushOne(tag: string, key: string): Promise<void> {
        const nonce = randomUUID().replace(/-/g, '');
        const now = Date.now();
        const claimed = await this.#redis.meterClaim(
            deltaKey(tag, key),
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            inflightKey(tag),
            nonce,
            encodePendingEntry(now, key),
            String(BUFFER_TTL_MS),
            key,
            String(now),
        );
        // Nothing buffered for this counter — another flush already took it.
        if (!claimed) return;

        await this.#settle(tag, key, nonce, claimAmounts(claimed));
    }

    async #settleOrphan(
        tag: string,
        orphan: { nonce: string; key: string },
    ): Promise<void> {
        const nonce = randomUUID().replace(/-/g, '');
        const now = Date.now();
        const [taken, payload] = await this.#redis.meterReclaim(
            pendingKey(tag, orphan.nonce),
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            orphan.nonce,
            nonce,
            encodePendingEntry(now, orphan.key),
            String(BUFFER_TTL_MS),
            String(now),
        );

        if (!taken) {
            // The claim's amounts are not there. Either another flush re-keyed
            // it first — in which case that flush also took the index entry,
            // and this removed nothing — or the amounts left the cache while
            // the entry pointing at them stayed, which is usage lost. Removing
            // the entry is how the two are told apart, so the answer only
            // exists here.
            if (Number(payload) > 0) this.#recordLostClaim(orphan.key);
            return;
        }

        await this.#settle(
            tag,
            orphan.key,
            nonce,
            claimAmounts(payload as string[]),
        );
    }

    /**
     * Write a claimed counter onward, then replace its base with what the KV
     * store now holds.
     *
     * A write the store will never accept is narrowed down rather than
     * abandoned: the batch is halved and each half tried, until either it goes
     * through or a single path is left standing alone as the one thing that
     * cannot be written. Only that path is given up on — everything it was
     * batched with still lands. Amounts here are already spent, so the bar for
     * dropping any of them is that there is provably nothing else to try.
     */
    async #settle(
        tag: string,
        key: string,
        nonce: string,
        amounts: FlatAmounts,
    ): Promise<void> {
        if (Object.keys(amounts).length === 0) {
            // Nothing to write onward. Retire the claim rather than settling
            // it, which would clear a base that is still good.
            await this.#retireClaim(tag, key, nonce);
            return;
        }

        // Paths already known to be unwritable are dropped without spending a
        // write to rediscover it, which is what keeps one bad usage type from
        // costing a round of narrowing on every cycle for as long as it arrives.
        const known = Object.keys(amounts).filter((path) =>
            this.#unwritablePaths.has(path),
        );
        if (known.length > 0) {
            this.#recordDrop(
                key,
                pickAmounts(amounts, known),
                'known unwritable',
            );
            await this.#dropFromClaim(tag, nonce, known);
        }

        const pending = chunkAmounts(
            pickAmounts(
                amounts,
                Object.keys(amounts).filter(
                    (path) => !this.#unwritablePaths.has(path),
                ),
            ),
        );

        // Each write returns the whole counter, so the last one to succeed
        // holds every path the KV store now has — including earlier batches and
        // anything another deployment contributed.
        let settled: unknown;
        let written = 0;

        while (pending.length > 0) {
            const batch = pending.shift()!;
            const paths = Object.keys(batch);
            try {
                ({ res: settled } = await this.stores.kv.incr({
                    key,
                    pathAndAmountMap: batch,
                }));
            } catch (e) {
                const err = e as Error;
                if (!isPermanentSettleError(err)) throw e;

                if (paths.length > 1) {
                    const middle = Math.ceil(paths.length / 2);
                    pending.unshift(
                        pickAmounts(batch, paths.slice(0, middle)),
                        pickAmounts(batch, paths.slice(middle)),
                    );
                    continue;
                }

                this.#rememberUnwritable(paths[0]!);
                this.#recordDrop(key, batch, err.message);
                await this.#dropFromClaim(tag, nonce, paths);
                continue;
            }
            written += paths.length;

            // This batch is applied for good now, so take it off the claim
            // before anything else can fail: a re-drive then picks up only what
            // is still outstanding instead of adding these amounts a second
            // time.
            await this.#dropFromClaim(tag, nonce, paths);
        }

        if (written === 0) {
            // Nothing reached the store, so there is no newer base to adopt —
            // settling would replace a good one with this counter's old value.
            await this.#retireClaim(tag, key, nonce);
            return;
        }

        const flat = flattenAmounts(settled);
        await this.#redis.meterSettle(
            baseKey(tag, key),
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            deltaKey(tag, key),
            trackedKey(tag),
            nonce,
            String(BUFFER_TTL_MS),
            flat['total'] === undefined ? '' : String(flat['total']),
            key,
            ...toScriptArgs(flat),
        );
    }

    /** Take paths off a claim, so a re-drive doesn't carry them again. */
    async #dropFromClaim(
        tag: string,
        nonce: string,
        paths: string[],
    ): Promise<void> {
        if (paths.length === 0) return;
        await this.clients.redis.hdel(pendingKey(tag, nonce), ...paths);
    }

    #rememberUnwritable(path: string): void {
        if (this.#unwritablePaths.size >= UNWRITABLE_PATH_MEMO_LIMIT) {
            const oldest = this.#unwritablePaths.keys().next().value;
            if (oldest !== undefined) this.#unwritablePaths.delete(oldest);
        }
        this.#unwritablePaths.add(path);
    }

    /**
     * Say loudly that metered usage was lost. These amounts have already been
     * spent and are gone from the cache with the claim, so nothing downstream
     * will notice on its own — which is exactly why this cannot be a log line.
     */
    #recordDrop(key: string, dropped: FlatAmounts, reason: string): void {
        const paths = Object.keys(dropped);
        this.#droppedPathCount += paths.length;
        droppedPathsCounter.add(paths.length);
        console.error(
            `[metering] dropping ${paths.length} unwritable path(s) of ${key}: ${reason}`,
        );

        if (isBilledCounter(key)) {
            this.clients.alarm.create(
                `metering_usage_dropped:${key}`,
                `Usage could not be persisted for ${key} — the amounts are lost and the account is under-billed`,
                { key, paths, amounts: dropped, reason },
                'critical',
                { dedup: true },
            );
            return;
        }

        this.clients.alarm.create(
            'metering_aggregate_usage_dropped',
            `An aggregate usage counter could not be persisted (${key}) — reporting totals will under-count`,
            { key, paths, amounts: dropped, reason },
            'warning',
            { dedup: true },
        );
    }

    /**
     * Forget a claim and its index entry, leaving the base alone. Settling
     * would also replace the base, which is only correct when something was
     * actually written onward.
     */
    async #retireClaim(tag: string, key: string, nonce: string): Promise<void> {
        await this.#redis.meterRetire(
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            deltaKey(tag, key),
            trackedKey(tag),
            nonce,
            key,
        );
    }

    /**
     * Say loudly that a claim's amounts left the cache before anything wrote
     * them onward.
     *
     * Unlike a dropped path there is no list of what was lost — the amounts
     * went with the claim, and all that survived was the entry that pointed at
     * it. That is the whole reason this has to be raised: nothing else in the
     * system will ever notice the gap.
     */
    #recordLostClaim(key: string): void {
        lostClaimsCounter.add(1);
        console.error(
            `[metering] a claim on ${key} lost its amounts before they were written onward`,
        );

        if (isBilledCounter(key)) {
            this.clients.alarm.create(
                `metering_claim_lost:${key}`,
                `A claim on ${key} left the cache before it was persisted — the amounts are lost and the account is under-billed`,
                { key },
                'critical',
                { dedup: true },
            );
            return;
        }

        this.clients.alarm.create(
            'metering_aggregate_claim_lost',
            `An aggregate claim (${key}) left the cache before it was persisted — reporting totals will under-count`,
            { key },
            'warning',
            { dedup: true },
        );
    }
}

// -- Pending index encoding -------------------------------------------

const encodePendingEntry = (claimedAt: number, key: string): string =>
    `${claimedAt}:${key}`;

export const parsePendingEntry = (
    encoded: string,
): { claimedAt: number; key: string } | null => {
    const separator = encoded.indexOf(':');
    if (separator < 0) return null;

    const claimedAt = Number(encoded.slice(0, separator));
    const key = encoded.slice(separator + 1);
    if (!Number.isFinite(claimedAt) || !key) return null;

    return { claimedAt, key };
};
