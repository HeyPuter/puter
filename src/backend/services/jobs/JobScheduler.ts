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
import type {
    JobNextRun,
    ScheduledJobSummary,
} from '../../stores/jobs/ScheduledJobStore.js';
import { withRedisLock } from '../../util/redisLock.js';
import { deliveryBackoffMs } from '../../util/retryBackoff.js';
import { PuterService } from '../types';

/** How often each node looks for due jobs. */
const JOB_POLL_MS = 30_000;
/** Each poll waits up to this long first, so nodes don't all claim at once. */
const JOB_POLL_JITTER_MS = 5_000;
/** How overdue a `nearPrimary` job must be before other regions may claim it. */
export const JOB_NEAR_PRIMARY_GRACE_MS = 5 * 60_000;
const JOB_DEFAULT_LEASE_MS = 15 * 60_000;
/** Consecutive failures that raise `scheduled_job_failing`. */
const JOB_FAILING_ALARM_AT = 3;
const JOB_OVERDUE_MIN_MS = 10 * 60_000;
const JOB_STATE_MAX_BYTES = 64 * 1024;
const JOB_ERROR_MAX_CHARS = 1024;
const JOB_FIRST_RUN_JITTER_MAX_MS = 60_000;
const JOB_SHUTDOWN_WAIT_MS = 10_000;
/**
 * Job names and namespaces: what `scheduled_jobs` stores (ASCII, 128) and
 * without `:`, so a (namespace, name) pair maps to exactly one Redis key.
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

/** `fleet` runs once per cadence across every region; `region` once per region. */
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
     * Prefer the region nearest the primary database
     * (`jobs.nearPrimaryRegion`).
     */
    nearPrimary?: boolean;
    /**
     * How long a run holds the job: between renewals for `fleet`, in total for
     * `region` (at most `every`). Default 15 min, capped at `every` for
     * `region`.
     */
    leaseMs?: number;
    run: (ctx: JobRunContext) => Promise<void>;
}

/** The run no longer holds its job; another node may already be running it. */
export class JobLeaseLostError extends Error {}

type RegisteredJob = Required<JobDefinition>;

type RunOutcome = 'success' | 'failure' | 'interrupted';

/** What a run holds the job by. Its deadline is measured from before the claim. */
interface RunLease {
    controller: AbortController;
    /**
     * Renews if little lease is left; false (and aborted) if the run can't
     * start.
     */
    ready: () => Promise<boolean>;
    close: () => void;
}

interface RegionKeys {
    lock: string;
    gate: string;
    run: string;
}

/**
 * Runs our own recurring backend work once per cadence: once across every node
 * sharing the database (`fleet`, a lease row in `scheduled_jobs`), or once per
 * region (`region`, a Redis lock). Nothing polls until a job is registered.
 */
export class JobScheduler extends PuterService {
    #jobs = new Map<string, RegisteredJob>();
    /** Fleet jobs whose row this process has inserted (or found). */
    #rowsReady = new Set<string>();
    #running = new Map<string, Promise<void>>();
    #leases = new Set<RunLease>();
    #started = false;
    #stopping = false;
    #timer: ReturnType<typeof setInterval> | null = null;
    #pollDelays = new Set<ReturnType<typeof setTimeout>>();

    /**
     * Keys this deployment's jobs, so deployments sharing a database stay
     * apart.
     */
    get namespace(): string {
        return this.config.jobs?.namespace ?? this.config.domain ?? 'default';
    }

    register(name: string, definition: JobDefinition): void {
        if (!JOB_ID_PATTERN.test(this.namespace)) {
            throw new Error(
                `invalid jobs namespace "${this.namespace}": 1-128 of A-Z a-z 0-9 . _ -`,
            );
        }
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
            region.push(this.#track(name, () => this.#tryRegion(name, job)));
        }
        await Promise.all([this.#pollFleet(fleet), ...region]);
    }

    #arm(): void {
        if (this.#timer || this.#stopping) return;
        if (this.config.jobs?.enabled === false) return;
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

    /** Runs `work` as `name`'s only run in this process. */
    #track(name: string, work: () => Promise<void>): Promise<void> {
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

    // -- Fleet scope --------------------------------------------------

    async #pollFleet(names: string[]): Promise<void> {
        if (names.length === 0) return;
        if (!(await this.#ensureRows(names))) return;

        let listed: { jobs: ScheduledJobSummary[]; dbNowMs: number | null };
        try {
            listed = await this.stores.scheduledJob.listForNamespace(
                this.namespace,
                names,
            );
        } catch (err) {
            console.warn('[jobs] could not read scheduled_jobs', err);
            return;
        }
        const now = listed.dbNowMs ?? Date.now();

        const runs: Promise<void>[] = [];
        for (const row of listed.jobs) {
            const job = this.#jobs.get(row.name);
            if (!job || this.#running.has(row.name)) continue;
            if (row.leaseUntil !== null && row.leaseUntil >= now) continue;
            this.#checkOverdue(row, job, now);
            if (row.nextRunAt + this.#graceMs(job) > now) continue;
            runs.push(
                this.#track(row.name, () => this.#runFleet(row.name, job)),
            );
        }
        await Promise.all(runs);
    }

    /**
     * Insert rows for newly registered fleet jobs. False when the table is
     * unusable.
     */
    async #ensureRows(names: string[]): Promise<boolean> {
        const missing = names.filter((name) => !this.#rowsReady.has(name));
        if (missing.length === 0) return true;
        try {
            await Promise.all(
                missing.map((name) => {
                    const every = this.#jobs.get(name)!.every;
                    const jitter = Math.floor(
                        Math.random() *
                            Math.min(every * 0.05, JOB_FIRST_RUN_JITTER_MAX_MS),
                    );
                    return this.stores.scheduledJob.register(
                        this.namespace,
                        name,
                        jitter,
                        Date.now(),
                    );
                }),
            );
        } catch (err) {
            this.clients.alarm.create(
                'scheduled_jobs_unavailable',
                'scheduled_jobs is unavailable; fleet jobs are not running',
                { namespace: this.namespace, error: asError(err) },
                'critical',
                { dedup: true },
            );
            return false;
        }
        for (const name of missing) this.#rowsReady.add(name);
        return true;
    }

    /** Extra wait before this region may claim `job`. */
    #graceMs(job: RegisteredJob): number {
        const nearPrimaryRegion = this.config.jobs?.nearPrimaryRegion;
        if (!job.nearPrimary || !nearPrimaryRegion) return 0;
        return this.services.broadcast.regionId === nearPrimaryRegion
            ? 0
            : JOB_NEAR_PRIMARY_GRACE_MS;
    }

    #checkOverdue(
        row: ScheduledJobSummary,
        job: RegisteredJob,
        now: number,
    ): void {
        const overdueMs = now - row.nextRunAt;
        if (overdueMs <= Math.max(2 * job.every, JOB_OVERDUE_MIN_MS)) return;
        this.clients.alarm.create(
            `scheduled_job_overdue:${this.namespace}:${row.name}`,
            `System job ${row.name} is overdue`,
            { namespace: this.namespace, name: row.name, overdueMs },
            'warning',
            { dedup: true },
        );
    }

    async #runFleet(name: string, job: RegisteredJob): Promise<void> {
        const store = this.stores.scheduledJob;
        const namespace = this.namespace;
        const token = randomUUID();
        // Before the claim, so the claim's own I/O counts against the lease.
        const startedAt = performance.now();
        const claimed = await store.claim(namespace, name, {
            token,
            owner: this.#owner(),
            leaseMs: job.leaseMs,
            graceMs: this.#graceMs(job),
            updatedAt: Date.now(),
        });
        if (!claimed) return;

        const lease = this.#fleetLease(name, token, job.leaseMs, startedAt);
        const { signal } = lease.controller;
        let lastRunAt: number | null = null;
        let failures = 0;
        let error: unknown = null;
        try {
            const row = await store.readClaimed(namespace, name);
            if (!row) throw new Error('job row is gone');
            lastRunAt = row.dbNowMs;
            failures = row.failures;
            if (await lease.ready()) {
                await job.run({
                    signal,
                    state: parseState(row.state),
                    saveState: async (state) => {
                        const saved = await store.saveState(
                            namespace,
                            name,
                            token,
                            serializeState(state),
                            Date.now(),
                        );
                        if (!saved) lostLease(lease, name);
                    },
                });
            }
        } catch (err) {
            error = err;
        } finally {
            lease.close();
        }
        // Without the row there is nothing to record; the lease lapses.
        if (lastRunAt === null) throw error;

        const outcome = runOutcome(signal, error);
        let next: JobNextRun = { kind: 'unchanged' };
        let lastError: string | null = null;
        if (outcome === 'success') {
            next = { kind: 'cadence', every: job.every };
            failures = 0;
        } else if (outcome === 'failure') {
            failures += 1;
            next = {
                kind: 'after',
                delayMs: Math.min(job.every, deliveryBackoffMs(failures)),
            };
            lastError = errorText(error);
        } else {
            // Due again at once, for whichever node gets to it.
            lastError = `interrupted: ${errorText(signal.reason)}`;
        }

        const recorded = await store.finish(namespace, name, token, {
            next,
            lastRunAt,
            lastDurationMs: Math.round(performance.now() - startedAt),
            lastError,
            failures,
            updatedAt: Date.now(),
        });
        if (!recorded) {
            console.warn(`[jobs] ${name} lost its lease before finishing`);
            return;
        }
        if (outcome === 'failure') this.#reportFailure(name, failures, error);
    }

    /**
     * The row's lease is `leaseMs` from the claim, which started at `from`.
     * Renewals go out every `leaseMs / 3`; the run aborts if none has succeeded
     * within `leaseMs / 2` of when it was sent, or one fails or finds the lease
     * gone.
     */
    #fleetLease(
        name: string,
        token: string,
        leaseMs: number,
        from: number,
    ): RunLease {
        const controller = new AbortController();
        let deadline = from + leaseMs / 2;
        let closed = false;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        let renewTimer: ReturnType<typeof setTimeout> | undefined;
        let renewing: Promise<void> | null = null;
        const abort = (reason: string, cause?: unknown) => {
            if (controller.signal.aborted) return;
            controller.abort(new JobLeaseLostError(reason, { cause }));
        };

        const schedule = () => {
            clearTimeout(watchdog);
            clearTimeout(renewTimer);
            if (closed || controller.signal.aborted) return;
            const now = performance.now();
            watchdog = setTimeout(
                () => abort('lease renewal overdue'),
                Math.max(0, deadline - now),
            );
            renewTimer = setTimeout(
                () => void renew(),
                Math.max(0, deadline - leaseMs / 6 - now),
            );
        };

        const renew = (): Promise<void> => {
            renewing ??= (async () => {
                const sentAt = performance.now();
                try {
                    const renewed = await this.stores.scheduledJob.renew(
                        this.namespace,
                        name,
                        token,
                        leaseMs,
                        Date.now(),
                    );
                    // A renewal answering after the run closed can't re-arm.
                    if (closed || controller.signal.aborted) return;
                    if (!renewed) {
                        abort('lease lost');
                        return;
                    }
                    deadline = Math.max(deadline, sentAt + leaseMs / 2);
                    schedule();
                } catch (err) {
                    abort('lease renewal failed', err);
                } finally {
                    renewing = null;
                }
            })();
            return renewing;
        };

        const lease: RunLease = {
            controller,
            ready: async () => {
                // Past the deadline the lease may already be someone else's.
                if (performance.now() >= deadline) {
                    abort('lease renewal overdue');
                } else if (deadline - performance.now() < leaseMs / 6) {
                    await renew();
                }
                if (
                    !closed &&
                    !controller.signal.aborted &&
                    deadline - performance.now() >= leaseMs / 6
                ) {
                    return true;
                }
                abort('too little lease left to start');
                return false;
            },
            close: () => {
                closed = true;
                clearTimeout(watchdog);
                clearTimeout(renewTimer);
                this.#leases.delete(lease);
            },
        };
        this.#openLease(lease);
        if (performance.now() >= deadline) abort('lease renewal overdue');
        schedule();
        return lease;
    }

    #owner(): string {
        const region = this.services.broadcast.regionId;
        const server = this.config.serverId ?? 'local';
        return `${region}:${server}:${process.pid}`.slice(0, 128);
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
            this.#reportFailure(name, failures, error);
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
                this.#leases.delete(lease);
            },
        };
        this.#openLease(lease);
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

    // -- Shared -------------------------------------------------------

    /**
     * Track `lease` for shutdown; one opened while shutting down is aborted at
     * once.
     */
    #openLease(lease: RunLease): void {
        this.#leases.add(lease);
        if (this.#stopping) {
            lease.controller.abort(
                new JobLeaseLostError('server shutting down'),
            );
        }
    }

    #reportFailure(name: string, failures: number, error: unknown): void {
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

const lostLease = (lease: RunLease, name: string): never => {
    const lost = new JobLeaseLostError(`job ${name} lost its lease`);
    lease.controller.abort(lost);
    throw lost;
};

/** A run cut short by its signal is interrupted, whether or not it threw. */
const runOutcome = (signal: AbortSignal, error: unknown): RunOutcome => {
    if (signal.aborted) return 'interrupted';
    return error === null ? 'success' : 'failure';
};

const parseState = (raw: string | null): unknown => {
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const serializeState = (state: unknown): string => {
    const json = JSON.stringify(state ?? null);
    if (Buffer.byteLength(json) > JOB_STATE_MAX_BYTES) {
        throw new Error(`job state is over ${JOB_STATE_MAX_BYTES} bytes`);
    }
    return json;
};

const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

const errorText = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error)).slice(
        0,
        JOB_ERROR_MAX_CHARS,
    );
