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

import { PuterStore } from '../types';
import type { Actor } from '../../core/actor';
import {
    isSystemActor,
    SYSTEM_ACTOR,
    SYSTEM_ACTOR_UUID,
} from '../../core/actor';
import {
    PUTER_KV_STORE_TABLE_DEFINITION,
    PUTER_KV_STORE_TABLE_NAME,
} from './tableDefinition';
import { HttpError } from '../../core/http';
import {
    decodeCursor,
    encodeCursor,
    normalizeLimit,
    normalizeOffset,
} from '../../util/pagination';
import {
    cacheTtlSecondsFor,
    decodeCachedRead,
    encodeCachedHit,
    encodeCachedMiss,
    kvCacheKey,
    KV_CACHE_BLOCK_MARKER,
    resolveKvCacheSettings,
    type KvCachedItem,
    type KvCacheSettings,
} from './readCache';

// -- Types ------------------------------------------------------------

/** DynamoDB consumed-capacity units split by operation kind. */
export interface KVUsage {
    read: number;
    write: number;
    /**
     * Units for reads the cache answered, which consumed no capacity upstream:
     * the number the equivalent uncached read did consume, so a caller pricing
     * these has the same quantity to price against a different rate. Kept out
     * of `read` precisely so it can be priced differently.
     */
    cachedRead: number;
}

/**
 * Standard return envelope: `res` is the operation result, `usage` is the
 * DynamoDB consumed capacity so callers can meter if they choose to.
 */
export interface KVResult<T> {
    res: T;
    usage: KVUsage;
}

export interface KVOpts {
    /** Optional actor — defaults to the system actor. */
    actor?: Actor;
    /** Optional app uuid override for non-app-scoped actors. */
    appUuid?: string;
    /**
     * Namespace override that wins over the actor's own app — how an app
     * addresses a _different_ app's namespace. Set only by the KV driver, and
     * only after its cross-app permission check has passed.
     */
    namespaceAppUuid?: string;
}

export interface RecursiveRecord<T> {
    [k: string]: T | RecursiveRecord<T>;
}

// -- Helpers ----------------------------------------------------------

const GLOBAL_APP_KEY = 'os-global';
const SYSTEM_NAMESPACE = `v1:${SYSTEM_ACTOR_UUID}:${GLOBAL_APP_KEY}`;
const MAX_KEY_BYTES = 1024;
const MAX_VALUE_BYTES = 399 * 1024;
const BATCH_GET_CHUNK = 100;
const PATH_CLEANER_REGEX = /[^A-Za-z0-9_]/g;
// Offset emulation re-scans everything before the requested position, so it
// is bounded; cursors are the recommended way to page.
const MAX_LIST_OFFSET = 5000;
const MAX_FILL_PAGES = 10;
// Cache keys carried by one invalidation broadcast. A peer applies them in a
// single pass either way; the cap only keeps an individual message a sane size.
const KV_CACHE_BROADCAST_CHUNK = 500;

/**
 * Marks an entry private to the app that wrote it. Beside `value`/`ttl`, so
 * caller data can neither collide with it nor set it.
 */
export const KV_PRIVATE_ATTR = 'noShare';

const ttlFilter = (now: number) => ({
    expression: 'attribute_not_exists(#ttlAttr) OR #ttlAttr > :nowTs',
    names: { '#ttlAttr': 'ttl' },
    values: { ':nowTs': now },
});

/**
 * Expired entries, plus private ones for a cross-app caller. Filtered in the
 * query rather than afterwards so `includeTotal`'s COUNT excludes them too — a
 * total counting rows the caller can't see would leak what the flag hides.
 */
const listFilter = (now: number, crossApp: boolean) => {
    const ttl = ttlFilter(now);
    if (!crossApp) return ttl;
    return {
        expression: `(${ttl.expression}) AND attribute_not_exists(#privAttr)`,
        names: { ...ttl.names, '#privAttr': KV_PRIVATE_ATTR },
        values: { ...ttl.values },
    };
};

const emptyUsage = (): KVUsage => ({ read: 0, write: 0, cachedRead: 0 });

const readUsage = (units: number | undefined): KVUsage => ({
    read: Number(units ?? 0),
    write: 0,
    cachedRead: 0,
});

const writeUsage = (units: number | undefined): KVUsage => ({
    read: 0,
    write: Number(units ?? 0),
    cachedRead: 0,
});

const cachedReadUsage = (units: number): KVUsage => ({
    read: 0,
    write: 0,
    cachedRead: units,
});

const addUsage = (a: KVUsage, b: KVUsage): KVUsage => ({
    read: a.read + b.read,
    write: a.write + b.write,
    cachedRead: a.cachedRead + b.cachedRead,
});

const ensureActor = (opts?: KVOpts): Actor => opts?.actor ?? SYSTEM_ACTOR;

const isCrossApp = (opts?: KVOpts): boolean => Boolean(opts?.namespaceAppUuid);

// `effectiveApp`, not `app`, so the namespace agrees with the gate the driver
// applied: both read an access-token actor as the app that issued it, rather
// than the driver treating it as app-scoped while the store files its data
// under the shared global key.
const getNamespace = (actor: Actor, opts?: KVOpts): string => {
    if (isSystemActor(actor)) return SYSTEM_NAMESPACE;
    const appUuid =
        opts?.namespaceAppUuid ??
        actor.effectiveApp?.uid ??
        opts?.appUuid ??
        GLOBAL_APP_KEY;
    return `v1:${actor.user.uuid}:${appUuid}`;
};

const assertKey = (key: string): void => {
    if (key === '')
        throw new HttpError(400, 'kv: key is empty', {
            legacyCode: 'bad_request',
        });
    if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
        throw new HttpError(
            400,
            `kv: key exceeds ${MAX_KEY_BYTES} byte limit`,
            { legacyCode: 'bad_request' },
        );
    }
};

/**
 * Object keys we refuse to store or to walk, anywhere in a value or a document
 * path.
 *
 * `__proto__` is the prototype-pollution vector: any code that walks a
 * caller-supplied path (`createPaths` below, and every future traversal) would
 * step onto `Object.prototype` and write there. It also can't round-trip — the
 * AWS document client unmarshalls maps with plain assignment, so a stored
 * `__proto__` attribute comes back as the object's prototype instead of as
 * data. `constructor`/`prototype` are the second hop of the same walk, and a
 * map holding a `constructor` key fails the document client's own "is this a
 * plain object" test, which surfaces as an opaque 500 rather than a client
 * error.
 */
const UNSAFE_OBJECT_KEYS: ReadonlySet<string> = new Set([
    '__proto__',
    'constructor',
    'prototype',
]);

const unsafeKeyError = (key: string, subject: string): HttpError =>
    new HttpError(400, `kv: ${subject} \`${key}\` is not allowed`, {
        legacyCode: 'bad_request',
    });

/**
 * Reject a caller-supplied document path (`a.b.c`, optionally with `[0]` list
 * indexes) whose segments would walk onto the prototype chain.
 */
const assertPath = (valPath: string): void => {
    if (typeof valPath !== 'string')
        throw new HttpError(400, 'kv: path must be a string', {
            legacyCode: 'bad_request',
        });
    for (const chunk of valPath.split('.')) {
        const name = chunk.split(/\[\d*\]/g)[0];
        if (UNSAFE_OBJECT_KEYS.has(name))
            throw unsafeKeyError(name, 'path segment');
    }
};

const assertPaths = (paths: string[]): void => {
    for (const valPath of paths) assertPath(valPath);
};

const isOversizedExpression = (err: Error): boolean =>
    /expression size/i.test(err.message);

/**
 * Walk a value about to be stored and reject unsafe keys. Iterative so a deeply
 * nested value can't blow the stack; own keys only, matching what the document
 * client actually marshalls.
 */
const assertSafeValueKeys = (value: unknown): void => {
    const stack: unknown[] = [value];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object') continue;
        if (Array.isArray(current)) {
            stack.push(...current);
            continue;
        }
        for (const [k, v] of Object.entries(current)) {
            if (UNSAFE_OBJECT_KEYS.has(k)) throw unsafeKeyError(k, 'value key');
            stack.push(v);
        }
    }
};

const assertValue = (value: unknown): void => {
    const size = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    if (size > MAX_VALUE_BYTES) {
        throw new HttpError(
            400,
            `kv: value exceeds ${MAX_VALUE_BYTES} byte limit`,
            { legacyCode: 'bad_request' },
        );
    }
    assertSafeValueKeys(value);
};

const normalizePattern = (pattern?: string): string | undefined => {
    if (pattern === undefined || pattern === null) return undefined;
    if (typeof pattern !== 'string')
        throw new HttpError(400, 'kv: pattern must be a string', {
            legacyCode: 'bad_request',
        });
    const trimmed = pattern.trim();
    if (trimmed === '') return undefined;
    if (trimmed.endsWith('*')) {
        const prefix = trimmed.slice(0, -1);
        return prefix === '' ? undefined : prefix;
    }
    return trimmed;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const objectsEqual = (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (!rightKeys.includes(key)) return false;
        if (!objectsEqual(left[key], right[key])) return false;
    }
    return true;
};

const cleanAttrName = (chunk: string): string =>
    `#${chunk.replaceAll(PATH_CLEANER_REGEX, '')}`;

/** The `SET` assignment `incr` renders for one path. */
const incrSetStatement = (valPath: string, idx: number): string => {
    const attrName = ['value', ...valPath.split('.')]
        .filter(Boolean)
        .map(cleanAttrName)
        .join('.');
    return `${attrName} = if_not_exists(${attrName}, :start${idx}) + :incr${idx}`;
};

/**
 * Ceiling a caller assembling its own batches should keep each one under.
 *
 * The store rejects an update expression past its own size limit, and that
 * limit is on the rendered string — where every path appears twice, at its full
 * length — so a count of paths says nothing about whether a write will be
 * accepted. Sized below the limit so the optional TTL clause and any encoding
 * variance still fit.
 */
export const INCR_EXPRESSION_BUDGET_BYTES = 3584;

/** Size of the update expression `incr` would send for `paths`. */
export const incrExpressionBytes = (paths: string[]): number =>
    Buffer.byteLength(`SET ${paths.map(incrSetStatement).join(', ')}`);

/**
 * Split paths into batches whose expressions each fit `maxBytes`, preserving
 * order. A path always gets a batch even when it can't fit in one: a caller
 * narrowing down which path a rejection belongs to needs the single-path
 * attempt to happen rather than being told it is impossible.
 */
export const chunkPathsForIncr = (
    paths: string[],
    maxBytes: number = INCR_EXPRESSION_BUDGET_BYTES,
): string[][] => {
    const batches: string[][] = [];
    let batch: string[] = [];

    for (const path of paths) {
        const wouldOverflow =
            batch.length > 0 &&
            incrExpressionBytes([...batch, path]) > maxBytes;
        if (wouldOverflow) {
            batches.push(batch);
            batch = [];
        }
        batch.push(path);
    }
    if (batch.length > 0) batches.push(batch);

    return batches;
};

// -- SystemKVStore ----------------------------------------------------

/**
 * Underlying key-value store. Housed at the store layer so both services
 * (permissions, metering) and drivers (`puter-kvstore`) can share it.
 *
 * Every method returns `{ res, usage }` — `res` is the operation result,
 * `usage` is the DynamoDB consumed capacity split into read/write units so
 * callers can meter at the driver level when needed. No metering happens inside
 * the store itself.
 *
 * If `opts.actor` is omitted, operations are scoped to the system namespace.
 */
export class SystemKVStore extends PuterStore {
    private tableName = PUTER_KV_STORE_TABLE_NAME;
    private initialized: Promise<void> | null = null;

    #cache: KvCacheSettings = resolveKvCacheSettings(this.config);
    #pendingInvalidations = new Set<string>();
    #invalidationTimer: ReturnType<typeof setTimeout> | null = null;

    override async onServerStart(): Promise<void> {
        if (this.#cache.enabled) this.#subscribeRemoteInvalidations();

        // For local/dynalite runs we need to create the table up front.
        // Real AWS deployments provision tables externally (Terraform), so
        // we skip — unless the operator explicitly opts in via
        // `dynamo.bootstrapTables` (e.g. self-hosting against
        // dynamodb-local in docker-compose).
        const ddbConfig = this.config.dynamo ?? {};
        if (ddbConfig.aws && !ddbConfig.bootstrapTables) return;

        this.initialized = this.clients.dynamo.createTableIfNotExists(
            { ...PUTER_KV_STORE_TABLE_DEFINITION, TableName: this.tableName },
            'ttl',
        );
        await this.initialized;
    }

    override async onServerPrepareShutdown(): Promise<void> {
        if (this.#invalidationTimer) {
            clearTimeout(this.#invalidationTimer);
            this.#invalidationTimer = null;
        }
        // Peers would otherwise keep serving entries this node invalidated in
        // the last coalescing window.
        this.#flushInvalidationBroadcast();
    }

    // -- Read cache ---------------------------------------------------

    /**
     * Whether reads in this namespace may be served from the cache.
     *
     * The system namespace is where internal state lives — metering counters,
     * one-time codes, permission rows. Those callers read to decide something
     * on the spot and can't be handed a value that was true a moment ago, so
     * they always read through. It is also why nothing outside this store needs
     * to opt in or out: the namespace already says which kind of data it is.
     */
    #cacheable(namespace: string): boolean {
        return this.#cache.enabled && namespace !== SYSTEM_NAMESPACE;
    }

    /**
     * Look `keys` up in the cache. `resolved` holds the keys the cache answered
     * — a hit or a cached absence — and is what the caller subtracts from the
     * set it still has to fetch.
     */
    async #cacheRead(
        namespace: string,
        keys: string[],
    ): Promise<{
        items: KvCachedItem[];
        resolved: Set<string>;
        readUnits: number;
    }> {
        const empty = {
            items: [] as KvCachedItem[],
            resolved: new Set<string>(),
            readUnits: 0,
        };
        if (keys.length === 0) return empty;

        try {
            const raw =
                keys.length === 1
                    ? [
                          await this.clients.redis.get(
                              kvCacheKey(namespace, keys[0]),
                          ),
                      ]
                    : await this.#cachePipelineGet(namespace, keys);

            const items: KvCachedItem[] = [];
            const resolved = new Set<string>();
            let readUnits = 0;
            const now = Date.now() / 1000;

            keys.forEach((key, index) => {
                const cached = decodeCachedRead(raw[index], key);
                if (cached.state === 'hit') {
                    // The entry carries its own deadline and the cache TTL is
                    // only an upper bound on it, so an entry that lapsed since
                    // it was written counts as nothing cached at all.
                    if (cached.item.ttl && cached.item.ttl <= now) return;
                    items.push(cached.item);
                    resolved.add(key);
                    readUnits += cached.readUnits;
                    return;
                }
                if (cached.state === 'miss') {
                    resolved.add(key);
                    readUnits += cached.readUnits;
                }
            });

            return { items, resolved, readUnits };
        } catch (e) {
            // A cache that is down degrades to no cache, never to an error.
            console.warn(
                '[kv] read cache lookup failed:',
                (e as Error).message,
            );
            return empty;
        }
    }

    /**
     * Multi-key lookup as a pipeline rather than an `MGET`, so keys landing in
     * different hash slots don't have to share one.
     */
    async #cachePipelineGet(
        namespace: string,
        keys: string[],
    ): Promise<(string | null)[]> {
        const pipeline = this.clients.redis.pipeline();
        for (const key of keys) pipeline.get(kvCacheKey(namespace, key));
        const results = await pipeline.exec();
        return keys.map((_key, index) => {
            const entry = results?.[index];
            if (!entry || entry[0]) return null;
            return (entry[1] as string | null) ?? null;
        });
    }

    /**
     * Cache what a read just fetched. `keys` is what was asked of the
     * underlying store, so a key with no entry in `items` is cached as a known
     * absence.
     */
    #cachePopulate(params: {
        namespace: string;
        keys: string[];
        items: KvCachedItem[];
        readUnitsPerKey: number;
        startedAt: number;
    }): void {
        // A write that landed during this read left a block marker, and `NX`
        // below is what keeps the pre-write value out — but only for as long as
        // the marker lives. A read slower than that can no longer show its value
        // is the current one, so it doesn't get to cache it.
        if (Date.now() - params.startedAt > this.#cache.blockSeconds * 1000) {
            return;
        }

        const now = Date.now() / 1000;
        const byKey = new Map(params.items.map((item) => [item.key, item]));
        const writes: Array<{ key: string; payload: string; ttl: number }> = [];

        for (const key of params.keys) {
            const item = byKey.get(key);
            const ttl = item
                ? cacheTtlSecondsFor(this.#cache, item.ttl, now)
                : this.#cache.missTtlSeconds;
            if (ttl === null) continue;
            const payload = item
                ? encodeCachedHit(item, params.readUnitsPerKey)
                : encodeCachedMiss(params.readUnitsPerKey);
            if (
                Buffer.byteLength(payload, 'utf8') > this.#cache.maxEntryBytes
            ) {
                continue;
            }
            writes.push({
                key: kvCacheKey(params.namespace, key),
                payload,
                ttl,
            });
        }
        if (writes.length === 0) return;

        // Deliberately not awaited: a read shouldn't wait on its own cache fill.
        const pipeline = this.clients.redis.pipeline();
        for (const { key, payload, ttl } of writes) {
            pipeline.set(key, payload, 'EX', ttl, 'NX');
        }
        void Promise.resolve(pipeline.exec()).catch((e: unknown) => {
            console.warn(
                '[kv] read cache populate failed:',
                (e as Error).message,
            );
        });
    }

    /**
     * Stop serving cached reads for `keys`, here and in every peer region.
     *
     * Awaited for the local part so a caller's own next read can't be answered
     * from the cache it just made wrong; the broadcast is fire-and-forget.
     */
    async #invalidate(namespace: string, keys: string[]): Promise<void> {
        if (!this.#cacheable(namespace) || keys.length === 0) return;
        const cacheKeys = [...new Set(keys)].map((key) =>
            kvCacheKey(namespace, key),
        );
        await this.publishCacheKeys({
            keys: cacheKeys,
            serializedData: KV_CACHE_BLOCK_MARKER,
            ttlSeconds: this.#cache.blockSeconds,
        });
        this.#queueInvalidationBroadcast(cacheKeys);
    }

    /**
     * Accumulate invalidations and send them as one message.
     *
     * Every broadcast is serialized twice on the way out — once to dedupe it,
     * once to sign it — and a per-write message would pay both plus its own
     * envelope for a single cache key. Batching keeps a write-heavy namespace
     * from turning the cache into a net cost.
     */
    #queueInvalidationBroadcast(cacheKeys: string[]): void {
        for (const key of cacheKeys) this.#pendingInvalidations.add(key);

        if (this.#cache.broadcastCoalesceMs === 0) {
            this.#flushInvalidationBroadcast();
            return;
        }
        if (this.#invalidationTimer) return;
        this.#invalidationTimer = setTimeout(() => {
            this.#invalidationTimer = null;
            this.#flushInvalidationBroadcast();
        }, this.#cache.broadcastCoalesceMs);
        this.#invalidationTimer.unref?.();
    }

    #flushInvalidationBroadcast(): void {
        if (this.#pendingInvalidations.size === 0) return;
        const cacheKeys = [...this.#pendingInvalidations];
        this.#pendingInvalidations.clear();

        for (let i = 0; i < cacheKeys.length; i += KV_CACHE_BROADCAST_CHUNK) {
            this.clients.event.emit(
                'outer.kv.cacheInvalidated',
                {
                    cacheKeys: cacheKeys.slice(i, i + KV_CACHE_BROADCAST_CHUNK),
                },
                {},
            );
        }
    }

    /**
     * Apply invalidations a peer region sent us.
     *
     * A marker, not a delete, and for the local block window rather than
     * anything the sender named: the entry reaches this region's copy of the
     * underlying store on its own schedule, so the point is to keep reads going
     * through until it has.
     */
    #subscribeRemoteInvalidations(): void {
        this.clients.event.on(
            'outer.kv.cacheInvalidated',
            (_key, data, meta) => {
                // Our own emit reaches local listeners too, and the local half
                // of the invalidation already ran before it went out.
                if (!(meta as { from_outside?: boolean })?.from_outside) return;

                const cacheKeys =
                    (data as { cacheKeys?: unknown })?.cacheKeys ?? [];
                if (!Array.isArray(cacheKeys)) return;
                const keys = cacheKeys.filter(
                    (key): key is string =>
                        typeof key === 'string' && key !== '',
                );
                if (keys.length === 0) return;

                void this.publishCacheKeys({
                    keys,
                    serializedData: KV_CACHE_BLOCK_MARKER,
                    ttlSeconds: this.#cache.blockSeconds,
                });
            },
        );
    }

    // -- Public API ---------------------------------------------------

    /**
     * Refuse a cross-app mutation against a private entry. Not atomic with the
     * write that follows, so one in-flight write can still land on an entry the
     * owner flags in between.
     */
    async #assertNotPrivate(
        namespace: string,
        key: string,
        opts?: KVOpts,
    ): Promise<KVUsage> {
        if (!isCrossApp(opts)) return emptyUsage();
        const response = await this.clients.dynamo.get(this.tableName, {
            namespace,
            key,
        });
        if (response.Item?.[KV_PRIVATE_ATTR]) {
            throw new HttpError(
                403,
                'kv: this entry is private to the app that wrote it',
                { legacyCode: 'forbidden' },
            );
        }
        // Returned rather than swallowed: the probe is a real read, and a caller
        // that did not pay for it is under-billed for the operation.
        return readUsage(
            response.ConsumedCapacity?.CapacityUnits as number | undefined,
        );
    }

    /**
     * The batch form: one batched read for every key rather than a round trip
     * each, which would turn a single batched write into N+1 calls.
     */
    async #assertNonePrivate(
        namespace: string,
        keys: string[],
        opts?: KVOpts,
    ): Promise<KVUsage> {
        if (!isCrossApp(opts) || keys.length === 0) return emptyUsage();
        const { entries, usage } = await this.getBatches(namespace, keys);
        const isPrivate = entries.some((entry) => entry?.noShare);
        if (isPrivate) {
            throw new HttpError(
                403,
                'kv: this entry is private to the app that wrote it',
                { legacyCode: 'forbidden' },
            );
        }
        return usage;
    }

    async get(
        {
            key,
            consistentRead,
        }: { key: string | string[]; consistentRead?: boolean },
        opts?: KVOpts,
    ): Promise<KVResult<unknown | null | (unknown | null)[]>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const crossApp = isCrossApp(opts);
        const multi = Array.isArray(key);
        const keys = multi ? key : [key];

        for (const k of keys) assertKey(k);

        let kvEntries: KvCachedItem[] = [];
        let usage = emptyUsage();

        // A consistent read is asking for the source of truth by definition.
        const useCache = !consistentRead && this.#cacheable(namespace);
        // Deduped so a key repeated in a batch is looked up — and charged for —
        // once, matching what `getBatches` already does.
        const wanted = [...new Set(keys)];
        let toFetch = wanted;

        if (useCache) {
            const cached = await this.#cacheRead(namespace, wanted);
            kvEntries = cached.items;
            usage = addUsage(usage, cachedReadUsage(cached.readUnits));
            toFetch = wanted.filter((k) => !cached.resolved.has(k));
        }

        if (toFetch.length > 0) {
            const startedAt = Date.now();
            let fetched: KvCachedItem[];
            let fetchUnits: number;

            if (multi) {
                const { entries, usage: u } = await this.getBatches(
                    namespace,
                    toFetch,
                );
                fetched = entries;
                fetchUnits = u.read;
            } else {
                const response = await this.clients.dynamo.get(
                    this.tableName,
                    { namespace, key: toFetch[0] },
                    consistentRead,
                );
                fetched = response.Item ? [response.Item as KvCachedItem] : [];
                fetchUnits = Number(
                    (response.ConsumedCapacity?.CapacityUnits as
                        number | undefined) ?? 0,
                );
            }

            kvEntries = kvEntries.concat(fetched);
            usage = addUsage(usage, readUsage(fetchUnits));

            if (useCache) {
                // Capacity is reported per call, not per item, so a cached read
                // replays the batch's average rather than an exact figure.
                this.#cachePopulate({
                    namespace,
                    keys: toFetch,
                    items: fetched,
                    readUnitsPerKey: fetchUnits / toFetch.length,
                    startedAt,
                });
            }
        }

        const now = Date.now() / 1000;
        const values = keys.map((k) => {
            const entry = kvEntries.find((e) => e.key === k);
            if (!entry) return null;
            if (entry.ttl && entry.ttl <= now) return null;
            // Absent rather than refused: the flag must not confirm the key.
            if (crossApp && entry.noShare) return null;
            return entry.value ?? null;
        });

        return { res: multi ? values : values[0], usage };
    }

    async set(
        {
            key,
            value,
            expireAt,
            disableSharing,
        }: {
            key: string;
            value: unknown;
            expireAt?: number;
            /**
             * Mark the entry private. `put` replaces the item, so omitting it
             * on a later write is how the owner re-shares the entry.
             */
            disableSharing?: boolean;
        },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        assertKey(key);
        assertValue(value);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const response = await this.clients.dynamo.put(this.tableName, {
            namespace,
            key,
            value,
            ttl: expireAt,
            ...(disableSharing ? { [KV_PRIVATE_ATTR]: true } : {}),
        });
        await this.#invalidate(namespace, [key]);

        return {
            res: true,
            usage: addUsage(
                probeUsage,
                writeUsage(
                    response.ConsumedCapacity?.CapacityUnits as
                        number | undefined,
                ),
            ),
        };
    }

    async batchPut(
        {
            items,
            disableSharing,
        }: {
            items: Array<{ key: string; value: unknown; expireAt?: number }>;
            /**
             * Marks every entry in the batch private, as `set` does for one.
             * Batch-wide rather than per-item: it arrives on the same trailing
             * options object the single form takes.
             */
            disableSharing?: boolean;
        },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        if (!Array.isArray(items) || items.length === 0) {
            return { res: true, usage: emptyUsage() };
        }

        const byKey = new Map<
            string,
            { key: string; value: unknown; expireAt?: number }
        >();
        for (const item of items) {
            const k = String(item.key);
            assertKey(k);
            assertValue(item.value);
            byKey.set(k, {
                key: k,
                value: item.value,
                expireAt: item.expireAt,
            });
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        // One private key refuses the batch — no partial success to probe with.
        const probeUsage = await this.#assertNonePrivate(
            namespace,
            [...byKey.keys()],
            opts,
        );

        const putParams = Array.from(byKey.values()).map((item) => ({
            table: this.tableName,
            item: {
                namespace,
                key: item.key,
                value: item.value,
                ttl: item.expireAt,
                ...(disableSharing ? { [KV_PRIVATE_ATTR]: true } : {}),
            },
        }));

        const response = await this.clients.dynamo.batchPut(putParams);
        await this.#invalidate(namespace, [...byKey.keys()]);
        const units =
            response.ConsumedCapacity?.reduce(
                (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                0,
            ) ?? byKey.size;

        return {
            res: true,
            usage: addUsage(probeUsage, writeUsage(units || byKey.size)),
        };
    }

    async del(
        { key }: { key: string },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const response = await this.clients.dynamo.del(this.tableName, {
            namespace,
            key,
        });
        await this.#invalidate(namespace, [key]);
        return {
            res: true,
            usage: addUsage(
                probeUsage,
                writeUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        number | undefined) ?? 1,
                ),
            ),
        };
    }

    async list(
        {
            as,
            limit,
            cursor,
            pattern,
            offset,
            includeTotal,
            fetchUntilFull,
        }: {
            as?: 'keys' | 'values' | 'entries';
            limit?: number;
            cursor?: string | Record<string, unknown>;
            pattern?: string;
            offset?: number;
            includeTotal?: boolean;
            fetchUntilFull?: boolean;
        },
        opts?: KVOpts,
    ): Promise<
        KVResult<
            | string[]
            | unknown[]
            | { key: string; value: unknown }[]
            | {
                  items:
                      string[] | unknown[] | { key: string; value: unknown }[];
                  cursor?: string;
                  total?: number;
              }
        >
    > {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const normalizedLimit = normalizeLimit(limit, { label: 'kv: limit' });
        const normalizedOffset = normalizeOffset(offset, {
            cap: MAX_LIST_OFFSET,
            label: 'kv: offset',
        });
        const pageKey = decodeCursor(cursor, 'kv: cursor');
        const normalizedPattern = normalizePattern(pattern);

        if (pageKey !== undefined && normalizedOffset !== undefined) {
            throw new HttpError(
                400,
                'kv: cursor and offset cannot be combined',
                {
                    legacyCode: 'bad_request',
                },
            );
        }
        if (fetchUntilFull && normalizedLimit === undefined) {
            throw new HttpError(400, 'kv: fetchUntilFull requires limit', {
                legacyCode: 'bad_request',
            });
        }

        const kind = as ?? 'entries';
        if (!['keys', 'values', 'entries'].includes(kind)) {
            throw new HttpError(
                400,
                'kv: list "as" must be keys, values, or entries',
                { legacyCode: 'bad_request' },
            );
        }

        const paginated =
            normalizedLimit !== undefined ||
            pageKey !== undefined ||
            normalizedOffset !== undefined ||
            includeTotal === true ||
            fetchUntilFull === true;

        const now = Date.now() / 1000;
        let usage = emptyUsage();
        const runQuery = async (
            qLimit: number,
            startKey?: Record<string, unknown>,
            select?: 'COUNT',
        ) => {
            const response = await this.clients.dynamo.query(
                this.tableName,
                { namespace },
                qLimit,
                startKey,
                '',
                false,
                {
                    ...(normalizedPattern
                        ? {
                              beginsWith: {
                                  key: 'key',
                                  value: normalizedPattern,
                              },
                          }
                        : {}),
                    filter: listFilter(now, isCrossApp(opts)),
                    ...(select ? { select } : {}),
                },
            );
            usage = addUsage(
                usage,
                readUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        number | undefined) ?? 1,
                ),
            );
            return response;
        };

        // Offset emulation: COUNT queries advance the page key past the
        // skipped rows without transferring item data. Cost is still
        // proportional to the offset — cursors are the cheap path.
        let startKey = pageKey;
        let exhausted = false;
        if (normalizedOffset !== undefined && normalizedOffset > 0) {
            let remaining = normalizedOffset;
            while (remaining > 0) {
                const skip = await runQuery(remaining, startKey, 'COUNT');
                remaining -= Number(skip.Count ?? 0);
                startKey = skip.LastEvaluatedKey as
                    Record<string, unknown> | undefined;
                if (!startKey) {
                    exhausted = remaining > 0;
                    break;
                }
            }
        }

        const collected: Array<Record<string, unknown>> = [];
        let nextKey = startKey;
        if (!exhausted) {
            let pages = 0;
            do {
                const want = normalizedLimit
                    ? normalizedLimit - collected.length
                    : 0;
                const response = await runQuery(want, nextKey);
                collected.push(
                    ...((response.Items ?? []) as Array<
                        Record<string, unknown>
                    >),
                );
                nextKey = response.LastEvaluatedKey as
                    Record<string, unknown> | undefined;
                pages++;
                if (normalizedLimit === undefined) {
                    // Legacy full listing: follow continuation pages so the
                    // result is complete rather than capped at one response.
                    if (!nextKey) break;
                } else if (
                    !fetchUntilFull ||
                    collected.length >= normalizedLimit ||
                    !nextKey ||
                    pages >= MAX_FILL_PAGES
                ) {
                    break;
                }
            } while (true);
        }

        const entries = collected
            .filter((e) => e && (!e.ttl || (e.ttl as number) > now))
            .map((e) => ({ key: e.key as string, value: e.value }));

        let items: string[] | unknown[] | { key: string; value: unknown }[] =
            entries;
        if (kind === 'keys') items = entries.map((e) => e.key);
        else if (kind === 'values') items = entries.map((e) => e.value);

        if (!paginated) return { res: items, usage };

        let total: number | undefined;
        if (includeTotal) {
            total = 0;
            let countKey: Record<string, unknown> | undefined;
            do {
                const counted = await runQuery(0, countKey, 'COUNT');
                total += Number(counted.Count ?? 0);
                countKey = counted.LastEvaluatedKey as
                    Record<string, unknown> | undefined;
            } while (countKey);
        }

        const nextCursor = encodeCursor(nextKey);
        return {
            res: {
                items,
                ...(nextCursor ? { cursor: nextCursor } : {}),
                ...(total !== undefined ? { total } : {}),
            },
            usage,
        };
    }

    async flush(opts?: KVOpts): Promise<KVResult<boolean>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const response = await this.clients.dynamo.query(this.tableName, {
            namespace,
        });
        let usage = readUsage(
            response.ConsumedCapacity?.CapacityUnits as number | undefined,
        );

        const entries = response.Items ?? [];
        const results = (
            await Promise.all(
                entries.map(async (entry) => {
                    try {
                        return await this.clients.dynamo.del(this.tableName, {
                            namespace,
                            key: entry.key,
                        });
                    } catch (e) {
                        console.error('[kv] flush delete failed', entry.key, e);
                        return null;
                    }
                }),
            )
        ).filter(Boolean);

        const deleteUnits = results.reduce(
            (acc, r) => acc + Number(r?.ConsumedCapacity?.CapacityUnits ?? 0),
            0,
        );
        usage = addUsage(usage, writeUsage(deleteUnits));

        // Exactly the keys the query saw, which is also exactly what was
        // deleted — anything a truncated query missed is still there to read.
        await this.#invalidate(
            namespace,
            entries.map((entry) => String(entry.key)),
        );

        return { res: true, usage };
    }

    async expireAt(
        { key, timestamp }: { key: string; timestamp: number },
        opts?: KVOpts,
    ): Promise<KVResult<void>> {
        assertKey(key);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);
        const usage = await this.rawExpireAt(namespace, key, Number(timestamp));
        await this.#invalidate(namespace, [key]);
        return { res: undefined, usage: addUsage(probeUsage, usage) };
    }

    async expire(
        { key, ttl }: { key: string; ttl: number },
        opts?: KVOpts,
    ): Promise<KVResult<void>> {
        assertKey(key);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);
        const timestamp = Math.floor(Date.now() / 1000) + Number(ttl);
        const usage = await this.rawExpireAt(namespace, key, timestamp);
        await this.#invalidate(namespace, [key]);
        return { res: undefined, usage: addUsage(probeUsage, usage) };
    }

    async incr<T extends Record<string, number>>(
        {
            key,
            pathAndAmountMap,
            expireAt,
        }: { key: string; pathAndAmountMap: T; expireAt?: number },
        opts?: KVOpts,
    ): Promise<
        KVResult<T extends { '': number } ? number : RecursiveRecord<number>>
    > {
        assertKey(key);
        if (!pathAndAmountMap || Object.keys(pathAndAmountMap).length === 0)
            throw new HttpError(400, 'kv: incr requires pathAndAmountMap', {
                legacyCode: 'bad_request',
            });
        if (
            Object.values(pathAndAmountMap).some((v) => typeof v !== 'number')
        ) {
            throw new HttpError(
                400,
                'kv: all values in pathAndAmountMap must be numbers',
                { legacyCode: 'bad_request' },
            );
        }
        assertPaths(Object.keys(pathAndAmountMap));

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const setStatements = Object.keys(pathAndAmountMap).map(
            (valPath, idx) => incrSetStatement(valPath, idx),
        );
        const valueAttributeValues = Object.entries(pathAndAmountMap).reduce(
            (acc, [_path, amt], idx) => {
                acc[`:incr${idx}`] = amt;
                acc[`:start${idx}`] = 0;
                return acc;
            },
            {} as Record<string, number>,
        );
        const valueAttributeNames = Object.entries(pathAndAmountMap).reduce(
            (acc, [valPath]) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        // Fold the TTL into the same UpdateItem so a counter bump is a single
        // write instead of incr + a separate expireAt. if_not_exists keeps the
        // first stamp for the key (re-stamping the same value was always a
        // no-op) — but now we don't pay for that extra write on every bump.
        if (expireAt !== undefined) {
            const ttlSeconds = Number(expireAt);
            if (Number.isNaN(ttlSeconds))
                throw new HttpError(400, 'kv: expireAt must be a number', {
                    legacyCode: 'bad_request',
                });
            setStatements.push('#ttl = if_not_exists(#ttl, :ttl)');
            valueAttributeValues[':ttl'] = ttlSeconds;
            valueAttributeNames['#ttl'] = 'ttl';
        }

        const updateExpression = `SET ${setStatements.join(', ')}`;
        const expressionNames = { ...valueAttributeNames, '#value': 'value' };
        const runUpdate = () =>
            this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                updateExpression,
                valueAttributeValues,
                expressionNames,
            );

        // Most increments land on an item whose parent maps already exist (a
        // day's counter is created once, then bumped on every event), so try
        // the update directly and only pay the per-layer createPaths writes
        // when a nested parent is genuinely missing — typically the first bump
        // for a key. Mirrors the lazy ValidationException fallback in remove().
        let createPathsUsage = 0;
        let response;
        try {
            response = await runUpdate();
        } catch (e) {
            const err = e as Error;
            if (err?.name !== 'ValidationException') throw e;
            // An expression rejected for its own size is the one
            // ValidationException createPaths cannot repair: it writes a layer
            // per nested path — against this same item, so each of those writes
            // costs the whole item — and then re-sends a byte-identical
            // expression to be rejected again. Fail fast and let the caller
            // send fewer paths at a time.
            if (isOversizedExpression(err)) throw e;
            createPathsUsage = await this.createPaths(
                namespace,
                key,
                Object.keys(pathAndAmountMap),
            );
            response = await runUpdate();
        }
        await this.#invalidate(namespace, [key]);

        const usage = addUsage(
            probeUsage,
            writeUsage(
                Number(response.ConsumedCapacity?.CapacityUnits ?? 0) +
                    createPathsUsage,
            ),
        );

        return { res: response.Attributes?.value, usage };
    }

    async decr<T extends Record<string, number>>(
        { key, pathAndAmountMap }: { key: string; pathAndAmountMap: T },
        opts?: KVOpts,
    ): Promise<
        KVResult<T extends { '': number } ? number : RecursiveRecord<number>>
    > {
        const negated = Object.fromEntries(
            Object.entries(pathAndAmountMap).map(([k, v]) => [k, -v]),
        ) as T;
        return this.incr({ key, pathAndAmountMap: negated }, opts);
    }

    async add(
        {
            key,
            pathAndValueMap,
        }: { key: string; pathAndValueMap: Record<string, unknown> },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!pathAndValueMap || Object.keys(pathAndValueMap).length === 0) {
            throw new HttpError(400, 'kv: add requires pathAndValueMap', {
                legacyCode: 'bad_request',
            });
        }
        for (const val of Object.values(pathAndValueMap)) {
            assertValue(val);
        }
        assertPaths(Object.keys(pathAndValueMap));

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const createPathsUsage = await this.createPaths(
            namespace,
            key,
            Object.keys(pathAndValueMap),
        );

        const setStatements = Object.entries(pathAndValueMap).map(
            ([valPath], idx) => {
                const attrName = ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .map(cleanAttrName)
                    .join('.');
                return `${attrName} = list_append(if_not_exists(${attrName}, :emptyList${idx}), :append${idx})`;
            },
        );
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce(
            (acc, [_path, val], idx) => {
                acc[`:append${idx}`] = Array.isArray(val) ? val : [val];
                acc[`:emptyList${idx}`] = [];
                return acc;
            },
            {} as Record<string, unknown>,
        );
        const valueAttributeNames = Object.entries(pathAndValueMap).reduce(
            (acc, [valPath]) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            `SET ${setStatements.join(', ')}`,
            valueAttributeValues,
            { ...valueAttributeNames, '#value': 'value' },
        );
        await this.#invalidate(namespace, [key]);

        const usage = addUsage(
            probeUsage,
            writeUsage(
                Number(response.ConsumedCapacity?.CapacityUnits ?? 0) +
                    createPathsUsage,
            ),
        );

        return { res: response.Attributes?.value, usage };
    }

    async remove(
        { key, paths }: { key: string; paths: string[] },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!paths || paths.length === 0) {
            throw new HttpError(400, 'kv: remove requires paths', {
                legacyCode: 'bad_request',
            });
        }
        assertPaths(paths);

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const removeStatements = paths.map((valPath) => {
            return ['value', ...valPath.split('.')]
                .filter(Boolean)
                .map((chunk) => {
                    const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                    const indexSuffix = chunk.slice(cleanedChunk.length);
                    return `${cleanAttrName(cleanedChunk)}${indexSuffix}`;
                })
                .join('.');
        });
        const valueAttributeNames = paths.reduce(
            (acc, valPath) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        try {
            const response = await this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                `REMOVE ${removeStatements.join(', ')}`,
                undefined,
                { ...valueAttributeNames, '#value': 'value' },
            );
            await this.#invalidate(namespace, [key]);
            return {
                res: response.Attributes?.value,
                usage: addUsage(
                    probeUsage,
                    writeUsage(
                        (response.ConsumedCapacity?.CapacityUnits as
                            number | undefined) ?? 1,
                    ),
                ),
            };
        } catch (e) {
            const err = e as Error;
            if (
                err?.name === 'ValidationException' &&
                /document path|invalid updateexpression/i.test(err.message)
            ) {
                // Path didn't exist — treat as no-op, return current value
                const fallback = await this.get({ key }, opts);
                return {
                    res: fallback.res,
                    usage: addUsage(
                        probeUsage,
                        addUsage(fallback.usage, writeUsage(1)),
                    ),
                };
            }
            throw e;
        }
    }

    async update(
        {
            key,
            pathAndValueMap,
            ttl,
        }: {
            key: string;
            pathAndValueMap: Record<string, unknown>;
            ttl?: number;
        },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!pathAndValueMap || Object.keys(pathAndValueMap).length === 0) {
            throw new HttpError(400, 'kv: update requires pathAndValueMap', {
                legacyCode: 'bad_request',
            });
        }
        for (const val of Object.values(pathAndValueMap)) {
            assertValue(val);
        }
        assertPaths(Object.keys(pathAndValueMap));

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const createPathsUsage = await this.createPaths(
            namespace,
            key,
            Object.keys(pathAndValueMap),
        );

        const setStatements = Object.entries(pathAndValueMap).map(
            ([valPath], idx) => {
                const attrName = ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .map(cleanAttrName)
                    .join('.');
                return `${attrName} = :value${idx}`;
            },
        );
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce(
            (acc, [_path, val], idx) => {
                acc[`:value${idx}`] = val;
                return acc;
            },
            {} as Record<string, unknown>,
        );
        const valueAttributeNames = Object.entries(pathAndValueMap).reduce(
            (acc, [valPath]) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        if (ttl !== undefined) {
            const ttlSeconds = Number(ttl);
            if (Number.isNaN(ttlSeconds))
                throw new HttpError(400, 'kv: ttl must be a number', {
                    legacyCode: 'bad_request',
                });
            const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
            setStatements.push('#ttl = :ttl');
            valueAttributeValues[':ttl'] = timestamp;
            valueAttributeNames['#ttl'] = 'ttl';
        }

        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            `SET ${setStatements.join(', ')}`,
            valueAttributeValues,
            { ...valueAttributeNames, '#value': 'value' },
        );

        await this.#invalidate(namespace, [key]);

        const usage = addUsage(
            probeUsage,
            writeUsage(
                Number(response.ConsumedCapacity?.CapacityUnits ?? 0) +
                    createPathsUsage,
            ),
        );

        return { res: response.Attributes?.value, usage };
    }

    // -- Internals ----------------------------------------------------

    private async getBatches(
        namespace: string,
        allKeys: string[],
    ): Promise<{
        entries: KvCachedItem[];
        usage: KVUsage;
    }> {
        const batches: string[][] = [];
        for (let i = 0; i < allKeys.length; i += BATCH_GET_CHUNK) {
            batches.push(allKeys.slice(i, i + BATCH_GET_CHUNK));
        }

        const results = await Promise.all(
            batches.map(async (keys) => {
                const requests = [...new Set(keys)].map((k) => ({
                    table: this.tableName,
                    items: { namespace, key: k },
                }));
                const response = await this.clients.dynamo.batchGet(requests);
                const entries = (response.Responses?.[this.tableName] ??
                    []) as KvCachedItem[];
                const units =
                    response.ConsumedCapacity?.reduce(
                        (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                        0,
                    ) ?? 0;
                return { entries, units };
            }),
        );

        return results.reduce(
            (acc, curr) => {
                acc.entries.push(...curr.entries);
                acc.usage.read += curr.units;
                return acc;
            },
            {
                entries: [] as KvCachedItem[],
                usage: emptyUsage(),
            },
        );
    }

    private async rawExpireAt(
        namespace: string,
        key: string,
        timestamp: number,
    ): Promise<KVUsage> {
        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            'SET #ttl = :ttl, #value = if_not_exists(#value, :defaultValue)',
            { ':ttl': timestamp, ':defaultValue': null },
            { '#ttl': 'ttl', '#value': 'value' },
        );
        return writeUsage(
            (response.ConsumedCapacity?.CapacityUnits as number | undefined) ??
                1,
        );
    }

    /**
     * Ensure each intermediate map layer exists for a set of nested paths.
     * Returns write units consumed. DDB can't set nested paths on missing
     * parents in one expression, so we walk the layers and `SET ...
     * if_not_exists(..., {})` each one.
     */
    private async createPaths(
        namespace: string,
        key: string,
        pathList: string[],
    ): Promise<number> {
        assertPaths(pathList);

        const nestedMapValue = (() => {
            const valueRoot: Record<string, unknown> = {};
            let hasPaths = false;
            pathList.forEach((valPath) => {
                if (!valPath) return;
                hasPaths = true;
                const chunks = valPath.split('.').filter(Boolean);
                let cursor: Record<string, unknown> = valueRoot;
                for (let i = 0; i < chunks.length - 1; i++) {
                    const chunk = chunks[i];
                    // Own properties only: an inherited hit here would mean
                    // walking (and then writing to) the prototype chain.
                    const existing = Object.hasOwn(cursor, chunk)
                        ? cursor[chunk]
                        : undefined;
                    if (!isPlainObject(existing)) {
                        cursor[chunk] = {};
                    }
                    cursor = cursor[chunk] as Record<string, unknown>;
                }
            });
            return hasPaths ? valueRoot : null;
        })();

        if (!nestedMapValue) return 0;

        const allIntermediatePaths = new Set<string>();
        pathList.forEach((valPath) => {
            const chunks = ['value', ...valPath.split('.')].filter(Boolean);
            for (let i = 1; i < chunks.length; i++) {
                allIntermediatePaths.add(chunks.slice(0, i).join('.'));
            }
        });

        let writeUnits = 0;
        const orderedPaths = [...allIntermediatePaths].sort(
            (left, right) => left.split('.').length - right.split('.').length,
        );

        for (const layerPath of orderedPaths) {
            const chunks = layerPath.split('.');
            const attrName = chunks.map(cleanAttrName).join('.');
            const expressionNames: Record<string, string> = {};
            chunks.forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                expressionNames[cleanAttrName(cleanedChunk)] = cleanedChunk;
            });
            const isRootLayer = layerPath === 'value';
            const expressionValues = isRootLayer
                ? { ':nestedMap': nestedMapValue }
                : { ':emptyMap': {} };
            const valueToken = isRootLayer ? ':nestedMap' : ':emptyMap';

            const response = await this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                `SET ${attrName} = if_not_exists(${attrName}, ${valueToken})`,
                expressionValues,
                expressionNames,
            );
            writeUnits += Number(response.ConsumedCapacity?.CapacityUnits ?? 0);

            if (
                isRootLayer &&
                objectsEqual(response.Attributes?.value, nestedMapValue)
            ) {
                return writeUnits;
            }
        }
        return writeUnits;
    }
}
