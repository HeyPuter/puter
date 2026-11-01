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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SCHEDULE_PARTITIONS } from '../../stores/events/ScheduleIndexStore.js';
import { RECONCILE_PASS_BUDGET_MS } from './scheduleReconcile.js';
import {
    bootScheduleHarness,
    seedSchedules,
    type ScheduleHarness,
} from './scheduleTestUtil.js';

/**
 * A region's worth of schedules through the reconcile, in bounded time: the
 * rebuild after the index is lost, and an incremental pass with 1% changed.
 * `PUTER_SCHEDULE_LOAD_ROWS` sets the row count; 100,000 is the sizing case,
 * and the default keeps a CI run short. Bounds scale with the count.
 */

const ROWS = Number(process.env.PUTER_SCHEDULE_LOAD_ROWS ?? 20_000);
const REBUILD_BOUND_MS_PER_100K = 10 * 60_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

let h: ScheduleHarness;

const report = (line: string): void => {
    process.stderr.write(`[schedule load] ${line}\n`);
};

beforeAll(async () => {
    h = await bootScheduleHarness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
}, 180_000);

afterAll(async () => {
    vi.restoreAllMocks();
    await h?.shutdown();
});

describe(`${ROWS} schedules in one region`, () => {
    it('rebuild within the bound, then an incremental pass with 1% changed', async () => {
        const server = h.env.server;
        const schedules = server.services.schedule;
        const now = Date.now();
        const apps: string[] = [];
        for (let i = 0; i < 10; i++) apps.push((await h.makeApp()).uid);
        const seeded = Date.now();
        const uids: string[] = [];
        for (let i = 0; i < apps.length; i++)
            uids.push(
                ...(await seedSchedules(server, {
                    namespace: schedules.namespace,
                    region: schedules.region,
                    holderUserId: h.userId,
                    appUid: apps[i],
                    count: ROWS / apps.length,
                    startAt: now - 30 * 24 * HOUR,
                    everyMs: HOUR,
                    createdAt: now - 31 * 24 * HOUR,
                    updatedAt: () => now - HOUR,
                })),
            );
        report(`seeded ${uids.length} rows in ${Date.now() - seeded} ms`);

        const started = performance.now();
        let passes = 0;
        for (;;) {
            passes++;
            const pass = await schedules.reconcile();
            if (pass.cycleCompleted) break;
        }
        const rebuildMs = performance.now() - started;
        let due = 0;
        for (let p = 0; p < SCHEDULE_PARTITIONS; p++)
            due += await server.clients.redis.zcard(
                server.stores.scheduleIndex.keys(p).due,
            );
        report(`rebuild: ${rebuildMs.toFixed(0)} ms over ${passes} passes`);
        expect(due).toBe(ROWS);
        expect(rebuildMs).toBeLessThanOrEqual(
            (REBUILD_BOUND_MS_PER_100K * ROWS) / 100_000,
        );

        // 1% of rows change: a suspension each, as the hook would record it.
        const changed = uids.slice(0, ROWS / 100);
        const at = Date.now();
        for (let i = 0; i < changed.length; i += 500) {
            const batch = changed.slice(i, i + 500);
            await server.clients.db.write(
                'UPDATE `event_schedules` SET `version` = `version` + 1, `updated_at` = ? ' +
                    `WHERE \`uid\` IN (${batch.map(() => '?').join(', ')})`,
                [at, ...batch],
            );
            await server.clients.db.write(
                'UPDATE `event_subscriptions` SET `suspended_at` = ?, `suspended_reason` = ? ' +
                    `WHERE \`anchor_uid\` IN (${batch.map(() => '?').join(', ')})`,
                [Math.floor(at / 1000), 'failures', ...batch],
            );
        }
        const incStarted = performance.now();
        const pass = await schedules.reconcile();
        const incrementalMs = performance.now() - incStarted;
        report(
            `incremental pass: ${pass.incrementalRows} rows in ${incrementalMs.toFixed(0)} ms ` +
                `(with ${pass.fullRows} full-diff rows)`,
        );
        expect(pass.incrementalRows).toBeGreaterThanOrEqual(changed.length);
        expect(incrementalMs).toBeLessThanOrEqual(RECONCILE_PASS_BUDGET_MS);
        for (const uid of changed.slice(0, 20))
            expect((await server.stores.scheduleIndex.getDef(uid))!.state).toBe(
                'suspended:failures',
            );
    }, 1_200_000);
});
