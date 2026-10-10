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

import { metrics } from '@opentelemetry/api';
import { createPool, ExecuteValues, type Pool } from 'mysql2';
import { Span } from '../../util/span.js';
import { AbstractDatabaseClient, type WriteResult } from './DatabaseClient';
import { SQLBatcher } from './SQLBatcher.js';
import { isRetriableError } from './retriableErrors.js';
import { splitMysqlStatements } from './splitMysqlStatements.js';
import type { IConfig } from '../../types';

const DEFAULT_SELECT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_LIMIT = 30;
const IDLE_TIMEOUT_MS = 60_000;

const replicaFailoverCounter = metrics
    .getMeter('puter-backend')
    .createCounter('db.read.replica_failover', {
        description:
            'Reads that failed on the replica batcher and were retried on the primary',
    });

export { compareMigrationFilenames } from './migrationFilenames.js';

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
    /** Primary pool, SELECT-only: same rows as `db`, coalesced like the replica. */
    private dbPrimaryRead!: SQLBatcher;
    private configuration = Configuration.SINGLE;
    private shutdownStarted = false;

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
        this.dbPrimaryRead = this.createPrimaryReadBatcher(this.primaryPool);

        if (dbConf.replica) {
            this.replicaPool = this.createPool(dbConf.replica);
            this.configuration = Configuration.REPLICA;
            console.log('[mysql] connected to read-replica');
        } else {
            this.replicaPool = this.primaryPool;
            this.configuration = Configuration.SINGLE;
        }

        this.dbReplica = this.createReplicaBatcher(this.replicaPool);

        await this.applyMigrationPaths(
            () => this.primaryPool.promise().getConnection(),
            splitMysqlStatements,
            { transactional: false },
        );
    }

    override async onServerPrepareShutdown(): Promise<void> {
        if (this.shutdownStarted) return;
        this.shutdownStarted = true;

        // Pools stay open; onServerShutdown closes them after the layers
        // above have drained.
        console.log('[mysql] entering drain mode');
    }

    override async onServerShutdown(): Promise<void> {
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
            result = await this.dbPrimaryRead.execute(query, params);
        }
        if (!result) return [];
        return (result[0] as Record<string, unknown>[]) ?? [];
    }

    @Span('db.pread', (query: string) => ({ 'db.statement': query }))
    override async pread(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const result = await this.dbPrimaryRead.execute(query, params);
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
                    await conn.execute(statement, values as ExecuteValues);
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

    protected override hasReadReplica(): boolean {
        return this.configuration === Configuration.REPLICA;
    }

    // ------------------------------------------------------------------
    // Pool management
    // ------------------------------------------------------------------

    private createPool(poolConfig: PoolConfig): Pool {
        const connectionLimit =
            poolConfig.connectionLimit ?? DEFAULT_CONNECTION_LIMIT;
        const pool = createPool({
            maxPreparedStatements: 900,
            connectionLimit,
            // mysql2 only reaps idle connections when maxIdle < connectionLimit.
            // Unreaped, they sit until the server's wait_timeout closes them,
            // and the next statement sent on one fails. 0 means unlimited,
            // and a negative maxIdle would crash the reaper.
            ...(connectionLimit > 1 && { maxIdle: connectionLimit - 1 }),
            idleTimeout: IDLE_TIMEOUT_MS,
            // Reaped connections say goodbye instead of dropping the socket.
            gracefulEnd: true,
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

    /**
     * One write per flush. Coalesced writes share a transaction, so unrelated
     * callers hold each other's row locks until COMMIT and deadlock; a lone
     * statement needs no BEGIN/COMMIT round trips.
     */
    private createPrimaryBatcher(pool: Pool): SQLBatcher {
        return new SQLBatcher(pool, {
            maxBatchSize: 1,
            poolLabel: 'primary',
            acquireTimeoutMs: this.config.database?.acquireTimeoutMs,
        });
    }

    /** Reads that must see the primary, still coalesced. */
    private createPrimaryReadBatcher(pool: Pool): SQLBatcher {
        return new SQLBatcher(pool, {
            maxTimeInQueue: 30,
            maxBatchSize: 5,
            poolLabel: 'primary',
            readOnly: true,
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

    /**
     * Replica failures worth retrying on the primary: batcher load-shed or
     * transient connection errors — never deterministic SQL errors.
     */
    private static isFailoverWorthy(error: unknown): boolean {
        const code = (error as { code?: string })?.code;
        return code === 'dbBatchFailed' || isRetriableError(error);
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
