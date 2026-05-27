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

import type { FieldDef, QueryResult } from 'pg';
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

const postgresReplicaConfig = (): IConfig => ({
    port: 0,
    extensions: [],
    database: {
        engine: 'postgres',
        migrationPaths: [],
        replica: {},
    },
});

const field = (name: string, dataTypeID: number): FieldDef => ({
    name,
    tableID: 0,
    columnID: 0,
    dataTypeID,
    dataTypeSize: -1,
    dataTypeModifier: -1,
    format: 'text',
});

const int8Field = (name: string): FieldDef => field(name, 20);
const textField = (name: string): FieldDef => field(name, 25);

const queryResult = (
    rows: Record<string, unknown>[] = [],
    rowCount = rows.length,
    fields: FieldDef[] = [],
): QueryResult<Record<string, unknown>> => ({
    command: '',
    fields,
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

    it('normalizes int8 fields on read and primary read rows', async () => {
        const pool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult(
                [
                    {
                        uuid: 'session-1',
                        created_at: '1710000000',
                        last_activity: '1710000001',
                        expires_at: '1710000002',
                        revoked_at: null,
                    },
                ],
                1,
                [
                    textField('uuid'),
                    int8Field('created_at'),
                    int8Field('last_activity'),
                    int8Field('expires_at'),
                    int8Field('revoked_at'),
                ],
            ),
        );
        const client = new PostgresDatabaseClient(postgresConfig(), () => pool);
        await client.onServerStart();

        await expect(client.read('SELECT * FROM `sessions`')).resolves.toEqual(
            [
                {
                    uuid: 'session-1',
                    created_at: 1710000000,
                    last_activity: 1710000001,
                    expires_at: 1710000002,
                    revoked_at: null,
                },
            ],
        );
        await expect(client.pread('SELECT * FROM `sessions`')).resolves.toEqual(
            [
                {
                    uuid: 'session-1',
                    created_at: 1710000000,
                    last_activity: 1710000001,
                    expires_at: 1710000002,
                    revoked_at: null,
                },
            ],
        );
    });

    it('rejects unsafe int8 values instead of losing precision', async () => {
        const pool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult(
                [{ id: '9007199254740992' }],
                1,
                [int8Field('id')],
            ),
        );
        const client = new PostgresDatabaseClient(postgresConfig(), () => pool);
        await client.onServerStart();

        await expect(client.read('SELECT `id` FROM `sessions`')).rejects.toThrow(
            'safe integer',
        );
    });

    it('normalizes tryHardRead rows returned by a replica', async () => {
        const primaryPool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult([{ created_at: '1' }], 1, [
                int8Field('created_at'),
            ]),
        );
        const replicaPool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult([{ created_at: '2' }], 1, [
                int8Field('created_at'),
            ]),
        );
        const pools = [primaryPool, replicaPool];
        let nextPoolIndex = 0;
        const client = new PostgresDatabaseClient(
            postgresReplicaConfig(),
            () => {
                const pool = pools[nextPoolIndex];
                nextPoolIndex += 1;
                if (!pool) throw new Error('unexpected pool factory call');
                return pool;
            },
        );
        await client.onServerStart();

        await expect(
            client.tryHardRead('SELECT `created_at` FROM `sessions`'),
        ).resolves.toEqual([{ created_at: 2 }]);
    });

    it('normalizes tryHardRead rows returned by primary fallback', async () => {
        const primaryPool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult([{ created_at: '3' }], 1, [
                int8Field('created_at'),
            ]),
        );
        const replicaPool = new RecordingPool(
            new RecordingPoolClient(),
            queryResult([], 0, [int8Field('created_at')]),
        );
        const pools = [primaryPool, replicaPool];
        let nextPoolIndex = 0;
        const client = new PostgresDatabaseClient(
            postgresReplicaConfig(),
            () => {
                const pool = pools[nextPoolIndex];
                nextPoolIndex += 1;
                if (!pool) throw new Error('unexpected pool factory call');
                return pool;
            },
        );
        await client.onServerStart();

        await expect(
            client.tryHardRead('SELECT `created_at` FROM `sessions`'),
        ).resolves.toEqual([{ created_at: 3 }]);
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
