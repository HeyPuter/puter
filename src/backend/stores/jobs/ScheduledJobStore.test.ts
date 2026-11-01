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

/**
 * Against a real database, so the claim SQL and `nowMsExpr` run on whichever
 * engine the run is configured for; `PUTER_TEST_DB_ENGINE=postgres` covers the
 * postgres dialect.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

describe('ScheduledJobStore', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const store = () => server.stores.scheduledJob;
    const db = () => server.clients.db;

    const dbNow = async (): Promise<number> => {
        const [row] = await db().pread(`SELECT ${db().nowMsExpr()} AS now_ms`);
        return Number(row.now_ms);
    };

    const row = async (namespace: string, name: string) => {
        const [found] = await db().pread(
            'SELECT * FROM `scheduled_jobs` WHERE `namespace` = ? AND `name` = ?',
            [namespace, name],
        );
        return found;
    };

    const claimOf = (token: string, leaseMs = 60_000, graceMs = 0) => ({
        token,
        owner: 'test:node:1',
        leaseMs,
        graceMs,
        updatedAt: Date.now(),
    });

    // Compared with the database's own epoch seconds: an emulated database
    // can run on a clock far from this process's.
    it("reads the database's clock in epoch milliseconds", async () => {
        const [row] = await db().pread(
            `SELECT ${db().nowMsExpr()} AS now_ms, ${db().unixSecondsSql('CURRENT_TIMESTAMP')} AS now_s`,
        );
        const nowMs = Number(row.now_ms);
        expect(Number.isSafeInteger(nowMs)).toBe(true);
        expect(Math.abs(nowMs - Number(row.now_s) * 1000)).toBeLessThan(2_000);
    });

    it('registers once, due by the database clock, and never resets a cadence', async () => {
        const namespace = `ns-${randomUUID()}`;
        const before = await dbNow();
        await store().register(namespace, 'job.a', 1_000, Date.now());
        const first = await row(namespace, 'job.a');
        expect(Number(first.next_run_at)).toBeGreaterThanOrEqual(
            before + 1_000,
        );
        expect(Number(first.next_run_at)).toBeLessThan(before + 6_000);
        expect(Number(first.failures)).toBe(0);
        expect(first.lease_until).toBeNull();

        await store().register(namespace, 'job.a', 50_000, Date.now());
        expect(Number((await row(namespace, 'job.a')).next_run_at)).toBe(
            Number(first.next_run_at),
        );
    });

    it('claims a due job once, and fences every later write on the token', async () => {
        const namespace = `ns-${randomUUID()}`;
        await store().register(namespace, 'job.b', 0, Date.now());

        expect(await store().claim(namespace, 'job.b', claimOf('t1'))).toBe(
            true,
        );
        expect(await store().claim(namespace, 'job.b', claimOf('t2'))).toBe(
            false,
        );

        const claimed = await store().readClaimed(namespace, 'job.b');
        expect(claimed).toMatchObject({ state: null, failures: 0 });
        expect(Math.abs(claimed!.dbNowMs - (await dbNow()))).toBeLessThan(
            5_000,
        );

        expect(await store().renew(namespace, 'job.b', 't2', 60_000, 1)).toBe(
            false,
        );
        expect(await store().renew(namespace, 'job.b', 't1', 60_000, 1)).toBe(
            true,
        );
        expect(
            await store().saveState(namespace, 'job.b', 't2', '{"x":1}', 1),
        ).toBe(false);
        expect(
            await store().saveState(namespace, 'job.b', 't1', '{"x":2}', 1),
        ).toBe(true);

        const finish = {
            nextRunAt: 123,
            lastRunAt: 100,
            lastDurationMs: 5,
            lastError: null,
            failures: 0,
            updatedAt: 1,
        };
        expect(await store().finish(namespace, 'job.b', 't2', finish)).toBe(
            false,
        );
        expect(await store().finish(namespace, 'job.b', 't1', finish)).toBe(
            true,
        );

        const done = await row(namespace, 'job.b');
        expect(done).toMatchObject({
            state: '{"x":2}',
            lease_token: null,
            lease_owner: null,
        });
        expect(done.lease_until).toBeNull();
        expect(Number(done.next_run_at)).toBe(123);
        expect(Number(done.last_duration_ms)).toBe(5);
    });

    it('claims only past the grace and once the lease has lapsed', async () => {
        const namespace = `ns-${randomUUID()}`;
        await store().register(namespace, 'job.c', 0, Date.now());
        const now = await dbNow();
        await db().write(
            'UPDATE `scheduled_jobs` SET `next_run_at` = ? WHERE `namespace` = ?',
            [now - 60_000, namespace],
        );

        expect(
            await store().claim(
                namespace,
                'job.c',
                claimOf('t1', 60_000, 120_000),
            ),
        ).toBe(false);
        expect(await store().claim(namespace, 'job.c', claimOf('t1', 1))).toBe(
            true,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(await store().claim(namespace, 'job.c', claimOf('t2'))).toBe(
            true,
        );
        expect((await row(namespace, 'job.c')).lease_token).toBe('t2');
    });

    it('lists only the named jobs of one namespace, with the replica clock', async () => {
        const namespace = `ns-${randomUUID()}`;
        await store().register(namespace, 'job.d', 0, Date.now());
        await store().register(namespace, 'job.e', 0, Date.now());
        await store().register(`${namespace}-other`, 'job.d', 0, Date.now());

        const listed = await store().listForNamespace(namespace, ['job.d']);
        expect(listed.jobs).toEqual([
            { name: 'job.d', nextRunAt: expect.any(Number), leaseUntil: null },
        ]);
        expect(Math.abs(listed.dbNowMs! - (await dbNow()))).toBeLessThan(5_000);
        expect(await store().listForNamespace(namespace, [])).toEqual({
            jobs: [],
            dbNowMs: null,
        });
    });
});
