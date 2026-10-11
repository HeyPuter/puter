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

import type { puterClients } from '../clients';
import type { IExtensionClientInstances } from '../clients/types';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

/**
 * Built-in store registry, populated by declaration merging from
 * `stores/index.ts` to avoid a circular `typeof puterStores` reference.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IPuterStoreInstances {}

/** Extension-augmentable store registry; see `IExtensionClientInstances`. */
export interface IExtensionStoreInstances {
    [key: string]: unknown;
}

/**
 * `stores` is typed as the full registry, but at construction time only stores
 * declared earlier exist. Read `this.stores.X` from lifecycle or handler
 * methods, not constructors.
 */
export type IPuterStore<T extends WithLifecycle = WithLifecycle> = new (
    config: IConfig,
    clients: LayerInstances<typeof puterClients> & IExtensionClientInstances,
    stores: IPuterStoreInstances & IExtensionStoreInstances,
) => T;

const DEFAULT_BROADCAST_REFRESH_TTL_SECONDS = 15 * 60;

// Tombstone lifetime; must outlast replica lag.
export const CACHE_TOMBSTONE_TTL_SECONDS = 60;
export const CACHE_TOMBSTONE_SUFFIX = ':deleted';

/** A tombstone marker rather than a cached row; peers must set it, not drop it. */
export const isCacheTombstoneKey = (key: string): boolean =>
    key.endsWith(CACHE_TOMBSTONE_SUFFIX);

type PublishCacheKeysParams = {
    keys: string[];
    serializedData?: string;
    ttlSeconds?: number;
    broadcast?: boolean;
};

/** The store primitives a {@link RowCache} writes through. */
interface RowCacheHost {
    redis: () => LayerInstances<typeof puterClients>['redis'];
    publish: (params: PublishCacheKeysParams) => Promise<void>;
    tombstone: (keys: string[]) => Promise<void>;
    clearTombstones: (keys: string[]) => Promise<void>;
    tombstoned: (keys: string[]) => Promise<Set<string>>;
    writeUnlessDeleted: (
        keys: string[],
        write: () => Promise<void>,
    ) => Promise<void>;
}

export interface RowCacheOptions<T> {
    /** Keys are `<prefix>:<prop>:<value>`. */
    prefix: string;
    /** The identifying properties a row is cached under. */
    props: readonly string[];
    ttlSeconds: number;
    /** The subset of `keysFor(row)` a read may cache `row` under. */
    writeKeysFor?: (row: T) => string[];
    /** Rehydrates a parsed hit. */
    revive?: (row: T) => T | null;
}

type InFlightLoad = { json: string | null } | { error: unknown };

/** One pipelined round of GETs; a miss, or any failure, reads as null. */
export const readCacheValues = async (
    redis: Pick<LayerInstances<typeof puterClients>['redis'], 'pipeline'>,
    keys: string[],
): Promise<Array<string | null>> => {
    if (keys.length === 0) return [];
    try {
        const pipeline = redis.pipeline();
        for (const key of keys) pipeline.get(key);
        const results = (await pipeline.exec()) ?? [];
        return keys.map((_, i) => {
            const raw = results[i]?.[1];
            return typeof raw === 'string' ? raw : null;
        });
    } catch {
        return keys.map((): string | null => null);
    }
};

/**
 * Read-through cache for rows found by several identifying properties, each key
 * holding the whole row. Writes skip tombstoned keys, so a lagging replica
 * can't cache a deleted row back; refresh and invalidate reach peers.
 */
export class RowCache<T extends object> {
    readonly #inFlight = new Map<string, Promise<InFlightLoad>>();

    constructor(
        private readonly host: RowCacheHost,
        private readonly options: RowCacheOptions<T>,
    ) {}

    key(prop: string, value: unknown): string {
        return `${this.options.prefix}:${prop}:${String(value)}`;
    }

    /** Every key `row` can be found under; invalidation drops all of them. */
    keysFor(row: T): string[] {
        const keys: string[] = [];
        for (const prop of this.options.props) {
            const value = (row as Record<string, unknown>)[prop];
            if (value === undefined || value === null || value === '') continue;
            keys.push(this.key(prop, value));
        }
        return keys;
    }

    async read(key: string): Promise<T | null> {
        try {
            return this.#parse(await this.host.redis().get(key));
        } catch {
            return null;
        }
    }

    /** One pipelined read; a miss is `null`. */
    async readMany(keys: string[]): Promise<Array<T | null>> {
        const values = await readCacheValues(this.host.redis(), keys);
        return values.map((raw) => this.#parse(raw));
    }

    /**
     * The row under `key`, else `load`ed and cached. `load` reads the primary
     * when asked to or when `key` is tombstoned. Concurrent replica loads of
     * one key share a query; each caller still gets its own copy.
     */
    async get(
        key: string,
        load: (primary: boolean) => Promise<T | null>,
        {
            skipRead = false,
            primary = false,
        }: { skipRead?: boolean; primary?: boolean } = {},
    ): Promise<T | null> {
        if (!skipRead && !primary) {
            const hit = await this.read(key);
            if (hit) return hit;
        }
        if (primary) {
            const row = await load(true);
            if (row) void this.write([row]);
            return row;
        }

        const pending = this.#inFlight.get(key);
        if (pending) {
            const shared = await pending;
            if ('error' in shared) throw shared.error;
            return shared.json === null ? null : this.#parse(shared.json);
        }

        let settle!: (result: InFlightLoad) => void;
        this.#inFlight.set(
            key,
            new Promise<InFlightLoad>((resolve) => {
                settle = resolve;
            }),
        );
        try {
            const tombstoned = (await this.host.tombstoned([key])).size > 0;
            const row = await load(tombstoned);
            // Snapshot before the caller can mutate the row.
            const json = row ? JSON.stringify(row) : null;
            settle({ json });
            if (row && json) void this.#write([{ row, json }]);
            return row;
        } catch (error) {
            settle({ error });
            throw error;
        } finally {
            this.#inFlight.delete(key);
        }
    }

    /**
     * Rows by `prop`, keyed by requested value for hits and by the row's own
     * value for loads: one pipelined read, one `load` for the misses, a primary
     * `load` for misses whose key is tombstoned, one pipelined backfill.
     */
    async getMany<V>(
        prop: string,
        values: V[],
        load: (values: V[], primary: boolean) => Promise<T[]>,
    ): Promise<Map<V, T>> {
        const result = new Map<V, T>();
        const unique = [...new Set(values)];
        if (unique.length === 0) return result;

        const hits = await this.readMany(unique.map((v) => this.key(prop, v)));
        const missing = unique.filter((value, i) => {
            const hit = hits[i];
            if (hit) result.set(value, hit);
            return !hit;
        });
        if (missing.length === 0) return result;

        const valueOf = (row: T) => (row as Record<string, unknown>)[prop] as V;
        const rows = await load(missing, false);
        const deleted = await this.host.tombstoned(
            rows.map((row) => this.key(prop, valueOf(row))),
        );
        const live = rows.filter(
            (row) => !deleted.has(this.key(prop, valueOf(row))),
        );
        for (const row of live) result.set(valueOf(row), row);
        if (live.length < rows.length) {
            // Only the primary reliably knows a tombstoned row is gone.
            const stale = rows
                .filter((row) => deleted.has(this.key(prop, valueOf(row))))
                .map(valueOf);
            for (const row of await load(stale, true)) {
                result.set(valueOf(row), row);
            }
        }
        void this.write(live);
        return result;
    }

    /**
     * Cache `rows` on this node, skipping tombstoned ones and undoing any a
     * delete lands on mid-write. Best effort; never throws.
     */
    async write(rows: T[]): Promise<void> {
        await this.#write(
            rows.map((row) => ({ row, json: JSON.stringify(row) })),
        );
    }

    async #write(serialized: Array<{ row: T; json: string }>): Promise<void> {
        const entries = serialized
            .map(({ row, json }) => ({ keys: this.#writeKeysFor(row), json }))
            .filter((entry) => entry.keys.length > 0);
        if (entries.length === 0) return;
        try {
            const before = await this.host.tombstoned(
                entries.flatMap((e) => e.keys),
            );
            const live = entries.filter(
                (e) => !e.keys.some((key) => before.has(key)),
            );
            if (live.length === 0) return;
            const pipeline = this.host.redis().pipeline();
            for (const { keys, json } of live) {
                for (const key of keys) {
                    pipeline.set(key, json, 'EX', this.options.ttlSeconds);
                }
            }
            await pipeline.exec();
            // A row cached under a live tombstone is never re-checked.
            const after = await this.host.tombstoned(
                live.flatMap((e) => e.keys),
            );
            const undo = live
                .filter((e) => e.keys.some((key) => after.has(key)))
                .flatMap((e) => e.keys);
            if (undo.length > 0) {
                await this.host.publish({ keys: undo, broadcast: true });
            }
        } catch {
            // The next read fills it.
        }
    }

    /** Cache `row` here and on peers, unless it was deleted. */
    async refresh(row: T): Promise<void> {
        const keys = this.#writeKeysFor(row);
        const json = JSON.stringify(row);
        await this.host.writeUnlessDeleted(keys, () =>
            this.host.publish({
                keys,
                serializedData: json,
                ttlSeconds: this.options.ttlSeconds,
                broadcast: true,
            }),
        );
    }

    async invalidate(row: T): Promise<void> {
        await this.host.publish({ keys: this.keysFor(row), broadcast: true });
    }

    /** Invalidate a deleted row; pass it as read _before_ the delete. */
    async markDeleted(row: T): Promise<void> {
        // Only keys the row owned: another row may still be found by the rest.
        const owned = this.#writeKeysFor(row);
        await this.host.tombstone(owned);
        await this.host.publish({
            keys: this.keysFor(row).filter((key) => !owned.includes(key)),
            broadcast: true,
        });
    }

    /** A recreated row may be cached again under its keys. */
    async clearTombstones(row: T): Promise<void> {
        await this.host.clearTombstones(this.keysFor(row));
    }

    #writeKeysFor(row: T): string[] {
        return this.options.writeKeysFor?.(row) ?? this.keysFor(row);
    }

    #parse(raw: unknown): T | null {
        if (typeof raw !== 'string' || raw === '') return null;
        try {
            const row = JSON.parse(raw) as T | null;
            if (!row || typeof row !== 'object') return null;
            return this.options.revive ? this.options.revive(row) : row;
        } catch {
            return null;
        }
    }
}

export const PuterStore = class PuterStore implements WithLifecycle {
    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients> &
            IExtensionClientInstances,
        protected stores: IPuterStoreInstances &
            IExtensionStoreInstances = {} as IPuterStoreInstances &
            IExtensionStoreInstances,
    ) {}
    public onServerStart() {
        return;
    }
    public onServerPrepareShutdown() {
        return;
    }
    public onServerShutdown() {
        return;
    }

    /**
     * Refresh (pass `serializedData`) or invalidate (omit it) cache keys
     * locally. Pass `broadcast: true` to also send the same mutation to peer
     * nodes via `outer.cacheUpdate`. Pipelined for cluster-mode safety (no
     * multi-key DEL/MSET that would CROSSSLOT on Valkey).
     */
    protected async publishCacheKeys(
        params: PublishCacheKeysParams,
    ): Promise<void> {
        const { keys, serializedData } = params;
        if (keys.length === 0) return;

        const ttl = Math.max(
            1,
            Math.floor(
                params.ttlSeconds ?? DEFAULT_BROADCAST_REFRESH_TTL_SECONDS,
            ),
        );

        try {
            const pipeline = this.clients.redis.pipeline();
            if (serializedData === undefined) {
                for (const key of keys) pipeline.del(key);
            } else {
                for (const key of keys) {
                    pipeline.set(key, serializedData, 'EX', ttl);
                }
            }
            await pipeline.exec();
        } catch {
            console.warn(
                '[PuterStore] publishCacheKeys failed to update local cache:',
                keys,
            );
        }

        if (!params.broadcast) return;

        try {
            const payload =
                serializedData === undefined
                    ? { cacheKey: keys }
                    : { cacheKey: keys, data: serializedData, ttlSeconds: ttl };
            this.clients.event.emit('outer.cacheUpdate', payload, {});
        } catch {
            console.warn(
                '[PuterStore] publishCacheKeys failed to broadcast cache update:',
                keys,
            );
        }
    }

    /**
     * Invalidate `keys` for a deleted row, marked so a lagging replica can't
     * cache it back.
     */
    protected async tombstoneCacheKeys(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await this.publishCacheKeys({
            keys: keys.map((key) => key + CACHE_TOMBSTONE_SUFFIX),
            serializedData: '1',
            ttlSeconds: CACHE_TOMBSTONE_TTL_SECONDS,
            broadcast: true,
        });
        await this.publishCacheKeys({ keys, broadcast: true });
    }

    /** Drop tombstones; the row is back and may be cached again. */
    protected async clearCacheTombstones(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await this.publishCacheKeys({
            keys: keys.map((key) => key + CACHE_TOMBSTONE_SUFFIX),
            broadcast: true,
        });
    }

    /**
     * Write only if `keys` are untombstoned, and undo it if a delete lands
     * mid-write — a row cached under a live tombstone is never re-checked.
     */
    protected async writeCacheUnlessDeleted(
        keys: string[],
        write: () => Promise<void>,
    ): Promise<void> {
        if (keys.length === 0) return;
        if (await this.isCacheKeyTombstoned(keys)) return;
        await write();
        if (await this.isCacheKeyTombstoned(keys)) {
            await this.publishCacheKeys({ keys, broadcast: true });
        }
    }

    /**
     * Whether any of `keys` was deleted within the tombstone window. Fails
     * open.
     */
    protected async isCacheKeyTombstoned(keys: string[]): Promise<boolean> {
        return (await this.tombstonedCacheKeys(keys)).size > 0;
    }

    /** Which of `keys` were deleted within the tombstone window. Fails open. */
    protected async tombstonedCacheKeys(keys: string[]): Promise<Set<string>> {
        const deleted = new Set<string>();
        if (keys.length === 0) return deleted;
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const key of keys) {
                pipeline.exists(key + CACHE_TOMBSTONE_SUFFIX);
            }
            const results = (await pipeline.exec()) ?? [];
            keys.forEach((key, i) => {
                if (Number(results[i]?.[1]) > 0) deleted.add(key);
            });
        } catch {
            // Fail open.
        }
        return deleted;
    }

    /** A {@link RowCache} over this store's redis and peer broadcast. */
    protected rowCache<T extends object>(
        options: RowCacheOptions<T>,
    ): RowCache<T> {
        return new RowCache<T>(
            {
                redis: () => this.clients.redis,
                publish: (params) => this.publishCacheKeys(params),
                tombstone: (keys) => this.tombstoneCacheKeys(keys),
                clearTombstones: (keys) => this.clearCacheTombstones(keys),
                tombstoned: (keys) => this.tombstonedCacheKeys(keys),
                writeUnlessDeleted: (keys, write) =>
                    this.writeCacheUnlessDeleted(keys, write),
            },
            options,
        );
    }
} satisfies IPuterStore<WithLifecycle>;

export type IPuterStoreRegistry = Record<
    string,
    | IPuterStore<WithLifecycle>
    | (InstanceType<IPuterStore<WithLifecycle>> & Record<string, unknown>)
>;
