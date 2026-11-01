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
 * The backend's own periodic jobs on the default scheduler: what registers,
 * that each runs once across nodes sharing Redis, and that a single self-hosted
 * node (sqlite, in-process Redis) runs every one of them.
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

const keysOf = (namespace: string, name: string) => ({
    lock: `jobs:{${namespace}:${name}}:lock`,
    gate: `jobs:{${namespace}:${name}}:next`,
    run: `jobs:{${namespace}:${name}}:run`,
});

/** A node of its own in `region`, on the test server's Redis. */
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
        'runs %s once across three nodes sharing Redis',
        async (name) => {
            const namespace = `ns-${randomUUID()}`;
            const nodes = ['n1', 'n2', 'n3'].map((id) => node(namespace, id));
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

            await Promise.all(nodes.map((scheduler) => scheduler.poll()));
            await Promise.all(nodes.map((scheduler) => scheduler.poll()));

            expect(runs).toBe(1);
            const redis = server.clients.redis;
            const keys = keysOf(namespace, name);
            // A failure would have cut the gate to a 2 s backoff.
            expect(await redis.pttl(keys.gate)).toBeGreaterThan(
                job.every - MINUTE,
            );
            expect(await redis.hget(keys.run, 'failures')).toBeNull();
        },
    );

    it('runs every job on a single self-hosted node, without the old per-job gates', async () => {
        const jobs = server.services.jobs;
        const redis = server.clients.redis;

        await jobs.poll();

        // The node's own poll timer may have started some of them first.
        await vi.waitFor(
            async () => {
                for (const name of JOB_NAMES) {
                    const keys = keysOf(jobs.namespace, name);
                    expect(await redis.exists(keys.gate), name).toBe(1);
                    // Released once the run is over.
                    expect(await redis.exists(keys.lock), name).toBe(0);
                    expect(await redis.hget(keys.run, 'failures'), name).toBe(
                        null,
                    );
                }
            },
            { timeout: 10_000, interval: 100 },
        );
        await expect(
            redis.exists('sessions:purge:gate', 'kvShare:purge:gate'),
        ).resolves.toBe(0);
    });
});
