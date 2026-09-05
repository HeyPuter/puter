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
 * One reserved item per (user, app, region) in the replicated key-value table,
 * written with the store's direct item path: presence is platform bookkeeping,
 * not the user's data, so it is never metered, never listed, and never
 * announced as a key-value change.
 *
 * One item per region rather than a `regions` map on one item: a map field
 * replicates last-writer-wins, a key naming its own region cannot conflict, and
 * `read()` reassembles the row with a prefix query. The item's `connectedAt` is
 * the compare-and-set token a leave or repair checks.
 *
 * Table cost tracks session churn, not connected population: only the first
 * socket a region holds for a pair writes (a region-local counter answers
 * reconnects, and a region-shared pin keeps sibling nodes from each writing the
 * same join), a claim-gated refresh renews a long-lived item once per window,
 * and reads are keyed by a per-user generation bumped on every transition.
 *
 * A region that dies without disconnecting leaves its item behind; the next
 * forward to it answers "no socket" and the emitting region retires the item.
 */

// -- Keys -------------------------------------------------------------

/** The app a socket with no app of its own is counted under. */
export const PRESENCE_NO_APP = KV_GLOBAL_APP_KEY;

/** Reserved-item prefix shared by every region's row for one pair. */
const presenceRowPrefix = (userUuid: string, appUid: string): string =>
    `pr#${userUuid}#${appUid}#`;

/** Reserved-item key of one region's entry in a pair's row. */
export const presenceItemKey = (
    userUuid: string,
    appUid: string,
    region: string,
): string => `${presenceRowPrefix(userUuid, appUid)}${region}`;

const connectionsKey = (userId: number | string, appUid: string): string =>
    `ev:pc:{${userId}}:${appUid}`;

const generationKey = (userId: number | string): string => `ev:pg:{${userId}}`;

/** Region-shared pin: has this region already written its join for the pair. */
const pinKey = (userId: number | string, appUid: string): string =>
    `ev:pin:{${userId}}:${appUid}`;

/**
 * Region-shared claim: has this region already refreshed the pair's item inside
 * the current refresh window. Keyed by region, unlike the join pin — a refresh
 * is owed by whichever region a live socket is actually in, not by whichever
 * region first observes the touch.
 */
const refreshClaimKey = (
    userId: number | string,
    appUid: string,
    region: string,
): string => `ev:ptl:{${userId}}:${appUid}:${region}`;

// -- Lifetimes --------------------------------------------------------

/**
 * How long a region's connection count survives untouched. A live socket
 * refreshes it on every concurrency-slot renewal, so this is only reached by a
 * node that died holding sockets — and a count stuck high is what lazy repair
 * corrects, so the backstop stays generous.
 */
const CONNECTION_COUNT_TTL_SECONDS = 24 * 60 * 60;

/**
 * The generation outlives the sessions it orders: one that expired and
 * restarted at zero would let a cached row look current again.
 */
const GENERATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Backstop for the join pin, in case a crash skips both places that clear it.
 * Must stay under `PRESENCE_ITEM_TTL_SECONDS`, or a pin could outlive the item
 * it stands for and block the region from writing itself back in.
 */
const PIN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Rolling `ttl` on a per-region item, so a region that dies without
 * disconnecting ages out of the row.
 */
const PRESENCE_ITEM_TTL_SECONDS = 48 * 60 * 60;

/**
 * How often one region may refresh its item for a pair — gated by a claim, so a
 * room full of long-lived sockets costs one table write per window rather than
 * one per renewal. Several windows fit inside the item TTL, so a missed claim
 * is never the last chance to keep the item alive.
 */
const PRESENCE_ITEM_REFRESH_SECONDS = 12 * 60 * 60;

// -- Row --------------------------------------------------------------

/** One pair's presence, reassembled from its regions' items. */
export interface PresenceRow {
    /** Region name to the moment its socket for this pair connected. */
    regions: Record<string, number>;
}

export class PresenceStore extends PuterStore {
    // -- The row -----------------------------------------------------

    /** The pair's row, reassembled from every region's own item. */
    async read(userUuid: string, appUid: string): Promise<PresenceRow> {
        const prefix = presenceRowPrefix(userUuid, appUid);
        const items = await this.stores.kv.queryReservedItems<{
            key: string;
            connectedAt?: unknown;
        }>(prefix);

        const regions: Record<string, number> = {};
        for (const item of items) {
            const connectedAt = Number(item.connectedAt);
            if (!Number.isFinite(connectedAt)) continue;
            regions[item.key.slice(prefix.length)] = connectedAt;
        }
        return { regions };
    }

    /**
     * Record that this region now holds a socket for the pair. Unconditional:
     * the item's key already names this region, so no other writer can ever
     * touch it, and nothing here is a read-then-write that a concurrent connect
     * elsewhere could race.
     */
    async join(
        userUuid: string,
        appUid: string,
        region: string,
        connectedAt: number = Date.now(),
    ): Promise<void> {
        await this.stores.kv.putReservedItem(
            presenceItemKey(userUuid, appUid, region),
            {
                connectedAt,
                ttl: Math.floor(Date.now() / 1000) + PRESENCE_ITEM_TTL_SECONDS,
            },
        );
    }

    /**
     * Take a region's item out of the row, but only while it still carries the
     * `connectedAt` that was read. False means a fresher connect won the race,
     * which is exactly the outcome that must not be overwritten.
     */
    async leave(
        userUuid: string,
        appUid: string,
        region: string,
        expectedConnectedAt: number,
    ): Promise<boolean> {
        return this.stores.kv.retireReservedItemIf(
            presenceItemKey(userUuid, appUid, region),
            '#c = :expected',
            { ':expected': expectedConnectedAt },
            { '#c': 'connectedAt' },
        );
    }

    // -- Join pin (region-shared) --------------------------------------

    /**
     * Claim the region-wide pin saying "this region has already written its
     * join for this pair." True only for whichever caller actually sets it — a
     * sibling node crossing zero for the same pair at the same moment loses the
     * race and rightly skips its own join.
     */
    async acquireJoinPin(userId: number, appUid: string): Promise<boolean> {
        const result = await this.clients.redis.set(
            pinKey(userId, appUid),
            '1',
            'EX',
            PIN_TTL_SECONDS,
            'NX',
        );
        return result === 'OK';
    }

    /**
     * Release the pin once this region has actually left the row (or found it
     * already gone), or once it has told a peer it holds nothing for the pair.
     * Either way, the next connect for the pair in this region is free to write
     * a fresh join.
     */
    async releaseJoinPin(userId: number, appUid: string): Promise<void> {
        await this.clients.redis.del(pinKey(userId, appUid));
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

    /**
     * Push this region's connection count past another backstop window, from
     * the renew timer that keeps a socket's concurrency slot alive. A no-op on
     * a key that was never written. Pass `refresh` to also contend for the
     * pair's item-refresh claim; only the one winner per window writes.
     */
    async touchConnection(
        userId: number,
        appUid: string,
        refresh?: { userUuid: string; region: string },
    ): Promise<void> {
        await this.clients.redis.expire(
            connectionsKey(userId, appUid),
            CONNECTION_COUNT_TTL_SECONDS,
        );
        if (!refresh) return;

        const claimed = await this.clients.redis.set(
            refreshClaimKey(userId, appUid, refresh.region),
            '1',
            'EX',
            PRESENCE_ITEM_REFRESH_SECONDS,
            'NX',
        );
        if (claimed !== 'OK') return;

        // Extends `ttl` without disturbing `connectedAt` (the leave path's
        // compare-and-set token); a retired-but-unswept item revives carrying
        // its old token, so a stale repair may retire it once more.
        try {
            await this.stores.kv.refreshReservedItem(
                presenceItemKey(refresh.userUuid, appUid, refresh.region),
                {
                    ttl:
                        Math.floor(Date.now() / 1000) +
                        PRESENCE_ITEM_TTL_SECONDS,
                },
                { connectedAt: Date.now() },
            );
        } catch (err) {
            // Hand the claim back rather than sitting out the rest of the
            // window on one failed write.
            await this.clients.redis.del(
                refreshClaimKey(userId, appUid, refresh.region),
            );
            throw err;
        }
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
