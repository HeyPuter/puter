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

import { PERMISSION_SCAN_CACHE_TTL_SECONDS } from '../permission/consts.js';

/**
 * Delivery-time access decisions, held across events.
 *
 * The re-check is the most expensive thing on the dispatch path — a permission
 * scan per surviving row — and a busy anchor asks the same question of the same
 * subscription over and over. Memoizing inside one event is not enough for a
 * save loop, which is many events.
 *
 * Entries are keyed by the permission cache's **own** generation for the row's
 * identity, so nothing here needs its own invalidation: a grant or revoke
 * already bumps that counter, cluster- and region-wide, and a bumped generation
 * simply produces a key nothing has answered yet. The node is part of the key
 * because the decision is about the node the event is about, not the anchor — a
 * filter reaching into a subfolder the holder cannot list is denied there and
 * allowed elsewhere under the same subscription.
 *
 * The TTL is a backstop for the paths that change access without bumping
 * anything, and is the scan cache's own, so this can never serve an answer
 * staler than the layer it caches over. Bounded, and least-recently-used: a
 * `Map` iterates in insertion order, so re-inserting on read moves an entry to
 * the young end.
 */

export interface DeliveryAuthKey {
    subId: string;
    /** Permission-cache generation(s) the row's identity depends on. */
    generation: string;
    /** Uid of the node the decision is about. */
    nodeUid: string;
}

export const DELIVERY_AUTH_CACHE_MAX_ENTRIES = 20_000;

export const DELIVERY_AUTH_CACHE_TTL_MS =
    PERMISSION_SCAN_CACHE_TTL_SECONDS * 1000;

const cacheKey = (key: DeliveryAuthKey): string =>
    `${key.subId}|${key.generation}|${key.nodeUid}`;

interface CacheEntry {
    allowed: boolean;
    cachedAt: number;
}

export class DeliveryAuthCache {
    readonly #entries = new Map<string, CacheEntry>();
    /** Entry ids by subscription, so forgetting one is not a scan of all. */
    readonly #bySub = new Map<string, Set<string>>();
    readonly #maxEntries: number;
    readonly #ttlMs: number;

    constructor(
        maxEntries: number = DELIVERY_AUTH_CACHE_MAX_ENTRIES,
        ttlMs: number = DELIVERY_AUTH_CACHE_TTL_MS,
    ) {
        this.#maxEntries = Math.max(1, maxEntries);
        this.#ttlMs = Math.max(0, ttlMs);
    }

    get size(): number {
        return this.#entries.size;
    }

    /** The decision, or `null` when it has to be made again. */
    read(key: DeliveryAuthKey): boolean | null {
        const id = cacheKey(key);
        const entry = this.#entries.get(id);
        if (!entry) return null;
        if (Date.now() - entry.cachedAt > this.#ttlMs) {
            this.#drop(key.subId, id);
            return null;
        }
        this.#entries.delete(id);
        this.#entries.set(id, entry);
        return entry.allowed;
    }

    write(key: DeliveryAuthKey, allowed: boolean): void {
        const id = cacheKey(key);
        this.#entries.delete(id);
        this.#entries.set(id, { allowed, cachedAt: Date.now() });
        const ids = this.#bySub.get(key.subId) ?? new Set<string>();
        ids.add(id);
        this.#bySub.set(key.subId, ids);
        while (this.#entries.size > this.#maxEntries) {
            const oldest = this.#entries.keys().next();
            if (oldest.done) break;
            this.#drop(
                oldest.value.slice(0, oldest.value.indexOf('|')),
                oldest.value,
            );
        }
    }

    #drop(subId: string, id: string): void {
        this.#entries.delete(id);
        const ids = this.#bySub.get(subId);
        if (!ids) return;
        ids.delete(id);
        if (ids.size === 0) this.#bySub.delete(subId);
    }

    /**
     * Drop every decision about one subscription. For a row that changed shape
     * rather than access — a re-anchor — where the generation it was keyed by
     * has not moved and the old answers are about a node it no longer watches.
     */
    forget(subId: string): void {
        for (const id of this.#bySub.get(subId) ?? []) this.#entries.delete(id);
        this.#bySub.delete(subId);
    }

    clear(): void {
        this.#entries.clear();
        this.#bySub.clear();
    }
}
