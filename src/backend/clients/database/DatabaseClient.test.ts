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

import { describe, expect, it } from 'vitest';
import type { IConfig } from '../../types';
import { AbstractDatabaseClient, type WriteResult } from './DatabaseClient';
import { DatabaseClientFactory } from './index.js';
import { MySQLDatabaseClient } from './MySQLDatabaseClient.js';
import { PostgresDatabaseClient } from './PostgresDatabaseClient.js';
import { SqliteDatabaseClient } from './SqliteDatabaseClient.js';

const config = (engine: string): IConfig =>
    ({ port: 0, extensions: [], database: { engine } }) as IConfig;

const sqlite = () => new SqliteDatabaseClient(config('sqlite'));
const mysql = () => new MySQLDatabaseClient(config('mysql'));
const postgres = () => new PostgresDatabaseClient(config('postgres'));

/**
 * Minimal concrete client backed by fixture rows — exercises the shared helpers
 * on `AbstractDatabaseClient` that the real engines inherit.
 */
class FixtureDatabaseClient extends AbstractDatabaseClient {
    override readonly engineName = 'fixture';
    readonly reads: string[] = [];
    readonly preads: string[] = [];
    readonly writes: { query: string; params: unknown[] }[] = [];

    constructor(
        private readonly replicaRows: Record<string, unknown>[] | Error,
        private readonly primaryRows: Record<string, unknown>[] = [],
    ) {
        super(config('fixture'));
    }

    override async read(query: string): Promise<Record<string, unknown>[]> {
        this.reads.push(query);
        if (this.replicaRows instanceof Error) throw this.replicaRows;
        return this.replicaRows;
    }

    override async pread(query: string): Promise<Record<string, unknown>[]> {
        this.preads.push(query);
        return this.primaryRows;
    }

    override async write(
        query: string,
        params: unknown[] = [],
    ): Promise<WriteResult> {
        this.writes.push({ query, params });
        return { insertId: 1, affectedRows: 1, anyRowsAffected: true };
    }
}

describe('DatabaseClientFactory', () => {
    it('picks sqlite when no engine is configured', () => {
        expect(
            new DatabaseClientFactory({ port: 0, extensions: [] } as IConfig),
        ).toBeInstanceOf(SqliteDatabaseClient);
    });

    it('refuses an unknown engine name', () => {
        expect(() => new DatabaseClientFactory(config('cassandra'))).toThrow(
            'Unknown database engine: cassandra',
        );
    });
});

describe('AbstractDatabaseClient — unimplemented surface', () => {
    const bare = () => new AbstractDatabaseClient(config('none'));

    it('refuses to run queries until a subclass implements them', async () => {
        await expect(bare().read('SELECT 1')).rejects.toThrow(
            'DatabaseClient.read() not implemented',
        );
        await expect(bare().pread('SELECT 1')).rejects.toThrow(
            'DatabaseClient.pread() not implemented',
        );
        await expect(bare().write('DELETE FROM x')).rejects.toThrow(
            'DatabaseClient.write() not implemented',
        );
        await expect(bare().batchWrite([])).rejects.toThrow(
            'DatabaseClient.batchWrite() not implemented',
        );
    });
});

describe('AbstractDatabaseClient — replica-aware reads', () => {
    it('returns replica rows without waiting on the primary', async () => {
        const client = new FixtureDatabaseClient([{ id: 1 }], [{ id: 2 }]);
        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { id: 1 },
        ]);
    });

    it('falls back to the primary when the replica has not caught up', async () => {
        const client = new FixtureDatabaseClient([], [{ id: 2 }]);
        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { id: 2 },
        ]);
    });

    it('falls back to the primary when the replica read throws', async () => {
        const client = new FixtureDatabaseClient(
            new Error('replica unavailable'),
            [{ id: 3 }],
        );
        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { id: 3 },
        ]);
    });

    it('names the failing query when a required read finds nothing', async () => {
        const client = new FixtureDatabaseClient([], []);
        await expect(
            client.requireRead('SELECT * FROM `user` WHERE `id` = ?'),
        ).rejects.toThrow(
            'required read returned no rows: SELECT * FROM `user` WHERE `id` = ?',
        );
    });
});

describe('AbstractDatabaseClient — SQL generation', () => {
    it('generates an INSERT with quoted columns and placeholders', async () => {
        const client = new FixtureDatabaseClient([]);
        await client.insert('user', { username: 'ada', email: null });

        expect(client.writes).toEqual([
            {
                query: 'INSERT INTO `user` (`username`, `email`) VALUES (?, ?)',
                params: ['ada', null],
            },
        ]);
    });

    it('quotes each dotted segment and escapes embedded backticks', () => {
        const client = sqlite();
        expect(client.quoteIdentifier('user')).toBe('`user`');
        expect(client.quoteIdentifier('db.user.id')).toBe('`db`.`user`.`id`');
        expect(client.quoteIdentifier('user.*')).toBe('`user`.*');
        expect(client.quoteIdentifier('we`ird')).toBe('`we``ird`');
    });

    it('quotes postgres identifiers with double quotes', () => {
        const client = postgres();
        expect(client.quoteIdentifier('db.user')).toBe('"db"."user"');
        expect(client.quoteIdentifier('we"ird')).toBe('"we""ird"');
        expect(client.quoteIdentifier('user.*')).toBe('"user".*');
    });

    it('renders booleans the way each engine expects', () => {
        expect(sqlite().booleanLiteral(true)).toBe('1');
        expect(sqlite().booleanValue(false)).toBe(0);
        expect(postgres().booleanLiteral(true)).toBe('TRUE');
        expect(postgres().booleanLiteral(false)).toBe('FALSE');
        expect(postgres().booleanValue(true)).toBe(true);
    });

    it('picks the engine-specific ignore-conflict syntax', () => {
        expect(sqlite().insertIgnoreInto('kv')).toBe(
            'INSERT OR IGNORE INTO `kv`',
        );
        expect(sqlite().insertIgnoreSuffix()).toBe('');
        expect(postgres().insertIgnoreInto('kv')).toBe('INSERT INTO "kv"');
        expect(postgres().insertIgnoreSuffix()).toBe(' ON CONFLICT DO NOTHING');
        expect(mysql().insertIgnoreInto('kv')).toBe('INSERT IGNORE INTO `kv`');
        expect(mysql().insertIgnoreSuffix()).toBe('');
    });

    it('builds an upsert clause per engine', () => {
        expect(mysql().upsertClause(['user_id'], ['value', 'dt'])).toBe(
            'ON DUPLICATE KEY UPDATE `value` = ?, `dt` = ?',
        );
        expect(sqlite().upsertClause(['user_id', 'app'], ['value'])).toBe(
            'ON CONFLICT(`user_id`, `app`) DO UPDATE SET `value` = ?',
        );
        expect(postgres().upsertClause(['user_id'], ['value'])).toBe(
            'ON CONFLICT("user_id") DO UPDATE SET "value" = ?',
        );
    });

    it('rejects an upsert with nothing to update', () => {
        expect(() => sqlite().upsertClause(['user_id'], [])).toThrow(
            'upsertClause requires at least one update column',
        );
    });

    it('extracts JSON text using each engine dialect', () => {
        expect(sqlite().jsonTextExtract('`metadata`', ['a', 'b'])).toBe(
            "json_extract(`metadata`, '$.a.b')",
        );
        expect(mysql().jsonTextExtract('`metadata`', ['a'])).toBe(
            "JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.a'))",
        );
        expect(postgres().jsonTextExtract('"metadata"', ['a', 'b'])).toBe(
            `"metadata" #>> ARRAY['a', 'b']`,
        );
    });

    it('escapes quotes inside JSON path segments', () => {
        expect(sqlite().jsonTextExtract('`m`', ["it's"])).toBe(
            "json_extract(`m`, '$.it''s')",
        );
    });

    it('coalesces expressions and rejects an empty list', () => {
        expect(sqlite().nullCoalesce('`a`', '`b`', '0')).toBe(
            'COALESCE(`a`, `b`, 0)',
        );
        expect(() => sqlite().nullCoalesce()).toThrow(
            'nullCoalesce requires at least one expression',
        );
    });

    it('only postgres needs a RETURNING clause to learn the insert id', () => {
        expect(postgres().returningIdClause()).toBe(' RETURNING id');
        expect(sqlite().returningIdClause()).toBe('');
        expect(mysql().returningIdClause()).toBe('');
    });

    it('falls back to `otherwise` for an engine with no explicit choice', () => {
        const client = new FixtureDatabaseClient([]);
        expect(
            client.case({ sqlite: 'a', mysql: 'b', otherwise: 'fallback' }),
        ).toBe('fallback');
        expect(client.case({ fixture: 'exact', otherwise: 'fallback' })).toBe(
            'exact',
        );
    });
});
