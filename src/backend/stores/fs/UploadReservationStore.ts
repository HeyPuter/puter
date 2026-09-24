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

// -- Constants --------------------------------------------------------

/** Room for the key to outlive its last lease, so reads still prune it. */
const KEY_TTL_SLACK_MS = 60 * 1000;

// Per-lease ceiling so even 10,000 active leases summed in one HINCRBY
// counter stay far inside a 64-bit range — the cap that matters is the
// number of pending uploads, not the size any one of them claims.
const MAX_LEASE_BYTES = 2 ** 44;

// Same hash tag on both keys so a cluster keeps them on one slot — the
// scripts below touch both in a single call.
const reservationsKey = (ownerId: number): string =>
    `prodfsv2:upload-reservations:{${ownerId}}`;
const totalsKey = (ownerId: number): string =>
    `prodfsv2:upload-reservation-totals:{${ownerId}}`;

/**
 * Bytes a lease should hold for a write: what it declares, less what it frees
 * by replacing an existing entry. Never negative (a shrinking overwrite holds
 * nothing extra), never non-finite, and never past `MAX_LEASE_BYTES` (a bad or
 * absurd input holds a large but bounded amount rather than nothing, which is
 * the safe direction to fail in).
 */
export function toUploadReservationBytes(
    incoming: number,
    existing: number,
): number {
    const delta = incoming - existing;
    if (!Number.isFinite(delta)) return MAX_LEASE_BYTES;
    return Math.min(MAX_LEASE_BYTES, Math.max(0, Math.ceil(delta)));
}

// Members carry their byte count so a script can recover it from the member
// string alone; sanitized independently of whatever `toUploadReservationBytes`
// already did, since a bad value must never make a script error — an error
// here degrades to fail-open (see `take`), silently dropping quota
// enforcement for the call instead of a correct accept or reject.
const memberBytes = (bytes: number): number =>
    Math.min(
        MAX_LEASE_BYTES,
        Math.max(0, Math.floor(Number.isFinite(bytes) ? bytes : 0)),
    );

const activeMember = (sessionId: string, bytes: number): string =>
    `${sessionId}:${memberBytes(bytes)}`;

// -- Scripts ----------------------------------------------------------

// Every script prunes expired members from KEYS[1] (the lease set) first,
// folding each one out of the running totals kept in KEYS[2] (a hash:
// activeBytes, settledBytes, activeCount) rather than re-summing the whole
// set — a set with thousands of members costs a handful of ops here instead
// of a full scan. Once the set empties out, KEYS[2] is dropped rather than
// left at zero, so nothing can drift.
//
// KEYS[2] can still go missing or go negative on its own (evicted, or
// deleted independently of KEYS[1]) while leases remain — that's rebuilt
// here from a full scan before anything else runs, rather than trusting a
// counter that's known bad.
const PRUNE = `
local h = redis.call('HMGET', KEYS[2], 'activeBytes', 'settledBytes', 'activeCount')
-- Rebuild the totals from the set if the hash was lost (no activeCount) or
-- drifted negative. A missing field isn't a string in any Lua host.
if redis.call('ZCARD', KEYS[1]) > 0 and (type(h[3]) ~= 'string' or (tonumber(h[1]) or 0) < 0 or (tonumber(h[2]) or 0) < 0 or (tonumber(h[3]) or 0) < 0) then
    local a, s, c = 0, 0, 0
    for _, m in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
        local sep = string.find(m, ':', 1, true)
        if sep then
            local n = tonumber(string.sub(m, sep + 1)) or 0
            if string.sub(m, 1, 1) == '~' then s = s + n else a = a + n; c = c + 1 end
        end
    end
    redis.call('DEL', KEYS[2])
    redis.call('HSET', KEYS[2], 'activeBytes', a, 'settledBytes', s, 'activeCount', c)
    local t = redis.call('PTTL', KEYS[1])
    if t > 0 then redis.call('PEXPIRE', KEYS[2], t) end
end
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
for i = 1, #expired do
    local m = expired[i]
    local sep = string.find(m, ':', 1, true)
    if sep then
        local bytes = tonumber(string.sub(m, sep + 1)) or 0
        if string.sub(m, 1, 1) == '~' then
            if bytes > 0 then
                redis.call('HINCRBY', KEYS[2], 'settledBytes', -bytes)
            end
        else
            if bytes > 0 then
                redis.call('HINCRBY', KEYS[2], 'activeBytes', -bytes)
            end
            redis.call('HINCRBY', KEYS[2], 'activeCount', -1)
        end
    end
end
if #expired > 0 then
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
end
if redis.call('ZCARD', KEYS[1]) == 0 then
    redis.call('DEL', KEYS[2])
end
`;

const EXTEND_TTL = `
local function extend(key, ttlMs)
    local ttl = redis.call('PTTL', key)
    if tonumber(ttlMs) > ttl then redis.call('PEXPIRE', key, ttlMs) end
end
`;

/**
 * KEYS: lease set, totals hash. ARGV: now, cap, key ttl ms, then
 * member/deadline pairs to add.
 *
 * Prunes, then — only if adding wouldn't push `activeCount` over the cap —
 * `ZADD NX`s each new lease (a member already present, i.e. a retried
 * sessionId, isn't added twice or counted twice) and updates the totals to
 * match. One round trip so a burst of starts for the same owner serializes
 * through this script instead of racing on separate reads. Called with no pairs
 * (`outstanding`) to prune and read without taking anything.
 */
const TAKE_SCRIPT = `
${PRUNE}
${EXTEND_TTL}
local adding = (#ARGV - 3) / 2
local added = 0
if adding > 0 then
    local newCount = 0
    for i = 4, #ARGV, 2 do
        if redis.call('ZSCORE', KEYS[1], ARGV[i]) == false then
            newCount = newCount + 1
        end
    end
    local activeCount = tonumber(redis.call('HGET', KEYS[2], 'activeCount')) or 0
    if activeCount + newCount <= tonumber(ARGV[2]) then
        for i = 4, #ARGV, 2 do
            local member = ARGV[i]
            if redis.call('ZADD', KEYS[1], 'NX', ARGV[i + 1], member) == 1 then
                local sep = string.find(member, ':', 1, true)
                local bytes = tonumber(string.sub(member, sep + 1)) or 0
                if bytes > 0 then
                    redis.call('HINCRBY', KEYS[2], 'activeBytes', bytes)
                end
                redis.call('HINCRBY', KEYS[2], 'activeCount', 1)
            end
        end
        extend(KEYS[1], ARGV[3])
        extend(KEYS[2], ARGV[3])
        added = 1
    end
end
local totals = redis.call('HMGET', KEYS[2], 'activeBytes', 'settledBytes')
return { totals[1] or '0', totals[2] or '0', added }
`;

/**
 * KEYS: lease set, totals hash. ARGV: settle-at score, key ttl ms, then active
 * members to settle.
 *
 * Per member, moves it from active to settled (`~` prefix, same bytes) only if
 * it was still active — a member already settled or already pruned is left
 * alone, so completing a session twice is a no-op the second time.
 */
const SETTLE_SCRIPT = `
${EXTEND_TTL}
local settleAt = ARGV[1]
for i = 3, #ARGV do
    local member = ARGV[i]
    if redis.call('ZREM', KEYS[1], member) == 1 then
        local sep = string.find(member, ':', 1, true)
        local bytes = tonumber(string.sub(member, sep + 1)) or 0
        if bytes > 0 then
            redis.call('HINCRBY', KEYS[2], 'activeBytes', -bytes)
        end
        redis.call('HINCRBY', KEYS[2], 'activeCount', -1)
        local settled = redis.call('ZADD', KEYS[1], 'NX', settleAt, '~' .. member)
        if settled == 1 and bytes > 0 then
            redis.call('HINCRBY', KEYS[2], 'settledBytes', bytes)
        end
    end
end
extend(KEYS[1], ARGV[2])
extend(KEYS[2], ARGV[2])
return 1
`;

/**
 * KEYS: lease set, totals hash. ARGV: active members to release.
 *
 * Per member, drops it from the set and its bytes from the totals, only if it
 * was still there — releasing twice, or releasing something that expired or was
 * already settled, is a no-op.
 */
const RELEASE_SCRIPT = `
for i = 1, #ARGV do
    local member = ARGV[i]
    if redis.call('ZREM', KEYS[1], member) == 1 then
        local sep = string.find(member, ':', 1, true)
        local bytes = tonumber(string.sub(member, sep + 1)) or 0
        if bytes > 0 then
            redis.call('HINCRBY', KEYS[2], 'activeBytes', -bytes)
        end
        redis.call('HINCRBY', KEYS[2], 'activeCount', -1)
    end
end
if redis.call('ZCARD', KEYS[1]) == 0 then
    redis.call('DEL', KEYS[2])
end
return 1
`;

type ScriptRunner = {
    uploadReservationTake(...args: string[]): Promise<[string, string, number]>;
    uploadReservationSettle(...args: string[]): Promise<number>;
    uploadReservationRelease(...args: string[]): Promise<number>;
};

// -- UploadReservationStore --------------------------------------------

/**
 * Bytes committed to signed uploads that were started but haven't landed yet —
 * held from the moment a session is created until it completes, fails, expires,
 * or is aborted, so a burst of starts issued before any of them finish can't
 * all read the same committed usage and all pass. Completion "settles" a lease
 * instead of dropping it, since its bytes take a moment to reach the replica a
 * normal allowance check reads from.
 */
export class UploadReservationStore extends PuterStore {
    #definedScripts = false;

    get #redis(): ScriptRunner {
        this.#defineScripts();
        return this.clients.redis as unknown as ScriptRunner;
    }

    #defineScripts(): void {
        if (this.#definedScripts) return;
        this.#definedScripts = true;
        const client = this.clients.redis;
        client.defineCommand('uploadReservationTake', {
            numberOfKeys: 2,
            lua: TAKE_SCRIPT,
        });
        client.defineCommand('uploadReservationSettle', {
            numberOfKeys: 2,
            lua: SETTLE_SCRIPT,
        });
        client.defineCommand('uploadReservationRelease', {
            numberOfKeys: 2,
            lua: RELEASE_SCRIPT,
        });
    }

    /**
     * Take a batch of leases for one owner, all or nothing. Returns the owner's
     * active/settled totals (including the new leases) on success, or with
     * `added: false` when the batch was refused for being over `maxPending`
     * outstanding active leases. Null means the cache couldn't be reached —
     * uncommitted, not refused, the same "fail open" contract as every other
     * method here.
     */
    async take(
        ownerId: number,
        leases: { sessionId: string; bytes: number; deadline: number }[],
        maxPending: number,
    ): Promise<{
        added: boolean;
        activeBytes: number;
        settledBytes: number;
    } | null> {
        if (leases.length > maxPending) {
            return { added: false, activeBytes: 0, settledBytes: 0 };
        }
        const now = Date.now();
        const args = [String(now), String(Math.max(0, Math.floor(maxPending)))];
        if (leases.length === 0) {
            args.push('0');
        } else {
            const maxDeadline = Math.max(
                ...leases.map((lease) =>
                    Number.isFinite(lease.deadline) ? lease.deadline : now,
                ),
            );
            args.push(
                String(
                    Math.max(
                        0,
                        Math.ceil(maxDeadline - now + KEY_TTL_SLACK_MS),
                    ),
                ),
            );
            for (const lease of leases) {
                const deadline = Number.isFinite(lease.deadline)
                    ? Math.max(0, Math.floor(lease.deadline))
                    : now;
                args.push(
                    activeMember(lease.sessionId, lease.bytes),
                    String(deadline),
                );
            }
        }

        try {
            const [active, settled, added] =
                await this.#redis.uploadReservationTake(
                    reservationsKey(ownerId),
                    totalsKey(ownerId),
                    ...args,
                );
            return {
                added: added === 1,
                activeBytes: toSafeNumber(active),
                settledBytes: toSafeNumber(settled),
            };
        } catch (e) {
            console.warn(
                `[fs] upload reservation not taken for owner ${ownerId}: ${(e as Error).message}`,
            );
            return null;
        }
    }

    /** What an owner currently has active/settled. Zero both on cache error. */
    async outstanding(
        ownerId: number,
    ): Promise<{ activeBytes: number; settledBytes: number }> {
        try {
            const [active, settled] = await this.#redis.uploadReservationTake(
                reservationsKey(ownerId),
                totalsKey(ownerId),
                String(Date.now()),
                '0',
                '0',
            );
            return {
                activeBytes: toSafeNumber(active),
                settledBytes: toSafeNumber(settled),
            };
        } catch (e) {
            console.warn(
                `[fs] upload reservations unreadable for owner ${ownerId}: ${(e as Error).message}`,
            );
            return { activeBytes: 0, settledBytes: 0 };
        }
    }

    /**
     * Move leases from active to settled once their bytes have committed. Safe
     * to call for a lease already settled or already gone.
     */
    async settle(
        ownerId: number,
        items: { sessionId: string; bytes: number }[],
        settleMs: number,
    ): Promise<void> {
        if (items.length === 0) return;
        try {
            const now = Date.now();
            const ttlMs = Math.max(
                0,
                Math.floor(Number.isFinite(settleMs) ? settleMs : 0),
            );
            const members = items.map((item) =>
                activeMember(item.sessionId, item.bytes),
            );
            await this.#redis.uploadReservationSettle(
                reservationsKey(ownerId),
                totalsKey(ownerId),
                String(now + ttlMs),
                String(ttlMs + KEY_TTL_SLACK_MS),
                ...members,
            );
        } catch (e) {
            console.warn(
                `[fs] upload reservations not settled for owner ${ownerId}: ${(e as Error).message}`,
            );
        }
    }

    /** Give leases back — abort, failure, or expiry. Bytes were never committed. */
    async release(
        ownerId: number,
        items: { sessionId: string; bytes: number }[],
    ): Promise<void> {
        if (items.length === 0) return;
        try {
            const members = items.map((item) =>
                activeMember(item.sessionId, item.bytes),
            );
            await this.#redis.uploadReservationRelease(
                reservationsKey(ownerId),
                totalsKey(ownerId),
                ...members,
            );
        } catch (e) {
            console.warn(
                `[fs] upload reservations not released for owner ${ownerId}: ${(e as Error).message}`,
            );
        }
    }
}

const toSafeNumber = (value: unknown): number => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
};
