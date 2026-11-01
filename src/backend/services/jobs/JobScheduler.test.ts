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

    /**
     * A node of its own: its own config and region, on the test server's Redis
     * unless given one.
     */
    const node = ({
        namespace,
        region = 'r1',
        redis,
        domain = 'puter.test',
        enabled,
    }: {
        namespace?: string;
        region?: string;
        redis?: InstanceType<typeof MockRedis>;
        domain?: string;
        enabled?: boolean;
    } = {}) => {
        const config = {
            port: 0,
            extensions: [],
            domain,
            serverId: `node-${schedulers.length}`,
            jobs: { namespace, enabled },
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

    const keysOf = (namespace: string, name: string) => ({
        lock: `jobs:{${namespace}:${name}}:lock`,
        gate: `jobs:{${namespace}:${name}}:next`,
        run: `jobs:{${namespace}:${name}}:run`,
    });

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

    it('falls back to the default namespace, once and loudly, when the configured one cannot be held', () => {
        const run = async () => {};
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const namespace of ['a:b', 'x'.repeat(129), 'spaced name']) {
            const scheduler = node({ namespace });
            scheduler.register('job.a', { every: 1000, scope: 'fleet', run });
            expect(scheduler.namespace).toBe('default');
        }
        logged.mockClear();

        // A self-host whose domain carries a port still boots.
        const scheduler = node({ domain: 'localhost:4100' });
        scheduler.register('job.a', { every: 1000, scope: 'fleet', run });
        scheduler.register('job.b', { every: 1000, scope: 'fleet', run });
        expect(scheduler.namespace).toBe('default');
        expect(logged).toHaveBeenCalledTimes(1);
        expect(String(logged.mock.calls[0][0])).toMatch(
            /localhost:4100.*jobs\.namespace/,
        );
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
        const scheduler = node({ namespace: freshNamespace(), enabled: false });
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
            scope: 'region',
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

        await scheduler.poll();
        expect(runs).toBe(1);
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

        /** Let the run play out, then check nothing it armed is left behind. */
        const settle = async (running: Promise<void>) => {
            await vi.advanceTimersByTimeAsync(2_000);
            await running;
            expect(schedulerTimers()).toBe(0);
        };

        it('clears a run’s timers at shutdown even while the run hangs', async () => {
            const scheduler = node({ namespace: freshNamespace() });
            let release!: () => void;
            scheduler.register('job.hang', {
                every: HOUR,
                scope: 'region',
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

    it('refuses state over 64 KB', async () => {
        const namespace = freshNamespace();
        const redis = new MockRedis({ port: 17107 });
        const scheduler = node({ namespace, redis });
        let refused: unknown = null;
        scheduler.register('job.bigState', {
            every: HOUR,
            scope: 'region',
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
        expect(
            await redis.hget(keysOf(namespace, 'job.bigState').run, 'state'),
        ).toBeNull();
    });

    it('releases an interrupted run on shutdown without counting a failure', async () => {
        const namespace = freshNamespace();
        const redis = new MockRedis({ port: 17109 });
        const scheduler = node({ namespace, redis });
        const job = batchedJob(50, 50);
        scheduler.register('job.shutdown', {
            every: HOUR,
            scope: 'region',
            run: job.run,
        });
        const running = scheduler.poll();
        await vi.waitFor(() => expect(job.seen.done).toBeGreaterThan(0));
        scheduler.onServerPrepareShutdown();
        await running;

        expect(job.seen.done).toBeLessThan(50);
        expect((job.seen.signal?.reason as Error).message).toBe(
            'server shutting down',
        );
        const keys = keysOf(namespace, 'job.shutdown');
        // Due again at once, with no failure counted.
        expect(await redis.exists(keys.gate)).toBe(0);
        expect(await redis.hget(keys.run, 'failures')).toBeNull();
    });

    it('keeps namespaces apart: the same job name runs once in each', async () => {
        const redis = new MockRedis({ port: 17110 });
        const [nsA, nsB] = [freshNamespace(), freshNamespace()];
        const nodes = [
            node({ namespace: nsA, redis }),
            node({ namespace: nsA, redis }),
            node({ namespace: nsB, redis }),
            node({ namespace: nsB, redis }),
        ];
        const runs: string[] = [];
        nodes.forEach((scheduler, i) =>
            scheduler.register('job.shared', {
                every: HOUR,
                scope: 'region',
                run: async () => {
                    runs.push(i < 2 ? 'a' : 'b');
                    await sleep(20);
                },
            }),
        );
        await Promise.all(nodes.map((scheduler) => scheduler.poll()));
        await Promise.all(nodes.map((scheduler) => scheduler.poll()));
        expect(runs.sort()).toEqual(['a', 'b']);
    });

    it('falls back to the domain as its namespace', () => {
        expect(node({ domain: 'example.test' }).namespace).toBe('example.test');
        expect(
            node({ namespace: 'explicit', domain: 'example.test' }).namespace,
        ).toBe('explicit');
    });

    it('boots a server whose domain carries a port, registering its jobs under the default namespace', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const portDomain = await setupTestServer({
            domain: 'localhost:4101',
        } as IConfig);
        try {
            expect(portDomain.services.jobs.namespace).toBe('default');
            const namespaceErrors = logged.mock.calls.filter(([message]) =>
                String(message).startsWith('[jobs] namespace'),
            );
            expect(namespaceErrors).toHaveLength(1);
        } finally {
            await portDomain.shutdown();
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
    it('runs a fleet job once per region, its lease capped at its cadence and nearPrimary ignored', async () => {
        const namespace = freshNamespace();
        const redisA = new MockRedis({ port: 17111 });
        const redisB = new MockRedis({ port: 17112 });
        const nodes = [
            node({ namespace, region: 'a', redis: redisA }),
            node({ namespace, region: 'a', redis: redisA }),
            node({ namespace, region: 'b', redis: redisB }),
            node({ namespace, region: 'b', redis: redisB }),
        ];
        const keys = keysOf(namespace, 'job.fleet');
        const runs: string[] = [];
        const lockTtls: number[] = [];
        const reads = vi.spyOn(db(), 'read');
        const preads = vi.spyOn(db(), 'pread');
        const writes = vi.spyOn(db(), 'write');
        nodes.forEach((scheduler, i) => {
            const redis = i < 2 ? redisA : redisB;
            scheduler.register('job.fleet', {
                every: 2_000,
                scope: 'fleet',
                nearPrimary: true,
                // Longer than `every`: refused for a region job, capped here.
                leaseMs: HOUR,
                run: async () => {
                    runs.push(i < 2 ? 'a' : 'b');
                    lockTtls.push(await redis.pttl(keys.lock));
                    await sleep(20);
                },
            });
        });

        await Promise.all(nodes.map((scheduler) => scheduler.poll()));
        await Promise.all(nodes.map((scheduler) => scheduler.poll()));
        expect(runs.sort()).toEqual(['a', 'b']);
        for (const ttl of lockTtls) {
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(2_000);
        }
        expect(await redisA.pttl(keys.gate)).toBeGreaterThan(1_000);
        expect(await redisB.pttl(keys.gate)).toBeGreaterThan(1_000);
        expect(reads).not.toHaveBeenCalled();
        expect(preads).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
    });
});
