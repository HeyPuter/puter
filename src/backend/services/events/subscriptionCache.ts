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
 * unsubscribe paths bump and broadcast.
 *
 * Two different numbers share the name "generation" in the surrounding code,
 * and this cache keeps them as two separate fields rather than one:
 *
 * - `epoch` — purely local, bumped on every invalidation this process makes of
 *   its own answer, whatever the reason. `write()` captures it before a lookup
 *   starts and compares on the way back in: a mismatch means something
 *   invalidated while the lookup was in flight, and the computed answer is
 *   dropped rather than cached stale. It never needs to mean anything to
 *   another process.
 * - `redisGeneration` — the store's `ev:g` value, real only when a _local_
 *   subscribe/unsubscribe supplied one (`#publishGeneration`). Two such bumps
 *   can race and arrive out of order, and this is what lets the later one win
 *   regardless.
 *
 * Conflating them was the bug: `ev:g` is a region-local `INCR`, so a peer
 * region's bump can carry a number behind one this process already recorded for
 * entirely unrelated reasons (its own local traffic, or an earlier invalidation
 * that had no number to report), and comparing them let a real invalidation be
 * silently ignored as "already applied". A bump with no number —
 * `invalidateUser`'s only mode; see its own comment — advances `epoch`
 * unconditionally and leaves `redisGeneration` untouched, so it can never
 * falsely outrank, or be outranked by, a store-issued one. `read()` is the
 * remaining backstop: a definite answer only survives a short TTL before it is
 * treated as unknown again, exactly the "~2 s local-gen TTL trade" the
 * permission cache makes (`PermissionStore.ts`,
 * `PERMISSION_CACHE_GENERATION_LOCAL_TTL_SECONDS`) — bounding staleness by time
 * wherever a counter cannot order it.
 *
 * Bounded, because one process sees an unbounded number of users over its
 * lifetime and the useful entries are the ones being written to right now.
 * Eviction is least-recently-used: a `Map` iterates in insertion order, so
 * re-inserting on read is what moves an entry to the young end.
 */

interface CacheEntry {
    epoch: number;
    /** `null` until a local subscribe/unsubscribe has supplied a real one. */
    redisGeneration: number | null;
    /** `null` while unknown — a bump leaves the epoch and clears this. */
    hasAny: boolean | null;
    /** When `hasAny` was last written; what the read-side TTL measures from. */
    cachedAt: number;
}

export const SUBSCRIPTION_CACHE_MAX_USERS = 10_000;

/**
 * How long a definite answer survives without a bump. Mirrors the permission
 * cache's local TTL.
 */
export const SUBSCRIPTION_CACHE_TTL_MS = 2_000;

export class SubscriptionCache {
    readonly #entries = new Map<number, CacheEntry>();
    readonly #maxUsers: number;
    readonly #ttlMs: number;

    constructor(
        maxUsers: number = SUBSCRIPTION_CACHE_MAX_USERS,
        ttlMs: number = SUBSCRIPTION_CACHE_TTL_MS,
    ) {
        this.#maxUsers = Math.max(1, maxUsers);
        this.#ttlMs = Math.max(0, ttlMs);
    }

    get size(): number {
        return this.#entries.size;
    }

    /** The epoch a lookup must capture before reading, to write safely after. */
    generationOf(userId: number): number {
        return this.#entries.get(userId)?.epoch ?? 0;
    }

    /** The cached answer, or `null` when this process has to go and look. */
    read(userId: number): boolean | null {
        const entry = this.#entries.get(userId);
        if (!entry) return null;
        if (Date.now() - entry.cachedAt > this.#ttlMs) return null;
        // Touch on a hit so the hot users are the ones that survive eviction.
        this.#entries.delete(userId);
        this.#entries.set(userId, entry);
        return entry.hasAny;
    }

    /**
     * Record an answer against the epoch it was read under. A bump that landed
     * while the read was in flight leaves the epochs mismatched, and the answer
     * is dropped rather than cached stale.
     */
    write(userId: number, epoch: number, hasAny: boolean): void {
        const entry = this.#entries.get(userId);
        if (entry && entry.epoch !== epoch) return;
        this.#set(userId, {
            epoch,
            redisGeneration: entry?.redisGeneration ?? null,
            hasAny,
            cachedAt: Date.now(),
        });
    }

    /**
     * Invalidate a user. With `generation`, this is a local subscribe or
     * unsubscribe reporting the store's own new value: applied only when it is
     * ahead of the last one this process recorded, so two racing local bumps
     * can't land out of order. Without one — `invalidateUser`'s bare call — the
     * epoch still advances unconditionally, because there is nothing to compare
     * a number-less invalidation against; the previously recorded
     * `redisGeneration`, if any, is left exactly as it was.
     */
    bump(userId: number, generation?: number): void {
        const entry = this.#entries.get(userId);
        if (generation !== undefined) {
            const current = entry?.redisGeneration ?? 0;
            // Already applied, or superseded by one that arrived first.
            if (generation <= current) return;
        }
        this.#set(userId, {
            epoch: (entry?.epoch ?? 0) + 1,
            redisGeneration: generation ?? entry?.redisGeneration ?? null,
            hasAny: null,
            cachedAt: Date.now(),
        });
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
