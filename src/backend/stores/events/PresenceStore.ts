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

import { CONCURRENT_SLOT_TTL_MS } from '../../core/http/middleware/rateLimit.js';
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
 * socket a region holds for a pair writes (a region-local set of live sockets
 * answers reconnects, and a region-shared pin keeps sibling nodes from each
 * writing the same join), a claim-gated refresh renews a long-lived item once
 * per window, and reads are keyed by a per-user generation bumped on every
 * transition.
 *
 * Only the region an item names ever writes it. A compare-and-set from another
 * region is evaluated against that region's replica, which can be stale, and
 * its write would then replace a fresher join. A region whose sockets went
 * without disconnecting retires its own item when a forward next reaches it;
 * one that never answers ages out on the item's `ttl`.
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

/**
 * This region's live sockets for a pair, scored by last renewal. Not `ev:pc:`,
 * which older nodes keep as an integer: neither may read the other's type.
 */
const socketsKey = (userId: number | string, appUid: string): string =>
    `ev:pcs:{${userId}}:${appUid}`;

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

/** Region-shared claim on checking this region's own item after a forward. */
const retireClaimKey = (userId: number | string, appUid: string): string =>
    `ev:prt:{${userId}}:${appUid}`;

/**
 * Region-shared marker: the pair's last socket here went inside the leave grace
 * window. Only the node that saw it go holds the timer; this is what the others
 * check before retiring the item.
 */
const leavingKey = (userId: number | string, appUid: string): string =>
    `ev:plg:{${userId}}:${appUid}`;

// -- Lifetimes --------------------------------------------------------

/**
 * How long a socket counts without a renewal: the window a concurrency slot
 * lives without one, which is three of the renew timer's intervals. A node that
 * dies stops renewing, so its sockets stop counting.
 */
const SOCKET_LIVE_MS = CONCURRENT_SLOT_TTL_MS;

/** Backstop on the socket set itself; liveness is each member's score. */
const SOCKETS_KEY_TTL_SECONDS = 24 * 60 * 60;

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

/**
 * How often forwards for a pair this region holds nothing for may cost it a
 * table read. Matches how long a peer trusts its cached row, so a peer still
 * forwarding after one window has re-read the table since.
 */
const RETIRE_CLAIM_SECONDS = 60;

// -- Scripts ----------------------------------------------------------

// Both drop members not renewed inside the window and answer with the live
// count, in one step, so a transition is never read off a half-applied change.
// KEYS[1] is the socket set, KEYS[2] the leaving marker.

/** Add or renew one socket; the pair is no longer leaving. */
const ADD_SOCKET_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('DEL', KEYS[2])
return redis.call('ZCARD', KEYS[1])
`;

/**
 * Drop one socket. With the last live member gone, drop the set and, given a
 * grace window, mark the pair as leaving for it.
 */
const REMOVE_SOCKET_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
if count > 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return count
end
redis.call('DEL', KEYS[1])
if tonumber(ARGV[4]) > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', ARGV[4])
end
return 0
`;

interface PresenceScripts {
    presenceAddSocket(
        socketsKey: string,
        leavingKey: string,
        socketId: string,
        nowMs: string,
        staleAtMs: string,
        ttlSeconds: string,
    ): Promise<number>;
    presenceRemoveSocket(
        socketsKey: string,
        leavingKey: string,
        socketId: string,
        staleAtMs: string,
        ttlSeconds: string,
        leaveGraceMs: string,
    ): Promise<number>;
}

/** Scores at or below this are sockets that stopped renewing. */
const staleAt = (nowMs: number): number => nowMs - SOCKET_LIVE_MS;

// -- Row --------------------------------------------------------------

/** One pair's presence, reassembled from its regions' items. */
export interface PresenceRow {
    /** Region name to the moment its socket for this pair connected. */
    regions: Record<string, number>;
}

export class PresenceStore extends PuterStore {
    #definedScripts = false;

    #scripts(): PresenceScripts {
        if (!this.#definedScripts) {
            this.#definedScripts = true;
            this.clients.redis.defineCommand('presenceAddSocket', {
                numberOfKeys: 2,
                lua: ADD_SOCKET_SCRIPT,
            });
            this.clients.redis.defineCommand('presenceRemoveSocket', {
                numberOfKeys: 2,
                lua: REMOVE_SOCKET_SCRIPT,
            });
        }
        return this.clients.redis as unknown as PresenceScripts;
    }

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
     * Take this region's item out of the row, but only while it still carries
     * the `connectedAt` that was read. False means a fresher connect won the
     * race, which is exactly the outcome that must not be overwritten. Called
     * only by the region the item names: see the class comment.
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
     * already gone), or once its join failed. Either way, the next connect for
     * the pair in this region is free to write a fresh join.
     */
    async releaseJoinPin(userId: number, appUid: string): Promise<void> {
        await this.clients.redis.del(pinKey(userId, appUid));
    }

    // -- Retire claim (region-shared) ----------------------------------

    /**
     * Claim this window's one check of this region's own item, after a peer
     * forwarded for a pair the region holds nothing for. Keeps a busy stream
     * from costing a table read per batch.
     */
    async claimRetire(userId: number, appUid: string): Promise<boolean> {
        const result = await this.clients.redis.set(
            retireClaimKey(userId, appUid),
            '1',
            'EX',
            RETIRE_CLAIM_SECONDS,
            'NX',
        );
        return result === 'OK';
    }

    /** Hand the claim back after a failed check, so the next forward retries. */
    async releaseRetireClaim(userId: number, appUid: string): Promise<void> {
        await this.clients.redis.del(retireClaimKey(userId, appUid));
    }

    // -- This region's connections -----------------------------------

    /**
     * Count one more socket for the pair in this region. Returns how many
     * sockets now count, which is what says whether the region still holds the
     * pair once one goes.
     *
     * The existing concurrency slots cannot answer this: they expose no count,
     * key on the user rather than the pair, and fail open, which is wrong in
     * precisely the situation presence exists for.
     */
    async addConnection(
        userId: number,
        appUid: string,
        socketId: string,
    ): Promise<number> {
        const now = Date.now();
        const count = await this.#scripts().presenceAddSocket(
            socketsKey(userId, appUid),
            leavingKey(userId, appUid),
            socketId,
            String(now),
            String(staleAt(now)),
            String(SOCKETS_KEY_TTL_SECONDS),
        );
        return Number(count);
    }

    /**
     * Drop one socket. Zero is the count that owes the region's removal, and
     * sockets a dead node stopped renewing are not counted toward it. Dropping
     * a socket twice changes nothing. At zero, `leaveGraceMs` marks the pair as
     * leaving region-wide in the same step.
     */
    async removeConnection(
        userId: number,
        appUid: string,
        socketId: string,
        leaveGraceMs = 0,
    ): Promise<number> {
        const count = await this.#scripts().presenceRemoveSocket(
            socketsKey(userId, appUid),
            leavingKey(userId, appUid),
            socketId,
            String(staleAt(Date.now())),
            String(SOCKETS_KEY_TTL_SECONDS),
            String(Math.max(0, Math.ceil(leaveGraceMs))),
        );
        return Number(count);
    }

    /** Whether the pair's last socket here went inside the leave grace window. */
    async isLeaving(userId: number, appUid: string): Promise<boolean> {
        return (
            (await this.clients.redis.exists(leavingKey(userId, appUid))) > 0
        );
    }

    /** Whether any socket for the pair in this region renewed inside the window. */
    async holdsConnection(userId: number, appUid: string): Promise<boolean> {
        const live = await this.clients.redis.zcount(
            socketsKey(userId, appUid),
            staleAt(Date.now()) + 1,
            '+inf',
        );
        return Number(live) > 0;
    }

    /**
     * Renew one socket, from the timer that keeps its concurrency slot alive. A
     * renewal re-adds a socket whose renewals ran late enough to lapse. Pass
     * `refresh` to also contend for the pair's item-refresh claim; only the one
     * winner per window writes, and the return says whether this call did.
     */
    async touchConnection(
        userId: number,
        appUid: string,
        socketId: string,
        refresh?: { userUuid: string; region: string },
    ): Promise<boolean> {
        await this.addConnection(userId, appUid, socketId);
        if (!refresh) return false;

        const claimed = await this.clients.redis.set(
            refreshClaimKey(userId, appUid, refresh.region),
            '1',
            'EX',
            PRESENCE_ITEM_REFRESH_SECONDS,
            'NX',
        );
        if (claimed !== 'OK') return false;

        // Extends `ttl` without disturbing `connectedAt` (the leave path's
        // compare-and-set token); a retired-but-unswept item revives carrying
        // its old token, so a stale leave may retire it once more.
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
        return true;
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
