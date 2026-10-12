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

export interface BoundedTtlMapOptions {
    /** Past this many entries, the least recently used one is evicted. */
    maxEntries: number;
    /** Entry lifetime. Omit for entries that only leave by eviction. */
    ttlMs?: number;
}

interface Entry<V> {
    value: V;
    expiresAt: number;
}

/**
 * In-process map with a size cap and an optional per-entry TTL, for caches,
 * memos and log throttles. Expired entries read as missing; reads refresh an
 * entry's recency, so eviction drops the least recently used one.
 */
export class BoundedTtlMap<K, V> {
    readonly #maxEntries: number;
    readonly #ttlMs: number | undefined;
    readonly #entries = new Map<K, Entry<V>>();

    constructor({ maxEntries, ttlMs }: BoundedTtlMapOptions) {
        this.#maxEntries = Math.max(1, maxEntries);
        this.#ttlMs = ttlMs;
    }

    get size(): number {
        return this.#entries.size;
    }

    get(key: K): V | undefined {
        return this.#live(key)?.value;
    }

    has(key: K): boolean {
        return this.#live(key) !== undefined;
    }

    set(key: K, value: V): this {
        this.#entries.delete(key);
        if (this.#entries.size >= this.#maxEntries) {
            const oldest = this.#entries.keys().next();
            if (!oldest.done) this.#entries.delete(oldest.value);
        }
        this.#entries.set(key, {
            value,
            expiresAt:
                this.#ttlMs === undefined ? Infinity : Date.now() + this.#ttlMs,
        });
        return this;
    }

    delete(key: K): boolean {
        return this.#entries.delete(key);
    }

    clear(): void {
        this.#entries.clear();
    }

    /**
     * True at most once per TTL window for `key`, for "log/post this at most
     * once a window" throttles. Calls inside the window return false.
     */
    shouldEmit(this: BoundedTtlMap<K, true>, key: K): boolean {
        if (this.has(key)) return false;
        this.set(key, true);
        return true;
    }

    #live(key: K): Entry<V> | undefined {
        const entry = this.#entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.#entries.delete(key);
            return undefined;
        }
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        return entry;
    }
}
