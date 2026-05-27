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

import type { QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import type { IConfig } from '../../types';
import { DatabaseClientFactory } from './index.js';
import {
    mapPostgresWriteResult,
    PostgresDatabaseClient,
    type PostgresPool,
    type PostgresPoolClient,
} from './PostgresDatabaseClient.js';

type QueryCall = {
    text: string;
    values?: unknown[];
};

const postgresConfig = (): IConfig => ({
    port: 0,
    extensions: [],
    database: {
        engine: 'postgres',
        migrationPaths: [],
    },
});

const queryResult = (
    rows: Record<string, unknown>[] = [],
    rowCount = rows.length,
): QueryResult<Record<string, unknown>> => ({
    command: '',
    fields: [],
    oid: 0,
    rowCount,
    rows,
});

class RecordingPoolClient implements PostgresPoolClient {
    readonly calls: QueryCall[] = [];
    released = false;

    constructor(private readonly failOnText?: string) {}

    async query(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<Record<string, unknown>>> {
        this.calls.push({ text, values });
        if (this.failOnText && text.includes(this.failOnText)) {
            throw new Error(`forced query failure: ${text}`);
        }
        return queryResult([], text === 'ROLLBACK' ? 0 : 1);
    }

    release(): void {
        this.released = true;
    }
}

class RecordingPool implements PostgresPool {
    readonly calls: QueryCall[] = [];

    constructor(
        private readonly client: RecordingPoolClient =
            new RecordingPoolClient(),
        private readonly nextResult: QueryResult<Record<string, unknown>> =
            queryResult(),
    ) {}

    async query(
        text: string,
        values?: unknown[],
    ): Promise<QueryResult<Record<string, unknown>>> {
        this.calls.push({ text, values });
        if (text === 'SELECT 1') return queryResult([{ ok: 1 }], 1);
        return this.nextResult;
    }

    async connect(): Promise<PostgresPoolClient> {
        return this.client;
    }

    async end(): Promise<void> {}
}

describe('PostgresDatabaseClient', () => {
    it('is selected by the database factory', () => {
        const client = new DatabaseClientFactory(postgresConfig());
        expect(client).toBeInstanceOf(PostgresDatabaseClient);
    });

    it('maps pg write results to the shared WriteResult shape', () => {
        expect(
            mapPostgresWriteResult(queryResult([{ id: '42' }], 1)),
        ).toEqual({
            insertId: 42,
            affectedRows: 1,
            anyRowsAffected: true,
        });

        expect(mapPostgresWriteResult(queryResult([], 0))).toEqual({
            insertId: 0,
            affectedRows: 0,
            anyRowsAffected: false,
        });
    });

    it('prepares write SQL at the pg boundary', async () => {
        const pool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult([{ id: '7' }], 1),
        );
        const client = new PostgresDatabaseClient(postgresConfig(), () => pool);
        await client.onServerStart();

        const result = await client.write(
            'INSERT INTO `apps` (`name`) VALUES (?) RETURNING id',
            ['editor'],
        );

        expect(result.insertId).toBe(7);
        expect(pool.calls.at(-1)).toEqual({
            text: 'INSERT INTO "apps" ("name") VALUES ($1) RETURNING id',
            values: ['editor'],
        });
    });

    it('runs batch writes in order and commits', async () => {
        const conn = new RecordingPoolClient();
        const client = new PostgresDatabaseClient(
            postgresConfig(),
            () => new RecordingPool(conn),
        );
        await client.onServerStart();

        await client.batchWrite([
            {
                statement:
                    'UPDATE `user` SET `username` = ? WHERE `id` = ?',
                values: ['ada', 1],
            },
            {
                statement: 'DELETE FROM `sessions` WHERE `uuid` = ?',
                values: ['session-1'],
            },
        ]);

        expect(conn.calls).toEqual([
            { text: 'BEGIN', values: undefined },
            {
                text: 'UPDATE "user" SET "username" = $1 WHERE "id" = $2',
                values: ['ada', 1],
            },
            {
                text: 'DELETE FROM "sessions" WHERE "uuid" = $1',
                values: ['session-1'],
            },
            { text: 'COMMIT', values: undefined },
        ]);
        expect(conn.released).toBe(true);
    });

    it('rolls back and releases the pg connection when a batch write fails', async () => {
        const conn = new RecordingPoolClient('UPDATE "user"');
        const client = new PostgresDatabaseClient(
            postgresConfig(),
            () => new RecordingPool(conn),
        );
        await client.onServerStart();

        await expect(
            client.batchWrite([
                {
                    statement:
                        'UPDATE `user` SET `username` = ? WHERE `id` = ?',
                    values: ['ada', 1],
                },
            ]),
        ).rejects.toThrow('forced query failure');

        expect(conn.calls).toEqual([
            { text: 'BEGIN', values: undefined },
            {
                text: 'UPDATE "user" SET "username" = $1 WHERE "id" = $2',
                values: ['ada', 1],
            },
            { text: 'ROLLBACK', values: undefined },
        ]);
        expect(conn.released).toBe(true);
    });
});
