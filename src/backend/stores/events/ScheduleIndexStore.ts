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
import murmurhash from 'murmurhash';
import { withRedisLock } from '../../util/redisLock.js';
import { PuterStore } from '../types.js';
import { scheduleNamespace } from './ScheduleStore.js';
import type { ScheduleKind } from './types.js';

/**
 * The region's due index for schedules: which schedule fires next, who holds
 * its current attempt, and which slot that attempt owes. It is the queue, and
 * can always be rebuilt from the schedule table.
 *
 * Each namespace has {@link SCHEDULE_PARTITIONS} partitions; a partition's keys
 * share the `{sched:p<n>}` hash tag, so every script runs on one cluster slot:
 *
 *     sched:<ns>:due:{sched:p<n>}     ZSET  scheduleId -> when to look next
 *     sched:<ns>:def:{sched:p<n>}     HASH  scheduleId -> version|state|json
 *     sched:<ns>:run:{sched:p<n>}     HASH  scheduleId -> owed|pinned|missed|attempts|fails|token|phase
 *     sched:<ns>:absent:{sched:p<n>}  HASH  scheduleId -> first time a full diff missed it
 *
 * `state` is `active`, `suspended:<reason>` or `ended`; an ended def is a
 * tombstone whose json is `{"endedAt":ms}`, so an older apply can't bring the
 * schedule back. Every attempt holds a fenced lease: a pop writes a fresh token
 * into the run, and every later script for that attempt is refused once the
 * token is no longer the stored one. `owed` is the next slot to fire and only
 * moves forward; a settle is accepted once per slot.
 *
 * Scripts read the clock with `TIME` and parse `|`-delimited values with
 * `string.match`; the json is opaque to them. Times are kept in float
 * arithmetic and written through `%.0f`: the in-process Redis runs Lua with
 * 32-bit integers, where a millisecond timestamp overflows `%d`.
 */

export const SCHEDULE_PARTITIONS = 16;

/** Pipelined commands per round trip when applying in bulk. */
const APPLY_BATCH = 500;

/** Where a schedule's index entries live. */
export const schedulePartition = (scheduleId: string): number =>
    murmurhash.v3(scheduleId) % SCHEDULE_PARTITIONS;

// -- Scripts ----------------------------------------------------------

const PRELUDE = `
local function nowMs()
    local t = redis.call('TIME')
    return tonumber(t[1]) * 1000.0 + math.floor(tonumber(t[2]) / 1000)
end
local function fmt(n)
    return string.format('%.0f', n)
end
local function parseRun(raw)
    if not raw then return nil end
    local o, p, m, a, f, t, ph = string.match(raw,
        '^([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)$')
    if not o then return nil end
    return { owed = o, pinned = p, missed = m, attempts = a, fails = f,
        token = t, phase = ph }
end
local function joinRun(r)
    return r.owed .. '|' .. r.pinned .. '|' .. r.missed .. '|' ..
        r.attempts .. '|' .. r.fails .. '|' .. r.token .. '|' .. r.phase
end
local function readRun(key, id)
    return parseRun(redis.call('HGET', key, id))
end
local function writeRun(key, id, r)
    redis.call('HSET', key, id, joinRun(r))
end
local function fenced(key, id, token)
    local r = readRun(key, id)
    if not r or r.token == '' or r.token ~= token then return nil end
    return r
end
local function num(s)
    return tonumber(s) or 0
end
`;

/** KEYS: due, run, def. ARGV: limit, leaseMs, tokenPrefix. */
const POP_SCRIPT = `${PRELUDE}
local now = nowMs()
local hits = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', fmt(now),
    'WITHSCORES', 'LIMIT', 0, tonumber(ARGV[1]))
local out = { fmt(now) }
local lease = fmt(now + tonumber(ARGV[2]))
local n = 0
for i = 1, #hits, 2 do
    local id = hits[i]
    local def = redis.call('HGET', KEYS[3], id)
    local state = def and string.match(def, '^%d+|([^|]*)|')
    local raw = state == 'active' and redis.call('HGET', KEYS[2], id)
    local r = raw and parseRun(raw)
    if not r then
        redis.call('ZREM', KEYS[1], id)
    else
        n = n + 1
        r.token = ARGV[3] .. ':' .. n
        redis.call('ZADD', KEYS[1], 'XX', lease, id)
        writeRun(KEYS[2], id, r)
        out[#out + 1] = id
        out[#out + 1] = hits[i + 1]
        out[#out + 1] = raw
        out[#out + 1] = def
        out[#out + 1] = r.token
    end
end
-- Rebuilt by a constructor: the in-process Redis only reads a table back as
-- an array when it was built that way.
return { unpack(out) }
`;

/** KEYS: due, run. ARGV: id, token, slot, missed. */
const START_SCRIPT = `${PRELUDE}
local r = fenced(KEYS[2], ARGV[1], ARGV[2])
if not r then return 0 end
r.pinned = ARGV[3]
r.missed = ARGV[4]
writeRun(KEYS[2], ARGV[1], r)
return 1
`;

/** KEYS: due, run. ARGV: id, token, slot, nextScore, nextOwed, fails. */
const SETTLE_SCRIPT = `${PRELUDE}
local r = fenced(KEYS[2], ARGV[1], ARGV[2])
if not r then return 0 end
local slot = tonumber(ARGV[3])
if slot < num(r.owed) or tonumber(ARGV[5]) <= slot then return -1 end
redis.call('ZADD', KEYS[1], 'XX', ARGV[4], ARGV[1])
r.owed = ARGV[5]
r.pinned = ''
r.missed = ''
r.attempts = '0'
r.fails = ARGV[6]
r.token = ''
r.phase = ''
writeRun(KEYS[2], ARGV[1], r)
return 1
`;

/** KEYS: due, run. ARGV: id, token, slot, retryMs, fails. */
const FINALIZE_SCRIPT = `${PRELUDE}
local r = fenced(KEYS[2], ARGV[1], ARGV[2])
if not r then return 0 end
if tonumber(ARGV[3]) < num(r.owed) then return -1 end
redis.call('ZADD', KEYS[1], 'XX', fmt(nowMs() + tonumber(ARGV[4])), ARGV[1])
r.owed = ARGV[3]
r.pinned = ''
r.missed = ''
r.attempts = '0'
r.fails = ARGV[5]
r.token = ''
r.phase = 'finalizing'
writeRun(KEYS[2], ARGV[1], r)
return 1
`;

/** KEYS: due, run. ARGV: id, token, delayMs, slot, missed, attempts, fails. */
const RETRY_SCRIPT = `${PRELUDE}
local r = fenced(KEYS[2], ARGV[1], ARGV[2])
if not r then return 0 end
redis.call('ZADD', KEYS[1], 'XX', fmt(nowMs() + tonumber(ARGV[3])), ARGV[1])
r.pinned = ARGV[4]
r.missed = ARGV[5]
r.attempts = ARGV[6]
r.fails = ARGV[7]
r.token = ''
writeRun(KEYS[2], ARGV[1], r)
return 1
`;

/** KEYS: due, run. ARGV: id, token, delayMs. */
const DEFER_SCRIPT = `${PRELUDE}
local r = fenced(KEYS[2], ARGV[1], ARGV[2])
if not r then return 0 end
redis.call('ZADD', KEYS[1], 'XX', fmt(nowMs() + tonumber(ARGV[3])), ARGV[1])
r.token = ''
writeRun(KEYS[2], ARGV[1], r)
return 1
`;

/** KEYS: due, run. ARGV: id, token, leaseMs. */
const RENEW_SCRIPT = `${PRELUDE}
local r = fenced(KEYS[2], ARGV[1], ARGV[2])
if not r then return 0 end
redis.call('ZADD', KEYS[1], 'XX', fmt(nowMs() + tonumber(ARGV[3])), ARGV[1])
return 1
`;

/**
 * KEYS: due, run, def, absent. ARGV: id, version ('' = the stored one), state,
 * defJson ('' = keep the stored one), score, owed. Returns 1 changed, 0 stale
 * or no-op, 2 membership repaired, 3 a live row met a tombstone at its
 * version.
 */
const APPLY_SCRIPT = `${PRELUDE}
local id = ARGV[1]
local state = ARGV[3]
local cur = redis.call('HGET', KEYS[3], id)
local sv, sstate, sjson
if cur then
    local v, s, j = string.match(cur, '^(%d+)|([^|]*)|(.*)$')
    sv = tonumber(v)
    sstate = s
    sjson = j
end
redis.call('HDEL', KEYS[4], id)
local v
if ARGV[2] == '' then
    if not cur then return 0 end
    v = sv
else
    v = tonumber(ARGV[2])
end
local function newRun()
    return { owed = ARGV[6], pinned = '', missed = '', attempts = '0',
        fails = '0', token = '', phase = '' }
end
local function dueUnlessLeased(r)
    if r.token == '' and not redis.call('ZSCORE', KEYS[1], id) then
        redis.call('ZADD', KEYS[1], ARGV[5], id)
        return true
    end
    return false
end
if cur and v < sv then return 0 end
if cur and v == sv then
    if sstate == 'ended' then
        if state == 'ended' then return 0 end
        return 3
    end
    if state == sstate then
        local changed = false
        if state == 'active' then
            local r = readRun(KEYS[2], id)
            if not r then
                r = newRun()
                writeRun(KEYS[2], id, r)
                changed = true
            end
            if dueUnlessLeased(r) then changed = true end
        elseif redis.call('ZREM', KEYS[1], id) == 1 then
            changed = true
        end
        if changed then return 2 end
        return 0
    end
end
if state == 'ended' then
    redis.call('ZREM', KEYS[1], id)
    redis.call('HDEL', KEYS[2], id)
    redis.call('HSET', KEYS[3], id,
        fmt(v) .. '|ended|{"endedAt":' .. fmt(nowMs()) .. '}')
    return 1
end
local json = ARGV[4]
if json == '' then
    if not cur or sstate == 'ended' then return 0 end
    json = sjson
end
redis.call('HSET', KEYS[3], id, fmt(v) .. '|' .. state .. '|' .. json)
local r = readRun(KEYS[2], id)
if state == 'active' then
    if not r then
        writeRun(KEYS[2], id, newRun())
        redis.call('ZADD', KEYS[1], ARGV[5], id)
    elseif cur and sstate ~= 'active' then
        r.pinned = ''
        r.missed = ''
        r.token = ''
        r.attempts = '0'
        r.fails = '0'
        writeRun(KEYS[2], id, r)
        redis.call('ZADD', KEYS[1], ARGV[5], id)
    else
        dueUnlessLeased(r)
    end
else
    redis.call('ZREM', KEYS[1], id)
    if not r then
        writeRun(KEYS[2], id, newRun())
    else
        r.token = ''
        r.pinned = ''
        r.missed = ''
        writeRun(KEYS[2], id, r)
    end
end
return 1
`;

/**
 * KEYS: def, run, absent, due. ARGV: id, mode, ageMs. `tombstone` drops an
 * ended def older than `ageMs`; `absent` records a member the schedule table
 * doesn't have, and drops it once that was first recorded `ageMs` ago.
 */
const FORGET_SCRIPT = `${PRELUDE}
local now = nowMs()
local cutoff = now - tonumber(ARGV[3])
if ARGV[2] == 'tombstone' then
    local cur = redis.call('HGET', KEYS[1], ARGV[1])
    local endedAt = cur and string.match(cur, '^%d+|ended|{"endedAt":(%d+)}$')
    if not endedAt or tonumber(endedAt) > cutoff then return 0 end
else
    local seen = redis.call('HGET', KEYS[3], ARGV[1])
    if not seen then
        redis.call('HSET', KEYS[3], ARGV[1], fmt(now))
        return 0
    end
    if tonumber(seen) > cutoff then return 0 end
end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
return 1
`;

/** KEYS: budget. ARGV: limit, windowMs. Returns 0, or ms until the reset. */
const BUDGET_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if n <= tonumber(ARGV[1]) then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return tonumber(ARGV[2])
end
if ttl < 1 then return 1 end
return ttl
`;

/** KEYS: semaphore. ARGV: cap, ttlMs, token. Returns 1 when taken. */
const DEPLOY_ACQUIRE_SCRIPT = `${PRELUDE}
local now = nowMs()
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', fmt(now))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], fmt(now + tonumber(ARGV[2])), ARGV[3])
redis.call('PEXPIRE', KEYS[1], fmt(tonumber(ARGV[2]) * 2))
return 1
`;

/** KEYS: semaphore. ARGV: token, ttlMs. */
const DEPLOY_RENEW_SCRIPT = `${PRELUDE}
return redis.call('ZADD', KEYS[1], 'XX',
    fmt(nowMs() + tonumber(ARGV[2])), ARGV[1])
`;

type Reply = Promise<number>;

interface ScheduleScripts {
    schedPop(
        due: string,
        run: string,
        def: string,
        limit: string,
        leaseMs: string,
        tokenPrefix: string,
    ): Promise<string[]>;
    schedStart(
        due: string,
        run: string,
        id: string,
        token: string,
        slot: string,
        missed: string,
    ): Reply;
    schedSettle(
        due: string,
        run: string,
        id: string,
        token: string,
        slot: string,
        nextScore: string,
        nextOwed: string,
        fails: string,
    ): Reply;
    schedFinalize(
        due: string,
        run: string,
        id: string,
        token: string,
        slot: string,
        retryMs: string,
        fails: string,
    ): Reply;
    schedRetry(
        due: string,
        run: string,
        id: string,
        token: string,
        delayMs: string,
        slot: string,
        missed: string,
        attempts: string,
        fails: string,
    ): Reply;
    schedDefer(
        due: string,
        run: string,
        id: string,
        token: string,
        delayMs: string,
    ): Reply;
    schedRenew(
        due: string,
        run: string,
        id: string,
        token: string,
        leaseMs: string,
    ): Reply;
    schedApply(
        due: string,
        run: string,
        def: string,
        absent: string,
        id: string,
        version: string,
        state: string,
        defJson: string,
        score: string,
        owed: string,
    ): Reply;
    schedForget(
        def: string,
        run: string,
        absent: string,
        due: string,
        id: string,
        mode: string,
        ageMs: string,
    ): Reply;
    schedBudget(budget: string, limit: string, windowMs: string): Reply;
    schedDeployAcquire(
        semaphore: string,
        cap: string,
        ttlMs: string,
        token: string,
    ): Reply;
    schedDeployRenew(semaphore: string, token: string, ttlMs: string): Reply;
}

const SCRIPTS: Array<[keyof ScheduleScripts, number, string]> = [
    ['schedPop', 3, POP_SCRIPT],
    ['schedStart', 2, START_SCRIPT],
    ['schedSettle', 2, SETTLE_SCRIPT],
    ['schedFinalize', 2, FINALIZE_SCRIPT],
    ['schedRetry', 2, RETRY_SCRIPT],
    ['schedDefer', 2, DEFER_SCRIPT],
    ['schedRenew', 2, RENEW_SCRIPT],
    ['schedApply', 4, APPLY_SCRIPT],
    ['schedForget', 4, FORGET_SCRIPT],
    ['schedBudget', 1, BUDGET_SCRIPT],
    ['schedDeployAcquire', 1, DEPLOY_ACQUIRE_SCRIPT],
    ['schedDeployRenew', 1, DEPLOY_RENEW_SCRIPT],
];

// -- Shapes -----------------------------------------------------------

/** What the index holds about a schedule, mirrored from its rows. */
export interface ScheduleIndexDef {
    rowId: number;
    kind: ScheduleKind;
    startAt: number;
    everyMs: number | null;
    cron: string | null;
    tz: string;
    endsAt: number | null;
    createdAt: number;
    subId: string | null;
    holderUserId: number;
    appUid: string;
    handlerName: string | null;
    context: string | null;
    handlerDepth: number;
    offsetMs: number;
    action: string | null;
}

/** `active`, `suspended:<reason>` or `ended`. */
export type ScheduleIndexState = string;

export interface ScheduleDefEntry {
    version: number;
    state: ScheduleIndexState;
    /** `null` for a tombstone. */
    def: ScheduleIndexDef | null;
    /** When a tombstone was written. */
    endedAt: number | null;
}

export interface ScheduleRunState {
    /** The next slot to fire. */
    owed: number | null;
    /** The slot an attempt fixed before invoking, if it was late. */
    pinned: number | null;
    missed: number;
    missedCapped: boolean;
    /** Retries of the current slot. */
    attempts: number;
    /** Consecutive handler failures, kept across settles. */
    fails: number;
    /** The attempt holding the lease; empty when nothing does. */
    token: string;
    phase: '' | 'finalizing';
}

export interface PoppedSchedule {
    id: string;
    partition: number;
    /** The due score it was popped at. */
    score: number;
    /** The run as it was before this pop leased it. */
    prevRun: ScheduleRunState;
    def: ScheduleDefEntry;
    token: string;
}

export interface SchedulePop {
    nowMs: number;
    items: PoppedSchedule[];
}

/** One `schedApply`. */
export interface ScheduleIndexChange {
    id: string;
    /** `null` applies at the version the index already holds. */
    version: number | null;
    state: ScheduleIndexState;
    /** `null` keeps the stored def; ignored for `ended`. */
    def: ScheduleIndexDef | null;
    score: number;
    /** Written only when the index has no run for the schedule. */
    owed: number | null;
}

/** 1 changed, 0 stale or no-op, 2 repaired, 3 tombstone over a live row. */
export type ScheduleApplyResult = 0 | 1 | 2 | 3;

/** Where the chunked full diff is. */
export interface ScheduleFullDiffCursor {
    afterId: number;
    /** Redis time the current cycle started. */
    cycleStart: number;
    /** Walking table rows, or sweeping index members after a wrap. */
    phase: 'rows' | 'sweep';
    partition: number;
    scan: string;
}

// -- Encoding ---------------------------------------------------------

const int = (n: number): string => String(Math.floor(n));

const intOrNull = (s: string): number | null => (s === '' ? null : Number(s));

/** `missed` carries a trailing `+` when the count was capped. */
const encodeMissed = (missed: number, capped: boolean): string =>
    `${int(missed)}${capped ? '+' : ''}`;

export const parseRunState = (raw: string): ScheduleRunState | null => {
    const parts = raw.split('|');
    if (parts.length !== 7) return null;
    const [owed, pinned, missed, attempts, fails, token, phase] = parts;
    return {
        owed: intOrNull(owed),
        pinned: intOrNull(pinned),
        missed: missed === '' ? 0 : parseInt(missed, 10),
        missedCapped: missed.endsWith('+'),
        attempts: Number(attempts || 0),
        fails: Number(fails || 0),
        token,
        phase: phase === 'finalizing' ? 'finalizing' : '',
    };
};

export const parseDefEntry = (raw: string): ScheduleDefEntry | null => {
    const match = /^(\d+)\|([^|]*)\|([\s\S]*)$/.exec(raw);
    if (!match) return null;
    const [, version, state, json] = match;
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (state === 'ended')
        return {
            version: Number(version),
            state,
            def: null,
            endedAt: Number((parsed as { endedAt?: unknown }).endedAt ?? 0),
        };
    return {
        version: Number(version),
        state,
        def: parsed as ScheduleIndexDef,
        endedAt: null,
    };
};

export class ScheduleIndexStore extends PuterStore {
    #definedScripts = false;

    get namespace(): string {
        return scheduleNamespace(this.config);
    }

    #scripts(): ScheduleScripts {
        if (!this.#definedScripts) {
            this.#definedScripts = true;
            for (const [name, numberOfKeys, lua] of SCRIPTS)
                this.clients.redis.defineCommand(name, { numberOfKeys, lua });
        }
        return this.clients.redis as unknown as ScheduleScripts;
    }

    // -- Keys ---------------------------------------------------------

    keys(partition: number): {
        due: string;
        run: string;
        def: string;
        absent: string;
    } {
        const prefix = `sched:${this.namespace}`;
        const tag = `{sched:p${partition}}`;
        return {
            due: `${prefix}:due:${tag}`,
            run: `${prefix}:run:${tag}`,
            def: `${prefix}:def:${tag}`,
            absent: `${prefix}:absent:${tag}`,
        };
    }

    #keysFor(id: string) {
        return this.keys(schedulePartition(id));
    }

    #meta(name: string): string {
        return `sched:${this.namespace}:${name}`;
    }

    // -- Fire path ----------------------------------------------------

    /**
     * Lease up to `limit` due members of one partition. Members whose def is
     * missing or not `active` are taken out of the due set instead.
     */
    async pop(
        partition: number,
        limit: number,
        leaseMs: number,
    ): Promise<SchedulePop> {
        const k = this.keys(partition);
        const flat = await this.#scripts().schedPop(
            k.due,
            k.run,
            k.def,
            int(limit),
            int(leaseMs),
            randomUUID(),
        );
        const items: PoppedSchedule[] = [];
        for (let i = 1; i + 4 < flat.length; i += 5) {
            const prevRun = parseRunState(String(flat[i + 2]));
            const def = parseDefEntry(String(flat[i + 3]));
            if (!prevRun || !def) continue;
            items.push({
                id: String(flat[i]),
                partition,
                score: Number(flat[i + 1]),
                prevRun,
                def,
                token: String(flat[i + 4]),
            });
        }
        return { nowMs: Number(flat[0]), items };
    }

    async start(
        id: string,
        token: string,
        slot: number,
        missed: number,
        missedCapped: boolean,
    ): Promise<boolean> {
        const k = this.#keysFor(id);
        return (
            (await this.#scripts().schedStart(
                k.due,
                k.run,
                id,
                token,
                int(slot),
                encodeMissed(missed, missedCapped),
            )) === 1
        );
    }

    /** 1 settled, 0 lease lost, -1 a slot already settled. */
    async settle(
        id: string,
        token: string,
        slot: number,
        nextScore: number,
        nextOwed: number,
        fails: number,
    ): Promise<1 | 0 | -1> {
        const k = this.#keysFor(id);
        return (await this.#scripts().schedSettle(
            k.due,
            k.run,
            id,
            token,
            int(slot),
            int(nextScore),
            int(nextOwed),
            int(fails),
        )) as 1 | 0 | -1;
    }

    /** As {@link settle}, for the last slot: the member waits to be finished. */
    async finalize(
        id: string,
        token: string,
        slot: number,
        retryMs: number,
        fails: number,
    ): Promise<1 | 0 | -1> {
        const k = this.#keysFor(id);
        return (await this.#scripts().schedFinalize(
            k.due,
            k.run,
            id,
            token,
            int(slot),
            int(retryMs),
            int(fails),
        )) as 1 | 0 | -1;
    }

    async retry(
        id: string,
        token: string,
        delayMs: number,
        slot: number,
        missed: number,
        missedCapped: boolean,
        attempts: number,
        fails: number,
    ): Promise<boolean> {
        const k = this.#keysFor(id);
        return (
            (await this.#scripts().schedRetry(
                k.due,
                k.run,
                id,
                token,
                int(delayMs),
                int(slot),
                encodeMissed(missed, missedCapped),
                int(attempts),
                int(fails),
            )) === 1
        );
    }

    async defer(id: string, token: string, delayMs: number): Promise<boolean> {
        const k = this.#keysFor(id);
        return (
            (await this.#scripts().schedDefer(
                k.due,
                k.run,
                id,
                token,
                int(Math.max(0, delayMs)),
            )) === 1
        );
    }

    async renew(id: string, token: string, leaseMs: number): Promise<boolean> {
        const k = this.#keysFor(id);
        return (
            (await this.#scripts().schedRenew(
                k.due,
                k.run,
                id,
                token,
                int(leaseMs),
            )) === 1
        );
    }

    /**
     * Spend one run from a (holder, app)'s fixed window. 0 when admitted,
     * otherwise how long until the window resets.
     */
    async spendBudget(
        holderUserId: number,
        appUid: string,
        limit: number,
        windowMs: number,
    ): Promise<number> {
        return this.#scripts().schedBudget(
            this.#meta(`budget:{${holderUserId}:${appUid}}`),
            int(limit),
            int(windowMs),
        );
    }

    // -- Applying -----------------------------------------------------

    /**
     * Apply changes from create, the lifecycle, peers or the reconcile. Each is
     * version-guarded (see the class comment); results are in input order.
     * Pipelined per partition, so a batch never spans cluster slots.
     */
    async apply(
        changes: readonly ScheduleIndexChange[],
    ): Promise<ScheduleApplyResult[]> {
        const results = new Array<ScheduleApplyResult>(changes.length).fill(0);
        const byPartition = new Map<number, number[]>();
        changes.forEach((change, i) => {
            const p = schedulePartition(change.id);
            const indices = byPartition.get(p);
            if (indices) indices.push(i);
            else byPartition.set(p, [i]);
        });
        // A pipeline only carries commands already defined on the client.
        this.#scripts();
        for (const [p, indices] of byPartition) {
            const k = this.keys(p);
            for (let start = 0; start < indices.length; start += APPLY_BATCH) {
                const batch = indices.slice(start, start + APPLY_BATCH);
                const pipeline = this.clients.redis.pipeline();
                for (const i of batch) {
                    const c = changes[i];
                    (pipeline as unknown as ScheduleScripts).schedApply(
                        k.due,
                        k.run,
                        k.def,
                        k.absent,
                        c.id,
                        c.version === null ? '' : int(c.version),
                        c.state,
                        c.state === 'ended' || c.def === null
                            ? ''
                            : JSON.stringify(c.def),
                        int(c.score),
                        c.owed === null ? '' : int(c.owed),
                    );
                }
                const replies = (await pipeline.exec()) ?? [];
                batch.forEach((i, j) => {
                    const [err, reply] = replies[j] ?? [null, 0];
                    if (err) throw err;
                    results[i] = Number(reply) as ScheduleApplyResult;
                });
            }
        }
        return results;
    }

    /** Drop a tombstone older than `ageMs`. */
    async forgetTombstone(id: string, ageMs: number): Promise<boolean> {
        const k = this.#keysFor(id);
        return (
            (await this.#scripts().schedForget(
                k.def,
                k.run,
                k.absent,
                k.due,
                id,
                'tombstone',
                int(ageMs),
            )) === 1
        );
    }

    /**
     * Record that the schedule table no longer has this member, and drop it
     * once that was first recorded at least `ageMs` ago.
     */
    async forgetAbsent(id: string, ageMs: number): Promise<boolean> {
        const k = this.#keysFor(id);
        return (
            (await this.#scripts().schedForget(
                k.def,
                k.run,
                k.absent,
                k.due,
                id,
                'absent',
                int(ageMs),
            )) === 1
        );
    }

    // -- Reads --------------------------------------------------------

    async getDef(id: string): Promise<ScheduleDefEntry | null> {
        const raw = await this.clients.redis.hget(this.#keysFor(id).def, id);
        return raw === null ? null : parseDefEntry(raw);
    }

    async getRun(id: string): Promise<ScheduleRunState | null> {
        const raw = await this.clients.redis.hget(this.#keysFor(id).run, id);
        return raw === null ? null : parseRunState(raw);
    }

    async getScore(id: string): Promise<number | null> {
        const score = await this.clients.redis.zscore(
            this.#keysFor(id).due,
            id,
        );
        return score === null ? null : Number(score);
    }

    /** One page of a partition's defs, for the full diff's sweep. */
    async scanDefs(
        partition: number,
        cursor: string,
        count: number,
    ): Promise<{ cursor: string; entries: Array<[string, string]> }> {
        const [next, flat] = await this.clients.redis.hscan(
            this.keys(partition).def,
            cursor,
            'COUNT',
            count,
        );
        const entries: Array<[string, string]> = [];
        for (let i = 0; i + 1 < flat.length; i += 2)
            entries.push([flat[i], flat[i + 1]]);
        return { cursor: next, entries };
    }

    /** Redis time, the clock every script reads. */
    async now(): Promise<number> {
        const [seconds, micros] = await this.clients.redis.time();
        return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
    }

    // -- Region meta --------------------------------------------------

    async isBuilt(): Promise<boolean> {
        return (await this.clients.redis.exists(this.#meta('built'))) === 1;
    }

    async markBuilt(): Promise<void> {
        await this.clients.redis.set(this.#meta('built'), '1');
    }

    /** The incremental reconcile's cursor: the largest `updated_at` applied. */
    async getSyncCursor(): Promise<number | null> {
        const raw = await this.clients.redis.get(this.#meta('sync'));
        return raw === null ? null : Number(raw);
    }

    async setSyncCursor(updatedAt: number): Promise<void> {
        await this.clients.redis.set(this.#meta('sync'), int(updatedAt));
    }

    async getFullCursor(): Promise<ScheduleFullDiffCursor | null> {
        const raw = await this.clients.redis.get(this.#meta('full'));
        if (raw === null) return null;
        try {
            return JSON.parse(raw) as ScheduleFullDiffCursor;
        } catch {
            return null;
        }
    }

    async setFullCursor(cursor: ScheduleFullDiffCursor): Promise<void> {
        await this.clients.redis.set(
            this.#meta('full'),
            JSON.stringify(cursor),
        );
    }

    /** Run `fn` as this region's one reconcile, or `null` when another is. */
    withReconcileLock<T>(
        ttlMs: number,
        fn: () => Promise<T>,
    ): Promise<T | null> {
        return withRedisLock<T | null>(
            this.clients.redis,
            this.#meta('reconcile:lock'),
            fn,
            { ttlMs, onUnavailable: 'busy', onBusy: (): T | null => null },
        );
    }

    // -- Deploys ------------------------------------------------------

    /**
     * Run a deploy of `script` holding this region's lock on that script and
     * one of its `cap` deploy slots. `'busy'` when either is taken.
     */
    async withDeployGate<T>(
        script: string,
        options: { cap: number; ttlMs: number; renewMs: number },
        deploy: () => Promise<T>,
    ): Promise<T | 'busy'> {
        const semaphore = this.#meta('deploys');
        return withRedisLock<T | 'busy'>(
            this.clients.redis,
            this.#meta(`deploy:{${script}}`),
            async () => {
                const token = randomUUID();
                const taken = await this.#scripts().schedDeployAcquire(
                    semaphore,
                    int(options.cap),
                    int(options.ttlMs),
                    token,
                );
                if (taken !== 1) return 'busy';
                const renew = setInterval(() => {
                    void (async () => {
                        try {
                            await this.#scripts().schedDeployRenew(
                                semaphore,
                                token,
                                int(options.ttlMs),
                            );
                        } catch {
                            // The slot frees itself at expiry.
                        }
                    })();
                }, options.renewMs);
                renew.unref?.();
                try {
                    return await deploy();
                } finally {
                    clearInterval(renew);
                    try {
                        await this.clients.redis.zrem(semaphore, token);
                    } catch {
                        // The slot frees itself at expiry.
                    }
                }
            },
            {
                ttlMs: options.ttlMs,
                onUnavailable: 'busy',
                onBusy: (): T | 'busy' => 'busy',
            },
        );
    }
}
