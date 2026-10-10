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

import { readdirSync, readFileSync } from 'fs';
import { isAbsolute, resolve as resolvePath } from 'path';
import type { IConfig } from '../../types';
import { Span } from '../../util/span.js';
import { PuterClient } from '../types';
import { compareMigrationFilenames } from './migrationFilenames.js';

export interface WriteResult {
    insertId: number | bigint;
    affectedRows: number;
    anyRowsAffected: boolean;
}

export interface BatchEntry {
    statement: string;
    values: unknown[];
}

type SqlJsonPath = readonly [string, ...string[]];

/** The slice of a pooled connection that migrations need. */
export interface MigrationConnection {
    query(sql: string): Promise<unknown>;
    release(): void;
}

/**
 * Base database client. Subclasses must override every method that throws here.
 *
 * Do not instantiate directly — use the factory exported from
 * `clients/database/index.ts` which picks the right implementation based on
 * `config.database.engine`.
 */
export class AbstractDatabaseClient extends PuterClient {
    /** Short name used by `case()` to pick engine-specific values. */
    readonly engineName: string = '';

    constructor(config: IConfig) {
        super(config);
    }

    // ------------------------------------------------------------------
    // Abstract interface — subclasses MUST override
    // ------------------------------------------------------------------

    /** Execute a read query. Returns an array of row objects. */
    async read(
        _query: string,
        _params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        throw new Error('DatabaseClient.read() not implemented');
    }

    /**
     * Read that prefers the primary database (useful when read-replicas may
     * have replication lag). In single-node setups this is identical to
     * `read()`.
     */
    async pread(
        _query: string,
        _params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        throw new Error('DatabaseClient.pread() not implemented');
    }

    /** Execute a write query (INSERT / UPDATE / DELETE). */
    async write(_query: string, _params: unknown[] = []): Promise<WriteResult> {
        throw new Error('DatabaseClient.write() not implemented');
    }

    /** Execute multiple write statements in a single transaction. */
    async batchWrite(_entries: BatchEntry[]): Promise<void> {
        throw new Error('DatabaseClient.batchWrite() not implemented');
    }

    // ------------------------------------------------------------------
    // Shared helpers (rely on the abstract methods above)
    // ------------------------------------------------------------------

    /**
     * Generate and execute an INSERT statement from a table name and a
     * key/value data object.
     */
    async insert(
        tableName: string,
        data: Record<string, unknown>,
    ): Promise<WriteResult> {
        const cols = Object.keys(data);
        const values = Object.values(data);
        const sql =
            `INSERT INTO ${this.quoteIdentifier(tableName)} ` +
            `(${cols.map((c) => this.quoteIdentifier(c)).join(', ')}) ` +
            `VALUES (${cols.map(() => '?').join(', ')})` +
            this.returningIdClause();
        return this.write(sql, values);
    }

    /** Whether `read()` goes to a separate replica rather than the primary. */
    protected hasReadReplica(): boolean {
        return false;
    }

    /**
     * Like `read()`, but an empty or failed replica read falls back to the
     * primary, so replication lag can't hide a row that was just written. The
     * primary read starts alongside the replica one rather than after it.
     * Without a replica this is a single `read()`.
     */
    @Span('db.tryHardRead', (query: string) => ({ 'db.statement': query }))
    async tryHardRead(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        if (!this.hasReadReplica()) return this.read(query, params);

        const primary = settle(this.pread(query, params));
        try {
            const rows = await this.read(query, params);
            if (rows.length > 0) return rows;
        } catch {
            // replica failed — fall through to primary
        }
        const result = await primary;
        if ('error' in result) throw result.error;
        return result.value;
    }

    /**
     * Apply the `.sql` files named `<engineName>*` in each configured migration
     * directory, in filename order. Files must be idempotent: nothing records
     * which ones already ran. A failure aborts startup. `transactional` wraps
     * each file in BEGIN/COMMIT, for engines whose DDL can roll back.
     */
    protected async applyMigrationPaths(
        connect: () => Promise<MigrationConnection>,
        splitStatements: (contents: string) => string[],
        { transactional }: { transactional: boolean },
    ): Promise<void> {
        const paths = this.config.database?.migrationPaths;
        if (!paths || paths.length === 0) return;

        const tag = `[${this.engineName}]`;
        const conn = await connect();
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
                                f.endsWith('.sql') &&
                                f.startsWith(this.engineName),
                        )
                        .sort(compareMigrationFilenames);
                } catch (e) {
                    throw new Error(
                        `${tag} migration path is unreadable: ${dir}`,
                        {
                            cause: e,
                        },
                    );
                }

                if (files.length === 0) {
                    console.log(`${tag} no migrations in ${dir}`);
                    continue;
                }

                console.log(
                    `${tag} running migrations from ${dir}: ${files.length} file(s)`,
                );

                for (const file of files) {
                    const contents = readFileSync(
                        resolvePath(dir, file),
                        'utf8',
                    );
                    const statements = splitStatements(contents);
                    if (transactional) await conn.query('BEGIN');
                    try {
                        for (let i = 0; i < statements.length; i++) {
                            try {
                                await conn.query(statements[i]);
                            } catch (e) {
                                throw new Error(
                                    `${tag} failed to apply ${file} at statement ${i}`,
                                    { cause: e },
                                );
                            }
                        }
                        if (transactional) await conn.query('COMMIT');
                    } catch (e) {
                        if (transactional) {
                            try {
                                await conn.query('ROLLBACK');
                            } catch {
                                // the original failure is the one worth surfacing
                            }
                        }
                        throw e;
                    }
                    console.log(
                        `${tag} applied ${file} (${statements.length} statements)`,
                    );
                }
            }
        } finally {
            conn.release();
        }
    }

    /**
     * Return the value from `choices` that matches the current engine.
     *
     * Usage:
     *
     *     db.case({
     *         sqlite: "datetime('now')",
     *         mysql: 'NOW()',
     *         otherwise: 'NOW()',
     *     });
     *
     * If the engine name isn't present in `choices`, falls back to
     * `choices.otherwise`.
     */
    case<T>(choices: Record<string, T> & { otherwise?: T }): T {
        if (Object.prototype.hasOwnProperty.call(choices, this.engineName)) {
            return choices[this.engineName];
        }
        return choices.otherwise as T;
    }

    quoteIdentifier(identifier: string): string {
        return identifier
            .split('.')
            .map((part) => {
                if (part === '*') return part;
                return `\`${part.replaceAll('`', '``')}\``;
            })
            .join('.');
    }

    booleanLiteral(value: boolean): string {
        return value ? '1' : '0';
    }

    booleanValue(value: boolean): boolean | 0 | 1 {
        return value ? 1 : 0;
    }

    insertIgnoreInto(tableName: string): string {
        const table = this.quoteIdentifier(tableName);
        return this.case({
            sqlite: `INSERT OR IGNORE INTO ${table}`,
            postgres: `INSERT INTO ${table}`,
            otherwise: `INSERT IGNORE INTO ${table}`,
        });
    }

    insertIgnoreSuffix(): string {
        return this.case({
            postgres: ' ON CONFLICT DO NOTHING',
            otherwise: '',
        });
    }

    upsertClause(
        conflictColumns: readonly string[],
        updateColumns: readonly string[],
    ): string {
        if (updateColumns.length === 0) {
            throw new Error('upsertClause requires at least one update column');
        }

        const updateList = updateColumns
            .map((column) => `${this.quoteIdentifier(column)} = ?`)
            .join(', ');

        return this.case({
            mysql: `ON DUPLICATE KEY UPDATE ${updateList}`,
            otherwise: `ON CONFLICT(${conflictColumns
                .map((column) => this.quoteIdentifier(column))
                .join(', ')}) DO UPDATE SET ${updateList}`,
        });
    }

    jsonTextExtract(jsonExpression: string, path: SqlJsonPath): string {
        const sqlitePath = `$${path.map((part) => `.${part}`).join('')}`;
        return this.case({
            sqlite: `json_extract(${jsonExpression}, ${this.sqlStringLiteral(sqlitePath)})`,
            mysql: `JSON_UNQUOTE(JSON_EXTRACT(${jsonExpression}, ${this.sqlStringLiteral(sqlitePath)}))`,
            postgres: `${jsonExpression} #>> ARRAY[${path
                .map((part) => this.sqlStringLiteral(part))
                .join(', ')}]`,
            otherwise: `JSON_UNQUOTE(JSON_EXTRACT(${jsonExpression}, ${this.sqlStringLiteral(sqlitePath)}))`,
        });
    }

    nullCoalesce(...expressions: readonly string[]): string {
        if (expressions.length === 0) {
            throw new Error('nullCoalesce requires at least one expression');
        }
        return `COALESCE(${expressions.join(', ')})`;
    }

    returningIdClause(): string {
        return this.case({
            postgres: ' RETURNING id',
            otherwise: '',
        });
    }

    protected sqlStringLiteral(value: string): string {
        return `'${value.replaceAll("'", "''")}'`;
    }
}

/** Await later without an unhandled rejection in the meantime. */
const settle = async <T>(
    promise: Promise<T>,
): Promise<{ value: T } | { error: unknown }> => {
    try {
        return { value: await promise };
    } catch (error) {
        return { error };
    }
};
