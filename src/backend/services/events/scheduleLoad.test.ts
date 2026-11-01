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
import type { Actor } from '../../core/actor.js';
import {
    ScheduleIndexStore,
    type ScheduleIndexChange,
} from '../../stores/events/ScheduleIndexStore.js';
import type { IConfig } from '../../types.js';
import * as metrics from './metrics.js';
import { ScheduleActionRegistry } from './scheduleActions.js';
import {
    SCHEDULE_IN_FLIGHT_PER_NODE,
    ScheduleRunner,
    type ScheduleRunnerHost,
} from './ScheduleRunner.js';

/**
 * One node under sustained schedule load, on simulated time: a fake handler
 * that takes a fixed time to answer, and the runner's own tick, lease and
 * renewal timers. A node runs at most its in-flight cap at once, so its
 * throughput is that cap over the handler's latency.
 */

const T0 = Date.parse('2026-11-02T10:00:00Z');
const HOUR = 3_600_000;
/** Spread across apps so no (holder, app) budget window is what limits. */
const APPS = 500;

let seq = 0;

interface LoadResult {
    fired: number;
    lagP95Ms: number;
    alarms: string[];
}

/**
 * `rate` schedules come due every second for `seconds`; each run's handler
 * answers after `latencyMs`. Runs for `simulateMs` of clock.
 */
const runLoad = async (options: {
    rate: number;
    seconds: number;
    latencyMs: number;
    simulateMs: number;
    lagFromMs: number;
}): Promise<LoadResult> => {
    seq++;
    const redis = new MockRedis.Cluster(['redis://localhost:7001']);
    const index = new ScheduleIndexStore(
        { jobs: { namespace: `load${seq}` } } as IConfig,
        { redis } as never,
        {} as never,
    );
    const changes: ScheduleIndexChange[] = [];
    for (let i = 0; i < options.rate * options.seconds; i++) {
        const slot = T0 + Math.floor(i / options.rate) * 1000;
        changes.push({
            id: `load-${seq}-${i}`,
            version: 2,
            state: 'active',
            def: {
                rowId: i,
                kind: 'recurring',
                startAt: slot,
                everyMs: HOUR,
                cron: null,
                tz: 'UTC',
                endsAt: null,
                createdAt: T0 - HOUR,
                subId: `sub-${i}`,
                holderUserId: 1,
                appUid: `app-${i % APPS}`,
                handlerName: 'tick',
                context: null,
                handlerDepth: 0,
                offsetMs: 0,
                action: null,
            },
            score: slot,
            owed: slot,
        });
    }
    await index.apply(changes);

    const lags: number[] = [];
    const record = vi
        .spyOn(metrics.scheduleLag, 'record')
        .mockImplementation((lag: number) => {
            if (Date.now() >= T0 + options.lagFromMs) lags.push(lag);
        });
    const alarms: string[] = [];
    let fired = 0;
    const host = {
        index,
        actions: new ScheduleActionRegistry(),
        events: {
            invokeForSchedule: async () => {
                await new Promise((resolve) =>
                    setTimeout(resolve, options.latencyMs),
                );
                fired++;
                return { outcome: 'settled' as const };
            },
            resolveScheduleActor: async () =>
                ({ user: { id: 1, suspended: false } }) as unknown as Actor,
            chargeableForSchedule: async () => true,
            meterScheduleRun: async () => {},
            suspendForFailures: async () => true,
        },
        finishRun: async (_id: string, version: number) => version + 1,
        endOrphan: async (_id: string, version: number) => version + 1,
        alarm: (id: string) => alarms.push(id),
    } as unknown as ScheduleRunnerHost;

    const runner = new ScheduleRunner(host);
    runner.start();
    for (let t = 0; t < options.simulateMs; t += 250)
        await vi.advanceTimersByTimeAsync(250);
    runner.stop();
    await vi.advanceTimersByTimeAsync(options.latencyMs * 2);
    record.mockRestore();

    const sorted = [...lags].sort((a, b) => a - b);
    return {
        fired,
        lagP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        alarms,
    };
};

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'Date',
            'setTimeout',
            'clearTimeout',
            'setInterval',
            'clearInterval',
        ],
    });
    vi.spyOn(process, 'hrtime').mockReturnValue([0, 0]);
    vi.setSystemTime(T0);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('one node under load', () => {
    it('keeps p95 lag inside the 60 s window at 1 s handlers, just under its capacity', async () => {
        const rate = SCHEDULE_IN_FLIGHT_PER_NODE - 4;
        const result = await runLoad({
            rate,
            seconds: 120,
            latencyMs: 1000,
            simulateMs: 150_000,
            lagFromMs: 0,
        });
        expect(result.fired).toBe(rate * 120);
        expect(result.lagP95Ms).toBeLessThan(60_000);
        expect(result.alarms).toEqual([]);
    }, 300_000);

    it('falls behind at 5 s handlers, and the lag alarm says so', async () => {
        const result = await runLoad({
            rate: 40,
            seconds: 480,
            latencyMs: 5000,
            simulateMs: 480_000,
            lagFromMs: 120_000,
        });
        // Throughput is the in-flight cap over the latency.
        expect(result.fired).toBeLessThanOrEqual(
            (SCHEDULE_IN_FLIGHT_PER_NODE / 5) * 480 +
                SCHEDULE_IN_FLIGHT_PER_NODE,
        );
        expect(result.lagP95Ms).toBeGreaterThan(60_000);
        expect(result.alarms).toContain('events_schedule_lag');
    }, 600_000);
});
