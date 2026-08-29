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

/**
 * The "does anyone watch anything of this user's" answer, per process — asked
 * of whoever owns the resource being written, which is all a write knows.
 *
 * Nearly every user has nothing watched, and this is what lets a write cost
 * nothing: after the first miss the answer is in memory and dispatch never
 * touches Redis again. That only holds if invalidation is pushed rather than
 * polled, so entries are keyed by a per-user generation the subscribe and
 * unsubscribe paths bump and broadcast — never by a timer, which would put the
 * round trip back on the hot path at whatever rate the timer expired.
 *
 * Bounded, because one process sees an unbounded number of users over its
 * lifetime and the useful entries are the ones being written to right now.
 * Eviction is least-recently-used: a `Map` iterates in insertion order, so
 * re-inserting on read is what moves an entry to the young end.
 */

interface CacheEntry {
    generation: number;
    /** `null` while unknown — a bump leaves the generation and clears this. */
    hasAny: boolean | null;
}

export const SUBSCRIPTION_CACHE_MAX_USERS = 10_000;

export class SubscriptionCache {
    readonly #entries = new Map<number, CacheEntry>();
    readonly #maxUsers: number;

    constructor(maxUsers: number = SUBSCRIPTION_CACHE_MAX_USERS) {
        this.#maxUsers = Math.max(1, maxUsers);
    }

    get size(): number {
        return this.#entries.size;
    }

    /** The generation this process believes the user is on. */
    generationOf(userId: number): number {
        return this.#entries.get(userId)?.generation ?? 0;
    }

    /** The cached answer, or `null` when this process has to go and look. */
    read(userId: number): boolean | null {
        const entry = this.#entries.get(userId);
        if (!entry) return null;
        // Touch on a hit so the hot users are the ones that survive eviction.
        this.#entries.delete(userId);
        this.#entries.set(userId, entry);
        return entry.hasAny;
    }

    /**
     * Record an answer against the generation it was read under. A bump that
     * landed while the read was in flight leaves the generations mismatched,
     * and the answer is dropped rather than cached stale.
     */
    write(userId: number, generation: number, hasAny: boolean): void {
        const entry = this.#entries.get(userId);
        if (entry && entry.generation !== generation) return;
        this.#set(userId, { generation, hasAny });
    }

    /**
     * Invalidate a user, moving them to `generation` when it is ahead of what
     * this process has. Two bumps can arrive out of order — the counter is what
     * orders them, so the later one cannot be undone by the earlier.
     */
    bump(userId: number, generation?: number): void {
        const current = this.#entries.get(userId)?.generation ?? 0;
        if (generation === undefined) {
            this.#set(userId, { generation: current + 1, hasAny: null });
            return;
        }
        // Already applied, or superseded by one that arrived first.
        if (generation <= current) return;
        this.#set(userId, { generation, hasAny: null });
    }

    clear(): void {
        this.#entries.clear();
    }

    #set(userId: number, entry: CacheEntry): void {
        this.#entries.delete(userId);
        this.#entries.set(userId, entry);
        while (this.#entries.size > this.#maxUsers) {
            const oldest = this.#entries.keys().next();
            if (oldest.done) break;
            this.#entries.delete(oldest.value);
        }
    }
}
