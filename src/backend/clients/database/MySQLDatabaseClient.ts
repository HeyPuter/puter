import { createPool, type Pool } from 'mysql2';
import { DatabaseClient, type WriteResult } from './DatabaseClient';
import { SQLBatcher } from './SQLBatcher.js';
import type { IConfig } from '../../types';

const RETRIABLE_ERROR_CODES = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
]);

const RETRIABLE_ERROR_MESSAGES = [
    'Connection lost',
    'read ECONNRESET',
    'ETIMEDOUT',
];

type PoolConfig = Parameters<typeof createPool>[0];

enum Configuration {
    SINGLE,
    REPLICA,
}

export class MySQLDatabaseClient extends DatabaseClient {
    override readonly engineName = 'mysql';

    private primaryPool!: Pool;
    private replicaPool!: Pool;
    private db!: SQLBatcher;
    private dbReplica!: SQLBatcher;
    private configuration = Configuration.SINGLE;
    private shutdownStarted = false;
    private shutdownTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: IConfig) {
        super(config);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    override async onServerStart(): Promise<void> {
        const dbConf = this.config.database!;

        this.primaryPool = this.createPool({
            host: dbConf.host ?? '127.0.0.1',
            port: dbConf.port ?? 3306,
            user: dbConf.user ?? 'root',
            password: dbConf.password ?? '',
            database: dbConf.database ?? 'puter',
        });
        console.log('[mysql] connected to primary');

        this.db = new SQLBatcher(this.primaryPool, 40);

        if (dbConf.replica) {
            this.replicaPool = this.createPool(dbConf.replica);
            this.configuration = Configuration.REPLICA;
            console.log('[mysql] connected to read-replica');
        } else {
            this.replicaPool = this.primaryPool;
            this.configuration = Configuration.SINGLE;
        }

        this.dbReplica = new SQLBatcher(this.replicaPool, 10);
    }

    override async onServerPrepareShutdown(): Promise<void> {
        if (this.shutdownStarted) return;
        this.shutdownStarted = true;

        // Allow in-flight queries to drain before closing pools
        const drainMs = 60_000;
        console.log(
            `[mysql] draining in-flight queries (${drainMs}ms) before closing pools`,
        );

        this.shutdownTimer = setTimeout(() => {
            this.shutdownTimer = null;
            this.closeCurrentPools('drain').catch((e) =>
                console.error('[mysql] error closing pools after drain', e),
            );
        }, drainMs);

        if (typeof this.shutdownTimer.unref === 'function') {
            this.shutdownTimer.unref();
        }
    }

    override async onServerShutdown(): Promise<void> {
        if (this.shutdownTimer) {
            clearTimeout(this.shutdownTimer);
            this.shutdownTimer = null;
        }
        await this.closeCurrentPools('shutdown');
    }

    // ------------------------------------------------------------------
    // Query interface
    // ------------------------------------------------------------------

    override async read(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const result = await this.dbReplica.execute(query, params);
        if (!result) return [];
        return (result[0] as Record<string, unknown>[]) ?? [];
    }

    override async pread(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const result = await this.db.execute(query, params);
        if (!result) return [];
        return (result[0] as Record<string, unknown>[]) ?? [];
    }

    override async write(
        query: string,
        params: unknown[] = [],
    ): Promise<WriteResult> {
        const result = await this.db.execute(query, params);
        const header = result[0] as {
            insertId?: number;
            affectedRows?: number;
        };
        return {
            insertId: header.insertId ?? 0,
            anyRowsAffected: (header.affectedRows ?? 0) > 0,
        };
    }

    override async batchWrite(
        entries: { statement: string; values: unknown[] }[],
    ): Promise<void> {
        const stmts = entries.map((e) => e.statement).join('; ');
        const vals = entries.flatMap((e) => e.values);
        await this.db.execute(stmts, vals);
    }

    override async tryHardRead(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        if (this.configuration === Configuration.SINGLE) {
            return this.read(query, params);
        }

        // Run both reads in parallel — prefer replica when it returns rows,
        // otherwise fall back to primary to handle replication lag.
        const primaryPromise = this.db.execute(query, params);
        try {
            const replicaResult = await this.dbReplica.execute(query, params);
            if (
                Array.isArray(replicaResult?.[0]) &&
                (replicaResult[0] as unknown[]).length > 0
            ) {
                primaryPromise.catch(() => {}); // suppress unhandled rejection
                return replicaResult[0] as Record<string, unknown>[];
            }
        } catch {
            // fall through to primary
        }

        const primaryResult = await primaryPromise;
        return (primaryResult?.[0] as Record<string, unknown>[]) ?? [];
    }

    // ------------------------------------------------------------------
    // Pool management
    // ------------------------------------------------------------------

    private createPool(poolConfig: PoolConfig): Pool {
        return createPool({
            maxPreparedStatements: 900,
            ...poolConfig,
            multipleStatements: true,
        } as PoolConfig);
    }

    /** Reinitialize the primary pool (e.g. after a health-check failure). */
    reinitPrimary(): void {
        if (this.shutdownStarted) return;

        const dbConf = this.config.database!;
        const previous = this.primaryPool;
        this.primaryPool = this.createPool({
            host: dbConf.host ?? '127.0.0.1',
            port: dbConf.port ?? 3306,
            user: dbConf.user ?? 'root',
            password: dbConf.password ?? '',
            database: dbConf.database ?? 'puter',
        });
        this.db = new SQLBatcher(this.primaryPool, 40);

        if (this.configuration === Configuration.SINGLE) {
            this.replicaPool = this.primaryPool;
            this.dbReplica = new SQLBatcher(this.primaryPool, 10);
        }

        if (previous && previous !== this.primaryPool) {
            this.closePool(previous, 'reinit:primary').catch(() => {});
        }
    }

    /** Reinitialize the replica pool. */
    reinitReplica(): void {
        if (this.shutdownStarted || !this.config.database?.replica) return;

        const previous = this.replicaPool;
        this.replicaPool = this.createPool(this.config.database.replica);
        this.dbReplica = new SQLBatcher(this.replicaPool, 10);

        if (
            previous &&
            previous !== this.replicaPool &&
            previous !== this.primaryPool
        ) {
            this.closePool(previous, 'reinit:replica').catch(() => {});
        }
    }

    // ------------------------------------------------------------------
    // Retry helpers (for health checks or resilient reads)
    // ------------------------------------------------------------------

    static isRetriableError(error: unknown): boolean {
        const code = (error as { code?: string })?.code;
        if (code && RETRIABLE_ERROR_CODES.has(code)) return true;

        const msg = String((error as Error)?.message ?? '');
        return RETRIABLE_ERROR_MESSAGES.some((m) => msg.includes(m));
    }

    async readWithRetry(
        label: string,
        operation: () => Promise<unknown[]>,
        opts?: {
            maxAttempts?: number;
            baseBackoffMs?: number;
            maxBackoffMs?: number;
            jitterRatio?: number;
        },
    ): Promise<unknown[]> {
        const maxAttempts = opts?.maxAttempts ?? 3;
        const baseBackoffMs = opts?.baseBackoffMs ?? 100;
        const maxBackoffMs = opts?.maxBackoffMs ?? 500;
        const jitterRatio = opts?.jitterRatio ?? 0.2;

        let attempt = 1;

        while (true) {
            try {
                return await operation();
            } catch (error) {
                if (this.shutdownStarted) throw error;
                if (
                    attempt >= maxAttempts ||
                    !MySQLDatabaseClient.isRetriableError(error)
                )
                    throw error;

                const raw = baseBackoffMs * 2 ** (attempt - 1);
                const capped = Math.min(maxBackoffMs, raw);
                const window = Math.round(capped * jitterRatio);
                const jitter =
                    window === 0
                        ? 0
                        : Math.floor(Math.random() * (window * 2 + 1)) - window;
                const delay = Math.max(0, capped + jitter);

                console.warn(
                    `[${label}] transient mysql error (${(error as { code?: string })?.code ?? 'unknown'}); retry ${attempt + 1}/${maxAttempts} in ${delay}ms`,
                );
                await new Promise((r) => setTimeout(r, delay));
                attempt++;
            }
        }
    }

    // ------------------------------------------------------------------
    // Internal pool lifecycle
    // ------------------------------------------------------------------

    private async closePool(
        pool: Pool,
        label: string,
        timeoutMs: number | null = null,
    ): Promise<void> {
        if (!pool) return;

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const finish = (err?: unknown) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (err) reject(err);
                else resolve();
            };

            if (timeoutMs !== null) {
                timer = setTimeout(() => {
                    console.warn(
                        `[mysql] timed out closing pool (${label}); forcing`,
                    );
                    this.forceDestroyConnections(pool, `${label}:timeout`);
                    finish();
                }, timeoutMs);
            }

            try {
                pool.end((err) => finish(err));
            } catch (err) {
                finish(err);
            }
        });
    }

    private forceDestroyConnections(pool: Pool, label: string): void {
        // mysql2 internal — _allConnections is a CircularBuffer
        const all = (
            pool as unknown as {
                _allConnections?: {
                    forEach: (fn: (c: { destroy: () => void }) => void) => void;
                };
            }
        )._allConnections;
        if (!all || typeof all.forEach !== 'function') return;

        let count = 0;
        all.forEach((conn) => {
            try {
                conn.destroy();
                count++;
            } catch {
                // no-op
            }
        });
        if (count > 0)
            console.warn(
                `[mysql] force-closed ${count} connections (${label})`,
            );
    }

    private async closeCurrentPools(reason: string): Promise<void> {
        const timeoutMs = reason.startsWith('signal:') ? 45_000 : null;
        const tasks: Promise<void>[] = [];

        if (this.primaryPool) {
            tasks.push(
                this.closePool(
                    this.primaryPool,
                    `${reason}:primary`,
                    timeoutMs,
                ),
            );
        }
        if (this.replicaPool && this.replicaPool !== this.primaryPool) {
            tasks.push(
                this.closePool(
                    this.replicaPool,
                    `${reason}:replica`,
                    timeoutMs,
                ),
            );
        }

        await Promise.all(tasks);
    }
}
