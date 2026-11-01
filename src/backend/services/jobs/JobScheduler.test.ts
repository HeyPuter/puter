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
import MockRedis from 'ioredis-mock';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    JOB_NEAR_PRIMARY_GRACE_MS,
    JobLeaseLostError,
    JobScheduler,
    type JobRunContext,
} from './JobScheduler.js';

type SchedulerArgs = ConstructorParameters<typeof JobScheduler>;

const HOUR = 60 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('JobScheduler', () => {
    let server: PuterServer;
    const schedulers: JobScheduler[] = [];

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        for (const scheduler of schedulers.splice(0)) {
            scheduler.onServerPrepareShutdown();
        }
    });

    const db = () => server.clients.db;

    /** A node of its own: its own config and region, sharing the test database. */
    const node = ({
        namespace,
        region = 'r1',
        nearPrimaryRegion,
        redis,
        domain = 'puter.test',
    }: {
        namespace?: string;
        region?: string;
        nearPrimaryRegion?: string;
        redis?: InstanceType<typeof MockRedis>;
        domain?: string;
    } = {}) => {
        const config = {
            port: 0,
            extensions: [],
            domain,
            serverId: `node-${schedulers.length}`,
            jobs: { namespace, nearPrimaryRegion },
        } as IConfig;
        const clients = (
            redis ? { ...server.clients, redis } : server.clients
        ) as SchedulerArgs[1];
        const services = {
            broadcast: { regionId: region },
        } as unknown as SchedulerArgs[3];
        const scheduler = new JobScheduler(
            config,
            clients,
            server.stores as SchedulerArgs[2],
            services,
        );
        schedulers.push(scheduler);
        return scheduler;
    };

    const freshNamespace = () => `ns-${randomUUID()}`;

    const dbNow = async (): Promise<number> => {
        const [row] = await db().pread(`SELECT ${db().nowMsExpr()} AS now_ms`);
        return Number(row.now_ms);
    };

    const jobRow = async (namespace: string, name: string) => {
        const [row] = await db().pread(
            'SELECT * FROM `scheduled_jobs` WHERE `namespace` = ? AND `name` = ?',
            [namespace, name],
        );
        return row;
    };

    const setNextRunAt = async (
        namespace: string,
        name: string,
        at: number,
    ) => {
        await db().write(
            'UPDATE `scheduled_jobs` SET `next_run_at` = ? WHERE `namespace` = ? AND `name` = ?',
            [at, namespace, name],
        );
    };

    /** Register `name` on every node and make its row due. */
    const registerDue = async (
        nodes: JobScheduler[],
        name: string,
        definition: Parameters<JobScheduler['register']>[1],
    ) => {
        for (const scheduler of nodes) scheduler.register(name, definition);
        // The first poll inserts the row; it is due within the first-run jitter.
        await server.stores.scheduledJob.register(
            nodes[0].namespace,
            name,
            0,
            Date.now(),
        );
        await setNextRunAt(nodes[0].namespace, name, 0);
    };

    /**
     * A job that runs `batches` batches `batchMs` apart, checking its signal
     * before each.
     */
    const batchedJob = (batches: number, batchMs: number) => {
        const seen = { done: 0, signal: null as AbortSignal | null };
        const run = async ({ signal }: JobRunContext) => {
            seen.signal = signal;
            for (let i = 0; i < batches; i++) {
                if (signal.aborted) return;
                await sleep(batchMs);
                seen.done += 1;
            }
        };
        return { seen, run };
    };

    // -- Registration -------------------------------------------------

    it('refuses a bad or duplicate registration', () => {
        const scheduler = node({ namespace: freshNamespace() });
        const run = async () => {};
        expect(() =>
            scheduler.register('bad name', {
                every: 1000,
                scope: 'fleet',
                run,
            }),
        ).toThrow(/invalid job name/);
        expect(() =>
            scheduler.register('job', { every: 0, scope: 'fleet', run }),
        ).toThrow(/every/);
        expect(() =>
            scheduler.register('job', {
                every: 1000,
                scope: 'fleet',
                leaseMs: 1.5,
                run,
            }),
        ).toThrow(/leaseMs/);
        scheduler.register('job', { every: 1000, scope: 'fleet', run });
        expect(() =>
            scheduler.register('job', { every: 1000, scope: 'fleet', run }),
        ).toThrow(/already registered/);
    });

    it('does nothing at all while no job is registered', async () => {
        vi.useFakeTimers({
            toFake: [
                'setInterval',
                'setTimeout',
                'clearInterval',
                'clearTimeout',
            ],
        });
        // Timers the test runtime itself already holds.
        const baseline = vi.getTimerCount();
        const reads = vi.spyOn(db(), 'read');
        const preads = vi.spyOn(db(), 'pread');
        const writes = vi.spyOn(db(), 'write');
        const scheduler = node({ namespace: freshNamespace() });

        scheduler.onServerStart();
        expect(vi.getTimerCount()).toBe(baseline);
        await scheduler.poll();
        expect(reads).not.toHaveBeenCalled();
        expect(preads).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();

        // A job registered after start arms the poll; shutdown disarms it.
        scheduler.register('late', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {},
        });
        expect(vi.getTimerCount()).toBeGreaterThan(baseline);
        scheduler.onServerPrepareShutdown();
        expect(vi.getTimerCount()).toBe(baseline);
    });

    it('registers idempotently across instances, never resetting the cadence', async () => {
        const namespace = freshNamespace();
        const [a, b] = [node({ namespace }), node({ namespace })];
        let runs = 0;
        const definition = {
            every: HOUR,
            scope: 'fleet' as const,
            run: async () => {
                runs += 1;
            },
        };
        a.register('job.idem', definition);
        await a.poll();
        const inserted = await jobRow(namespace, 'job.idem');

        b.register('job.idem', definition);
        await b.poll();
        const [{ count }] = await db().pread(
            'SELECT COUNT(*) AS count FROM `scheduled_jobs` WHERE `namespace` = ?',
            [namespace],
        );
        expect(Number(count)).toBe(1);
        expect(Number((await jobRow(namespace, 'job.idem')).next_run_at)).toBe(
            Number(inserted.next_run_at),
        );
        expect(runs).toBeLessThanOrEqual(1);
    });

    // -- Fleet scope --------------------------------------------------

    it('runs a due job exactly once across 10 racing nodes, 20 rounds in a row', async () => {
        const namespace = freshNamespace();
        const nodes = Array.from({ length: 10 }, () => node({ namespace }));
        let runs = 0;
        await registerDue(nodes, 'job.race', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                runs += 1;
            },
        });

        for (let round = 1; round <= 20; round++) {
            await setNextRunAt(namespace, 'job.race', 0);
            await Promise.all(nodes.map((scheduler) => scheduler.poll()));
            expect(runs).toBe(round);
        }
    });

    it('never double-claims across nodes whose clocks are 2 minutes apart', async () => {
        const namespace = freshNamespace();
        const [behind, ahead] = [node({ namespace }), node({ namespace })];
        let runs = 0;
        let release!: () => void;
        await registerDue([behind, ahead], 'job.skew', {
            every: HOUR,
            scope: 'fleet',
            leaseMs: 30_000,
            run: async () => {
                runs += 1;
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            },
        });

        const realNow = Date.now;
        const skewed = vi.spyOn(Date, 'now');
        skewed.mockImplementation(() => realNow() - 2 * 60_000);
        const first = behind.poll();
        await vi.waitFor(() => expect(runs).toBe(1));

        // By the fast node's clock the 30 s lease ran out long ago.
        skewed.mockImplementation(() => realNow() + 2 * 60_000);
        await ahead.poll();
        expect(runs).toBe(1);

        skewed.mockRestore();
        release();
        await first;
        expect(runs).toBe(1);
    });

    it('lets another node claim once a dead node’s lease lapses', async () => {
        const namespace = freshNamespace();
        const scheduler = node({ namespace });
        let runs = 0;
        await registerDue([scheduler], 'job.lapse', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                runs += 1;
            },
        });
        // A node claims and dies without renewing or finishing.
        expect(
            await server.stores.scheduledJob.claim(namespace, 'job.lapse', {
                token: 'dead-node',
                owner: 'dead',
                leaseMs: 300,
                graceMs: 0,
                updatedAt: Date.now(),
            }),
        ).toBe(true);

        await scheduler.poll();
        expect(runs).toBe(0);
        await sleep(350);
        await scheduler.poll();
        expect(runs).toBe(1);
    });

    it('renews the lease so a run outlives leaseMs without another node claiming', async () => {
        const namespace = freshNamespace();
        const [owner, other] = [node({ namespace }), node({ namespace })];
        const job = batchedJob(10, 100);
        let otherRuns = 0;
        owner.register('job.renew', {
            every: HOUR,
            scope: 'fleet',
            leaseMs: 300,
            run: job.run,
        });
        other.register('job.renew', {
            every: HOUR,
            scope: 'fleet',
            leaseMs: 300,
            run: async () => {
                otherRuns += 1;
            },
        });
        await server.stores.scheduledJob.register(
            namespace,
            'job.renew',
            0,
            Date.now(),
        );
        await setNextRunAt(namespace, 'job.renew', 0);

        const running = owner.poll();
        for (let i = 0; i < 4; i++) {
            await sleep(200);
            await other.poll();
        }
        await running;

        expect(job.seen.done).toBe(10);
        expect(job.seen.signal?.aborted).toBe(false);
        expect(otherRuns).toBe(0);
        const row = await jobRow(namespace, 'job.renew');
        expect(row.lease_token).toBeNull();
        expect(Number(row.failures)).toBe(0);
    });

    describe('fails closed when renewal does', () => {
        const leaseMs = 300;

        const start = async (name: string) => {
            const namespace = freshNamespace();
            const scheduler = node({ namespace });
            const job = batchedJob(10, 100);
            let saveError: unknown = null;
            await registerDue([scheduler], name, {
                every: HOUR,
                scope: 'fleet',
                leaseMs,
                run: async (ctx) => {
                    await job.run(ctx);
                    try {
                        await ctx.saveState({ late: true });
                    } catch (err) {
                        saveError = err;
                    }
                },
            });
            return { namespace, scheduler, job, saveError: () => saveError };
        };

        // The claim sets `lease_owner` too; a renewal only extends the lease.
        const isRenewal = (sql: string) =>
            sql.startsWith('UPDATE `scheduled_jobs` SET `lease_until`') &&
            !sql.includes('`lease_owner`');

        it('aborts before the next batch when another run took the lease', async () => {
            const { namespace, scheduler, job, saveError } =
                await start('job.stolen');
            const running = scheduler.poll();
            await vi.waitFor(() => expect(job.seen.done).toBeGreaterThan(0));
            await db().write(
                'UPDATE `scheduled_jobs` SET `lease_token` = ? WHERE `namespace` = ?',
                ['thief', namespace],
            );
            await running;

            expect(job.seen.signal?.aborted).toBe(true);
            expect(job.seen.done).toBeLessThan(10);
            expect(saveError()).toBeInstanceOf(JobLeaseLostError);
            // The fenced finish and save wrote nothing over the new owner.
            const row = await jobRow(namespace, 'job.stolen');
            expect(row.lease_token).toBe('thief');
            expect(row.state).toBeNull();
            expect(row.last_run_at).toBeNull();
        });

        it('aborts when a renewal throws', async () => {
            const { namespace, scheduler, job } =
                await start('job.renewThrows');
            const write = db().write.bind(db());
            vi.spyOn(db(), 'write').mockImplementation(async (sql, params) => {
                if (isRenewal(sql)) throw new Error('connection reset');
                return write(sql, params);
            });
            await scheduler.poll();

            expect(job.seen.signal?.aborted).toBe(true);
            expect(job.seen.signal?.reason).toBeInstanceOf(JobLeaseLostError);
            expect(job.seen.done).toBeLessThan(10);
            // Interrupted, not failed: due again at once, nothing counted.
            const row = await jobRow(namespace, 'job.renewThrows');
            expect(Number(row.next_run_at)).toBe(0);
            expect(Number(row.failures)).toBe(0);
            expect(row.lease_token).toBeNull();
            expect(row.last_error).toMatch(/^interrupted/);
        });

        it('aborts when a renewal is slower than leaseMs / 2', async () => {
            const { scheduler, job } = await start('job.renewSlow');
            const write = db().write.bind(db());
            vi.spyOn(db(), 'write').mockImplementation(async (sql, params) => {
                if (isRenewal(sql)) await sleep(leaseMs);
                return write(sql, params);
            });
            await scheduler.poll();

            expect(job.seen.signal?.aborted).toBe(true);
            expect((job.seen.signal?.reason as Error).message).toMatch(
                /overdue/,
            );
            expect(job.seen.done).toBeLessThan(10);
        });

        it('aborts when the primary database is lost mid-run', async () => {
            const { namespace, scheduler, job } =
                await start('job.primaryLost');
            const running = scheduler.poll();
            await vi.waitFor(() => expect(job.seen.done).toBeGreaterThan(0));
            const lost = () => Promise.reject(new Error('primary unreachable'));
            vi.spyOn(db(), 'write').mockImplementation(lost);
            vi.spyOn(db(), 'pread').mockImplementation(lost);
            await running;
            vi.restoreAllMocks();

            expect(job.seen.signal?.aborted).toBe(true);
            expect(job.seen.done).toBeLessThan(10);
            // Nothing recorded; the lease lapses on its own.
            expect(
                (await jobRow(namespace, 'job.primaryLost')).lease_token,
            ).not.toBeNull();
        });
    });

    it('hands state saved by one run to the next run on another node', async () => {
        const namespace = freshNamespace();
        const [a, b] = [node({ namespace }), node({ namespace })];
        const seen: unknown[] = [];
        const definition = {
            every: HOUR,
            scope: 'fleet' as const,
            run: async ({ state, saveState }: JobRunContext) => {
                seen.push(state);
                await saveState({
                    cursor: ((state as { cursor?: number })?.cursor ?? 0) + 7,
                });
            },
        };
        await registerDue([a, b], 'job.state', definition);

        await a.poll();
        await setNextRunAt(namespace, 'job.state', 0);
        await b.poll();
        expect(seen).toEqual([null, { cursor: 7 }]);
        expect(
            JSON.parse((await jobRow(namespace, 'job.state')).state),
        ).toEqual({
            cursor: 14,
        });
    });

    it('refuses state over 64 KB', async () => {
        const namespace = freshNamespace();
        const scheduler = node({ namespace });
        let refused: unknown = null;
        await registerDue([scheduler], 'job.bigState', {
            every: HOUR,
            scope: 'fleet',
            run: async ({ saveState }) => {
                try {
                    await saveState({ blob: 'x'.repeat(70_000) });
                } catch (err) {
                    refused = err;
                }
            },
        });
        await scheduler.poll();
        expect((refused as Error).message).toMatch(/over 65536 bytes/);
        expect((await jobRow(namespace, 'job.bigState')).state).toBeNull();
    });

    it('runs a job 5 intervals overdue once, then returns to its cadence', async () => {
        const namespace = freshNamespace();
        const scheduler = node({ namespace });
        const alarms = vi.spyOn(server.clients.alarm, 'create');
        let runs = 0;
        await registerDue([scheduler], 'job.overdue', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                runs += 1;
            },
        });
        const prev = (await dbNow()) - 5 * HOUR - 60_000;
        await setNextRunAt(namespace, 'job.overdue', prev);

        await scheduler.poll();
        await scheduler.poll();
        expect(runs).toBe(1);

        const next = Number(
            (await jobRow(namespace, 'job.overdue')).next_run_at,
        );
        expect(next).toBe(prev + 6 * HOUR);
        expect(next).toBeGreaterThan(await dbNow());
        expect(alarms).toHaveBeenCalledWith(
            `scheduled_job_overdue:${namespace}:job.overdue`,
            expect.any(String),
            expect.objectContaining({ name: 'job.overdue' }),
            'warning',
            { dedup: true },
        );
    });

    it('backs off a failing job and alarms at 3 failures in a row', async () => {
        const namespace = freshNamespace();
        const scheduler = node({ namespace });
        const alarms = vi.spyOn(server.clients.alarm, 'create');
        let fail = true;
        await registerDue([scheduler], 'job.failing', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                if (fail) throw new Error('upstream said no');
            },
        });
        const failingAlarm = `scheduled_job_failing:${namespace}:job.failing`;
        const failingCalls = () =>
            alarms.mock.calls.filter(([id]) => id === failingAlarm);

        for (let failures = 1; failures <= 3; failures++) {
            await setNextRunAt(namespace, 'job.failing', 0);
            const before = await dbNow();
            await scheduler.poll();
            const row = await jobRow(namespace, 'job.failing');
            expect(Number(row.failures)).toBe(failures);
            expect(row.last_error).toBe('upstream said no');
            // deliveryBackoffMs: 2 s, 4 s, 8 s.
            const backoff = 2_000 * 2 ** (failures - 1);
            expect(Number(row.next_run_at)).toBeGreaterThanOrEqual(
                before + backoff,
            );
            expect(Number(row.next_run_at)).toBeLessThan(
                before + backoff + 2_000,
            );
            expect(failingCalls()).toHaveLength(failures < 3 ? 0 : 1);
        }
        expect(failingCalls()[0].slice(3)).toEqual([
            'warning',
            { dedup: true },
        ]);

        fail = false;
        await setNextRunAt(namespace, 'job.failing', 0);
        await scheduler.poll();
        const row = await jobRow(namespace, 'job.failing');
        expect(Number(row.failures)).toBe(0);
        expect(row.last_error).toBeNull();
    });

    it('releases an interrupted run on shutdown without counting a failure', async () => {
        const namespace = freshNamespace();
        const scheduler = node({ namespace });
        const job = batchedJob(50, 50);
        await registerDue([scheduler], 'job.shutdown', {
            every: HOUR,
            scope: 'fleet',
            run: job.run,
        });
        const running = scheduler.poll();
        await vi.waitFor(() => expect(job.seen.done).toBeGreaterThan(0));
        scheduler.onServerPrepareShutdown();
        await running;

        expect(job.seen.done).toBeLessThan(50);
        const row = await jobRow(namespace, 'job.shutdown');
        expect(row.lease_token).toBeNull();
        expect(Number(row.next_run_at)).toBe(0);
        expect(Number(row.failures)).toBe(0);
        expect(row.last_error).toMatch(/^interrupted: server shutting down/);
    });

    it('holds a nearPrimary job for the grace period outside the near region', async () => {
        const namespace = freshNamespace();
        const near = node({ namespace, region: 'r1', nearPrimaryRegion: 'r1' });
        const far = node({ namespace, region: 'r2', nearPrimaryRegion: 'r1' });
        const runs: Record<string, number> = {};
        const count = (key: string) => async () => {
            runs[key] = (runs[key] ?? 0) + 1;
        };
        far.register('job.near', {
            every: HOUR,
            scope: 'fleet',
            nearPrimary: true,
            run: count('far'),
        });
        near.register('job.near', {
            every: HOUR,
            scope: 'fleet',
            nearPrimary: true,
            run: count('near'),
        });
        far.register('job.anywhere', {
            every: HOUR,
            scope: 'fleet',
            run: count('anywhere'),
        });

        await far.poll();
        const now = await dbNow();
        await setNextRunAt(namespace, 'job.near', now - 60_000);
        await setNextRunAt(namespace, 'job.anywhere', now - 60_000);
        await far.poll();
        expect(runs).toEqual({ anywhere: 1 });

        await setNextRunAt(
            namespace,
            'job.near',
            now - JOB_NEAR_PRIMARY_GRACE_MS - 60_000,
        );
        await far.poll();
        expect(runs).toEqual({ anywhere: 1, far: 1 });

        await setNextRunAt(namespace, 'job.near', (await dbNow()) - 60_000);
        await near.poll();
        expect(runs).toEqual({ anywhere: 1, far: 1, near: 1 });
    });

    it('keeps namespaces apart: the same job name runs once in each', async () => {
        const [nsA, nsB] = [freshNamespace(), freshNamespace()];
        const a = node({ namespace: nsA });
        const b = node({ namespace: nsB });
        const runs: string[] = [];
        await registerDue([a], 'job.shared', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                runs.push('a');
            },
        });
        await registerDue([b], 'job.shared', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                runs.push('b');
            },
        });
        await Promise.all([a.poll(), b.poll(), a.poll(), b.poll()]);
        expect(runs.sort()).toEqual(['a', 'b']);
    });

    it('falls back to the domain as its namespace', () => {
        expect(node({ domain: 'example.test' }).namespace).toBe('example.test');
        expect(
            node({ namespace: 'explicit', domain: 'example.test' }).namespace,
        ).toBe('explicit');
    });

    it('raises a critical alarm and runs no fleet job when the table is missing', async () => {
        const isolated = await setupTestServer();
        try {
            await isolated.clients.db.write('DROP TABLE `scheduled_jobs`');
            const alarms = vi.spyOn(isolated.clients.alarm, 'create');
            const scheduler = new JobScheduler(
                { port: 0, extensions: [], domain: 'puter.test' } as IConfig,
                isolated.clients as SchedulerArgs[1],
                isolated.stores as SchedulerArgs[2],
                {
                    broadcast: { regionId: 'r1' },
                } as unknown as SchedulerArgs[3],
            );
            schedulers.push(scheduler);
            const run = vi.fn(async () => {});
            scheduler.register('job.noTable', {
                every: HOUR,
                scope: 'fleet',
                run,
            });

            await scheduler.poll();
            expect(run).not.toHaveBeenCalled();
            expect(alarms).toHaveBeenCalledWith(
                'scheduled_jobs_unavailable',
                expect.any(String),
                expect.any(Object),
                'critical',
                { dedup: true },
            );
        } finally {
            await isolated.shutdown();
        }
    });

    // -- Region scope -------------------------------------------------

    it('runs a region job once per region', async () => {
        const namespace = freshNamespace();
        const redisA = new MockRedis({ port: 17101 });
        const redisB = new MockRedis({ port: 17102 });
        const nodes = [
            node({ namespace, region: 'a', redis: redisA }),
            node({ namespace, region: 'a', redis: redisA }),
            node({ namespace, region: 'b', redis: redisB }),
            node({ namespace, region: 'b', redis: redisB }),
        ];
        const runs: string[] = [];
        nodes.forEach((scheduler, i) =>
            scheduler.register('job.region', {
                every: HOUR,
                scope: 'region',
                leaseMs: 5_000,
                run: async () => {
                    runs.push(i < 2 ? 'a' : 'b');
                    await sleep(20);
                },
            }),
        );

        await Promise.all(nodes.map((scheduler) => scheduler.poll()));
        await Promise.all(nodes.map((scheduler) => scheduler.poll()));
        expect(runs.sort()).toEqual(['a', 'b']);
        expect(
            await redisA.pttl(`jobs:next:${namespace}:job.region`),
        ).toBeGreaterThan(HOUR - 60_000);
        // The region lock was released after the run.
        expect(await redisA.exists(`jobs:region:${namespace}:job.region`)).toBe(
            0,
        );
    });

    it('backs off a failing region job and keeps its state in Redis', async () => {
        const namespace = freshNamespace();
        const redis = new MockRedis({ port: 17103 });
        const scheduler = node({ namespace, redis });
        const seen: unknown[] = [];
        let fail = true;
        scheduler.register('job.regionFail', {
            every: HOUR,
            scope: 'region',
            leaseMs: 5_000,
            run: async ({ state, saveState }) => {
                seen.push(state);
                await saveState({ page: seen.length });
                if (fail) throw new Error('nope');
            },
        });
        const gate = `jobs:next:${namespace}:job.regionFail`;

        await scheduler.poll();
        expect(
            await redis.hget(
                `jobs:run:${namespace}:job.regionFail`,
                'failures',
            ),
        ).toBe('1');
        expect(await redis.pttl(gate)).toBeLessThanOrEqual(2_000);

        fail = false;
        await redis.del(gate);
        await scheduler.poll();
        expect(seen).toEqual([null, { page: 1 }]);
        expect(
            await redis.hget(
                `jobs:run:${namespace}:job.regionFail`,
                'failures',
            ),
        ).toBeNull();
        expect(await redis.pttl(gate)).toBeGreaterThan(HOUR - 60_000);
    });
});
