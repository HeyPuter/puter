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
import { Pool, type PoolConfig, type QueryResult } from 'pg';
import { Span } from '../../util/span.js';
import {
    AbstractDatabaseClient,
    type BatchEntry,
    type WriteResult,
} from './DatabaseClient';
import { compareMigrationFilenames } from './migrationFilenames.js';
import { preparePostgresSql } from './preparePostgresSql.js';
import { splitPostgresStatements } from './splitPostgresStatements.js';
import type { IConfig } from '../../types';

type PostgresEndpointConfig = {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionString?: string;
    url?: string;
};

export interface PostgresQueryable {
    query(query: string, values?: unknown[]): Promise<QueryResult>;
}

export interface PostgresPoolClient extends PostgresQueryable {
    release(): void;
}

export interface PostgresPool extends PostgresQueryable {
    connect(): Promise<PostgresPoolClient>;
    end(): Promise<void>;
}

type PostgresPoolFactory = (poolConfig: PoolConfig) => PostgresPool;

enum Configuration {
    SINGLE,
    REPLICA,
}

const POSTGRES_INT8_OID = 20;
const INTEGER_TEXT_PATTERN = /^-?\d+$/u;

const normalizePostgresInt8 = (
    value: unknown,
    columnName: string,
): number | null | undefined => {
    if (value === null || value === undefined) return value;

    const parsed =
        typeof value === 'bigint'
            ? Number(value)
            : typeof value === 'number'
              ? value
              : typeof value === 'string' && INTEGER_TEXT_PATTERN.test(value)
                ? Number(value)
                : Number.NaN;

    if (!Number.isSafeInteger(parsed)) {
        throw new Error(
            `[postgres] int8 column ${columnName} is outside JavaScript's safe integer range`,
        );
    }

    return parsed;
};

const normalizePostgresRows = (
    result: QueryResult,
): Record<string, unknown>[] => {
    const int8Fields = result.fields.filter(
        (field) => field.dataTypeID === POSTGRES_INT8_OID,
    );
    if (int8Fields.length === 0) {
        return result.rows as Record<string, unknown>[];
    }

    return result.rows.map((row) => {
        const normalized: Record<string, unknown> = { ...row };
        for (const field of int8Fields) {
            normalized[field.name] = normalizePostgresInt8(
                normalized[field.name],
                field.name,
            );
        }
        return normalized;
    });
};

export const mapPostgresWriteResult = (result: QueryResult): WriteResult => {
    const affectedRows = result.rowCount ?? 0;
    const rowId = result.rows[0]?.id;
    const insertId =
        typeof rowId === 'bigint'
            ? rowId
            : typeof rowId === 'number'
              ? rowId
              : typeof rowId === 'string' && rowId !== ''
                ? Number(rowId)
                : 0;
    const normalizedInsertId =
        typeof insertId === 'number' && Number.isNaN(insertId) ? 0 : insertId;

    return {
        insertId: normalizedInsertId,
        affectedRows,
        anyRowsAffected: affectedRows > 0,
    };
};

export class PostgresDatabaseClient extends AbstractDatabaseClient {
    override readonly engineName = 'postgres';

    private primaryPool!: PostgresPool;
    private replicaPool!: PostgresPool;
    private configuration = Configuration.SINGLE;
    private shutdownStarted = false;
    private shutdownTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        config: IConfig,
        private readonly poolFactory: PostgresPoolFactory = (poolConfig) =>
            new Pool(poolConfig) as unknown as PostgresPool,
    ) {
        super(config);
    }

    override async onServerStart(): Promise<void> {
        const dbConf = this.config.database!;

        this.primaryPool = this.createPool(dbConf);
        await this.primaryPool.query('SELECT 1');
        console.log('[postgres] connected to primary');

        if (dbConf.replica) {
            this.replicaPool = this.createPool(dbConf.replica);
            await this.replicaPool.query('SELECT 1');
            this.configuration = Configuration.REPLICA;
            console.log('[postgres] connected to read-replica');
        } else {
            this.replicaPool = this.primaryPool;
            this.configuration = Configuration.SINGLE;
        }

        await this.runMigrations();
    }

    override async onServerPrepareShutdown(): Promise<void> {
        if (this.shutdownStarted) return;
        this.shutdownStarted = true;

        const drainMs = 60_000;
        console.log(
            `[postgres] draining in-flight queries (${drainMs}ms) before closing pools`,
        );

        this.shutdownTimer = setTimeout(() => {
            this.shutdownTimer = null;
            this.closeCurrentPools().catch((e) =>
                console.error('[postgres] error closing pools after drain', e),
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
        await this.closeCurrentPools();
    }

    override quoteIdentifier(identifier: string): string {
        return identifier
            .split('.')
            .map((part) => {
                if (part === '*') return part;
                return `"${part.replaceAll('"', '""')}"`;
            })
            .join('.');
    }

    override booleanLiteral(value: boolean): string {
        return value ? 'TRUE' : 'FALSE';
    }

    override booleanValue(value: boolean): boolean {
        return value;
    }

    @Span('db.read', (query: string) => ({ 'db.statement': query }))
    override async read(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const result = await this.query(this.replicaPool, query, params);
        return normalizePostgresRows(result);
    }

    @Span('db.pread', (query: string) => ({ 'db.statement': query }))
    override async pread(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const result = await this.query(this.primaryPool, query, params);
        return normalizePostgresRows(result);
    }

    @Span('db.write', (query: string) => ({ 'db.statement': query }))
    override async write(
        query: string,
        params: unknown[] = [],
    ): Promise<WriteResult> {
        const result = await this.query(this.primaryPool, query, params);
        return mapPostgresWriteResult(result);
    }

    @Span('db.batchWrite', (entries: unknown[]) => ({
        'db.batch_size': entries.length,
    }))
    override async batchWrite(entries: BatchEntry[]): Promise<void> {
        if (entries.length === 0) return;

        const conn = await this.primaryPool.connect();
        try {
            await conn.query('BEGIN');
            try {
                for (const { statement, values } of entries) {
                    await this.query(conn, statement, values);
                }
                await conn.query('COMMIT');
            } catch (err) {
                await conn.query('ROLLBACK').catch(() => {});
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

        const primaryPromise = this.query(this.primaryPool, query, params);
        try {
            const replicaResult = await this.query(
                this.replicaPool,
                query,
                params,
            );
            if (replicaResult.rows.length > 0) {
                primaryPromise.catch(() => {});
                return normalizePostgresRows(replicaResult);
            }
        } catch {
            // fall through to primary
        }

        const primaryResult = await primaryPromise;
        return normalizePostgresRows(primaryResult);
    }

    private async runMigrations(): Promise<void> {
        const paths = this.config.database?.migrationPaths;
        if (!paths || paths.length === 0) return;

        const conn = await this.primaryPool.connect();
        try {
            for (const rawPath of paths) {
                const dir = isAbsolute(rawPath)
                    ? rawPath
                    : resolvePath(process.cwd(), rawPath);

                let files: string[];
                try {
                    files = readdirSync(dir)
                        .filter(
                            (f) =>
                                f.endsWith('.sql') && f.startsWith('postgres'),
                        )
                        .sort(compareMigrationFilenames);
                } catch (e) {
                    throw new Error(
                        `[postgres] migration path is unreadable: ${dir}`,
                        { cause: e },
                    );
                }

                if (files.length === 0) {
                    console.log(`[postgres] no migrations in ${dir}`);
                    continue;
                }

                console.log(
                    `[postgres] running migrations from ${dir}: ${files.length} file(s)`,
                );

                for (const file of files) {
                    const filePath = resolvePath(dir, file);
                    const contents = readFileSync(filePath, 'utf8');
                    const statements = splitPostgresStatements(contents);
                    await conn.query('BEGIN');
                    try {
                        for (let i = 0; i < statements.length; i++) {
                            try {
                                await conn.query(statements[i]);
                            } catch (e) {
                                throw new Error(
                                    `[postgres] failed to apply ${file} at statement ${i}`,
                                    { cause: e },
                                );
                            }
                        }
                        await conn.query('COMMIT');
                    } catch (e) {
                        await conn.query('ROLLBACK').catch(() => {});
                        throw e;
                    }
                    console.log(
                        `[postgres] applied ${file} (${statements.length} statements)`,
                    );
                }
            }
        } finally {
            conn.release();
        }
    }

    private createPool(dbConf: PostgresEndpointConfig): PostgresPool {
        const connectionString = dbConf.connectionString ?? dbConf.url;
        if (connectionString) {
            return this.poolFactory({
                connectionString,
                max: 30,
            });
        }

        return this.poolFactory({
            host: dbConf.host ?? '127.0.0.1',
            port: dbConf.port ?? 5432,
            user: dbConf.user ?? 'postgres',
            password: dbConf.password ?? '',
            database: dbConf.database ?? 'puter',
            max: 30,
        });
    }

    private async query(
        target: PostgresQueryable,
        query: string,
        params: unknown[] = [],
    ): Promise<QueryResult> {
        const prepared = preparePostgresSql(query);
        return target.query(prepared.text, params);
    }

    private async closeCurrentPools(): Promise<void> {
        const tasks: Promise<void>[] = [];
        if (this.primaryPool) tasks.push(this.primaryPool.end());
        if (this.replicaPool && this.replicaPool !== this.primaryPool) {
            tasks.push(this.replicaPool.end());
        }
        await Promise.all(tasks);
    }
}
