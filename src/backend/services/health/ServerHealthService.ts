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

import { PuterService } from '../types';
import type { SocketService } from '../socket/SocketService';
import { kv } from '../../util/kvSingleton';
import { PUTER_KV_STORE_TABLE_NAME } from '../../stores/systemKv/tableDefinition';

/**
 * Periodic liveness monitor for the backend. Other services register checks via
 * `addCheck`; the internal loop runs them every `CHECK_INTERVAL_MS`, raises an
 * alarm on first failure, fires `onFail` handlers (for self-heal hooks), and
 * exposes `getStatus()` for the `/healthcheck` route.
 *
 * Default checks registered on server start:
 *
 * - `database-liveness` — `SELECT 1 AS ok` through the normal read path (a
 *   read-replica where one is configured), latency-gated against
 *   `config.server_health.db_liveness_latency_fail_ms` (default 1500ms).
 * - `socket-initialized` — socket.io must be attached. Only registered when
 *   SocketService is present (skipped for API-only deployments).
 *
 * Plus one probe per backing service this node can't serve traffic without,
 * each in the `dependencies` group (see `addCheck`) and each registered only
 * when that dependency is actually wired up:
 *
 * - `database-primary-liveness` — `SELECT 1 AS ok` pinned to the primary. Only
 *   registered when a read-replica exists, since without one it would just
 *   re-probe the connection `database-liveness` already covers. A node far from
 *   the primary pays real round-trip latency on every write, so this probe gets
 *   its own, looser threshold
 *   (`config.server_health.db_primary_liveness_latency_fail_ms`, default
 *   3000ms) and only reports unhealthy after
 *   `config.server_health.db_primary_liveness_breaches_to_fail` consecutive
 *   breaches (default 2) — a single slow cross-region round trip is noise. A
 *   primary that errors or hangs outright still fails on the first run.
 * - `redis-liveness` — `PING`.
 * - `dynamo-liveness` — point read of a key that is never written, so the probe
 *   exercises the data plane without depending on any stored state.
 * - `s3-liveness` — `HEAD` on the default storage bucket.
 *
 * These four are deliberately cheap and run on their own slower cadence
 * (`config.server_health.dependency_check_interval_ms`, default 30s) rather
 * than the 5s loop: they cross the network to metered services, and detecting a
 * dependency outage seconds sooner isn't worth a standing request stream from
 * every node. Any of them can be turned off with
 * `config.server_health.disabled_checks`.
 *
 * Draining mode: `onServerPrepareShutdown` flips the service into drain and
 * clears failure state. `/healthcheck` returns 503 so load balancers route
 * traffic away before the process exits.
 */

const SECOND = 1000;
const CHECK_INTERVAL_MS = 5 * SECOND;
const CHECK_TIMEOUT_MS = 4 * SECOND;
const HEALTH_LOOP_STALE_MULTIPLIER = 3;
const DEFAULT_DB_LIVENESS_LATENCY_FAIL_MS = 1500;
const DEFAULT_DB_PRIMARY_LIVENESS_LATENCY_FAIL_MS = 3 * SECOND;
const DEFAULT_DB_PRIMARY_LIVENESS_BREACHES_TO_FAIL = 2;
const DEFAULT_DEPENDENCY_CHECK_INTERVAL_MS = 30 * SECOND;
const DEFAULT_REDIS_LATENCY_FAIL_MS = 1 * SECOND;
const DEFAULT_DYNAMO_LATENCY_FAIL_MS = 1500;
const DEFAULT_S3_LATENCY_FAIL_MS = 2 * SECOND;
const STATUS_CACHE_TTL_SECONDS = 5;
const STATUS_CACHE_KEY = 'server-health:status';

/** Group name covering every backing-service probe. */
const DEPENDENCY_GROUP = 'dependencies';

/**
 * Key the dynamo probe reads. Nothing ever writes it — a point read that misses
 * still proves the round-trip, and costs the same minimum as one that hits.
 */
const DYNAMO_PROBE_KEY = {
    namespace: 'server-health',
    key: 'liveness-probe',
};

type CheckFn = () => Promise<unknown> | unknown;
type FailHandler = (err: unknown) => Promise<void> | void;

interface Chainable {
    onFail(handler: FailHandler): Chainable;
}

export interface AddCheckOptions {
    /**
     * Minimum gap between runs. Defaults to 0 — every loop cycle. A check with
     * a real cost (network hop, metered service) should set this; the loop
     * skips it until it's due and keeps reporting its last result meanwhile.
     */
    intervalMs?: number;
    /**
     * Group names this check also answers to, so `ignore`/`degrade` callers can
     * name a whole class of checks as `@<group>` instead of enumerating them.
     */
    groups?: string[];
}

interface RegisteredCheck {
    name: string;
    fn: CheckFn;
    onFailHandlers: FailHandler[];
    groups: string[];
    minIntervalMs: number;
    lastRunAt: number;
    lastDurationMs: number;
    hasRun: boolean;
    failing: boolean;
}

interface HealthStats {
    last_check_cycle_completed_at: number;
    check_durations_ms: Record<string, number>;
    failed_checks: string[];
    database_liveness_latency_ms?: number;
}

export interface HealthStatus {
    ok: boolean;
    failed?: string[];
    degraded?: string[];
}

export interface GetStatusOptions {
    /** Failing check names to drop entirely (healthy if all failures ignored). */
    ignore?: string[];
    /**
     * Failing check names to demote to non-fatal `degraded`. They don't make
     * `ok` false, but their presence signals partial health to the caller.
     */
    degrade?: string[];
}

export class ServerHealthService extends PuterService {
    #checks: RegisteredCheck[] = [];
    #healthStartedAt = Date.now();
    #lastCycleCompletedAt = 0;
    #stats: HealthStats = {
        last_check_cycle_completed_at: 0,
        check_durations_ms: {},
        failed_checks: [],
    };
    #loopRunning = false;
    #intervalHandle: NodeJS.Timeout | null = null;
    #draining = false;

    override onServerStart(): void {
        this.#registerDefaultChecks();
        this.#startLoop();
    }

    override onServerPrepareShutdown(): void {
        if (this.#draining) return;
        this.#draining = true;
        for (const check of this.#checks) check.failing = false;
        this.#lastCycleCompletedAt = Date.now();
        this.#stats = {
            last_check_cycle_completed_at: this.#lastCycleCompletedAt,
            check_durations_ms: {},
            failed_checks: [],
        };
        console.log('[server-health] entering drain mode');
    }

    override onServerShutdown(): void {
        if (this.#intervalHandle) {
            clearInterval(this.#intervalHandle);
            this.#intervalHandle = null;
        }
    }

    /**
     * Register a named health check. The returned chainable exposes
     * `onFail(fn)` so callers can hook self-heal logic (e.g., recreating a
     * pooled DB client after a liveness drop).
     *
     * A check named in `config.server_health.disabled_checks` is dropped here
     * and never runs — the chainable still works, its handlers just never
     * fire.
     */
    addCheck(name: string, fn: CheckFn, opts: AddCheckOptions = {}): Chainable {
        const registered: RegisteredCheck = {
            name,
            fn,
            onFailHandlers: [],
            groups: opts.groups ?? [],
            minIntervalMs: opts.intervalMs ?? 0,
            lastRunAt: 0,
            lastDurationMs: 0,
            hasRun: false,
            failing: false,
        };
        const disabled = this.config.server_health?.disabled_checks ?? [];
        if (!disabled.includes(name)) this.#checks.push(registered);

        const chainable: Chainable = {
            onFail: (handler) => {
                registered.onFailHandlers.push(handler);
                return chainable;
            },
        };
        return chainable;
    }

    /**
     * Current health status of this node. Results are cached in-process (kv.js)
     * for 5 seconds so a busy /healthcheck endpoint stays cheap. The cache is
     * deliberately per-node — a load balancer polling /healthcheck must see the
     * health of the exact node it hit, never a status shared with other nodes.
     *
     * `ignore` names failing states to disregard for this request only, letting
     * an orchestrator poll `/healthcheck` while tolerating specific
     * known-failing checks; when the remaining failures are all ignored the
     * status collapses back to `{ ok: true }`. `degrade` instead demotes named
     * failures to a non-fatal `degraded` list — `ok` stays true but the caller
     * can see the partial state. Any failure name may be filtered this way,
     * including the `draining` lifecycle state. A name of the form `@<group>`
     * stands for every check registered in that group, so a caller can tolerate
     * a whole class of checks — `@dependencies` for the backing-service probes
     * — without having to be redeployed each time one is added. The cached
     * status is always the full, unfiltered set — filtering is applied
     * per-request after the cache read so it never leaks across callers.
     */
    async getStatus(opts: GetStatusOptions = {}): Promise<HealthStatus> {
        const base = this.#draining
            ? { ok: false, failed: ['draining'] }
            : this.#getCachedStatus();
        return this.#applyFilters(base, opts.ignore ?? [], opts.degrade ?? []);
    }

    #getCachedStatus(): HealthStatus {
        const cached = kv.get(STATUS_CACHE_KEY) as HealthStatus | undefined;
        if (cached) return cached;

        const failures = this.#collectFailures();
        const status: HealthStatus =
            failures.length === 0
                ? { ok: true }
                : { ok: false, failed: failures };

        kv.set(STATUS_CACHE_KEY, status, { EX: STATUS_CACHE_TTL_SECONDS });
        return status;
    }

    /**
     * Reclassify a status against the per-request `ignore`/`degrade` sets.
     * `ignore`d failures are dropped; `degrade`d failures move to a non-fatal
     * `degraded` list; anything left stays a hard failure. `ok` is false only
     * while hard failures remain. A healthy status is returned as-is.
     */
    #applyFilters(
        status: HealthStatus,
        ignore: string[],
        degrade: string[],
    ): HealthStatus {
        if (status.ok || !status.failed) return status;

        const ignoredNames = this.#expandNames(ignore);
        const degradedNames = this.#expandNames(degrade);

        const remaining = status.failed.filter(
            (name) => !ignoredNames.has(name),
        );
        const degraded = remaining.filter((name) => degradedNames.has(name));
        const failed = remaining.filter((name) => !degradedNames.has(name));

        const result: HealthStatus = { ok: failed.length === 0 };
        if (failed.length > 0) result.failed = failed;
        if (degraded.length > 0) result.degraded = degraded;
        return result;
    }

    /** Resolve `@<group>` tokens to the names of the checks in that group. */
    #expandNames(names: string[]): Set<string> {
        const resolved = new Set<string>();
        for (const name of names) {
            if (!name.startsWith('@')) {
                resolved.add(name);
                continue;
            }
            const group = name.slice(1);
            for (const check of this.#checks) {
                if (check.groups.includes(group)) resolved.add(check.name);
            }
        }
        return resolved;
    }

    #registerDefaultChecks(): void {
        const latencyFailMs =
            Number(this.config.server_health?.db_liveness_latency_fail_ms) ||
            DEFAULT_DB_LIVENESS_LATENCY_FAIL_MS;

        const db = this.clients.db;
        if (db && typeof db.read === 'function') {
            this.addCheck('database-liveness', async () => {
                const startedAt = Date.now();
                const rows = (await db.read('SELECT 1 AS ok')) as unknown[];
                const durationMs = Date.now() - startedAt;
                this.#stats.database_liveness_latency_ms = durationMs;

                if (!Array.isArray(rows) || rows.length === 0) {
                    throw new Error('database liveness query returned no rows');
                }
                if (durationMs > latencyFailMs) {
                    throw new Error(
                        `database liveness latency ${durationMs}ms > threshold ${latencyFailMs}ms`,
                    );
                }
            });
        }

        const socket = this.services.socket as SocketService | undefined;
        if (socket) {
            this.addCheck('socket-initialized', () => {
                // Attach happens in `attachHttpServer`, called by PuterServer
                // after http is ready. If the internal io hasn't been set
                // by the time checks start running, something is wrong.
                const check = socket as unknown as { hasIO?: () => boolean };
                if (typeof check.hasIO === 'function' && !check.hasIO()) {
                    throw new Error('socket.io is not initialized');
                }
            });
        }

        this.#registerDependencyChecks();
    }

    /**
     * Probes for the backing services a node needs to serve traffic. Each is
     * the cheapest round-trip that still proves the data path works, runs on
     * the slow dependency cadence, and is skipped when the dependency isn't
     * wired up (self-hosted subsets, partially-stubbed tests).
     */
    #registerDependencyChecks(): void {
        const db = this.clients.db;
        if (
            this.config.database?.replica &&
            db &&
            typeof db.pread === 'function'
        ) {
            // `read()` above goes to the replica when one exists, so a primary
            // that is gone (or lagging behind a failover) looks healthy there.
            this.#addDependencyCheck({
                name: 'database-primary-liveness',
                configuredLatencyFailMs:
                    this.config.server_health
                        ?.db_primary_liveness_latency_fail_ms,
                defaultLatencyFailMs:
                    DEFAULT_DB_PRIMARY_LIVENESS_LATENCY_FAIL_MS,
                latencyBreachesToFail:
                    Number(
                        this.config.server_health
                            ?.db_primary_liveness_breaches_to_fail,
                    ) || DEFAULT_DB_PRIMARY_LIVENESS_BREACHES_TO_FAIL,
                probe: async () => {
                    const rows = (await db.pread(
                        'SELECT 1 AS ok',
                    )) as unknown[];
                    if (!Array.isArray(rows) || rows.length === 0) {
                        throw new Error(
                            'primary database liveness query returned no rows',
                        );
                    }
                },
            });
        }

        const redis = this.clients.redis;
        if (redis && typeof redis.ping === 'function') {
            this.#addDependencyCheck({
                name: 'redis-liveness',
                configuredLatencyFailMs:
                    this.config.server_health?.redis_liveness_latency_fail_ms,
                defaultLatencyFailMs: DEFAULT_REDIS_LATENCY_FAIL_MS,
                probe: async () => {
                    const reply = await redis.ping();
                    if (String(reply).toUpperCase() !== 'PONG') {
                        throw new Error(`unexpected ping reply: ${reply}`);
                    }
                },
            });
        }

        const dynamo = this.clients.dynamo;
        if (dynamo && typeof dynamo.get === 'function') {
            this.#addDependencyCheck({
                name: 'dynamo-liveness',
                configuredLatencyFailMs:
                    this.config.server_health?.dynamo_liveness_latency_fail_ms,
                defaultLatencyFailMs: DEFAULT_DYNAMO_LATENCY_FAIL_MS,
                probe: async () => {
                    await dynamo.get(
                        PUTER_KV_STORE_TABLE_NAME,
                        DYNAMO_PROBE_KEY,
                    );
                },
            });
        }

        const s3 = this.clients.s3;
        if (s3 && typeof s3.headBucket === 'function') {
            this.#addDependencyCheck({
                name: 's3-liveness',
                configuredLatencyFailMs:
                    this.config.server_health?.s3_liveness_latency_fail_ms,
                defaultLatencyFailMs: DEFAULT_S3_LATENCY_FAIL_MS,
                probe: async () => {
                    await s3.headBucket();
                },
            });
        }
    }

    /**
     * Wrap a dependency probe with a latency gate and register it on the slow
     * cadence, in the group `ignore`/`degrade` callers address as
     * `@dependencies`.
     *
     * `latencyBreachesToFail` tolerates that many consecutive over-threshold
     * runs before the gate throws, for a dependency whose latency is expected
     * to spike without being unhealthy (a primary reached across regions).
     * Defaults to 1 — fail on the first breach. It gates latency only: a probe
     * that rejects or hangs still fails the check on its first run.
     */
    #addDependencyCheck(opts: {
        name: string;
        configuredLatencyFailMs: number | undefined;
        defaultLatencyFailMs: number;
        latencyBreachesToFail?: number;
        probe: () => Promise<void>;
    }): void {
        const { name, probe } = opts;
        const latencyFailMs =
            Number(opts.configuredLatencyFailMs) || opts.defaultLatencyFailMs;
        const breachesToFail = Math.max(1, opts.latencyBreachesToFail ?? 1);
        const intervalMs =
            Number(this.config.server_health?.dependency_check_interval_ms) ||
            DEFAULT_DEPENDENCY_CHECK_INTERVAL_MS;

        let consecutiveBreaches = 0;

        this.addCheck(
            name,
            async () => {
                const startedAt = Date.now();
                await probe();
                const durationMs = Date.now() - startedAt;
                if (durationMs <= latencyFailMs) {
                    consecutiveBreaches = 0;
                    return;
                }
                consecutiveBreaches++;
                if (consecutiveBreaches < breachesToFail) {
                    console.warn(
                        `[server-health] ${name} latency ${durationMs}ms > threshold ${latencyFailMs}ms (${consecutiveBreaches}/${breachesToFail} before failing)`,
                    );
                    return;
                }
                throw new Error(
                    `${name} latency ${durationMs}ms > threshold ${latencyFailMs}ms on ${consecutiveBreaches} consecutive runs`,
                );
            },
            { intervalMs, groups: [DEPENDENCY_GROUP] },
        );
    }

    #startLoop(): void {
        this.#intervalHandle = setInterval(() => {
            if (this.#loopRunning) return; // reentrancy guard
            this.#loopRunning = true;
            this.#runCycle().finally(() => {
                this.#loopRunning = false;
            });
        }, CHECK_INTERVAL_MS);
        // Don't keep the process alive just for health checks.
        this.#intervalHandle.unref?.();
    }

    async #runCycle(): Promise<void> {
        if (this.#draining) {
            this.#lastCycleCompletedAt = Date.now();
            this.#stats.last_check_cycle_completed_at =
                this.#lastCycleCompletedAt;
            this.#stats.check_durations_ms = {};
            this.#stats.failed_checks = [];
            return;
        }

        // Concurrently, not one after another: checks are all I/O waits, and
        // serially they'd stack their timeouts into a cycle long enough to trip
        // the loop-staleness check.
        const due = this.#checks.filter((check) => this.#isDue(check));
        await Promise.all(due.map((check) => this.#runCheck(check)));

        const durations: Record<string, number> = {};
        for (const check of this.#checks) {
            if (check.hasRun) durations[check.name] = check.lastDurationMs;
        }

        this.#lastCycleCompletedAt = Date.now();
        this.#stats.last_check_cycle_completed_at = this.#lastCycleCompletedAt;
        this.#stats.check_durations_ms = durations;
        this.#stats.failed_checks = this.#collectCheckFailures();
    }

    /** Every cycle unless the check asked for a slower cadence. */
    #isDue(check: RegisteredCheck): boolean {
        if (!check.hasRun || check.minIntervalMs === 0) return true;
        return Date.now() - check.lastRunAt >= check.minIntervalMs;
    }

    async #runCheck(check: RegisteredCheck): Promise<void> {
        const startedAt = Date.now();
        check.lastRunAt = startedAt;
        check.hasRun = true;

        let timeoutHandle: NodeJS.Timeout | null = null;
        try {
            await new Promise<void>((resolve, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error('Health check timed out')),
                    CHECK_TIMEOUT_MS,
                );
                Promise.resolve(check.fn()).then(() => resolve(), reject);
            });
            check.failing = false;
        } catch (err) {
            const alreadyFailing = check.failing;
            check.failing = true;
            if (!alreadyFailing) {
                // Intentionally do not page PagerDuty for health-check
                // failures — external uptime monitors cover this and the
                // internal threshold flaps under normal load. Failures
                // are still logged below and still trigger self-heal
                // onFail handlers.
                for (const handler of check.onFailHandlers) {
                    try {
                        await handler(err);
                    } catch (hErr) {
                        console.error(
                            `[server-health] onFail handler for ${check.name} threw:`,
                            hErr,
                        );
                    }
                }
            }
            console.error(`[server-health] check "${check.name}" failed:`, err);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            check.lastDurationMs = Date.now() - startedAt;
        }
    }

    #collectFailures(): string[] {
        const names = this.#collectCheckFailures();
        const stale = this.#staleLoopFailure();
        if (stale) names.push(stale);
        return names;
    }

    #collectCheckFailures(): string[] {
        return this.#checks
            .filter((check) => check.failing)
            .map((check) => check.name);
    }

    #staleLoopFailure(): string | null {
        const staleAfterMs =
            Number(this.config.server_health?.stale_health_loop_fail_ms) ||
            CHECK_INTERVAL_MS * HEALTH_LOOP_STALE_MULTIPLIER;
        const now = Date.now();

        if (this.#lastCycleCompletedAt === 0) {
            return now - this.#healthStartedAt > staleAfterMs
                ? 'health-check-loop-not-running'
                : null;
        }
        return now - this.#lastCycleCompletedAt > staleAfterMs
            ? 'health-check-loop-stale'
            : null;
    }

    /** Snapshot of per-cycle timing + DB latency. */
    getStats(): HealthStats {
        return {
            ...this.#stats,
            check_durations_ms: { ...this.#stats.check_durations_ms },
        };
    }
}
