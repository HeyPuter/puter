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

import { PuterStore } from '../types.js';
import { KV_GLOBAL_APP_KEY } from '../systemKv/SystemKVStore.js';

/**
 * Which regions hold a socket for a (user, app).
 *
 * The row itself is a reserved item in the replicated key-value table, written
 * with the store's direct item path: presence is platform bookkeeping, not the
 * user's data, so it is never metered, never listed, and never announced as a
 * key-value change.
 *
 * Two things keep the cost of that table proportional to session churn rather
 * than to connected population:
 *
 * - **Writes are transition-only.** The first socket a region holds for a pair
 *   writes; every reconnect after it writes nothing, answered by a region-local
 *   counter in Redis. There is no periodic refresh of any kind — a row is
 *   corrected when someone reads it and finds it wrong, not on a timer.
 * - **Reads are keyed by a per-user generation**, bumped here on every transition
 *   and repair and broadcast to peer regions, so a caller's cache turns over
 *   when presence actually moves.
 *
 * A region that dies without disconnecting leaves itself in the row. That is
 * the designed failure: the next forward to it comes back "no socket", and the
 * emitting region removes it with a write conditional on `version`.
 */

// -- Keys -------------------------------------------------------------

/** The app a socket with no app of its own is counted under. */
export const PRESENCE_NO_APP = KV_GLOBAL_APP_KEY;

/** Reserved-item key of one pair's row. */
export const presenceItemKey = (userUuid: string, appUid: string): string =>
    `pr#${userUuid}#${appUid}`;

/** Map field of the row that holds the regions. */
const REGIONS_FIELD = 'regions';

const connectionsKey = (userId: number | string, appUid: string): string =>
    `ev:pc:{${userId}}:${appUid}`;

const generationKey = (userId: number | string): string => `ev:pg:{${userId}}`;

// -- Lifetimes --------------------------------------------------------

/**
 * How long a region's connection count survives untouched. Only ever reached by
 * a node that died holding sockets, and a count stuck high keeps its region in
 * the row — which lazy repair is what corrects, so the backstop is generous.
 */
const CONNECTION_COUNT_TTL_SECONDS = 24 * 60 * 60;

/**
 * The generation outlives the sessions it orders: one that expired and
 * restarted at zero would let a cached row look current again.
 */
const GENERATION_TTL_SECONDS = 24 * 60 * 60;

// -- Row --------------------------------------------------------------

/** One pair's presence, as the table stores it. */
export interface PresenceRow {
    /** Region name to the moment its first socket for this pair connected. */
    regions: Record<string, number>;
    /** Optimistic-concurrency counter every write moves. */
    version: number;
}

const readRow = (item: Record<string, unknown> | null): PresenceRow => {
    const regions = item?.[REGIONS_FIELD];
    const version = Number(item?.version ?? 0);
    return {
        regions:
            regions && typeof regions === 'object' && !Array.isArray(regions)
                ? (regions as Record<string, number>)
                : {},
        version: Number.isFinite(version) ? version : 0,
    };
};

export class PresenceStore extends PuterStore {
    // -- The row -----------------------------------------------------

    async read(userUuid: string, appUid: string): Promise<PresenceRow> {
        const item = await this.stores.kv.getReservedItem<
            Record<string, unknown>
        >(presenceItemKey(userUuid, appUid));
        return readRow(item);
    }

    /**
     * Record that this region now holds a socket for the pair. Unconditional:
     * nothing else can teach a peer region that a socket exists, and the write
     * names only its own region, so a concurrent connect elsewhere keeps both.
     */
    async join(
        userUuid: string,
        appUid: string,
        region: string,
        connectedAt: number = Date.now(),
    ): Promise<number> {
        return this.stores.kv.setReservedEntry(
            presenceItemKey(userUuid, appUid),
            REGIONS_FIELD,
            region,
            connectedAt,
        );
    }

    /**
     * Take a region out of the row, but only while it still carries the version
     * that was read. False means a fresher connect won the race, which is
     * exactly the outcome that must not be overwritten.
     */
    async leave(
        userUuid: string,
        appUid: string,
        region: string,
        expectedVersion: number,
    ): Promise<boolean> {
        return this.stores.kv.removeReservedEntry(
            presenceItemKey(userUuid, appUid),
            REGIONS_FIELD,
            region,
            expectedVersion,
        );
    }

    // -- This region's connections -----------------------------------

    /**
     * Count one more connection for the pair in this region, and say whether it
     * is the one that crossed zero — the only connect that owes a write.
     *
     * The existing concurrency slots cannot answer this: they expose no count,
     * key on the user rather than the pair, and fail open, which is wrong in
     * precisely the situation presence exists for.
     */
    async addConnection(userId: number, appUid: string): Promise<number> {
        const key = connectionsKey(userId, appUid);
        const count = await this.clients.redis.incr(key);
        await this.clients.redis.expire(key, CONNECTION_COUNT_TTL_SECONDS);
        return Number(count);
    }

    /** Drop one connection. Zero is the count that owes the region's removal. */
    async removeConnection(userId: number, appUid: string): Promise<number> {
        const key = connectionsKey(userId, appUid);
        const count = Number(await this.clients.redis.decr(key));
        // Gone at zero, so the keyspace stays proportional to connected pairs
        // — and a count driven negative by a double-reap resets with it.
        if (count <= 0) {
            await this.clients.redis.del(key);
            return 0;
        }
        await this.clients.redis.expire(key, CONNECTION_COUNT_TTL_SECONDS);
        return count;
    }

    /** Whether this region still holds any socket for the pair. */
    async holdsConnection(userId: number, appUid: string): Promise<boolean> {
        const raw = await this.clients.redis.get(
            connectionsKey(userId, appUid),
        );
        return raw !== null && Number(raw) > 0;
    }

    // -- Generation --------------------------------------------------

    /** Advance the user's presence generation. One key, so one command. */
    async bumpGeneration(userId: number): Promise<number> {
        const key = generationKey(userId);
        const next = await this.clients.redis.incr(key);
        await this.clients.redis.expire(key, GENERATION_TTL_SECONDS);
        return typeof next === 'number' ? next : Number(next);
    }
}
