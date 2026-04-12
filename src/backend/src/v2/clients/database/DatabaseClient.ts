import type { IConfig } from '../../types';
import { PuterClient } from '../types';

export interface WriteResult {
    insertId: number | bigint;
    anyRowsAffected: boolean;
}

export interface BatchEntry {
    statement: string;
    values: unknown[];
}

/**
 * Base database client. Subclasses must override every method that throws here.
 *
 * Do not instantiate directly — use the factory exported from
 * `clients/database/index.ts` which picks the right implementation
 * based on `config.database.engine`.
 */
export class DatabaseClient extends PuterClient {

    /** Short name used by `case()` to pick engine-specific values. */
    readonly engineName: string = '';

    constructor (config: IConfig) {
        super(config);
    }

    // ------------------------------------------------------------------
    // Abstract interface — subclasses MUST override
    // ------------------------------------------------------------------

    /**
     * Execute a read query. Returns an array of row objects.
     */
    async read (_query: string, _params: unknown[] = []): Promise<Record<string, unknown>[]> {
        throw new Error('DatabaseClient.read() not implemented');
    }

    /**
     * Read that prefers the primary database (useful when read-replicas
     * may have replication lag). In single-node setups this is identical
     * to `read()`.
     */
    async pread (_query: string, _params: unknown[] = []): Promise<Record<string, unknown>[]> {
        throw new Error('DatabaseClient.pread() not implemented');
    }

    /**
     * Execute a write query (INSERT / UPDATE / DELETE).
     */
    async write (_query: string, _params: unknown[] = []): Promise<WriteResult> {
        throw new Error('DatabaseClient.write() not implemented');
    }

    /**
     * Execute multiple write statements in a single transaction.
     */
    async batchWrite (_entries: BatchEntry[]): Promise<void> {
        throw new Error('DatabaseClient.batchWrite() not implemented');
    }

    // ------------------------------------------------------------------
    // Shared helpers (rely on the abstract methods above)
    // ------------------------------------------------------------------

    /**
     * Generate and execute an INSERT statement from a table name and a
     * key/value data object.
     */
    async insert (tableName: string, data: Record<string, unknown>): Promise<WriteResult> {
        const cols = Object.keys(data);
        const values = Object.values(data);
        const sql =
            `INSERT INTO \`${tableName}\` ` +
            `(${cols.map(c => `\`${c}\``).join(', ')}) ` +
            `VALUES (${cols.map(() => '?').join(', ')})`;
        return this.write(sql, values);
    }

    /**
     * Like `read()` but falls back to the primary when read-replicas are
     * in use. Subclasses may override with replica-aware logic; the
     * default delegates to `pread()`.
     */
    async tryHardRead (query: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
        return this.pread(query, params);
    }

    /**
     * Like `tryHardRead()` but throws when the result set is empty.
     */
    async requireRead (query: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
        const rows = await this.tryHardRead(query, params);
        if ( rows.length === 0 ) {
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
    case<T> (choices: Record<string, T> & { otherwise?: T }): T {
        if ( Object.prototype.hasOwnProperty.call(choices, this.engineName) ) {
            return choices[this.engineName];
        }
        return choices.otherwise as T;
    }
}
