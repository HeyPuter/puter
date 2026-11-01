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

import MockRedis from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.js';
import {
    SCHEDULE_PARTITIONS,
    ScheduleIndexStore,
    schedulePartition,
    type ScheduleIndexChange,
    type ScheduleIndexDef,
} from './ScheduleIndexStore.js';

/**
 * The due index's scripts, on the in-process Redis a single node runs. Every
 * contract here is what keeps one slot firing and billing once: fenced leases,
 * a forward-only `owed`, and a version-guarded apply that a tombstone
 * outlives.
 */

const T0 = Date.parse('2026-11-02T10:00:00Z');
const LEASE = 45_000;

let seq = 0;
let redis: InstanceType<typeof MockRedis.Cluster>;
let index: ScheduleIndexStore;
let now = T0;

/**
 * The mock's `TIME` is whole seconds of `Date` plus the monotonic clock's
 * sub-second part; pinning both makes the scripts' clock exact.
 */
const setClock = (ms: number): void => {
    now = ms;
    vi.setSystemTime(ms);
};

const def = (over: Partial<ScheduleIndexDef> = {}): ScheduleIndexDef => ({
    rowId: 1,
    kind: 'recurring',
    startAt: T0,
    everyMs: 60_000,
    cron: null,
    tz: 'UTC',
    endsAt: null,
    createdAt: T0 - 1000,
    subId: 'sub-1',
    holderUserId: 7,
    appUid: 'app-1',
    handlerName: 'tick',
    context: null,
    handlerDepth: 0,
    offsetMs: 0,
    action: null,
    ...over,
});

const change = (
    id: string,
    over: Partial<ScheduleIndexChange> = {},
): ScheduleIndexChange => ({
    id,
    version: 2,
    state: 'active',
    def: def(),
    score: T0,
    owed: T0,
    ...over,
});

const applyOne = async (c: ScheduleIndexChange) => (await index.apply([c]))[0];

const popOne = async (id: string) => {
    const { items } = await index.pop(schedulePartition(id), 100, LEASE);
    return items.find((item) => item.id === id) ?? null;
};

beforeEach(() => {
    seq++;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(process, 'hrtime').mockReturnValue([0, 0]);
    setClock(T0);
    redis = new MockRedis.Cluster(['redis://localhost:7001']);
    index = new ScheduleIndexStore(
        { jobs: { namespace: `idx${seq}` } } as IConfig,
        { redis } as never,
        {} as never,
    );
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('keys', () => {
    it('share one hash tag per partition and carry the namespace', () => {
        for (let p = 0; p < SCHEDULE_PARTITIONS; p++) {
            const keys = Object.values(index.keys(p));
            for (const key of keys) {
                expect(key.startsWith(`sched:idx${seq}:`)).toBe(true);
                expect(key.endsWith(`{sched:p${p}}`)).toBe(true);
            }
        }
    });
});

describe('pop', () => {
    it('leases due members and returns the run as it was before', async () => {
        await applyOne(change('a'));
        const popped = await popOne('a');
        expect(popped).toMatchObject({
            id: 'a',
            score: T0,
            prevRun: { owed: T0, token: '', fails: 0, attempts: 0 },
            def: { version: 2, state: 'active', def: { holderUserId: 7 } },
        });
        expect(popped!.token).not.toBe('');
        expect(await index.getScore('a')).toBe(T0 + LEASE);
        expect((await index.getRun('a'))!.token).toBe(popped!.token);

        // Within the lease nothing else gets it.
        await expect(popOne('a')).resolves.toBeNull();
    });

    it('takes non-active and def-less members out of the due set', async () => {
        await applyOne(change('s', { state: 'suspended:failures' }));
        await redis.zadd(index.keys(schedulePartition('s')).due, T0, 's');
        await redis.zadd(index.keys(schedulePartition('x')).due, T0, 'x');
        expect(await popOne('s')).toBeNull();
        expect(await popOne('x')).toBeNull();
        expect(await index.getScore('s')).toBeNull();
        expect(await index.getScore('x')).toBeNull();
    });

    it('takes a member whose def has no run out of the due set', async () => {
        await applyOne(change('r'));
        await redis.hdel(index.keys(schedulePartition('r')).run, 'r');
        expect(await popOne('r')).toBeNull();
        expect(await index.getScore('r')).toBeNull();
    });

    it('a re-pop after the lease lapses sees the crashed attempt`s token', async () => {
        await applyOne(change('c'));
        const first = await popOne('c');
        setClock(T0 + LEASE + 1000);
        const second = await popOne('c');
        expect(second!.prevRun.token).toBe(first!.token);
        expect(second!.token).not.toBe(first!.token);
    });

    it('writes whole-millisecond numbers and keeps a def with `|` intact', async () => {
        const context = JSON.stringify({ note: 'a|b|c' });
        await applyOne(change('j', { def: def({ context }) }));
        const popped = await popOne('j');
        expect(popped!.def.def!.context).toBe(context);
        const raw = await redis.hget(
            index.keys(schedulePartition('j')).run,
            'j',
        );
        expect(raw).not.toMatch(/\.0/);
        expect(
            String(
                await redis.zscore(index.keys(schedulePartition('j')).due, 'j'),
            ),
        ).toMatch(/^\d+$/);
    });
});

describe('fenced scripts', () => {
    const leased = async (id: string) => {
        await applyOne(change(id));
        return (await popOne(id))!;
    };

    it('refuse a stale token', async () => {
        const { token } = await leased('f');
        const stale = `${token}x`;
        expect(await index.start('f', stale, T0, 0, false)).toBe(false);
        expect(
            await index.settle('f', stale, T0, T0 + 60_000, T0 + 60_000, 0),
        ).toBe(0);
        expect(await index.finalize('f', stale, T0, 60_000, 0)).toBe(0);
        expect(await index.retry('f', stale, 1000, T0, 0, false, 1, 1)).toBe(
            false,
        );
        expect(await index.defer('f', stale, 1000)).toBe(false);
        expect(await index.renew('f', stale, LEASE)).toBe(false);
        expect(await index.getRun('f')).toMatchObject({ owed: T0, token });
    });

    it('refuse once a settle has cleared the token', async () => {
        const { token } = await leased('g');
        expect(
            await index.settle('g', token, T0, T0 + 60_000, T0 + 60_000, 0),
        ).toBe(1);
        expect(await index.renew('g', token, LEASE)).toBe(false);
        expect(
            await index.settle('g', token, T0, T0 + 60_000, T0 + 60_000, 0),
        ).toBe(0);
    });

    it('settle never moves owed backwards nor settles a slot before it', async () => {
        const { token } = await leased('h');
        expect(await index.settle('h', token, T0 - 60_000, T0, T0, 0)).toBe(-1);
        expect(await index.settle('h', token, T0, T0, T0, 0)).toBe(-1);
        expect(await index.getRun('h')).toMatchObject({ owed: T0 });
        expect(
            await index.settle('h', token, T0, T0 + 61_000, T0 + 60_000, 3),
        ).toBe(1);
        expect(await index.getRun('h')).toMatchObject({
            owed: T0 + 60_000,
            fails: 3,
            token: '',
            pinned: null,
            attempts: 0,
        });
        expect(await index.getScore('h')).toBe(T0 + 61_000);
    });

    it('start pins the slot and missed; retry keeps owed and stores counts', async () => {
        const { token } = await leased('i');
        expect(await index.start('i', token, T0 + 120_000, 2, false)).toBe(
            true,
        );
        expect(await index.getRun('i')).toMatchObject({
            owed: T0,
            pinned: T0 + 120_000,
            missed: 2,
        });
        expect(
            await index.retry('i', token, 5000, T0 + 120_000, 1000, true, 1, 4),
        ).toBe(true);
        expect(await index.getRun('i')).toMatchObject({
            owed: T0,
            pinned: T0 + 120_000,
            missed: 1000,
            missedCapped: true,
            attempts: 1,
            fails: 4,
            token: '',
        });
        expect(await index.getScore('i')).toBe(T0 + 5000);
    });

    it('defer moves the score and leaves the pin and counts', async () => {
        const { token } = await leased('d');
        await index.start('d', token, T0, 0, false);
        expect(await index.defer('d', token, 7000)).toBe(true);
        expect(await index.getScore('d')).toBe(T0 + 7000);
        expect(await index.getRun('d')).toMatchObject({
            pinned: T0,
            token: '',
        });
    });

    it('renew pushes the lease out', async () => {
        const { token } = await leased('n');
        setClock(T0 + 15_000);
        expect(await index.renew('n', token, LEASE)).toBe(true);
        expect(await index.getScore('n')).toBe(T0 + 15_000 + LEASE);
    });

    it('finalize parks the member as finalizing with the retry score', async () => {
        const { token } = await leased('z');
        expect(await index.finalize('z', token, T0 - 1000, 60_000, 0)).toBe(-1);
        expect(await index.finalize('z', token, T0, 60_000, 2)).toBe(1);
        expect(await index.getRun('z')).toMatchObject({
            phase: 'finalizing',
            token: '',
            fails: 2,
        });
        expect(await index.getScore('z')).toBe(T0 + 60_000);
    });
});

describe('versions', () => {
    it('are read in one round trip per partition, absent members left out', async () => {
        const ids = Array.from({ length: 200 }, (_, i) => `v-${i}`);
        await index.apply(
            ids.slice(0, 150).map((id, i) => change(id, { version: i + 1 })),
        );
        const hget = vi.spyOn(redis, 'hget');
        const pipeline = vi.spyOn(redis, 'pipeline');
        const versions = await index.versionsOf(ids);
        expect(hget).not.toHaveBeenCalled();
        expect(pipeline.mock.calls.length).toBeLessThanOrEqual(
            SCHEDULE_PARTITIONS,
        );
        expect(versions.size).toBe(150);
        expect(versions.get('v-0')).toBe(1);
        expect(versions.get('v-149')).toBe(150);
        expect(versions.has('v-199')).toBe(false);
    });
});

describe('apply', () => {
    it('ignores an older version', async () => {
        await applyOne(change('o', { version: 5 }));
        expect(
            await applyOne(change('o', { version: 4, state: 'ended' })),
        ).toBe(0);
        expect((await index.getDef('o'))!.state).toBe('active');
    });

    it('suspend un-dues and clears the token and pin, keeping owed and fails', async () => {
        await applyOne(change('s'));
        const { token } = (await popOne('s'))!;
        await index.start('s', token, T0, 0, false);
        expect(
            await applyOne(
                change('s', {
                    version: 3,
                    state: 'suspended:handler_not_found',
                }),
            ),
        ).toBe(1);
        expect(await index.getScore('s')).toBeNull();
        expect(await index.getRun('s')).toMatchObject({
            owed: T0,
            token: '',
            pinned: null,
        });
        // The in-flight attempt can no longer settle.
        expect(
            await index.settle('s', token, T0, T0 + 60_000, T0 + 60_000, 0),
        ).toBe(0);
    });

    it('resume clears the pin, resets the counts and keeps owed', async () => {
        await applyOne(change('r'));
        const { token } = (await popOne('r'))!;
        await index.retry('r', token, 1000, T0 + 60_000, 1, false, 2, 4);
        await applyOne(
            change('r', { version: 3, state: 'suspended:failures' }),
        );
        expect(
            await applyOne(
                change('r', {
                    version: 4,
                    score: T0 + 600_000,
                    owed: T0 + 600_000,
                }),
            ),
        ).toBe(1);
        expect(await index.getRun('r')).toMatchObject({
            owed: T0,
            pinned: null,
            attempts: 0,
            fails: 0,
            token: '',
        });
        expect(await index.getScore('r')).toBe(T0 + 600_000);
    });

    it('a higher active version leaves a leased member alone', async () => {
        await applyOne(change('l'));
        const { token } = (await popOne('l'))!;
        expect(
            await applyOne(change('l', { version: 3, score: T0 - 5000 })),
        ).toBe(1);
        expect(await index.getScore('l')).toBe(T0 + LEASE);
        expect((await index.getRun('l'))!.token).toBe(token);
    });

    it('ended writes a tombstone an older or equal apply can`t recreate', async () => {
        await applyOne(change('e'));
        expect(
            await applyOne(change('e', { version: 3, state: 'ended' })),
        ).toBe(1);
        expect(await index.getDef('e')).toMatchObject({
            version: 3,
            state: 'ended',
            def: null,
        });
        expect(await index.getRun('e')).toBeNull();
        expect(await index.getScore('e')).toBeNull();
        expect(await applyOne(change('e', { version: 2 }))).toBe(0);
        expect(await applyOne(change('e', { version: 3 }))).toBe(3);
        expect(
            await applyOne(change('e', { version: 3, state: 'ended' })),
        ).toBe(0);
        expect((await index.getDef('e'))!.state).toBe('ended');
        // Only a newer row, which only the table can produce, replaces it.
        expect(await applyOne(change('e', { version: 4 }))).toBe(1);
        expect(await index.getRun('e')).toMatchObject({ owed: T0 });
    });

    it('tells a tombstone over nothing apart from one over a live member', async () => {
        expect(
            await applyOne(change('n', { version: 3, state: 'ended' })),
        ).toBe(4);
        expect(await index.getDef('n')).toMatchObject({
            version: 3,
            state: 'ended',
        });
    });

    describe('at an equal version', () => {
        it('repairs a missing run and due membership without touching owed', async () => {
            await applyOne(change('m'));
            const keys = index.keys(schedulePartition('m'));
            await redis.zrem(keys.due, 'm');
            expect(
                await applyOne(
                    change('m', { owed: T0 + 999_000, score: T0 + 5000 }),
                ),
            ).toBe(2);
            expect(await index.getScore('m')).toBe(T0 + 5000);
            expect((await index.getRun('m'))!.owed).toBe(T0);

            await redis.hdel(keys.run, 'm');
            expect(await applyOne(change('m', { owed: T0 + 60_000 }))).toBe(2);
            expect((await index.getRun('m'))!.owed).toBe(T0 + 60_000);
            expect(await applyOne(change('m'))).toBe(0);
        });

        it('leaves a leased or finalizing member`s lease and phase alone', async () => {
            await applyOne(change('p'));
            const { token } = (await popOne('p'))!;
            expect(await applyOne(change('p', { score: T0 }))).toBe(0);
            expect(await index.getScore('p')).toBe(T0 + LEASE);
            await index.finalize('p', token, T0, 60_000, 0);
            expect(await applyOne(change('p', { score: T0 }))).toBe(0);
            expect(await index.getRun('p')).toMatchObject({
                phase: 'finalizing',
                owed: T0,
            });
            expect(await index.getScore('p')).toBe(T0 + 60_000);
        });

        it('un-dues a non-active member that is still due', async () => {
            await applyOne(change('u', { state: 'suspended:no_credit' }));
            await redis.zadd(index.keys(schedulePartition('u')).due, T0, 'u');
            expect(
                await applyOne(change('u', { state: 'suspended:no_credit' })),
            ).toBe(2);
            expect(await index.getScore('u')).toBeNull();
        });

        it('a different state transitions: suspend clears, resume resets', async () => {
            await applyOne(change('t'));
            const { token } = (await popOne('t'))!;
            await index.retry('t', token, 1000, T0, 0, false, 1, 2);
            expect(
                await applyOne(change('t', { state: 'suspended:failures' })),
            ).toBe(1);
            expect(await index.getRun('t')).toMatchObject({
                token: '',
                pinned: null,
                fails: 2,
            });
            expect(await applyOne(change('t', { score: T0 + 9000 }))).toBe(1);
            expect(await index.getRun('t')).toMatchObject({
                fails: 0,
                attempts: 0,
                owed: T0,
            });
            expect(await index.getScore('t')).toBe(T0 + 9000);
        });

        it('with `exact`, applies only at the version the caller saw', async () => {
            await applyOne(change('v', { version: 7 }));
            const suspend = {
                exact: true,
                state: 'suspended:failures',
                def: null,
            };
            expect(
                await applyOne(change('v', { version: 6, ...suspend })),
            ).toBe(0);
            expect(
                await applyOne(change('v', { version: 8, ...suspend })),
            ).toBe(0);
            expect(
                await applyOne(change('v', { version: 7, ...suspend })),
            ).toBe(1);
            expect(await index.getDef('v')).toMatchObject({
                version: 7,
                state: 'suspended:failures',
                def: { appUid: 'app-1' },
            });
            expect(
                await applyOne(change('w', { version: 1, exact: true })),
            ).toBe(0);
            expect(await index.getDef('w')).toBeNull();
            expect(await index.versionsOf(['v', 'w'])).toEqual(
                new Map([['v', 7]]),
            );
        });
    });
});

describe('forget', () => {
    it('drops a tombstone only once it is old enough', async () => {
        await applyOne(change('t', { state: 'ended' }));
        expect(await index.forgetTombstone('t', 60_000)).toBe(false);
        setClock(T0 + 61_000);
        expect(await index.forgetTombstone('t', 60_000)).toBe(true);
        expect(await index.getDef('t')).toBeNull();
    });

    it('never drops a live def as a tombstone', async () => {
        await applyOne(change('l'));
        setClock(T0 + 10 * 24 * 3600_000);
        expect(await index.forgetTombstone('l', 60_000)).toBe(false);
    });

    it('drops an absent member only on a later sighting, old enough', async () => {
        await applyOne(change('a'));
        expect(await index.forgetAbsent('a', 600_000)).toBe(false);
        setClock(T0 + 300_000);
        expect(await index.forgetAbsent('a', 600_000)).toBe(false);
        setClock(T0 + 600_000);
        expect(await index.forgetAbsent('a', 600_000)).toBe(true);
        expect(await index.getDef('a')).toBeNull();
        expect(await index.getScore('a')).toBeNull();
    });

    it('any apply clears an absence record', async () => {
        await applyOne(change('b'));
        await index.forgetAbsent('b', 600_000);
        await applyOne(change('b'));
        setClock(T0 + 600_000);
        expect(await index.forgetAbsent('b', 600_000)).toBe(false);
    });
});

describe('budget', () => {
    it('admits the limit per window, then says how long until it resets', async () => {
        for (let i = 0; i < 3; i++)
            expect(await index.spendBudget(7, 'app', 3, 60_000)).toBe(0);
        const wait = await index.spendBudget(7, 'app', 3, 60_000);
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(60_000);
        expect(await index.spendBudget(8, 'app', 3, 60_000)).toBe(0);
    });
});

describe('deploy gate', () => {
    const gate = { cap: 2, ttlMs: 60_000, renewMs: 20_000 };

    it('lets one deploy per script through at a time', async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const first = index.withDeployGate('script-a', gate, async () => {
            await held;
            return 'deployed';
        });
        await vi.waitFor(async () =>
            expect(
                await redis.exists(`sched:idx${seq}:deploy:{script-a}`),
            ).toBe(1),
        );
        expect(
            await index.withDeployGate(
                'script-a',
                gate,
                async () => 'deployed',
            ),
        ).toBe('busy');
        release();
        expect(await first).toBe('deployed');
        expect(
            await index.withDeployGate('script-a', gate, async () => 'again'),
        ).toBe('again');
    });

    it('holds at most `cap` deploys, and a crashed holder`s slot frees at expiry', async () => {
        const semaphore = `sched:idx${seq}:deploys`;
        await redis.zadd(
            semaphore,
            T0 + 60_000,
            'crashed-1',
            T0 + 60_000,
            'crashed-2',
        );
        expect(
            await index.withDeployGate(
                'script-b',
                gate,
                async () => 'deployed',
            ),
        ).toBe('busy');
        setClock(T0 + 61_000);
        expect(
            await index.withDeployGate(
                'script-b',
                gate,
                async () => 'deployed',
            ),
        ).toBe('deployed');
        expect(await redis.zcard(semaphore)).toBe(0);
    });

    it('an uncapped caller takes a slot past the cap, and capped callers see it', async () => {
        const semaphore = `sched:idx${seq}:deploys`;
        await redis.zadd(
            semaphore,
            T0 + 60_000,
            'held-1',
            T0 + 60_000,
            'held-2',
        );
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const uncapped = index.withDeployGate(
            'script-c',
            { ...gate, cap: null },
            async () => {
                await held;
                return 'deployed';
            },
        );
        await vi.waitFor(async () =>
            expect(await redis.zcard(semaphore)).toBe(3),
        );
        expect(
            await index.withDeployGate(
                'script-d',
                gate,
                async () => 'deployed',
            ),
        ).toBe('busy');
        release();
        expect(await uncapped).toBe('deployed');
        expect(await redis.zcard(semaphore)).toBe(2);
    });
});

it('reads the clock it scripts with', async () => {
    expect(await index.now()).toBe(now);
});
