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
import { deliveryBackoffMs } from '../../controllers/events/limits.js';
import type {
    ClaimedJob,
    ScheduledJobSummary,
} from '../../stores/jobs/ScheduledJobStore.js';
import { withRedisLock } from '../../util/redisLock.js';
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
const JOB_NAME_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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
    /** How long a run holds the job between renewals. Default 15 min. */
    leaseMs?: number;
    run: (ctx: JobRunContext) => Promise<void>;
}

/** The run no longer holds its job; another node may already be running it. */
export class JobLeaseLostError extends Error {}

type RegisteredJob = Required<JobDefinition>;

type RunOutcome = 'success' | 'failure' | 'interrupted';

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
    #controllers = new Set<AbortController>();
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
        if (!JOB_NAME_PATTERN.test(name)) {
            throw new Error(`invalid job name: ${name}`);
        }
        if (this.#jobs.has(name)) {
            throw new Error(`job already registered: ${name}`);
        }
        const leaseMs = definition.leaseMs ?? JOB_DEFAULT_LEASE_MS;
        if (!Number.isSafeInteger(definition.every) || definition.every <= 0) {
            throw new Error(`job ${name}: every must be a positive integer`);
        }
        if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
            throw new Error(`job ${name}: leaseMs must be a positive integer`);
        }
        if (definition.scope !== 'fleet' && definition.scope !== 'region') {
            throw new Error(`job ${name}: unknown scope`);
        }
        this.#jobs.set(name, {
            every: definition.every,
            scope: definition.scope,
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
        for (const controller of this.#controllers) {
            controller.abort(new JobLeaseLostError('server shutting down'));
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
        const claimed = await store.claim(namespace, name, {
            token,
            owner: this.#owner(),
            leaseMs: job.leaseMs,
            graceMs: this.#graceMs(job),
            updatedAt: Date.now(),
        });
        if (!claimed) return;

        const controller = this.#newController();
        const stopRenewal = this.#keepLease(
            name,
            token,
            job.leaseMs,
            controller,
        );
        const startedAt = Date.now();
        let row: ClaimedJob | null = null;
        // The primary's clock minus ours, so recorded times agree across nodes.
        let offsetMs = 0;
        let error: unknown = null;
        try {
            row = await store.readClaimed(namespace, name);
            if (!row) throw new Error('job row is gone');
            offsetMs = row.dbNowMs - Date.now();
            await job.run({
                signal: controller.signal,
                state: parseState(row.state),
                saveState: async (state) => {
                    const json = serializeState(state);
                    const saved = await store.saveState(
                        namespace,
                        name,
                        token,
                        json,
                        Date.now(),
                    );
                    if (!saved) {
                        const lost = new JobLeaseLostError(
                            `job ${name} lost its lease`,
                        );
                        controller.abort(lost);
                        throw lost;
                    }
                },
            });
        } catch (err) {
            error = err;
        } finally {
            stopRenewal();
            this.#controllers.delete(controller);
        }
        // Without the row there is nothing to record; the lease lapses.
        if (!row) throw error;

        const finishedAt = Date.now() + offsetMs;
        const outcome = runOutcome(controller.signal, error);
        let nextRunAt = row.nextRunAt;
        let failures = row.failures;
        let lastError: string | null = null;
        if (outcome === 'success') {
            nextRunAt = nextCadenceSlot(row.nextRunAt, job.every, finishedAt);
            failures = 0;
        } else if (outcome === 'failure') {
            failures += 1;
            nextRunAt =
                finishedAt + Math.min(job.every, deliveryBackoffMs(failures));
            lastError = errorText(error);
        } else {
            // Due again at once, for whichever node gets to it.
            lastError = `interrupted: ${errorText(controller.signal.reason)}`;
        }

        const recorded = await store.finish(namespace, name, token, {
            nextRunAt,
            lastRunAt: startedAt + offsetMs,
            lastDurationMs: Date.now() - startedAt,
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
     * Renew every `leaseMs / 3`. A renewal that fails, finds the lease gone, or
     * hasn't succeeded within `leaseMs / 2` aborts the run.
     */
    #keepLease(
        name: string,
        token: string,
        leaseMs: number,
        controller: AbortController,
    ): () => void {
        const overdue = () =>
            controller.abort(new JobLeaseLostError('lease renewal overdue'));
        let deadline = setTimeout(overdue, leaseMs / 2);
        let inFlight = false;

        const renew = async () => {
            if (inFlight || controller.signal.aborted) return;
            inFlight = true;
            try {
                const renewed = await this.stores.scheduledJob.renew(
                    this.namespace,
                    name,
                    token,
                    leaseMs,
                    Date.now(),
                );
                if (!renewed) {
                    controller.abort(new JobLeaseLostError('lease lost'));
                } else if (!controller.signal.aborted) {
                    clearTimeout(deadline);
                    deadline = setTimeout(overdue, leaseMs / 2);
                }
            } catch (err) {
                controller.abort(
                    new JobLeaseLostError('lease renewal failed', {
                        cause: err,
                    }),
                );
            } finally {
                inFlight = false;
            }
        };
        const interval = setInterval(() => {
            void renew();
        }, leaseMs / 3);

        return () => {
            clearInterval(interval);
            clearTimeout(deadline);
        };
    }

    /** A run's controller, aborted on shutdown even if that already began. */
    #newController(): AbortController {
        const controller = new AbortController();
        this.#controllers.add(controller);
        if (this.#stopping) {
            controller.abort(new JobLeaseLostError('server shutting down'));
        }
        return controller;
    }

    #owner(): string {
        const region = this.services.broadcast.regionId;
        const server = this.config.serverId ?? 'local';
        return `${region}:${server}:${process.pid}`.slice(0, 128);
    }

    // -- Region scope -------------------------------------------------

    async #tryRegion(name: string, job: RegisteredJob): Promise<void> {
        const redis = this.clients.redis;
        const gateKey = `jobs:next:${this.namespace}:${name}`;
        if ((await redis.exists(gateKey)) > 0) return;
        await withRedisLock(
            redis,
            `jobs:region:${this.namespace}:${name}`,
            async () => {
                const gate = await redis.set(
                    gateKey,
                    '1',
                    'PX',
                    job.every,
                    'NX',
                );
                if (gate !== 'OK') return;
                await this.#runRegion(name, job, gateKey);
            },
            {
                ttlMs: job.leaseMs,
                onUnavailable: 'busy',
                onBusy: (): void => undefined,
            },
        );
    }

    /**
     * One run under the region lock. It doesn't renew, so the signal aborts
     * when it lapses.
     */
    async #runRegion(
        name: string,
        job: RegisteredJob,
        gateKey: string,
    ): Promise<void> {
        const redis = this.clients.redis;
        const runKey = `jobs:run:${this.namespace}:${name}`;
        const saved = await redis.hget(runKey, 'state');

        const controller = this.#newController();
        const lapse = setTimeout(
            () => controller.abort(new JobLeaseLostError('region lock lapsed')),
            job.leaseMs,
        );
        let error: unknown = null;
        try {
            await job.run({
                signal: controller.signal,
                state: parseState(saved),
                saveState: async (state) => {
                    const json = serializeState(state);
                    if (controller.signal.aborted) {
                        throw new JobLeaseLostError(
                            `job ${name} lost its lock`,
                        );
                    }
                    await redis.hset(runKey, 'state', json);
                },
            });
        } catch (err) {
            error = err;
        } finally {
            clearTimeout(lapse);
            this.#controllers.delete(controller);
        }

        const outcome = runOutcome(controller.signal, error);
        if (outcome === 'success') {
            await redis.hdel(runKey, 'failures');
        } else if (outcome === 'failure') {
            const failures = await redis.hincrby(runKey, 'failures', 1);
            await redis.set(
                gateKey,
                '1',
                'PX',
                Math.min(job.every, deliveryBackoffMs(failures)),
            );
            this.#reportFailure(name, failures, error);
        } else {
            await redis.del(gateKey);
        }
    }

    // -- Shared -------------------------------------------------------

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

/** The first slot of `prev`'s cadence strictly after `after`. */
const nextCadenceSlot = (prev: number, every: number, after: number): number =>
    prev + Math.max(1, Math.floor((after - prev) / every) + 1) * every;

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
