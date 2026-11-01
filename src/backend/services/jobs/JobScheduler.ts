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
import { withRedisLock } from '../../util/redisLock.js';
import { resolveJobsNamespace } from '../../util/jobsNamespace.js';
import { deliveryBackoffMs } from '../../util/retryBackoff.js';
import { PuterService } from '../types';
import {
    JobLeaseLostError,
    asError,
    lostLease,
    parseState,
    runOutcome,
    serializeState,
    type RegisteredJob,
    type RunLease,
} from './jobRun.js';

export { JobLeaseLostError } from './jobRun.js';

/** How often each node looks for due jobs. */
const JOB_POLL_MS = 30_000;
/** Each poll waits up to this long first, so nodes don't all claim at once. */
const JOB_POLL_JITTER_MS = 5_000;
const JOB_DEFAULT_LEASE_MS = 15 * 60_000;
/** Consecutive failures that raise `scheduled_job_failing`. */
const JOB_FAILING_ALARM_AT = 3;
const JOB_SHUTDOWN_WAIT_MS = 10_000;
/**
 * Job names: ASCII, at most 128, and without `:`, so a (namespace, name) pair
 * maps to exactly one set of Redis keys (namespaces follow the same rule).
 */
const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// Region writes apply only while the gate still holds this run's token.
const REGION_FENCED_WRITE = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
local op = ARGV[2]
if op == 'hset' then return redis.call('hset', KEYS[2], ARGV[3], ARGV[4]) end
if op == 'hdel' then return redis.call('hdel', KEYS[2], ARGV[3]) end
if op == 'hincrby' then return redis.call('hincrby', KEYS[2], ARGV[3], 1) end
if op == 'pexpire' then return redis.call('pexpire', KEYS[1], ARGV[3]) end
if op == 'del' then return redis.call('del', KEYS[1]) end
return -1
`;

/**
 * `region` runs once per cadence per region. `fleet` means once across every
 * region where `services.jobs` supports it; this default runs it per region.
 */
export type JobScope = 'fleet' | 'region';

export interface JobRunContext {
    /** Aborts once the run may have lost the job. Check it before each batch. */
    signal: AbortSignal;
    /** What an earlier run saved, or null. */
    state: unknown;
    /**
     * Persist JSON-serializable `state` for later runs. Throws once the run
     * lost the job.
     */
    saveState: (state: unknown) => Promise<void>;
}

export interface JobDefinition {
    /** Cadence in ms. */
    every: number;
    scope: JobScope;
    /**
     * Prefer the region nearest the primary database, for a `fleet` job. The
     * default scheduler ignores it.
     */
    nearPrimary?: boolean;
    /**
     * How long a run holds the job, in total on the region path (at most
     * `every`). Default 15 min, capped at `every` for `region`; a `fleet` job
     * run per region is capped at `every` too.
     */
    leaseMs?: number;
    run: (ctx: JobRunContext) => Promise<void>;
}

/** The `afterId` cursor a keyset-walking job saved in its state, or 0. */
export const savedAfterId = (state: unknown): number => {
    const afterId = (state as { afterId?: unknown } | null)?.afterId;
    return typeof afterId === 'number' &&
        Number.isSafeInteger(afterId) &&
        afterId > 0
        ? afterId
        : 0;
};

interface RegionKeys {
    lock: string;
    gate: string;
    run: string;
}

/**
 * Runs our own recurring backend work once per cadence per region, under a
 * Redis lock. `fleet` jobs take the same path here; an extension registered as
 * `services.jobs` can run them fleet-wide by overriding `pollFleet`. Nothing
 * polls until a job is registered.
 */
export class JobScheduler extends PuterService {
    #jobs = new Map<string, RegisteredJob>();
    #running = new Map<string, Promise<void>>();
    #leases = new Set<RunLease>();
    #started = false;
    #stopping = false;
    #timer: ReturnType<typeof setInterval> | null = null;
    #pollDelays = new Set<ReturnType<typeof setTimeout>>();
    #warnedOff = false;
    #namespace: string | null = null;

    /** Keys this deployment's jobs, so deployments sharing Redis stay apart. */
    get namespace(): string {
        return (this.#namespace ??= resolveJobsNamespace(this.config));
    }

    register(name: string, definition: JobDefinition): void {
        if (!JOB_ID_PATTERN.test(name)) {
            throw new Error(`invalid job name: ${name}`);
        }
        if (this.#jobs.has(name)) {
            throw new Error(`job already registered: ${name}`);
        }
        const { every, scope } = definition;
        if (!Number.isSafeInteger(every) || every <= 0) {
            throw new Error(`job ${name}: every must be a positive integer`);
        }
        if (scope !== 'fleet' && scope !== 'region') {
            throw new Error(`job ${name}: unknown scope`);
        }
        const leaseMs =
            definition.leaseMs ??
            (scope === 'region'
                ? Math.min(JOB_DEFAULT_LEASE_MS, every)
                : JOB_DEFAULT_LEASE_MS);
        if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
            throw new Error(`job ${name}: leaseMs must be a positive integer`);
        }
        // The gate that fences a region run lasts `every`.
        if (scope === 'region' && leaseMs > every) {
            throw new Error(
                `job ${name}: a region job's leaseMs exceeds every`,
            );
        }
        this.#jobs.set(name, {
            every,
            scope,
            nearPrimary: definition.nearPrimary ?? false,
            leaseMs,
            run: definition.run,
        });
        if (this.#started) this.#arm();
    }

    override onServerStart(): void {
        this.#started = true;
        if (this.#jobs.size > 0) this.#arm();
    }

    override onServerPrepareShutdown(): void {
        this.#stopping = true;
        if (this.#timer) clearInterval(this.#timer);
        this.#timer = null;
        for (const delay of this.#pollDelays) clearTimeout(delay);
        this.#pollDelays.clear();
        for (const lease of [...this.#leases]) {
            lease.controller.abort(
                new JobLeaseLostError('server shutting down'),
            );
            lease.close();
        }
    }

    /**
     * Give aborted runs a moment to record themselves before the database
     * closes.
     */
    override async onServerShutdown(): Promise<void> {
        if (this.#running.size === 0) return;
        let wait: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            Promise.allSettled(this.#running.values()),
            new Promise((resolve) => {
                wait = setTimeout(resolve, JOB_SHUTDOWN_WAIT_MS);
            }),
        ]);
        clearTimeout(wait);
    }

    /**
     * Start every registered job that is due and not already running here.
     * Resolves once the runs it started have finished.
     */
    async poll(): Promise<void> {
        if (this.#stopping) return;
        const fleet: string[] = [];
        const region: Promise<void>[] = [];
        for (const [name, job] of this.#jobs) {
            if (this.#running.has(name)) continue;
            if (job.scope === 'fleet') {
                fleet.push(name);
                continue;
            }
            region.push(this.track(name, () => this.#tryRegion(name, job)));
        }
        await Promise.all([this.pollFleet(fleet), ...region]);
    }

    #arm(): void {
        if (this.#timer || this.#stopping) return;
        if (this.config.jobs?.enabled === false) {
            // Nothing alarms on a job that never runs, so say it here.
            if (!this.#warnedOff) {
                console.warn(
                    '[jobs] polling is off on this node (jobs.enabled: false); other nodes must run the jobs',
                );
            }
            this.#warnedOff = true;
            return;
        }
        const tick = () => {
            const delay = setTimeout(() => {
                this.#pollDelays.delete(delay);
                void this.#pollSafely();
            }, Math.random() * JOB_POLL_JITTER_MS);
            delay.unref?.();
            this.#pollDelays.add(delay);
        };
        const timer = setInterval(tick, JOB_POLL_MS);
        timer.unref?.();
        this.#timer = timer;
        tick();
    }

    async #pollSafely(): Promise<void> {
        try {
            await this.poll();
        } catch (err) {
            console.error('[jobs] poll failed', err);
        }
    }

    // -- Region scope -------------------------------------------------

    async #tryRegion(name: string, job: RegisteredJob): Promise<void> {
        const redis = this.clients.redis;
        const keys = regionKeys(this.namespace, name);
        let gated: number;
        try {
            gated = await redis.exists(keys.gate);
        } catch {
            // Redis is unreachable; the lock below would be busy anyway.
            return;
        }
        if (gated > 0) return;
        // Before the lock, so acquiring it counts against `leaseMs`.
        const startedAt = performance.now();
        await withRedisLock(
            redis,
            keys.lock,
            async () => {
                const token = randomUUID();
                const gate = await redis.set(
                    keys.gate,
                    token,
                    'PX',
                    job.every,
                    'NX',
                );
                if (gate !== 'OK') return;
                await this.#runRegion(name, job, keys, token, startedAt);
            },
            {
                ttlMs: job.leaseMs,
                onUnavailable: 'busy',
                onBusy: (): void => undefined,
            },
        );
    }

    /**
     * One run under the region lock. The lock doesn't renew, so the signal
     * aborts once it lapses, and every write is fenced on the gate's token.
     */
    async #runRegion(
        name: string,
        job: RegisteredJob,
        keys: RegionKeys,
        token: string,
        startedAt: number,
    ): Promise<void> {
        const lease = this.#regionLease(job.leaseMs, startedAt);
        const { signal } = lease.controller;
        const write = (op: string, ...args: (string | number)[]) =>
            this.#regionWrite(keys, token, op, ...args);
        let error: unknown = null;
        try {
            const saved = await this.clients.redis.hget(keys.run, 'state');
            if (await lease.ready()) {
                await job.run({
                    signal,
                    state: parseState(saved),
                    saveState: async (state) => {
                        const json = serializeState(state);
                        if ((await write('hset', 'state', json)) < 0) {
                            lostLease(lease, name);
                        }
                    },
                });
            }
        } catch (err) {
            error = err;
        } finally {
            lease.close();
        }

        const outcome = runOutcome(signal, error);
        if (outcome === 'success') {
            await write('hdel', 'failures');
        } else if (outcome === 'failure') {
            const failures = await write('hincrby', 'failures');
            if (failures < 0) return;
            await write(
                'pexpire',
                Math.min(job.every, deliveryBackoffMs(failures)),
            );
            this.reportFailure(name, failures, error);
        } else {
            await write('del');
        }
    }

    /**
     * The lock lapses `leaseMs` after `from`; the run needs half of it left to
     * start.
     */
    #regionLease(leaseMs: number, from: number): RunLease {
        const controller = new AbortController();
        const deadline = from + leaseMs;
        const abort = (reason: string) => {
            if (!controller.signal.aborted) {
                controller.abort(new JobLeaseLostError(reason));
            }
        };
        const lapse = setTimeout(
            () => abort('region lock lapsed'),
            Math.max(0, deadline - performance.now()),
        );
        const lease: RunLease = {
            controller,
            ready: async () => {
                if (
                    !controller.signal.aborted &&
                    deadline - performance.now() >= leaseMs / 2
                ) {
                    return true;
                }
                abort('too little of the lock left to start');
                return false;
            },
            close: () => {
                clearTimeout(lapse);
                this.closeLease(lease);
            },
        };
        this.openLease(lease);
        return lease;
    }

    /**
     * Run a write to the region keys if the gate still holds `token`; -1 if
     * not.
     */
    async #regionWrite(
        keys: RegionKeys,
        token: string,
        op: string,
        ...args: (string | number)[]
    ): Promise<number> {
        const result = await this.clients.redis.eval(
            REGION_FENCED_WRITE,
            2,
            keys.gate,
            keys.run,
            token,
            op,
            ...args,
        );
        return Number(result);
    }

    // -- Hooks, also for extensions that replace `services.jobs` -------

    /**
     * Run `fleet` jobs registered here and not running in this process. The
     * default holds each per region, its lease capped at `every`.
     */
    protected async pollFleet(names: string[]): Promise<void> {
        await Promise.all(
            names.map((name) => {
                const job = this.definitionOf(name);
                return this.track(name, () =>
                    this.#tryRegion(name, {
                        ...job,
                        leaseMs: Math.min(job.leaseMs, job.every),
                    }),
                );
            }),
        );
    }

    /** Runs `work` as `name`'s only run in this process. */
    protected track(name: string, work: () => Promise<void>): Promise<void> {
        const run = (async () => {
            try {
                await work();
            } catch (err) {
                console.error(`[jobs] ${name} errored`, err);
            } finally {
                this.#running.delete(name);
            }
        })();
        this.#running.set(name, run);
        return run;
    }

    protected isRunning(name: string): boolean {
        return this.#running.has(name);
    }

    protected definitionOf(name: string): RegisteredJob {
        const job = this.#jobs.get(name);
        if (!job) throw new Error(`job not registered: ${name}`);
        return job;
    }

    /** Who runs a job here: region, server and process. */
    protected owner(): string {
        const region = this.services.broadcast.regionId;
        const server = this.config.serverId ?? 'local';
        return `${region}:${server}:${process.pid}`.slice(0, 128);
    }

    /**
     * Track `lease` for shutdown; one opened while shutting down is aborted at
     * once.
     */
    protected openLease(lease: RunLease): void {
        this.#leases.add(lease);
        if (this.#stopping) {
            lease.controller.abort(
                new JobLeaseLostError('server shutting down'),
            );
        }
    }

    /** Stop tracking `lease`; its `close` calls this. */
    protected closeLease(lease: RunLease): void {
        this.#leases.delete(lease);
    }

    protected reportFailure(
        name: string,
        failures: number,
        error: unknown,
    ): void {
        console.error(`[jobs] ${name} failed (${failures} in a row)`, error);
        if (failures < JOB_FAILING_ALARM_AT) return;
        this.clients.alarm.create(
            `scheduled_job_failing:${this.namespace}:${name}`,
            `System job ${name} keeps failing`,
            {
                namespace: this.namespace,
                name,
                failures,
                error: asError(error),
            },
            'warning',
            { dedup: true },
        );
    }
}

/**
 * One hash slot per job. Neither part may contain `:` (`JOB_ID_PATTERN`), so no
 * two (namespace, name) pairs share keys.
 */
const regionKeys = (namespace: string, name: string): RegionKeys => {
    const tag = `{${namespace}:${name}}`;
    return {
        lock: `jobs:${tag}:lock`,
        gate: `jobs:${tag}:next`,
        run: `jobs:${tag}:run`,
    };
};
