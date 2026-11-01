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
import {
    EVENTS_CONSECUTIVE_FAILURES,
    EVENTS_SCHEDULE_INVOCATION_LIMIT,
    EVENTS_SCHEDULE_SPREAD_MAX_MS,
    EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import {
    ScheduleIndexStore,
    schedulePartition,
    type ScheduleIndexChange,
    type ScheduleIndexDef,
} from '../../stores/events/ScheduleIndexStore.js';
import type { IConfig } from '../../types.js';
import type { ScheduleInvokeResult } from './EventsService.js';
import { ScheduleActionRegistry } from './scheduleActions.js';
import {
    SCHEDULE_FINALIZE_RETRY_MS,
    SCHEDULE_LEASE_MS,
    ScheduleRunner,
    type ScheduleRunnerHost,
} from './ScheduleRunner.js';
import { spreadOffsetMs } from './scheduleSlots.js';
import type { ScheduleEvent, WorkerInvocation } from './workerSeam.js';

/**
 * The fire path against the real index scripts, with the layers around it faked
 * at their seams: who the holder is, whether they can pay, and what the handler
 * answers. What is pinned here is the at-least-once contract: one backend
 * attempt per schedule at a time, `event.id` stable across retries, crashes and
 * re-pops, and one settle and one bill per slot.
 */

const MIN = 60_000;
const T0 = Date.parse('2026-11-02T10:00:00Z');

let seq = 0;
let redis: InstanceType<typeof MockRedis.Cluster>;
let index: ScheduleIndexStore;
let invoked: ScheduleEvent[];
let answer: (invocation: WorkerInvocation) => Promise<ScheduleInvokeResult>;
let host: ScheduleRunnerHost & {
    events: {
        [K in keyof ScheduleRunnerHost['events']]: ReturnType<typeof vi.fn>;
    };
    finishRun: ReturnType<typeof vi.fn>;
    endOrphan: ReturnType<typeof vi.fn>;
    alarm: ReturnType<typeof vi.fn>;
};
let actor: Actor | null;

const setClock = (ms: number): void => {
    vi.setSystemTime(ms);
};

const def = (over: Partial<ScheduleIndexDef> = {}): ScheduleIndexDef => ({
    rowId: 1,
    kind: 'recurring',
    startAt: T0,
    everyMs: MIN,
    cron: null,
    tz: 'UTC',
    endsAt: null,
    createdAt: T0 - MIN,
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

const seed = async (
    id: string,
    over: Partial<ScheduleIndexDef> = {},
    change: Partial<ScheduleIndexChange> = {},
): Promise<void> => {
    const d = def(over);
    const owed = change.owed ?? d.startAt;
    await index.apply([
        {
            id,
            version: 2,
            state: 'active',
            def: d,
            score: owed + d.offsetMs,
            owed,
            ...change,
        },
    ]);
};

const runner = (options = {}) => new ScheduleRunner(host, options);

/** One tick of a runner, and everything it started. */
const tickAll = async (r: ScheduleRunner = runner()): Promise<void> => {
    await r.tick();
    await r.drain();
};

/** Let started attempts reach the handler. */
const untilInvoked = async (count: number): Promise<void> => {
    for (let i = 0; i < 200 && invoked.length < count; i++)
        await new Promise((resolve) => setImmediate(resolve));
    expect(invoked).toHaveLength(count);
};

const billed = () => host.events.meterScheduleRun.mock.calls.length;

beforeEach(() => {
    seq++;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(process, 'hrtime').mockReturnValue([0, 0]);
    setClock(T0);
    redis = new MockRedis.Cluster(['redis://localhost:7001']);
    index = new ScheduleIndexStore(
        { jobs: { namespace: `run${seq}` } } as IConfig,
        { redis } as never,
        {} as never,
    );
    invoked = [];
    actor = { user: { id: 7, suspended: false } } as unknown as Actor;
    answer = async () => ({ outcome: 'settled' });
    host = {
        index,
        actions: new ScheduleActionRegistry(),
        events: {
            invokeForSchedule: vi.fn(async (invocation, options) => {
                const sent = (
                    options?.stampEvent
                        ? options.stampEvent(invocation.event)
                        : invocation.event
                ) as ScheduleEvent;
                invoked.push(sent);
                return answer(invocation);
            }),
            resolveScheduleActor: vi.fn(async () => actor),
            chargeableForSchedule: vi.fn(async () => true),
            meterScheduleRun: vi.fn(async () => {}),
            suspendForFailures: vi.fn(async () => true),
        },
        finishRun: vi.fn(async (_id: string, version: number) => version + 1),
        endOrphan: vi.fn(async (_id: string, version: number) => version + 1),
        alarm: vi.fn(),
    } as unknown as typeof host;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('an on-time slot', () => {
    it('fires once, advances to the next slot and bills once', async () => {
        await seed('a');
        await tickAll();
        expect(invoked).toHaveLength(1);
        expect(invoked[0]).toMatchObject({
            subject: 'schedule:a',
            op: 'tick',
            id: `a:${T0}`,
            scheduleId: 'a',
            scheduledFor: T0,
            missed: 0,
            attempt: 1,
            firedAt: T0,
        });
        expect(invoked[0].missedCapped).toBeUndefined();
        expect(await index.getRun('a')).toMatchObject({
            owed: T0 + MIN,
            token: '',
            fails: 0,
        });
        expect(await index.getScore('a')).toBe(T0 + MIN);
        expect(billed()).toBe(1);

        await tickAll();
        expect(invoked).toHaveLength(1);
    });

    it('is fired by one of five runners ticking at once', async () => {
        await seed('five');
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        answer = async () => {
            await held;
            return { outcome: 'settled' };
        };
        const runners = Array.from({ length: 5 }, () => runner());
        await Promise.all(runners.map((r) => r.tick()));
        await untilInvoked(1);
        release();
        await Promise.all(runners.map((r) => r.drain()));
        expect(billed()).toBe(1);
    });

    it('waits when popped before its slot, with no run, bill or failure', async () => {
        await seed('early', {}, { owed: T0 + 5 * MIN, score: T0 - 1000 });
        await tickAll();
        expect(invoked).toHaveLength(0);
        expect(await index.getScore('early')).toBe(T0 + 5 * MIN);
        expect(await index.getRun('early')).toMatchObject({
            owed: T0 + 5 * MIN,
            fails: 0,
            attempts: 0,
            token: '',
        });
    });
});

describe('a late slot', () => {
    it('fires the latest slot with what it missed, pinned before invoking', async () => {
        await seed('late');
        setClock(T0 + 2 * MIN + 5000);
        let pinnedDuringRun = null;
        answer = async () => {
            pinnedDuringRun = (await index.getRun('late'))!.pinned;
            return { outcome: 'settled' };
        };
        await tickAll();
        expect(invoked[0]).toMatchObject({
            id: `late:${T0 + 2 * MIN}`,
            scheduledFor: T0 + 2 * MIN,
            missed: 2,
        });
        expect(pinnedDuringRun).toBe(T0 + 2 * MIN);
        expect(await index.getRun('late')).toMatchObject({
            owed: T0 + 3 * MIN,
            pinned: null,
        });
    });
});

describe('a crashed attempt', () => {
    /** An attempt that never comes back, as from a node that died. */
    const crash = () => {
        let finish!: (result: ScheduleInvokeResult) => void;
        answer = () =>
            new Promise<ScheduleInvokeResult>((resolve) => (finish = resolve));
        return (result: ScheduleInvokeResult) => finish(result);
    };

    it('re-fires the same slot after the next one has passed, and bills once', async () => {
        await seed('c');
        const dead = runner();
        const late = crash();
        await dead.tick();
        await untilInvoked(1);
        expect(invoked[0].id).toBe(`c:${T0}`);

        // The lease lapses after the next nominal slot.
        setClock(T0 + SCHEDULE_LEASE_MS + MIN);
        answer = async () => ({ outcome: 'settled' });
        await tickAll();
        expect(invoked[1]).toMatchObject({
            id: `c:${T0}`,
            missed: 0,
            attempt: 1,
        });
        expect(await index.getRun('c')).toMatchObject({ owed: T0 + MIN });
        expect(billed()).toBe(1);

        // The first attempt answers at last: its settle is refused.
        late({ outcome: 'settled' });
        await dead.drain();
        expect(billed()).toBe(1);
        expect(await index.getRun('c')).toMatchObject({ owed: T0 + MIN });
    });

    it('re-fires a late attempt`s pinned slot with the same missed count', async () => {
        await seed('p');
        setClock(T0 + 2 * MIN + 5000);
        const dead = runner();
        crash();
        await dead.tick();
        await untilInvoked(1);
        expect(invoked[0]).toMatchObject({
            id: `p:${T0 + 2 * MIN}`,
            missed: 2,
        });

        setClock(T0 + 2 * MIN + 5000 + SCHEDULE_LEASE_MS + 2 * MIN);
        answer = async () => ({ outcome: 'settled' });
        await tickAll();
        expect(invoked[1]).toMatchObject({
            id: `p:${T0 + 2 * MIN}`,
            missed: 2,
        });
    });
});

describe('retries', () => {
    it('keep `event.id` and count attempts across three of them', async () => {
        await seed('r');
        setClock(T0 + MIN + 5000);
        const outcomes: ScheduleInvokeResult[] = [
            { outcome: 'retriable' },
            { outcome: 'unavailable' },
            { outcome: 'retriable', retryAfterMs: 30_000 },
            { outcome: 'settled' },
        ];
        answer = async () => outcomes.shift()!;
        let now = T0 + MIN + 5000;
        for (let attempt = 1; attempt <= 4; attempt++) {
            await tickAll();
            now += Math.max(deliveryBackoffMs(attempt), 30_000) + 1000;
            setClock(now);
        }
        expect(invoked.map((e) => e.id)).toEqual(
            Array(4).fill(`r:${T0 + MIN}`),
        );
        expect(invoked.map((e) => e.attempt)).toEqual([1, 2, 3, 4]);
        expect(invoked.map((e) => e.missed)).toEqual([1, 1, 1, 1]);
        expect(billed()).toBe(1);
        // A settle resets the run of failures.
        expect(await index.getRun('r')).toMatchObject({
            fails: 0,
            attempts: 0,
        });
    });

    it('wait at least what the handler asked for', async () => {
        await seed('w');
        answer = async () => ({ outcome: 'retriable', retryAfterMs: 120_000 });
        await tickAll();
        expect(await index.getScore('w')).toBe(T0 + 120_000);
    });
});

describe('failures', () => {
    it('suspend after five in a row, terminal and retriable mixed, across slots', async () => {
        await seed('f');
        const outcomes: ScheduleInvokeResult[] = [
            { outcome: 'terminal' },
            { outcome: 'retriable' },
            { outcome: 'unavailable' },
            { outcome: 'terminal' },
            { outcome: 'retriable' },
            { outcome: 'terminal' },
        ];
        answer = async () => outcomes.shift()!;
        let now = T0;
        while (outcomes.length > 0) {
            await tickAll();
            now += 10 * MIN;
            setClock(now);
        }
        expect(host.events.suspendForFailures).toHaveBeenCalledTimes(1);
        expect(host.events.suspendForFailures).toHaveBeenCalledWith('sub-1');
        expect((await index.getRun('f'))!.fails).toBe(
            EVENTS_CONSECUTIVE_FAILURES,
        );
        // Each refused slot was dropped and billed; retries were not.
        expect(billed()).toBe(3);
    });

    it('a budget deferral is not a failure', async () => {
        await seed('b');
        const budgetKey = `sched:run${seq}:budget:{7:app-1}`;
        await redis.set(
            budgetKey,
            String(EVENTS_SCHEDULE_INVOCATION_LIMIT.limit),
        );
        await redis.pexpire(budgetKey, 20_000);
        await tickAll();
        expect(invoked).toHaveLength(0);
        expect(await index.getRun('b')).toMatchObject({
            fails: 0,
            attempts: 0,
        });
        const score = (await index.getScore('b'))!;
        expect(score).toBeGreaterThan(T0);
        expect(score).toBeLessThanOrEqual(T0 + 20_000);
    });

    it('a handler that is too deep drops the slot without a bill or a failure', async () => {
        await seed('d');
        answer = async () => ({ outcome: 'too-deep' });
        await tickAll();
        expect(billed()).toBe(0);
        expect(await index.getRun('d')).toMatchObject({
            owed: T0 + MIN,
            fails: 0,
        });
    });
});

describe('deferrals', () => {
    it('a suspended holder waits 15 minutes, then fires', async () => {
        await seed('s');
        actor = { user: { id: 7, suspended: true } } as unknown as Actor;
        await tickAll();
        expect(invoked).toHaveLength(0);
        expect(await index.getScore('s')).toBe(
            T0 + EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
        );
        expect(billed()).toBe(0);
        expect(await index.getRun('s')).toMatchObject({ fails: 0, owed: T0 });

        actor = { user: { id: 7, suspended: false } } as unknown as Actor;
        setClock(T0 + EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS);
        await tickAll();
        expect(invoked).toHaveLength(1);
        expect(invoked[0].missed).toBe(15);
    });

    it('withdrawn consent waits a minute', async () => {
        await seed('n');
        answer = async () => ({ outcome: 'no-consent' });
        await tickAll();
        expect(await index.getScore('n')).toBe(T0 + 60_000);
        expect(await index.getRun('n')).toMatchObject({ fails: 0, owed: T0 });
    });

    it('a deploy someone else holds waits five seconds', async () => {
        await seed('y');
        answer = async () => ({ outcome: 'deploy-busy' });
        await tickAll();
        expect(await index.getScore('y')).toBe(T0 + 5000);
    });

    it('a holder who can`t pay is not invoked', async () => {
        await seed('k');
        host.events.chargeableForSchedule.mockResolvedValue(false);
        await tickAll();
        expect(invoked).toHaveLength(0);
        expect(billed()).toBe(0);
    });
});

describe('lifecycle during a run', () => {
    it('a suspension mid-run refuses the settle, and the resume stands', async () => {
        await seed('l');
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        answer = async () => {
            await held;
            return { outcome: 'retriable' };
        };
        const r = runner();
        await r.tick();
        await untilInvoked(1);
        await index.apply([
            {
                id: 'l',
                version: 3,
                state: 'suspended:handler_not_found',
                def: def(),
                score: 0,
                owed: T0,
            },
        ]);
        await index.apply([
            {
                id: 'l',
                version: 4,
                state: 'active',
                def: def(),
                score: T0 + 10 * MIN,
                owed: T0,
            },
        ]);
        release();
        await r.drain();
        expect(billed()).toBe(0);
        expect(await index.getRun('l')).toMatchObject({
            owed: T0,
            fails: 0,
            attempts: 0,
            token: '',
        });
        expect(await index.getScore('l')).toBe(T0 + 10 * MIN);
    });

    it('a holder or app gone ends the schedule, once', async () => {
        await seed('o');
        actor = null;
        await tickAll();
        expect(host.endOrphan).toHaveBeenCalledTimes(1);
        expect(await index.getDef('o')).toMatchObject({
            state: 'ended',
            version: 3,
        });
        await tickAll();
        expect(host.endOrphan).toHaveBeenCalledTimes(1);
    });
});

describe('the last slot', () => {
    it('a one-shot fires once, and a failed finish retries without invoking', async () => {
        await seed('once', { kind: 'once', everyMs: null, endsAt: T0 });
        host.finishRun.mockRejectedValueOnce(new Error('primary down'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await tickAll();
        expect(invoked).toHaveLength(1);
        expect(billed()).toBe(1);
        expect(await index.getRun('once')).toMatchObject({
            phase: 'finalizing',
        });
        expect(await index.getScore('once')).toBe(
            T0 + SCHEDULE_FINALIZE_RETRY_MS,
        );

        host.finishRun.mockRejectedValueOnce(new Error('still down'));
        setClock(T0 + SCHEDULE_FINALIZE_RETRY_MS);
        await tickAll();
        expect(invoked).toHaveLength(1);
        expect(await index.getScore('once')).toBe(
            T0 + 2 * SCHEDULE_FINALIZE_RETRY_MS,
        );

        setClock(T0 + 2 * SCHEDULE_FINALIZE_RETRY_MS);
        await tickAll();
        expect(invoked).toHaveLength(1);
        expect(billed()).toBe(1);
        expect(host.finishRun).toHaveBeenCalledTimes(3);
        expect(await index.getDef('once')).toMatchObject({ state: 'ended' });
    });

    it('the inclusive last slot fires with its offset and retries, then finishes', async () => {
        const offsetMs = 4000;
        await seed(
            'end',
            { endsAt: T0 + 2 * MIN, offsetMs },
            { owed: T0 + 2 * MIN },
        );
        const outcomes: ScheduleInvokeResult[] = [
            { outcome: 'retriable' },
            { outcome: 'unavailable' },
            { outcome: 'settled' },
        ];
        answer = async () => outcomes.shift()!;
        setClock(T0 + 2 * MIN + offsetMs - 1000);
        await tickAll();
        expect(invoked).toHaveLength(0);
        let now = T0 + 2 * MIN + offsetMs;
        for (let attempt = 1; attempt <= 3; attempt++) {
            setClock(now);
            await tickAll();
            now += deliveryBackoffMs(attempt) + 1000;
        }
        expect(invoked.map((e) => e.id)).toEqual(
            Array(3).fill(`end:${T0 + 2 * MIN}`),
        );
        expect(billed()).toBe(1);
        expect(host.finishRun).toHaveBeenCalledTimes(1);
        expect(await index.getDef('end')).toMatchObject({ state: 'ended' });
    });
});

describe('the handler outliving the invoke timeout', () => {
    it('overlaps the retry, which carries the same `event.id`', async () => {
        await seed('h');
        const running: string[] = [];
        let finishFirst!: () => void;
        const first = new Promise<void>((resolve) => (finishFirst = resolve));
        let calls = 0;
        answer = async (invocation) => {
            const id = (invocation.event as ScheduleEvent).id;
            running.push(id);
            // The worker keeps running past the timeout the backend gave up at.
            if (calls++ === 0) {
                void first.then(() => running.splice(running.indexOf(id), 1));
                return { outcome: 'retriable' };
            }
            return { outcome: 'settled' };
        };
        await tickAll();
        setClock(T0 + deliveryBackoffMs(1));
        await tickAll();
        expect(running).toEqual([`h:${T0}`, `h:${T0}`]);
        finishFirst();
        expect(billed()).toBe(1);
    });
});

describe('spread', () => {
    it('is deterministic per schedule and inside its window', () => {
        for (let i = 0; i < 200; i++) {
            const id = `sched-${i}`;
            const offset = spreadOffsetMs(id, 'recurring', 3_600_000);
            expect(offset).toBe(spreadOffsetMs(id, 'recurring', 3_600_000));
            expect(offset % 1000).toBe(0);
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset).toBeLessThan(EVENTS_SCHEDULE_SPREAD_MAX_MS);
            expect(spreadOffsetMs(id, 'recurring', MIN)).toBeLessThan(6000);
        }
    });
});

describe('capacity', () => {
    it('pops no more than the node`s in-flight cap', async () => {
        for (let i = 0; i < 10; i++) await seed(`cap-${i}`);
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        answer = async () => {
            await held;
            return { outcome: 'settled' };
        };
        const r = runner({ inFlightCap: 3 });
        await r.tick();
        expect(r.inFlight).toBe(3);
        await untilInvoked(3);
        await r.tick();
        expect(r.inFlight).toBe(3);
        expect(invoked).toHaveLength(3);
        release();
        await r.drain();
        for (let i = 0; i < 3; i++) await tickAll(r);
        expect(invoked).toHaveLength(10);
    });
});

describe('delayed sends', () => {
    const seedDeferred = (id: string) =>
        seed(id, {
            kind: 'deferred',
            everyMs: null,
            endsAt: T0,
            subId: null,
            handlerName: null,
            action: 'test.send',
        });

    it('run their action, and end where it finished the row', async () => {
        await seedDeferred('x');
        const runs: unknown[] = [];
        host.actions.register('test.send', async (run) => {
            runs.push(run);
            return { type: 'finished', version: 9 };
        });
        await tickAll();
        expect(runs).toEqual([
            expect.objectContaining({
                scheduleId: 'x',
                scheduledFor: T0,
                attempts: 0,
            }),
        ]);
        expect(host.events.invokeForSchedule).not.toHaveBeenCalled();
        expect(billed()).toBe(0);
        expect(await index.getDef('x')).toMatchObject({
            state: 'ended',
            version: 9,
        });
    });

    it('retry with a backoff that counts attempts', async () => {
        await seedDeferred('z');
        host.actions.register('test.send', async () => ({ type: 'retry' }));
        await tickAll();
        expect(await index.getRun('z')).toMatchObject({
            attempts: 1,
            pinned: T0,
        });
        expect(await index.getScore('z')).toBe(T0 + deliveryBackoffMs(1));
    });

    it('wait for an action this node doesn`t have', async () => {
        await seedDeferred('q');
        await tickAll();
        expect(await index.getScore('q')).toBe(T0 + 60_000);
        expect(await index.getDef('q')).toMatchObject({ state: 'active' });
    });
});

it('keeps partition keys of one schedule together', () => {
    const p = schedulePartition('a');
    expect(
        Object.values(index.keys(p)).every((k) => k.endsWith(`{sched:p${p}}`)),
    ).toBe(true);
});
