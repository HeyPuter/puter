/**
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

import { readdirSync, readFileSync } from 'fs';
import { isAbsolute, resolve as resolvePath } from 'path';
import { metrics } from '@opentelemetry/api';
import { createPool, type Pool } from 'mysql2';
import { Span } from '../../util/span.js';
import { AbstractDatabaseClient, type WriteResult } from './DatabaseClient';
import { SQLBatcher } from './SQLBatcher.js';
import { isRetriableError } from './retriableErrors.js';
import { splitMysqlStatements } from './splitMysqlStatements.js';
import { compareMigrationFilenames } from './migrationFilenames.js';
import type { IConfig } from '../../types';

const DEFAULT_SELECT_TIMEOUT_MS = 30_000;

const replicaFailoverCounter = metrics
    .getMeter('puter-backend')
    .createCounter('db.read.replica_failover', {
        description:
            'Reads that failed on the replica batcher and were retried on the primary',
    });

export { compareMigrationFilenames };

type PoolConfig = Parameters<typeof createPool>[0];

enum Configuration {
    SINGLE,
    REPLICA,
}

export class MySQLDatabaseClient extends AbstractDatabaseClient {
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

        this.db = this.createPrimaryBatcher(this.primaryPool);

        if (dbConf.replica) {
            this.replicaPool = this.createPool(dbConf.replica);
            this.configuration = Configuration.REPLICA;
            console.log('[mysql] connected to read-replica');
        } else {
            this.replicaPool = this.primaryPool;
            this.configuration = Configuration.SINGLE;
        }

        this.dbReplica = this.createReplicaBatcher(this.replicaPool);

        await this.runMigrations();
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

    // The db.* spans measure the logical query, including time queued in
    // the SQLBatcher — the mysql2 auto-instrumentation only sees the
    // coalesced multi-statement flush, so per-query latency lives here.
    @Span('db.read', (query: string) => ({ 'db.statement': query }))
    override async read(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        let result;
        try {
            result = await this.dbReplica.execute(query, params);
        } catch (error) {
            // Replica-side degradation (batcher load-shed or a transient
            // connection failure) shouldn't fail reads while the primary is
            // healthy. Deterministic errors (bad SQL) are rethrown — they
            // would fail identically on the primary.
            if (
                this.configuration !== Configuration.REPLICA ||
                !MySQLDatabaseClient.isFailoverWorthy(error)
            ) {
                throw error;
            }
            replicaFailoverCounter.add(1);
            result = await this.db.execute(query, params);
        }
        if (!result) return [];
        return (result[0] as Record<string, unknown>[]) ?? [];
    }

    @Span('db.pread', (query: string) => ({ 'db.statement': query }))
    override async pread(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const result = await this.db.execute(query, params);
        if (!result) return [];
        return (result[0] as Record<string, unknown>[]) ?? [];
    }

    @Span('db.write', (query: string) => ({ 'db.statement': query }))
    override async write(
        query: string,
        params: unknown[] = [],
    ): Promise<WriteResult> {
        const result = await this.db.execute(query, params);
        const header = result[0] as {
            insertId?: number;
            affectedRows?: number;
        };
        const affectedRows = header.affectedRows ?? 0;
        return {
            insertId: header.insertId ?? 0,
            affectedRows,
            anyRowsAffected: affectedRows > 0,
        };
    }

    @Span('db.batchWrite', (entries: unknown[]) => ({
        'db.batch_size': entries.length,
    }))
    override async batchWrite(
        entries: { statement: string; values: unknown[] }[],
    ): Promise<void> {
        if (entries.length === 0) return;
        // Bypass the SQLBatcher: it coalesces queries from unrelated callers
        // into a single multi-statement string, which is incompatible with
        // wrapping a transaction around just *our* statements. Acquire a
        // dedicated connection so BEGIN/COMMIT/ROLLBACK only scope `entries`.
        const conn = await this.primaryPool.promise().getConnection();
        try {
            await conn.beginTransaction();
            try {
                for (const { statement, values } of entries) {
                    await conn.execute(statement, values);
                }
                await conn.commit();
            } catch (err) {
                await conn.rollback().catch(() => {});
                throw err;
            }
        } finally {
            conn.release();
        }
    }

    @Span('db.tryHardRead', (query: string) => ({ 'db.statement': query }))
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
    // Migrations
    // ------------------------------------------------------------------

    /**
     * Apply `.sql` files from each configured migration directory in order.
     * Files within a directory are sorted lexically. Files MUST be
     * idempotent — there is no per-file applied-state tracking. Failures
     * abort startup so operators see schema problems loud.
     */
    private async runMigrations(): Promise<void> {
        const paths = this.config.database?.migrationPaths;
        if (!paths || paths.length === 0) return;

        const conn = await this.primaryPool.promise().getConnection();
        try {
            for (const rawPath of paths) {
                const dir = isAbsolute(rawPath)
                    ? rawPath
                    : resolvePath(process.cwd(), rawPath);

                let files: string[];
                try {
                    files = readdirSync(dir)
                        .filter(
                            (f) => f.endsWith('.sql') && f.startsWith('mysql'),
                        )
                        .sort(compareMigrationFilenames);
                } catch (e) {
                    throw new Error(
                        `[mysql] migration path is unreadable: ${dir}`,
                        { cause: e },
                    );
                }

                if (files.length === 0) {
                    console.log(`[mysql] no migrations in ${dir}`);
                    continue;
                }

                console.log(
                    `[mysql] running migrations from ${dir}: ${files.length} file(s)`,
                );

                for (const file of files) {
                    const filePath = resolvePath(dir, file);
                    const contents = readFileSync(filePath, 'utf8');
                    const statements = splitMysqlStatements(contents);
                    for (let i = 0; i < statements.length; i++) {
                        try {
                            await conn.query(statements[i]);
                        } catch (e) {
                            throw new Error(
                                `[mysql] failed to apply ${file} at statement ${i}`,
                                { cause: e },
                            );
                        }
                    }
                    console.log(
                        `[mysql] applied ${file} (${statements.length} statements)`,
                    );
                }
            }
        } finally {
            conn.release();
        }
    }

    // ------------------------------------------------------------------
    // Pool management
    // ------------------------------------------------------------------

    private createPool(poolConfig: PoolConfig): Pool {
        const pool = createPool({
            maxPreparedStatements: 900,
            connectionLimit: 30,
            enableKeepAlive: true,
            ...poolConfig,
            multipleStatements: true,
        } as PoolConfig);

        // Server-side kill switch for runaway reads: MySQL applies
        // max_execution_time to SELECT statements only, so this is
        // write-safe. Without it, a stalled database turns reads into
        // indefinite hangs that no client-side timeout ever converts
        // into a failure. 0 disables.
        const selectTimeoutMs = Math.floor(
            Number(
                this.config.database?.selectTimeoutMs ??
                    DEFAULT_SELECT_TIMEOUT_MS,
            ),
        );
        if (selectTimeoutMs > 0) {
            pool.on('connection', (conn) => {
                conn.query(
                    `SET SESSION max_execution_time = ${selectTimeoutMs}`,
                );
            });
        }

        return pool;
    }

    private createPrimaryBatcher(pool: Pool): SQLBatcher {
        return new SQLBatcher(pool, {
            maxTimeInQueue: 30,
            maxBatchSize: 5,
            poolLabel: 'primary',
            acquireTimeoutMs: this.config.database?.acquireTimeoutMs,
        });
    }

    private createReplicaBatcher(pool: Pool): SQLBatcher {
        return new SQLBatcher(pool, {
            maxTimeInQueue: 10,
            maxBatchSize: 5,
            poolLabel: 'replica',
            readOnly: true,
            acquireTimeoutMs: this.config.database?.acquireTimeoutMs,
        });
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
        this.db = this.createPrimaryBatcher(this.primaryPool);

        if (this.configuration === Configuration.SINGLE) {
            this.replicaPool = this.primaryPool;
            this.dbReplica = this.createReplicaBatcher(this.primaryPool);
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
        this.dbReplica = this.createReplicaBatcher(this.replicaPool);

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
        return isRetriableError(error);
    }

    /** Replica failures worth retrying on the primary: batcher load-shed
     *  or transient connection errors — never deterministic SQL errors. */
    private static isFailoverWorthy(error: unknown): boolean {
        const code = (error as { code?: string })?.code;
        return code === 'dbBatchFailed' || isRetriableError(error);
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
