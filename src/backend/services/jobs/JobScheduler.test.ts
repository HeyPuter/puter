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
    beforeEach,
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
        enabled,
    }: {
        namespace?: string;
        region?: string;
        nearPrimaryRegion?: string;
        redis?: InstanceType<typeof MockRedis>;
        domain?: string;
        enabled?: boolean;
    } = {}) => {
        const config = {
            port: 0,
            extensions: [],
            domain,
            serverId: `node-${schedulers.length}`,
            jobs: { namespace, nearPrimaryRegion, enabled },
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
        // `:` would let two (namespace, name) pairs share Redis keys.
        expect(() =>
            scheduler.register('b:c', { every: 1000, scope: 'fleet', run }),
        ).toThrow(/invalid job name/);
        expect(() =>
            scheduler.register('x'.repeat(129), {
                every: 1000,
                scope: 'fleet',
                run,
            }),
        ).toThrow(/invalid job name/);
        expect(() =>
            scheduler.register('job.region', {
                every: 1000,
                scope: 'region',
                leaseMs: 2000,
                run,
            }),
        ).toThrow(/exceeds every/);
        scheduler.register('job', { every: 1000, scope: 'fleet', run });
        expect(() =>
            scheduler.register('job', { every: 1000, scope: 'fleet', run }),
        ).toThrow(/already registered/);
    });

    it('refuses to register under a namespace the table or Redis keys cannot hold', () => {
        const run = async () => {};
        for (const namespace of ['a:b', 'x'.repeat(129), 'spaced name']) {
            expect(() =>
                node({ namespace }).register('job', {
                    every: 1000,
                    scope: 'fleet',
                    run,
                }),
            ).toThrow(/invalid jobs namespace/);
        }
        expect(() =>
            node({ domain: 'localhost:4100' }).register('job', {
                every: 1000,
                scope: 'fleet',
                run,
            }),
        ).toThrow(/invalid jobs namespace/);
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

    it('arms no poll on a node with jobs turned off, though poll() still runs them', async () => {
        vi.useFakeTimers({
            toFake: [
                'setInterval',
                'setTimeout',
                'clearInterval',
                'clearTimeout',
            ],
        });
        const baseline = vi.getTimerCount();
        const namespace = freshNamespace();
        const scheduler = node({ namespace, enabled: false });
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let runs = 0;
        scheduler.onServerStart();
        scheduler.register('job.off', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                runs += 1;
            },
        });
        scheduler.register('job.off.too', {
            every: HOUR,
            scope: 'fleet',
            run: async () => undefined,
        });
        expect(vi.getTimerCount()).toBe(baseline);
        // Said once per node, not per job.
        expect(
            warned.mock.calls.filter(([line]) =>
                String(line).includes('jobs.enabled'),
            ),
        ).toHaveLength(1);
        vi.useRealTimers();

        await server.stores.scheduledJob.register(
            namespace,
            'job.off',
            0,
            Date.now(),
        );
        await setNextRunAt(namespace, 'job.off', 0);
        await scheduler.poll();
        expect(runs).toBe(1);
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

    it('polls an idle fleet job with one replica read and nothing else', async () => {
        const namespace = freshNamespace();
        const redis = new MockRedis({ port: 17107 });
        const scheduler = node({ namespace, redis });
        scheduler.register('job.idle', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {},
        });
        await scheduler.poll();
        await setNextRunAt(namespace, 'job.idle', (await dbNow()) + HOUR);

        const reads = vi.spyOn(db(), 'read');
        const preads = vi.spyOn(db(), 'pread');
        const writes = vi.spyOn(db(), 'write');
        const redisCalls = ['exists', 'set', 'eval', 'hget'].map((command) =>
            vi.spyOn(redis, command as 'exists'),
        );
        await scheduler.poll();
        expect(reads).toHaveBeenCalledTimes(1);
        expect(preads).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
        for (const call of redisCalls) expect(call).not.toHaveBeenCalled();
    });

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

    describe('on a controlled clock', () => {
        const leaseMs = 300;
        /**
         * Pending timeouts armed from JobScheduler.ts. The shared test server's
         * own loops keep running on real intervals and may arm fake timers
         * mid-test, so the global timer count says nothing about the
         * scheduler.
         */
        let armed: Set<unknown>;
        const schedulerTimers = () => armed.size;

        beforeEach(() => {
            vi.useFakeTimers({
                toFake: [
                    'setTimeout',
                    'clearTimeout',
                    'setInterval',
                    'clearInterval',
                    'performance',
                ],
            });
            armed = new Set();
            const fakeSetTimeout = globalThis.setTimeout;
            const fakeClearTimeout = globalThis.clearTimeout;
            const fromScheduler = () => {
                const limit = Error.stackTraceLimit;
                Error.stackTraceLimit = 30;
                const stack = new Error().stack ?? '';
                Error.stackTraceLimit = limit;
                return /services[\\/]jobs[\\/]JobScheduler\.ts/.test(stack);
            };
            vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
                fn: (...args: unknown[]) => void,
                ms?: number,
                ...rest: unknown[]
            ) => {
                if (!fromScheduler()) return fakeSetTimeout(fn, ms, ...rest);
                const handle = fakeSetTimeout(
                    (...args: unknown[]) => {
                        armed.delete(handle);
                        fn(...args);
                    },
                    ms,
                    ...rest,
                );
                armed.add(handle);
                return handle;
            }) as never);
            vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
                handle: Parameters<typeof clearTimeout>[0],
            ) => {
                armed.delete(handle);
                fakeClearTimeout(handle);
            }) as never);
        });

        /** Batches of `batchMs`, each started only while the signal is live. */
        const timedJob = (batches: number, batchMs: number) => {
            const seen = {
                starts: [] as number[],
                abortedAt: null as number | null,
                signal: null as AbortSignal | null,
                saveError: null as unknown,
            };
            const run = async ({ signal, saveState }: JobRunContext) => {
                seen.signal = signal;
                signal.addEventListener('abort', () => {
                    seen.abortedAt = performance.now();
                });
                for (let i = 0; i < batches; i++) {
                    if (signal.aborted) break;
                    seen.starts.push(performance.now());
                    await sleep(batchMs);
                }
                try {
                    await saveState({ late: true });
                } catch (err) {
                    seen.saveError = err;
                }
            };
            return { seen, run };
        };

        const start = async (name: string, batchMs = 70) => {
            const namespace = freshNamespace();
            const scheduler = node({ namespace });
            const job = timedJob(10, batchMs);
            await registerDue([scheduler], name, {
                every: HOUR,
                scope: 'fleet',
                leaseMs,
                run: job.run,
            });
            return { namespace, scheduler, job };
        };

        // The claim sets `lease_owner` too, and the finish clears the lease;
        // a renewal only extends it.
        const isClaim = (sql: string) => sql.includes('`lease_owner` = ?');
        const isRenewal = (sql: string) =>
            sql.startsWith('UPDATE `scheduled_jobs` SET `lease_until` = ') &&
            !isClaim(sql) &&
            !sql.includes('`lease_until` = NULL');

        /** Let the run play out, then check nothing it armed is left behind. */
        const settle = async (running: Promise<void>) => {
            await vi.advanceTimersByTimeAsync(2_000);
            await running;
            expect(schedulerTimers()).toBe(0);
        };

        it('starts the first batch well inside the lease, and aborts at the renewal after a theft', async () => {
            const { namespace, scheduler, job } = await start('job.stolen');
            const claimedAt = performance.now();
            const running = scheduler.poll();
            await vi.advanceTimersByTimeAsync(50);
            expect(job.seen.starts[0] - claimedAt).toBeLessThan(leaseMs / 2);

            await db().write(
                'UPDATE `scheduled_jobs` SET `lease_token` = ? WHERE `namespace` = ?',
                ['thief', namespace],
            );
            await settle(running);

            // The first renewal goes out at leaseMs / 3 and finds the lease gone.
            expect(job.seen.abortedAt! - claimedAt).toBe(leaseMs / 3);
            expect(job.seen.starts.every((t) => t < job.seen.abortedAt!)).toBe(
                true,
            );
            expect(job.seen.saveError).toBeInstanceOf(JobLeaseLostError);
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
            const claimedAt = performance.now();
            await settle(scheduler.poll());

            expect(job.seen.abortedAt! - claimedAt).toBe(leaseMs / 3);
            expect(job.seen.signal?.reason).toBeInstanceOf(JobLeaseLostError);
            expect(job.seen.starts.every((t) => t < job.seen.abortedAt!)).toBe(
                true,
            );
            // Interrupted, not failed: due again at once, nothing counted.
            const row = await jobRow(namespace, 'job.renewThrows');
            expect(Number(row.next_run_at)).toBe(0);
            expect(Number(row.failures)).toBe(0);
            expect(row.lease_token).toBeNull();
            expect(row.last_error).toMatch(/^interrupted/);
        });

        it('aborts at leaseMs / 2 when a renewal hangs, and the late answer re-arms nothing', async () => {
            const { scheduler, job } = await start('job.renewSlow');
            const write = db().write.bind(db());
            let answerRenewal!: () => void;
            vi.spyOn(db(), 'write').mockImplementation(async (sql, params) => {
                if (isRenewal(sql)) {
                    await new Promise<void>((resolve) => {
                        answerRenewal = resolve;
                    });
                }
                return write(sql, params);
            });
            const claimedAt = performance.now();
            const running = scheduler.poll();
            await vi.advanceTimersByTimeAsync(leaseMs);

            expect(job.seen.abortedAt! - claimedAt).toBe(leaseMs / 2);
            expect((job.seen.signal?.reason as Error).message).toMatch(
                /overdue/,
            );
            expect(job.seen.starts.every((t) => t < job.seen.abortedAt!)).toBe(
                true,
            );
            answerRenewal();
            await settle(running);
        });

        it('aborts when the primary database is lost mid-run', async () => {
            const { namespace, scheduler, job } =
                await start('job.primaryLost');
            const running = scheduler.poll();
            await vi.advanceTimersByTimeAsync(50);
            const lost = () => Promise.reject(new Error('primary unreachable'));
            vi.spyOn(db(), 'write').mockImplementation(lost);
            vi.spyOn(db(), 'pread').mockImplementation(lost);
            await settle(running);
            vi.restoreAllMocks();

            expect(job.seen.abortedAt).not.toBeNull();
            expect(job.seen.starts.every((t) => t < job.seen.abortedAt!)).toBe(
                true,
            );
            // Nothing recorded; the lease lapses on its own.
            expect(
                (await jobRow(namespace, 'job.primaryLost')).lease_token,
            ).not.toBeNull();
        });

        it('never starts a run once the claim itself used up half the lease', async () => {
            const { namespace, scheduler, job } = await start('job.slowClaim');
            const write = db().write.bind(db());
            vi.spyOn(db(), 'write').mockImplementation(async (sql, params) => {
                const result = await write(sql, params);
                if (isClaim(sql)) await sleep(leaseMs / 2 + 10);
                return result;
            });
            await settle(scheduler.poll());

            expect(job.seen.signal).toBeNull();
            const row = await jobRow(namespace, 'job.slowClaim');
            expect(row.lease_token).toBeNull();
            expect(Number(row.next_run_at)).toBe(0);
            expect(Number(row.failures)).toBe(0);
            expect(row.last_error).toMatch(/^interrupted/);
        });

        it('renews before starting when the claim and read left little lease', async () => {
            const { scheduler, job } = await start('job.slowRead', 70);
            const pread = db().pread.bind(db());
            const write = db().write.bind(db());
            const renewalsSent: number[] = [];
            vi.spyOn(db(), 'write').mockImplementation(async (sql, params) => {
                if (isRenewal(sql)) renewalsSent.push(performance.now());
                return write(sql, params);
            });
            vi.spyOn(db(), 'pread').mockImplementation(async (sql, params) => {
                const rows = await pread(sql, params);
                if (sql.includes('SELECT `state`')) {
                    await sleep(leaseMs * 0.4);
                }
                return rows;
            });
            await settle(scheduler.poll());

            const first = job.seen.starts[0];
            const renewedBefore = renewalsSent.filter((t) => t <= first);
            expect(renewedBefore.length).toBeGreaterThan(0);
            expect(first - renewedBefore.at(-1)!).toBeLessThan(leaseMs / 2);
            expect(job.seen.starts).toHaveLength(10);
            expect(job.seen.signal?.aborted).toBe(false);
        });

        it('clears a run’s timers at shutdown even while the run hangs', async () => {
            const namespace = freshNamespace();
            const scheduler = node({ namespace });
            let release!: () => void;
            await registerDue([scheduler], 'job.hang', {
                every: HOUR,
                scope: 'fleet',
                leaseMs,
                run: () =>
                    new Promise<void>((resolve) => {
                        release = resolve;
                    }),
            });
            const running = scheduler.poll();
            await vi.advanceTimersByTimeAsync(10);
            expect(schedulerTimers()).toBeGreaterThan(0);

            scheduler.onServerPrepareShutdown();
            expect(schedulerTimers()).toBe(0);
            release();
            await settle(running);
        });

        it('never starts a region run once taking the lock used up half the lease', async () => {
            const namespace = freshNamespace();
            const redis = new MockRedis({ port: 17104 });
            const scheduler = node({ namespace, redis });
            const run = vi.fn(async () => {});
            scheduler.register('job.slowLock', {
                every: HOUR,
                scope: 'region',
                leaseMs,
                run,
            });
            const set = redis.set.bind(redis) as (
                ...args: unknown[]
            ) => Promise<unknown>;
            const slowLock = vi.spyOn(redis, 'set').mockImplementation((async (
                ...args: unknown[]
            ) => {
                const result = await set(...args);
                if (String(args[0]).endsWith(':lock')) {
                    await sleep(leaseMs / 2 + 10);
                }
                return result;
            }) as never);
            await settle(scheduler.poll());

            expect(run).not.toHaveBeenCalled();
            // The gate went back, so the next poll runs it.
            expect(
                await redis.exists(`jobs:{${namespace}:job.slowLock}:next`),
            ).toBe(0);
            slowLock.mockRestore();
            await settle(scheduler.poll());
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('aborts a region run before its next batch once the lock lapses, and leaves it due at once', async () => {
            const namespace = freshNamespace();
            const redis = new MockRedis({ port: 17106 });
            const scheduler = node({ namespace, redis });
            const job = timedJob(10, 70);
            scheduler.register('job.lapse', {
                every: HOUR,
                scope: 'region',
                leaseMs,
                run: job.run,
            });
            const lockedAt = performance.now();
            await settle(scheduler.poll());

            expect(job.seen.abortedAt! - lockedAt).toBe(leaseMs);
            expect((job.seen.signal?.reason as Error).message).toMatch(
                /lapsed/,
            );
            expect(job.seen.starts.length).toBeLessThan(10);
            expect(job.seen.starts.every((t) => t < job.seen.abortedAt!)).toBe(
                true,
            );
            // The gate is still this run's, so its last save went through;
            // interrupted, the gate goes back and the job is due at once.
            expect(job.seen.saveError).toBeNull();
            const keys = {
                gate: `jobs:{${namespace}:job.lapse}:next`,
                run: `jobs:{${namespace}:job.lapse}:run`,
            };
            expect(await redis.exists(keys.gate)).toBe(0);
            expect(await redis.hget(keys.run, 'state')).toBe('{"late":true}');
            expect(await redis.hget(keys.run, 'failures')).toBeNull();
        });
    });

    it('records the next run on the primary clock, whatever the node clock does mid-run', async () => {
        const namespace = freshNamespace();
        const scheduler = node({ namespace });
        const realNow = Date.now;
        await registerDue([scheduler], 'job.clockJump', {
            every: HOUR,
            scope: 'fleet',
            run: async () => {
                // The node's clock steps back an hour while the job runs.
                vi.spyOn(Date, 'now').mockImplementation(
                    () => realNow() - HOUR,
                );
                throw new Error('failed after the step');
            },
        });
        await scheduler.poll();
        vi.restoreAllMocks();

        const row = await jobRow(namespace, 'job.clockJump');
        // Backoff 2 s from the primary's finish, not an hour in the past.
        expect(Number(row.next_run_at)).toBeGreaterThan(await dbNow());
        expect(Number(row.last_duration_ms)).toBeGreaterThanOrEqual(0);
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
            await redisA.pttl(`jobs:{${namespace}:job.region}:next`),
        ).toBeGreaterThan(HOUR - 60_000);
        // The region lock was released after the run.
        expect(await redisA.exists(`jobs:{${namespace}:job.region}:lock`)).toBe(
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
        const gate = `jobs:{${namespace}:job.regionFail}:next`;

        await scheduler.poll();
        expect(
            await redis.hget(
                `jobs:{${namespace}:job.regionFail}:run`,
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
                `jobs:{${namespace}:job.regionFail}:run`,
                'failures',
            ),
        ).toBeNull();
        expect(await redis.pttl(gate)).toBeGreaterThan(HOUR - 60_000);
    });

    it('skips region jobs quietly while Redis is unreachable', async () => {
        const namespace = freshNamespace();
        const redis = new MockRedis({ port: 17108 });
        const scheduler = node({ namespace, redis });
        const run = vi.fn(async () => {});
        scheduler.register('job.noRedis', {
            every: HOUR,
            scope: 'region',
            run,
        });
        vi.spyOn(redis, 'exists').mockRejectedValue(
            new Error('connection refused'),
        );
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        await scheduler.poll();
        expect(run).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
    });

    it('fences a region run that outlived its gate off its successor’s keys', async () => {
        const namespace = freshNamespace();
        const redis = new MockRedis({ port: 17105 });
        const [slow, next] = [
            node({ namespace, redis }),
            node({ namespace, redis }),
        ];
        const keys = {
            gate: `jobs:{${namespace}:job.fenced}:next`,
            run: `jobs:{${namespace}:job.fenced}:run`,
        };
        let release!: () => void;
        let slowStarted = false;
        let slowSaveError: unknown = null;
        // Ignores its signal and outlives both its 200 ms lock and 400 ms gate.
        slow.register('job.fenced', {
            every: 400,
            scope: 'region',
            leaseMs: 200,
            run: async ({ saveState }) => {
                slowStarted = true;
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                try {
                    await saveState({ by: 'slow' });
                } catch (err) {
                    slowSaveError = err;
                }
                throw new Error('slow run failed');
            },
        });
        next.register('job.fenced', {
            every: 400,
            scope: 'region',
            leaseMs: 200,
            run: async ({ saveState }) => {
                await saveState({ by: 'next' });
            },
        });

        const slowRun = slow.poll();
        await vi.waitFor(() => expect(slowStarted).toBe(true));
        await sleep(450);
        await next.poll();
        const successorGate = await redis.get(keys.gate);
        expect(successorGate).not.toBeNull();

        release();
        await slowRun;
        expect(slowSaveError).toBeInstanceOf(JobLeaseLostError);
        // Neither the slow run's state, its failure count, nor its cleanup
        // touched what the successor holds.
        expect(await redis.get(keys.gate)).toBe(successorGate);
        expect(await redis.pttl(keys.gate)).toBeGreaterThan(0);
        expect(await redis.hget(keys.run, 'state')).toBe('{"by":"next"}');
        expect(await redis.hget(keys.run, 'failures')).toBeNull();
    });
});
