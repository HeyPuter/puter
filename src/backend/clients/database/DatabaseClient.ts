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

import type { IConfig } from '../../types';
import { PuterClient } from '../types';

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

/**
 * Base database client. Subclasses must override every method that throws here.
 *
 * Do not instantiate directly — use the factory exported from
 * `clients/database/index.ts` which picks the right implementation
 * based on `config.database.engine`.
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

    /**
     * Execute a read query. Returns an array of row objects.
     */
    async read(
        _query: string,
        _params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        throw new Error('DatabaseClient.read() not implemented');
    }

    /**
     * Read that prefers the primary database (useful when read-replicas
     * may have replication lag). In single-node setups this is identical
     * to `read()`.
     */
    async pread(
        _query: string,
        _params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        throw new Error('DatabaseClient.pread() not implemented');
    }

    /**
     * Execute a write query (INSERT / UPDATE / DELETE).
     */
    async write(_query: string, _params: unknown[] = []): Promise<WriteResult> {
        throw new Error('DatabaseClient.write() not implemented');
    }

    /**
     * Execute multiple write statements in a single transaction.
     */
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

    /**
     * Like `read()` but falls back to the primary when read-replicas are
     * in use. Subclasses may override with replica-aware logic; the
     * default delegates to `pread()`.
     */
    async tryHardRead(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const primary = this.pread(query, params);
        primary.catch(() => {});

        try {
            const rows = await this.read(query, params);
            if (rows.length > 0) {
                return rows;
            }
        } catch {
            // replica failed — fall through to primary
        }
        return primary;
    }

    /**
     * Like `tryHardRead()` but throws when the result set is empty.
     */
    async requireRead(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        const rows = await this.tryHardRead(query, params);
        if (rows.length === 0) {
            throw new Error(`required read returned no rows: ${query}`);
        }
        return rows;
    }

    /**
     * Return the value from `choices` that matches the current engine.
     *
     * Usage:
     * ```
     * db.case({ sqlite: "datetime('now')", mysql: 'NOW()', otherwise: 'NOW()' })
     * ```
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
