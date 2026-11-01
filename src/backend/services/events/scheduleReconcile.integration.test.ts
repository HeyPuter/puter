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

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { EVENTS_SCHEDULE_TOMBSTONE_TTL_MS } from '../../controllers/events/limits.js';
import {
    SCHEDULE_PARTITIONS,
    schedulePartition,
} from '../../stores/events/ScheduleIndexStore.js';
import {
    FULL_DIFF_ABSENT_MIN_MS,
    RECONCILE_OVERLAP_MS,
    ScheduleReconciler,
    type ScheduleReconcileOptions,
    type ScheduleReconcileReport,
} from './scheduleReconcile.js';
import {
    bootScheduleHarness,
    freezeRedisClock,
    seedSchedules,
    type ScheduleHarness,
} from './scheduleTestUtil.js';

/**
 * The reconcile against the schedule table: an incremental pass that trusts
 * only the `updated_at` it read, a chunked full diff that needs two sightings
 * before dropping anything, and a rebuild that fires each schedule's latest
 * eligible slot once after the index is lost.
 */

// Each test boots or drives a whole backend; a loaded runner needs room.
vi.setConfig({ testTimeout: 120_000 });

const BOOT_TIMEOUT_MS = 120_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-02T10:00:00Z');

let h: ScheduleHarness;
let appUid: string;

const server = () => h.env.server;
const schedules = () => server().services.schedule;
const store = () => server().stores.schedule;
const index = () => server().stores.scheduleIndex;
const durable = () => server().stores.durableSubscription;
const db = () => server().clients.db;

const reconciler = (options: ScheduleReconcileOptions = {}) =>
    new ScheduleReconciler(
        {
            index: index(),
            store: store(),
            namespace: schedules().namespace,
            region: schedules().region,
            endRows: async (rows, reason) => {
                for (const row of rows)
                    if (row.kind !== 'deferred')
                        await durable().removeScheduleSubscription(row.uid);
                return store().finish(
                    rows.map((row) => row.id),
                    reason,
                );
            },
            alarm: vi.fn(),
        },
        options,
    );

/** Passes until a full-diff cycle completes. */
const untilCycle = async (
    r: ScheduleReconciler = reconciler(),
): Promise<ScheduleReconcileReport[]> => {
    const reports: ScheduleReconcileReport[] = [];
    for (let i = 0; i < 100; i++) {
        const report = await r.pass();
        reports.push(report);
        if (report.cycleCompleted) return reports;
    }
    throw new Error('no full-diff cycle completed');
};

/** The Redis keys of this deployment's schedules, as after a loss. */
const loseIndex = async (): Promise<void> => {
    const keys = await server().clients.redis.keys('sched:*');
    if (keys.length > 0) await server().clients.redis.del(...keys);
};

const seed = (over: Partial<Parameters<typeof seedSchedules>[1]> = {}) =>
    seedSchedules(server(), {
        namespace: schedules().namespace,
        region: schedules().region,
        holderUserId: h.userId,
        appUid,
        count: 1,
        startAt: T0 - 10 * HOUR,
        everyMs: HOUR,
        createdAt: T0 - 10 * HOUR,
        ...over,
    });

const rowOf = async (uid: string) =>
    (await store().get(schedules().namespace, uid))!;

const dueCount = async (): Promise<number> => {
    let total = 0;
    for (let p = 0; p < SCHEDULE_PARTITIONS; p++)
        total += await server().clients.redis.zcard(index().keys(p).due);
    return total;
};

beforeAll(async () => {
    h = await bootScheduleHarness();
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await h?.shutdown();
});

beforeEach(async () => {
    await db().write('DELETE FROM `event_schedules`', []);
    await db().write('DELETE FROM `event_subscriptions`', []);
    await loseIndex();
    freezeRedisClock();
    h.setClock(T0);
    h.sent.length = 0;
    appUid = (await h.makeApp()).uid;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    await h.runner.drain();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('rebuild', () => {
    it('fires each schedule`s latest eligible slot once after the index is lost', async () => {
        h.setClock(T0 - 30 * DAY);
        const app = { uid: appUid };
        const hourly = await h.createSchedule(app, {
            startAt: T0 - 29 * DAY,
            everyMs: HOUR,
        });
        const daily = await h.createSchedule(app, {
            startAt: T0 - 29 * DAY - 10 * HOUR,
            everyMs: DAY,
        });
        const monthly = await h.createSchedule(app, {
            startAt: T0 - 29 * DAY,
            everyMs: null,
            cron: '0 0 1 * *',
            minGapMs: 28 * DAY,
            ratePerHour: 1,
        });
        const ended = await h.createSchedule(app, {
            startAt: T0 - 29 * DAY,
            everyMs: HOUR,
            endsAt: T0 - 2 * HOUR,
        });

        await loseIndex();
        h.setClock(T0 + 20 * MIN + 30_000);
        const reports = await untilCycle();
        expect(reports[0].rebuilding).toBe(true);
        expect(await index().isBuilt()).toBe(true);

        await h.fire();
        const ids = new Map(
            h.sent.map((sent) => [sent.event.scheduleId, sent.event]),
        );
        expect(ids.get(hourly.uid)).toMatchObject({
            scheduledFor: T0,
            missed: 0,
        });
        expect(ids.get(daily.uid)).toMatchObject({
            scheduledFor: T0 - 10 * HOUR,
        });
        expect(ids.get(monthly.uid)).toMatchObject({
            scheduledFor: Date.parse('2026-11-01T00:00:00Z'),
        });
        expect(ids.get(ended.uid)).toMatchObject({
            scheduledFor: T0 - 2 * HOUR,
        });
        expect(h.sent).toHaveLength(4);

        // Once each: nothing re-fires until a next slot comes.
        await h.fire();
        expect(h.sent).toHaveLength(4);
        expect(await rowOf(ended.uid)).toMatchObject({
            state: 'done',
            endReason: 'ended',
        });
    });

    it('seeds the incremental cursor from the cycle`s start', async () => {
        const [uid] = await seed();
        // One page per pass, so the change below lands mid-cycle.
        let now = 0;
        const r = reconciler({ page: 1, clock: () => (now += 30_000) });
        await r.pass();
        expect(await index().isBuilt()).toBe(false);
        h.setClock(T0 + 5000);
        await db().write(
            'UPDATE `event_schedules` SET `state` = ?, `deleted_at` = ?, `end_reason` = ?, ' +
                '`version` = `version` + 1, `updated_at` = ? WHERE `uid` = ?',
            ['done', T0 + 5000, 'removed', T0 + 5000, uid],
        );
        await untilCycle(r);
        expect(await index().getSyncCursor()).toBe(T0 - RECONCILE_OVERLAP_MS);
        expect((await index().getDef(uid))!.state).toBe('active');
        await r.pass();
        expect((await index().getDef(uid))!.state).toBe('ended');
    });

    it('pages past 5000 rows', async () => {
        await seed({ count: 5200, deferred: true, startAt: T0 + HOUR });
        await untilCycle();
        expect(await dueCount()).toBe(5200);
    });
});

describe('incremental pass', () => {
    const built = async () => {
        await untilCycle();
        expect(await index().isBuilt()).toBe(true);
    };

    it('stores the largest updated_at it read, and applies a row lagging inside the overlap', async () => {
        await seed({ updatedAt: () => T0 - 10 * MIN });
        await built();
        await index().setSyncCursor(T0 - MIN);

        const [lagging] = await seed({ updatedAt: () => T0 - 90_000 });
        const report = await reconciler().pass();
        expect(report.incrementalRows).toBe(1);
        expect((await index().getDef(lagging))!.state).toBe('active');
        expect(await index().getSyncCursor()).toBe(T0 - MIN);

        const [newer] = await seed({ updatedAt: () => T0 + 7000 });
        await reconciler().pass();
        expect(await index().getSyncCursor()).toBe(T0 + 7000);
        expect((await index().getDef(newer))!.state).toBe('active');
    });

    it('leaves a commit later than the overlap to the full diff, within one cycle', async () => {
        await built();
        await index().setSyncCursor(T0);
        const [late] = await seed({ updatedAt: () => T0 - 10 * MIN });
        const report = await reconciler().pass();
        expect(report.incrementalRows).toBe(0);
        if (!(await index().getDef(late))) await untilCycle();
        expect((await index().getDef(late))!.state).toBe('active');
    });

    it('applies two changes in the same millisecond, by version', async () => {
        const [a, b] = await seed({ count: 2 });
        await built();
        await db().write(
            'UPDATE `event_schedules` SET `state` = ?, `deleted_at` = ?, `end_reason` = ?, ' +
                '`version` = `version` + 1, `updated_at` = ? WHERE `uid` IN (?, ?)',
            ['done', T0, 'removed', T0, a, b],
        );
        await reconciler().pass();
        expect((await index().getDef(a))!.state).toBe('ended');
        expect((await index().getDef(b))!.state).toBe('ended');
    });

    it('never applies an older version over a newer one', async () => {
        const [uid] = await seed();
        await built();
        const live = (await index().getDef(uid))!;
        await index().apply([
            {
                id: uid,
                version: 5,
                state: 'suspended:failures',
                def: live.def,
                score: 0,
                owed: T0,
            },
        ]);
        await untilCycle();
        expect(await index().getDef(uid)).toMatchObject({
            version: 5,
            state: 'suspended:failures',
        });
    });
});

describe('the pass budget', () => {
    it('stops starting work when it runs out, and the next pass resumes there', async () => {
        await seed({ count: 35, deferred: true, startAt: T0 + HOUR });
        let now = 0;
        const clock = () => (now += 15_000);
        const r = reconciler({ page: 10, clock });
        const first = await r.pass();
        expect(first.fullRows).toBe(20);
        const cursor = (await index().getFullCursor())!;
        expect(cursor.phase).toBe('rows');
        expect(await dueCount()).toBe(20);

        await r.pass();
        expect(await dueCount()).toBe(35);
    });
});

describe('full diff', () => {
    it('drops a member the table lacks only on a later sweep, ten minutes on', async () => {
        const [kept] = await seed();
        await untilCycle();
        const ghost = (await index().getDef(kept))!;
        await index().apply([
            {
                id: 'ghost-schedule',
                version: 2,
                state: 'active',
                def: ghost.def,
                score: T0,
                owed: T0,
            },
        ]);

        await untilCycle();
        h.setClock(T0 + 5 * MIN);
        await untilCycle();
        expect(await index().getDef('ghost-schedule')).not.toBeNull();
        h.setClock(T0 + FULL_DIFF_ABSENT_MIN_MS);
        await untilCycle();
        expect(await index().getDef('ghost-schedule')).toBeNull();
        expect(await index().getScore('ghost-schedule')).toBeNull();
        expect((await index().getDef(kept))!.state).toBe('active');
    });

    it('ends an orphan ten minutes old and deletes its stray subscription row', async () => {
        const [old, recent] = await seed({ count: 2 });
        await db().write(
            'UPDATE `event_schedules` SET `sub_id` = NULL, `updated_at` = ? WHERE `uid` = ?',
            [T0 - 11 * MIN, old],
        );
        await db().write(
            'UPDATE `event_schedules` SET `sub_id` = NULL, `updated_at` = ? WHERE `uid` = ?',
            [T0 - 5 * MIN, recent],
        );
        await untilCycle();
        expect(await rowOf(old)).toMatchObject({
            state: 'done',
            endReason: 'orphaned',
        });
        expect((await index().getDef(old))!.state).toBe('ended');
        const [stray] = await db().read(
            'SELECT COUNT(*) AS `n` FROM `event_subscriptions` WHERE `token` = ?',
            [`schedule:${old}`],
        );
        expect(Number(stray.n)).toBe(0);
        expect((await rowOf(recent)).deletedAt).toBeNull();
        expect(await index().getDef(recent)).toBeNull();
    });

    it('soft-deletes a live row the index tombstoned at its version, and lets a newer one replace the tombstone', async () => {
        const [lost, newer] = await seed({ count: 2 });
        await untilCycle();
        await index().apply([
            {
                id: lost,
                version: 2,
                state: 'ended',
                def: null,
                score: 0,
                owed: null,
            },
            {
                id: newer,
                version: 2,
                state: 'ended',
                def: null,
                score: 0,
                owed: null,
            },
        ]);
        await db().write(
            'UPDATE `event_schedules` SET `version` = 3, `updated_at` = ? WHERE `uid` = ?',
            [T0, newer],
        );
        await untilCycle();
        expect(await rowOf(lost)).toMatchObject({
            state: 'done',
            endReason: 'removed',
        });
        expect((await index().getDef(lost))!.state).toBe('ended');
        expect(await index().getDef(newer)).toMatchObject({
            version: 3,
            state: 'active',
        });
    });

    it('expires tombstones past their retention', async () => {
        const [uid] = await seed();
        await untilCycle();
        await index().apply([
            {
                id: uid,
                version: 3,
                state: 'ended',
                def: null,
                score: 0,
                owed: null,
            },
        ]);
        await db().write('DELETE FROM `event_schedules` WHERE `uid` = ?', [
            uid,
        ]);
        h.setClock(T0 + EVENTS_SCHEDULE_TOMBSTONE_TTL_MS + 1000);
        await untilCycle();
        expect(await index().getDef(uid)).toBeNull();
    });

    it('keeps delayed sends that are active, sending or delivered', async () => {
        const uids = await seed({
            count: 3,
            deferred: true,
            startAt: T0 + HOUR,
        });
        await db().write(
            'UPDATE `event_schedules` SET `state` = ? WHERE `uid` = ?',
            ['sending', uids[1]],
        );
        await db().write(
            'UPDATE `event_schedules` SET `state` = ? WHERE `uid` = ?',
            ['delivered', uids[2]],
        );
        await untilCycle();
        await untilCycle();
        for (const uid of uids)
            expect((await index().getDef(uid))!.state).toBe('active');
    });

    it('ends a schedule whose subscription was revoked for good', async () => {
        const [uid] = await seed();
        await db().write(
            'UPDATE `event_subscriptions` SET `suspended_at` = ?, `suspended_reason` = ? WHERE `anchor_uid` = ?',
            [1, 'permission_revoked', uid],
        );
        await untilCycle();
        expect(await rowOf(uid)).toMatchObject({
            state: 'done',
            endReason: 'permission_revoked',
        });
        expect((await index().getDef(uid))!.state).toBe('ended');
    });

    it('parks a suspended schedule and finishes one with nothing left to fire', async () => {
        const [parked] = await seed();
        await db().write(
            'UPDATE `event_subscriptions` SET `suspended_at` = ?, `suspended_reason` = ? WHERE `anchor_uid` = ?',
            [1, 'failures', parked],
        );
        const [spent] = await seed({ createdAt: T0 - 2 * HOUR });
        await db().write(
            'UPDATE `event_schedules` SET `ends_at` = ? WHERE `uid` = ?',
            [T0 - 3 * HOUR, spent],
        );
        await untilCycle();
        expect((await index().getDef(parked))!.state).toBe(
            'suspended:failures',
        );
        expect(await index().getScore(parked)).toBeNull();
        expect(await rowOf(spent)).toMatchObject({
            state: 'done',
            endReason: 'ended',
        });
    });
});

it('raises the drift alarm when a pass finds many entries the hooks missed', async () => {
    const uids = await seed({ count: 150 });
    const alarm = vi.fn();
    const r = new ScheduleReconciler({
        index: index(),
        store: store(),
        namespace: schedules().namespace,
        region: schedules().region,
        endRows: async () => [],
        alarm,
    });
    await untilCycle(r);
    expect(alarm).not.toHaveBeenCalled();
    // The index loses them while the table keeps them: the next cycle puts
    // them back, which the hooks should have kept from being needed.
    for (const uid of uids)
        await server().clients.redis.hdel(
            index().keys(schedulePartition(uid)).def,
            uid,
        );
    await untilCycle(r);
    expect(alarm).toHaveBeenCalledWith(
        'events_schedule_reconcile_drift',
        expect.any(String),
        expect.objectContaining({ applied: 150 }),
    );
});

it('runs one pass per region at a time', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const changedSince = store().changedSince.bind(store());
    await untilCycle();
    vi.spyOn(store(), 'changedSince').mockImplementation(async (...args) => {
        await held;
        return changedSince(...args);
    });
    const first = reconciler().pass();
    await vi.waitFor(() => expect(store().changedSince).toHaveBeenCalled());
    expect((await reconciler().pass()).skipped).toBe(true);
    release();
    expect((await first).skipped).toBe(false);
    expect(schedulePartition('x')).toBeLessThan(SCHEDULE_PARTITIONS);
});
