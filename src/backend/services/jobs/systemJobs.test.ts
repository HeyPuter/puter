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
 * The backend's own periodic jobs as the scheduler runs them: what registers,
 * that each runs once across nodes sharing a database, and that a single
 * self-hosted node (sqlite, in-process Redis) runs every one of them.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    JobScheduler,
    type JobDefinition,
    type JobRunContext,
} from './JobScheduler.js';

type SchedulerArgs = ConstructorParameters<typeof JobScheduler>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const EXPECTED_JOBS = {
    'auth.sessions.purge': {
        every: 7 * 24 * HOUR,
        scope: 'fleet',
        nearPrimary: true,
        leaseMs: 30 * MINUTE,
    },
    'kvShare.handles.purgeRevoked': {
        every: 24 * HOUR,
        scope: 'fleet',
        nearPrimary: true,
        leaseMs: 15 * MINUTE,
    },
    'notifications.retention': {
        every: HOUR,
        scope: 'fleet',
        nearPrimary: true,
        leaseMs: 15 * MINUTE,
    },
    'metering.globalRateCheck': {
        every: 25 * MINUTE,
        scope: 'fleet',
        nearPrimary: false,
        leaseMs: 5 * MINUTE,
    },
    'events.subscriptions.expirySweep': {
        every: HOUR,
        scope: 'fleet',
        nearPrimary: true,
        leaseMs: 15 * MINUTE,
    },
    'events.subscriptions.creditSweep': {
        every: 15 * MINUTE,
        scope: 'fleet',
        nearPrimary: false,
        leaseMs: 10 * MINUTE,
    },
};
const JOB_NAMES = Object.keys(EXPECTED_JOBS);

/** A timer armed while the server booted, and the frame that armed it. */
interface ArmedTimer {
    kind: 'interval' | 'timeout';
    ms: number | undefined;
    caller: string;
}

let server: PuterServer;
const registered = new Map<string, JobDefinition>();
const armed: ArmedTimer[] = [];

/** The first stack frame outside this file and node_modules. */
const callerOf = (stack: string | undefined): string =>
    (stack ?? '')
        .split('\n')
        .slice(1)
        .find(
            (line) =>
                !line.includes('systemJobs.test') &&
                !line.includes('node_modules'),
        ) ?? '';

beforeAll(async () => {
    const register = vi.spyOn(JobScheduler.prototype, 'register');
    const realInterval = globalThis.setInterval;
    const realTimeout = globalThis.setTimeout;
    const intervals = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
        ...args: Parameters<typeof setInterval>
    ) => {
        armed.push({
            kind: 'interval',
            ms: args[1],
            caller: callerOf(new Error().stack),
        });
        return realInterval(...args);
    }) as never);
    const timeouts = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        ...args: Parameters<typeof setTimeout>
    ) => {
        armed.push({
            kind: 'timeout',
            ms: args[1],
            caller: callerOf(new Error().stack),
        });
        return realTimeout(...args);
    }) as never);
    try {
        server = await setupTestServer({
            events: { enabled: true },
            notificationRetentionDays: 14,
            maxGlobalUsagePerMinute: 1e15,
            // A self-hosted node: nothing turns its jobs off.
            jobs: { enabled: true },
        } as IConfig);
    } finally {
        intervals.mockRestore();
        timeouts.mockRestore();
    }
    for (const [name, definition] of register.mock.calls)
        registered.set(name, definition);
    register.mockRestore();
});

afterAll(async () => {
    await server?.shutdown();
});

const db = () => server.clients.db;

const jobRow = async (namespace: string, name: string) => {
    const [row] = await db().pread(
        'SELECT * FROM `scheduled_jobs` WHERE `namespace` = ? AND `name` = ?',
        [namespace, name],
    );
    return row;
};

/** Insert `name`'s row (if missing) and make it due now. */
const makeDue = async (namespace: string, name: string) => {
    await server.stores.scheduledJob.register(namespace, name, 0, Date.now());
    await db().write(
        'UPDATE `scheduled_jobs` SET `next_run_at` = 0 WHERE `namespace` = ? AND `name` = ?',
        [namespace, name],
    );
};

/** A node of its own in its own region, sharing the test database. */
const node = (namespace: string, region: string): JobScheduler =>
    new JobScheduler(
        {
            domain: 'puter.test',
            serverId: `node-${region}`,
            jobs: { namespace },
        } as IConfig,
        server.clients as SchedulerArgs[1],
        server.stores as SchedulerArgs[2],
        {
            broadcast: { regionId: region },
        } as unknown as SchedulerArgs[3],
    );

describe('system jobs', () => {
    it('registers every moved job with its real cadence, scope and lease', () => {
        expect(
            Object.fromEntries(
                [...registered].map(([name, job]) => [
                    name,
                    {
                        every: job.every,
                        scope: job.scope,
                        nearPrimary: job.nearPrimary ?? false,
                        leaseMs: job.leaseMs,
                    },
                ]),
            ),
        ).toEqual(EXPECTED_JOBS);
    });

    it('leaves no per-node timer behind for a moved job', () => {
        const armedFrom = (file: string) =>
            armed
                .filter(({ caller }) => caller.includes(file))
                .map(({ kind, ms }) => ({ kind, ms }));

        expect(armedFrom('services/auth/AuthService')).toEqual([]);
        expect(armedFrom('services/notification/NotificationService')).toEqual(
            [],
        );
        // Node-local: the usage buffer flush.
        expect(armedFrom('services/metering/MeteringService')).toEqual([
            { kind: 'interval', ms: 10_000 },
        ]);
        // Node-local: the share-job runner (DB claims per job), and its kick.
        expect(armedFrom('services/kvShare/KvShareService')).toEqual([
            { kind: 'timeout', ms: expect.any(Number) },
            { kind: 'interval', ms: MINUTE },
        ]);
        // Node-local: the region's pending-delivery sweep.
        expect(armedFrom('services/events/EventsService')).toEqual([
            { kind: 'interval', ms: 10_000 },
        ]);
    });

    it.each(JOB_NAMES)(
        'runs %s once across three nodes sharing the database',
        async (name) => {
            const namespace = `ns-${randomUUID()}`;
            const nodes = ['r1', 'r2', 'r3'].map((region) =>
                node(namespace, region),
            );
            const job = registered.get(name)!;
            let runs = 0;
            for (const scheduler of nodes)
                scheduler.register(name, {
                    ...job,
                    run: async (ctx: JobRunContext) => {
                        runs += 1;
                        await job.run(ctx);
                    },
                });
            await makeDue(namespace, name);

            await Promise.all(nodes.map((scheduler) => scheduler.poll()));

            expect(runs).toBe(1);
            const row = await jobRow(namespace, name);
            expect(row.last_error).toBeNull();
            expect(Number(row.failures)).toBe(0);
            expect(Number(row.next_run_at)).toBeGreaterThan(Date.now());
        },
    );

    it('runs every job on a single self-hosted node, with no regional gate', async () => {
        const jobs = server.services.jobs;
        for (const name of JOB_NAMES) await makeDue(jobs.namespace, name);

        await jobs.poll();

        // The node's own poll timer may have started some of them first.
        await vi.waitFor(
            async () => {
                for (const name of JOB_NAMES) {
                    const row = await jobRow(jobs.namespace, name);
                    expect(row.last_run_at, name).not.toBeNull();
                    expect(row.last_error, name).toBeNull();
                    expect(Number(row.next_run_at), name).toBeGreaterThan(
                        Date.now(),
                    );
                }
            },
            { timeout: 10_000, interval: 100 },
        );
        await expect(
            server.clients.redis.exists(
                'sessions:purge:gate',
                'kvShare:purge:gate',
            ),
        ).resolves.toBe(0);
    });
});
