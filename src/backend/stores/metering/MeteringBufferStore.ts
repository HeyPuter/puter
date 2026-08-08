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
import murmurhash from 'murmurhash';
import type { RecursiveRecord } from '../systemKv/SystemKVStore';
import { PuterStore } from '../types';

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

// -- Shape helpers ----------------------------------------------------

/** `['a', '1', 'b', '2']` (a cache hash reply) to `{ a: 1, b: 2 }`. */
export const pairsToAmounts = (pairs: string[]): FlatAmounts => {
    const out: FlatAmounts = {};
    for (let i = 0; i < pairs.length - 1; i += 2) {
        out[pairs[i]!] = Number(pairs[i + 1]);
    }
    return out;
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

// -- Scripts ----------------------------------------------------------

/**
 * KEYS: delta, base, dirty set. ARGV: ttl, member, then path/amount pairs.
 *
 * Returns the delta and the base together so a running total can be served
 * without a second round trip. Amounts are floats — costs are fractional.
 */
const INCR_SCRIPT = `
for i = 3, #ARGV, 2 do
    redis.call('HINCRBYFLOAT', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[2])
redis.call('PEXPIRE', KEYS[3], ARGV[1])
return { redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[2]) }
`;

/** KEYS: delta, base. Reads both without marking the counter for flushing. */
const READ_SCRIPT = `
return { redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[2]) }
`;

/**
 * KEYS: delta, pending, pending index. ARGV: nonce, index value, ttl.
 *
 * The rename is the claim, and it is atomic: if two flushes race for one delta,
 * one takes all of it and the other sees nothing. Increments arriving mid-flush
 * start a fresh delta and go out on the next cycle.
 */
const CLAIM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
redis.call('RENAME', KEYS[1], KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
return redis.call('HGETALL', KEYS[2])
`;

/**
 * KEYS: pending (abandoned), pending (fresh), pending index. ARGV: abandoned
 * nonce, fresh nonce, fresh index value, ttl.
 *
 * Re-claims an abandoned claim under a new nonce. The pending index is read
 * without removing anything, so every deployment sees every abandoned claim at
 * once; this rename is what stops more than one of them from writing the same
 * amounts onward. Re-stamping the claim time also restarts the clock, so a
 * deployment that dies holding the re-claim doesn't have it swept instantly.
 */
const RECLAIM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
redis.call('RENAME', KEYS[1], KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
return redis.call('HGETALL', KEYS[2])
`;

/**
 * KEYS: base, pending, pending index. ARGV: nonce, ttl, new total (or ''), then
 * the authoritative path/value pairs.
 *
 * Replaces the base with what the KV store now holds, which is how the base
 * picks up other deployments' contributions without a separate read. The total
 * may not move backwards: two flushes settling out of order would otherwise
 * briefly under-report, and this total decides whether someone may spend.
 */
const SETTLE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'total')
local replace = true
if ARGV[3] ~= '' and current then
    if tonumber(current) > tonumber(ARGV[3]) then replace = false end
end
if replace then
    redis.call('DEL', KEYS[1])
    for i = 4, #ARGV, 2 do
        redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
    end
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
redis.call('DEL', KEYS[2])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1
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
    meterClaim(...args: string[]): Promise<string[] | null>;
    meterReclaim(...args: string[]): Promise<string[] | null>;
    meterSettle(...args: string[]): Promise<number>;
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
    #cyclesSinceReport = 0;

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
            numberOfKeys: 3,
            lua: INCR_SCRIPT,
        });
        client.defineCommand('meterRead', {
            numberOfKeys: 2,
            lua: READ_SCRIPT,
        });
        client.defineCommand('meterClaim', {
            numberOfKeys: 3,
            lua: CLAIM_SCRIPT,
        });
        client.defineCommand('meterReclaim', {
            numberOfKeys: 3,
            lua: RECLAIM_SCRIPT,
        });
        client.defineCommand('meterSettle', {
            numberOfKeys: 3,
            lua: SETTLE_SCRIPT,
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
            String(BUFFER_TTL_MS),
            key,
            ...toScriptArgs(pathAndAmountMap),
        );
        this.#absorbedCount++;
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

        const buckets = await Promise.all(
            Array.from({ length: BUCKET_COUNT }, (_, bucket) =>
                this.#drainBucket(`m${bucket}`),
            ),
        );

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
                `[metering] ${truncated} bucket(s) hit the per-cycle claim cap; the rest flush next cycle`,
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

        this.#reportCompression(work.length);
        return work.length;
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
        this.#absorbedCount = 0;
        this.#flushedCount = 0;
        this.#cyclesSinceReport = 0;

        if (writes === 0) return;
        console.log(
            `[metering] buffer absorbed ${absorbed} increments into ${writes} writes (${(absorbed / writes).toFixed(2)}x)`,
        );
    }

    async #drainBucket(tag: string): Promise<{
        tag: string;
        keys: string[];
        orphans: Array<{ nonce: string; key: string }>;
        truncated: boolean;
    }> {
        const redis = this.clients.redis;
        const [popped, pending] = await Promise.all([
            redis.spop(dirtyKey(tag), CLAIMS_PER_BUCKET),
            redis.hgetall(pendingIndexKey(tag)),
        ]);

        // An empty pop can come back as nothing at all rather than an empty
        // list, depending on the client.
        const keys = popped ?? [];

        const cutoff = Date.now() - ORPHAN_AGE_MS;
        const orphans: Array<{ nonce: string; key: string }> = [];
        for (const [nonce, encoded] of Object.entries(pending ?? {})) {
            const parsed = parsePendingEntry(encoded);
            if (!parsed || parsed.claimedAt > cutoff) continue;
            orphans.push({ nonce, key: parsed.key });
        }

        return {
            tag,
            keys,
            orphans,
            truncated: keys.length >= CLAIMS_PER_BUCKET,
        };
    }

    async #flushOne(tag: string, key: string): Promise<void> {
        const nonce = randomUUID().replace(/-/g, '');
        const claimed = await this.#redis.meterClaim(
            deltaKey(tag, key),
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            nonce,
            encodePendingEntry(Date.now(), key),
            String(BUFFER_TTL_MS),
        );
        // Nothing buffered for this counter — another flush already took it.
        if (!claimed) return;

        await this.#settle(tag, key, nonce, pairsToAmounts(claimed));
    }

    async #settleOrphan(
        tag: string,
        orphan: { nonce: string; key: string },
    ): Promise<void> {
        const nonce = randomUUID().replace(/-/g, '');
        const reclaimed = await this.#redis.meterReclaim(
            pendingKey(tag, orphan.nonce),
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            orphan.nonce,
            nonce,
            encodePendingEntry(Date.now(), orphan.key),
            String(BUFFER_TTL_MS),
        );
        if (!reclaimed) {
            // Either another flush re-claimed this first, or the claimed data
            // is gone and only its index entry outlived it. Dropping the entry
            // covers the second case and is a no-op for the first, which has
            // already re-keyed it.
            await this.clients.redis.hdel(pendingIndexKey(tag), orphan.nonce);
            return;
        }
        await this.#settle(tag, orphan.key, nonce, pairsToAmounts(reclaimed));
    }

    async #settle(
        tag: string,
        key: string,
        nonce: string,
        amounts: FlatAmounts,
    ): Promise<void> {
        const { res } = await this.stores.kv.incr({
            key,
            pathAndAmountMap: amounts,
        });

        const flat = flattenAmounts(res);
        await this.#redis.meterSettle(
            baseKey(tag, key),
            pendingKey(tag, nonce),
            pendingIndexKey(tag),
            nonce,
            String(BUFFER_TTL_MS),
            flat['total'] === undefined ? '' : String(flat['total']),
            ...toScriptArgs(flat),
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
