import { PuterService } from '../types';
import type { SocketService } from '../socket/SocketService';

/**
 * Periodic liveness monitor for the backend. Other services register
 * checks via `addCheck`; the internal loop runs them every
 * `CHECK_INTERVAL_MS`, raises an alarm on first failure, fires `onFail`
 * handlers (for self-heal hooks), and exposes `getStatus()` for the
 * `/healthcheck` route.
 *
 * Default checks registered on server start:
 *   - `database-liveness` — `SELECT 1 AS ok` latency-gated against
 *     `config.server_health.db_liveness_latency_fail_ms` (default 1500ms).
 *   - `socket-initialized` — socket.io must be attached. Only registered
 *     when SocketService is present (skipped for API-only deployments).
 *
 * Draining mode: `onServerPrepareShutdown` flips the service into drain
 * and clears failure state. `/healthcheck` returns 503 so load balancers
 * route traffic away before the process exits.
 */

const SECOND = 1000;
const CHECK_INTERVAL_MS = 5 * SECOND;
const CHECK_TIMEOUT_MS = 4 * SECOND;
const HEALTH_LOOP_STALE_MULTIPLIER = 3;
const DEFAULT_DB_LIVENESS_LATENCY_FAIL_MS = 1500;
const STATUS_CACHE_TTL_SECONDS = 5;
const STATUS_CACHE_KEY = 'server-health:status';

type CheckFn = () => Promise<unknown> | unknown;
type FailHandler = (err: unknown) => Promise<void> | void;

interface Chainable {
    onFail (handler: FailHandler): Chainable;
}

interface RegisteredCheck {
    name: string;
    fn: CheckFn;
    onFailHandlers: FailHandler[];
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
}

export class ServerHealthService extends PuterService {
    #checks: RegisteredCheck[] = [];
    #failures: { name: string }[] = [];
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

    override onServerStart (): void {
        this.#registerDefaultChecks();
        this.#startLoop();
    }

    override onServerPrepareShutdown (): void {
        if ( this.#draining ) return;
        this.#draining = true;
        this.#failures = [];
        this.#lastCycleCompletedAt = Date.now();
        this.#stats = {
            last_check_cycle_completed_at: this.#lastCycleCompletedAt,
            check_durations_ms: {},
            failed_checks: [],
        };
        console.log('[server-health] entering drain mode');
    }

    override onServerShutdown (): void {
        if ( this.#intervalHandle ) {
            clearInterval(this.#intervalHandle);
            this.#intervalHandle = null;
        }
    }

    /**
     * Register a named health check. The returned chainable exposes
     * `onFail(fn)` so callers can hook self-heal logic (e.g., recreating
     * a pooled DB client after a liveness drop).
     */
    addCheck (name: string, fn: CheckFn): Chainable {
        const registered: RegisteredCheck = { name, fn, onFailHandlers: [] };
        this.#checks.push(registered);
        const chainable: Chainable = {
            onFail: (handler) => {
                registered.onFailHandlers.push(handler);
                return chainable;
            },
        };
        return chainable;
    }

    /**
     * Current health status. Results are cached in Redis for 5 seconds
     * so a busy /healthcheck endpoint doesn't hammer the DB on every hit.
     */
    async getStatus (): Promise<HealthStatus> {
        if ( this.#draining ) return { ok: false, failed: ['draining'] };

        try {
            const cached = await this.clients.redis.get(STATUS_CACHE_KEY);
            if ( cached ) {
                try {
                    return JSON.parse(cached) as HealthStatus;
                } catch {
                    // Cache in invalid state — fall through and overwrite.
                }
            }
        } catch (e) {
            console.warn('[server-health] status cache read failed:', (e as Error).message);
        }

        const failures = this.#collectFailures();
        const status: HealthStatus = failures.length === 0
            ? { ok: true }
            : { ok: false, failed: failures };

        try {
            await this.clients.redis.set(
                STATUS_CACHE_KEY,
                JSON.stringify(status),
                'EX',
                STATUS_CACHE_TTL_SECONDS,
            );
        } catch (e) {
            console.warn('[server-health] status cache write failed:', (e as Error).message);
        }

        return status;
    }

    #registerDefaultChecks (): void {
        const latencyFailMs = Number(
            (this.config as unknown as { server_health?: { db_liveness_latency_fail_ms?: number } })
                .server_health?.db_liveness_latency_fail_ms,
        ) || DEFAULT_DB_LIVENESS_LATENCY_FAIL_MS;

        const db = this.clients.db;
        if ( db && typeof db.read === 'function' ) {
            this.addCheck('database-liveness', async () => {
                const startedAt = Date.now();
                const rows = await db.read('SELECT 1 AS ok') as unknown[];
                const durationMs = Date.now() - startedAt;
                this.#stats.database_liveness_latency_ms = durationMs;

                if ( !Array.isArray(rows) || rows.length === 0 ) {
                    throw new Error('database liveness query returned no rows');
                }
                if ( durationMs > latencyFailMs ) {
                    throw new Error(
                        `database liveness latency ${durationMs}ms > threshold ${latencyFailMs}ms`,
                    );
                }
            });
        }

        const socket = this.services.socket as SocketService | undefined;
        if ( socket ) {
            this.addCheck('socket-initialized', () => {
                // Attach happens in `attachHttpServer`, called by PuterServer
                // after http is ready. If the internal io hasn't been set
                // by the time checks start running, something is wrong.
                const check = socket as unknown as { hasIO?: () => boolean };
                if ( typeof check.hasIO === 'function' && !check.hasIO() ) {
                    throw new Error('socket.io is not initialized');
                }
            });
        }
    }

    #startLoop (): void {
        this.#intervalHandle = setInterval(() => {
            if ( this.#loopRunning ) return; // reentrancy guard
            this.#loopRunning = true;
            this.#runCycle().finally(() => { this.#loopRunning = false; });
        }, CHECK_INTERVAL_MS);
        // Don't keep the process alive just for health checks.
        this.#intervalHandle.unref?.();
    }

    async #runCycle (): Promise<void> {
        if ( this.#draining ) {
            this.#lastCycleCompletedAt = Date.now();
            this.#stats.last_check_cycle_completed_at = this.#lastCycleCompletedAt;
            this.#stats.check_durations_ms = {};
            this.#stats.failed_checks = [];
            return;
        }

        const newFailures: { name: string }[] = [];
        const durations: Record<string, number> = {};

        for ( const check of this.#checks ) {
            const startedAt = Date.now();
            let timeoutHandle: NodeJS.Timeout | null = null;
            try {
                await new Promise<void>((resolve, reject) => {
                    timeoutHandle = setTimeout(() => reject(new Error('Health check timed out')), CHECK_TIMEOUT_MS);
                    Promise.resolve(check.fn()).then(() => resolve(), reject);
                });
            } catch ( err ) {
                newFailures.push({ name: check.name });
                const alreadyFailing = this.#failures.some(f => f.name === check.name);
                if ( ! alreadyFailing ) {
                    this.clients.alarm?.create(
                        'health-check-failure',
                        `Health check ${check.name} failed`,
                        { error: err as Error },
                    );
                    for ( const handler of check.onFailHandlers ) {
                        try {
                            await handler(err);
                        } catch ( hErr ) {
                            console.error(`[server-health] onFail handler for ${check.name} threw:`, hErr);
                        }
                    }
                }
                console.error(`[server-health] check "${check.name}" failed:`, err);
            } finally {
                if ( timeoutHandle ) clearTimeout(timeoutHandle);
                durations[check.name] = Date.now() - startedAt;
            }
        }

        this.#failures = newFailures;
        this.#lastCycleCompletedAt = Date.now();
        this.#stats.last_check_cycle_completed_at = this.#lastCycleCompletedAt;
        this.#stats.check_durations_ms = durations;
        this.#stats.failed_checks = newFailures.map(f => f.name);
    }

    #collectFailures (): string[] {
        const names = this.#failures.map(f => f.name);
        const stale = this.#staleLoopFailure();
        if ( stale ) names.push(stale);
        return names;
    }

    #staleLoopFailure (): string | null {
        const staleAfterMs = Number(
            (this.config as unknown as { server_health?: { stale_health_loop_fail_ms?: number } })
                .server_health?.stale_health_loop_fail_ms,
        ) || (CHECK_INTERVAL_MS * HEALTH_LOOP_STALE_MULTIPLIER);
        const now = Date.now();

        if ( this.#lastCycleCompletedAt === 0 ) {
            return (now - this.#healthStartedAt) > staleAfterMs
                ? 'health-check-loop-not-running'
                : null;
        }
        return (now - this.#lastCycleCompletedAt) > staleAfterMs
            ? 'health-check-loop-stale'
            : null;
    }

    /** Snapshot of per-cycle timing + DB latency. */
    getStats (): HealthStats {
        return { ...this.#stats, check_durations_ms: { ...this.#stats.check_durations_ms } };
    }
}
