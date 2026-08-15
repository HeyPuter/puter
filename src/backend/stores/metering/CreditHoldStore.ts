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

import { randomUUID } from 'node:crypto';
import { metrics } from '@opentelemetry/api';
import { PuterStore } from '../types';

// -- Metrics ----------------------------------------------------------

const meter = metrics.getMeter('puter-backend');

const expiredHoldsCounter = meter.createCounter('metering.holds.expired', {
    description:
        'Credit holds that reached their deadline without being released',
});

// -- Constants --------------------------------------------------------

/**
 * How long a hold survives without being released.
 *
 * This is the exposure both ways: too short and a long completion stops being
 * accounted for while it is still running, too long and a request killed
 * without warning keeps budget locked up. It bounds the second case only —
 * releases are what normally ends a hold, and every path that takes one
 * releases it.
 */
const DEFAULT_HOLD_TTL_MS = 10 * 60 * 1000;

/** Room for the key to outlive its last hold, so reads still prune it. */
const KEY_TTL_SLACK_MS = 60 * 1000;

const holdsKey = (userId: string): string => `meter:holds:{${userId}}`;

// -- Scripts ----------------------------------------------------------

/**
 * KEYS: the actor's hold set. ARGV: member, deadline, key ttl.
 *
 * Members are scored by when they expire, which is what lets a read drop the
 * ones nothing released — a deployment that dies mid-request leaves its hold
 * behind, and nothing else would ever take it off.
 *
 * The key TTL only ever moves out: all holds share one key, so a take with a
 * short TTL must not truncate the key under a longer-lived hold — expiry would
 * drop every hold in the set, not just the new one. (PEXPIRE's GT flag can't do
 * this: it refuses to put a TTL on a key that has none, which is exactly the
 * state ZADD leaves a fresh key in.)
 */
const TAKE_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
if tonumber(ARGV[3]) > ttl then
    redis.call('PEXPIRE', KEYS[1], ARGV[3])
end
return 1
`;

/**
 * KEYS: the actor's hold set. ARGV: now.
 *
 * Prunes expired members, then sums what's left. Amounts ride on the member
 * name (`<id>:<amount>`) so one sorted set carries both the deadline and the
 * number, and pruning and summing happen in the same pass.
 */
const SUM_SCRIPT = `
local dropped = redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local total = 0
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
for i = 1, #members do
    local sep = string.find(members[i], ':', 1, true)
    if sep then
        total = total + (tonumber(string.sub(members[i], sep + 1)) or 0)
    end
end
return { tostring(total), dropped }
`;

type ScriptRunner = {
    creditHoldTake(...args: string[]): Promise<number>;
    creditHoldSum(...args: string[]): Promise<[string, number]>;
    zrem(key: string, member: string): Promise<number>;
};

// -- CreditHoldStore --------------------------------------------------

/**
 * Budget committed to requests that are still running.
 *
 * A balance says what an account has spent, and spending is only recorded once
 * an operation finishes — so several operations starting at once all read the
 * same balance and each one is told it can afford the whole of it. What they
 * then spend is bounded by the concurrency limit rather than by the budget.
 *
 * A hold closes that window: taken before the upstream call for what the call
 * could cost at worst, subtracted from the balance every other request reads,
 * and released when the call is done and its real usage is recorded. Holds live
 * in the cache rather than in the usage record because they are not usage —
 * nothing has been spent yet, they expire on their own, and every deployment
 * has to see them at once for them to mean anything.
 */
export class CreditHoldStore extends PuterStore {
    #definedScripts = false;

    get #redis(): ScriptRunner {
        this.#defineScripts();
        return this.clients.redis as unknown as ScriptRunner;
    }

    #defineScripts(): void {
        if (this.#definedScripts) return;
        this.#definedScripts = true;
        const client = this.clients.redis;
        client.defineCommand('creditHoldTake', {
            numberOfKeys: 1,
            lua: TAKE_SCRIPT,
        });
        client.defineCommand('creditHoldSum', {
            numberOfKeys: 1,
            lua: SUM_SCRIPT,
        });
    }

    /**
     * Commit `amount` of an actor's budget to something about to run.
     *
     * Returns the member to release it with, or null when the cache wouldn't
     * take it. Null means uncommitted, not failed: a cache that can't be
     * reached is our problem, and refusing the request over it would turn a
     * cache blip into an outage for everyone spending money.
     */
    async take(
        userId: string,
        amount: number,
        ttlMs: number = DEFAULT_HOLD_TTL_MS,
    ): Promise<string | null> {
        if (!userId || !Number.isFinite(amount) || amount <= 0) return null;
        const member = `${randomUUID()}:${Math.ceil(amount)}`;
        try {
            await this.#redis.creditHoldTake(
                holdsKey(userId),
                member,
                String(Date.now() + ttlMs),
                String(ttlMs + KEY_TTL_SLACK_MS),
            );
            return member;
        } catch (e) {
            console.warn(
                `[metering] credit hold not taken for ${userId}: ${(e as Error).message}`,
            );
            return null;
        }
    }

    /**
     * Push a hold's deadline out for an operation still running.
     *
     * Re-takes the same member, so a hold that was already pruned comes back —
     * which is what should happen: the request it stands for is still going.
     * Failure is tolerated the same way as `take`'s.
     */
    async refresh(
        userId: string,
        member: string | null,
        ttlMs: number = DEFAULT_HOLD_TTL_MS,
    ): Promise<void> {
        if (!userId || !member) return;
        try {
            await this.#redis.creditHoldTake(
                holdsKey(userId),
                member,
                String(Date.now() + ttlMs),
                String(ttlMs + KEY_TTL_SLACK_MS),
            );
        } catch (e) {
            console.warn(
                `[metering] credit hold not refreshed for ${userId}: ${(e as Error).message}`,
            );
        }
    }

    /** Give a hold back. Safe to call twice; the second call is a no-op. */
    async release(userId: string, member: string | null): Promise<void> {
        if (!userId || !member) return;
        try {
            await this.#redis.zrem(holdsKey(userId), member);
        } catch (e) {
            // The hold expires on its own, so the account gets its budget
            // back either way — just later than it should have.
            console.warn(
                `[metering] credit hold not released for ${userId}: ${(e as Error).message}`,
            );
        }
    }

    /**
     * What this actor currently has committed to running requests. Zero when
     * the cache can't answer — see `take` for why that direction.
     */
    async outstanding(userId: string): Promise<number> {
        if (!userId) return 0;
        try {
            const [total, dropped] = await this.#redis.creditHoldSum(
                holdsKey(userId),
                String(Date.now()),
            );
            if (dropped > 0) expiredHoldsCounter.add(dropped);
            const held = Number(total);
            return Number.isFinite(held) && held > 0 ? held : 0;
        } catch (e) {
            console.warn(
                `[metering] credit holds unreadable for ${userId}: ${(e as Error).message}`,
            );
            return 0;
        }
    }
}
