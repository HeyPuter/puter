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

import type { PresenceRow } from '../../stores/events/PresenceStore.js';

/**
 * Where a user's sockets are, per region, held until presence actually moves.
 *
 * Keyed by a per-user generation and by nothing else: no expiry. A fixed
 * lifetime would make presence _reads_ scale with matched event volume, which
 * is the one thing this whole path exists to avoid — a busy subscription
 * against a settled row must read the table once and never again. The
 * generation is bumped on every transition and every repair and carried to peer
 * regions over the broadcast channel, so staleness ends when presence changes
 * rather than on a clock.
 *
 * The entry also carries which regions it has already asked to be repaired,
 * which is what stops a busy stream from storming conditional writes at a row
 * it believes is wrong. A bump clears the entry, so the next window may repair
 * again.
 *
 * Bounded, and evicted least-recently-used: a `Map` iterates in insertion
 * order, so re-inserting on read moves an entry to the young end.
 */

interface CacheEntry {
    userId: number;
    epoch: number;
    row: PresenceRow;
    /** Regions this window has already spent its one repair write on. */
    repaired: Set<string>;
}

interface UserEntry {
    epoch: number;
    /** `null` until a local transition has supplied a real counter value. */
    redisGeneration: number | null;
}

export const PRESENCE_CACHE_MAX_ENTRIES = 10_000;

const entryKey = (userId: number, appUid: string): string =>
    `${userId}|${appUid}`;

export class PresenceCache {
    readonly #entries = new Map<string, CacheEntry>();
    readonly #users = new Map<number, UserEntry>();
    readonly #maxEntries: number;

    constructor(maxEntries: number = PRESENCE_CACHE_MAX_ENTRIES) {
        this.#maxEntries = Math.max(1, maxEntries);
    }

    get size(): number {
        return this.#entries.size;
    }

    /** The epoch a read must capture before going to the table. */
    generationOf(userId: number): number {
        return this.#users.get(userId)?.epoch ?? 0;
    }

    /** The cached row, or `null` when this region has to go and look. */
    read(userId: number, appUid: string): PresenceRow | null {
        const key = entryKey(userId, appUid);
        const entry = this.#entries.get(key);
        if (!entry) return null;
        if (entry.epoch !== this.generationOf(userId)) {
            this.#entries.delete(key);
            return null;
        }
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        return entry.row;
    }

    /**
     * Record a row against the epoch it was read under. A bump that landed
     * mid-read leaves the epochs mismatched and the answer is dropped rather
     * than cached stale.
     */
    write(
        userId: number,
        appUid: string,
        epoch: number,
        row: PresenceRow,
    ): void {
        if (this.generationOf(userId) !== epoch) return;
        this.#set(entryKey(userId, appUid), {
            userId,
            epoch,
            row,
            repaired: new Set(),
        });
    }

    /**
     * Invalidate everything cached for a user. With `generation`, this is a
     * local transition reporting the counter's new value, applied only when it
     * is ahead of the last one recorded so two racing bumps cannot land out of
     * order. Without one — every signal from another region — the epoch
     * advances unconditionally: the counter is region-local, so a peer's number
     * cannot be compared against this region's own.
     */
    bump(userId: number, generation?: number): void {
        const user = this.#users.get(userId);
        if (
            generation !== undefined &&
            generation <= (user?.redisGeneration ?? 0)
        )
            return;
        this.#users.set(userId, {
            epoch: (user?.epoch ?? 0) + 1,
            redisGeneration: generation ?? user?.redisGeneration ?? null,
        });
    }

    /**
     * Take this window's one repair for a (user, app, region), or refuse it
     * because the window already spent it.
     */
    claimRepair(userId: number, appUid: string, region: string): boolean {
        const entry = this.#entries.get(entryKey(userId, appUid));
        if (!entry || entry.epoch !== this.generationOf(userId)) return false;
        if (entry.repaired.has(region)) return false;
        entry.repaired.add(region);
        return true;
    }

    /** Drop a region from the cached row, so the window stops forwarding to it. */
    forget(userId: number, appUid: string, region: string): void {
        const entry = this.#entries.get(entryKey(userId, appUid));
        if (!entry) return;
        const { [region]: _dropped, ...rest } = entry.row.regions;
        entry.row = { ...entry.row, regions: rest };
    }

    clear(): void {
        this.#entries.clear();
        this.#users.clear();
    }

    #set(key: string, entry: CacheEntry): void {
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        while (this.#entries.size > this.#maxEntries) {
            const oldest = this.#entries.keys().next();
            if (oldest.done) break;
            this.#entries.delete(oldest.value);
        }
    }
}

/**
 * Regions to try for one delivery, most recently connected first, with the
 * emitting region — which never consults presence about itself — dropped.
 */
export const remoteRegions = (row: PresenceRow, self: string): string[] =>
    Object.entries(row.regions ?? {})
        .filter(([region]) => region !== self)
        .sort(([, left], [, right]) => Number(right) - Number(left))
        .map(([region]) => region);
