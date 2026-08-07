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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types';
import {
    MySQLDatabaseClient,
    compareMigrationFilenames,
} from './MySQLDatabaseClient.js';

interface FakeConnection {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
}

interface FakePool {
    poolConfig: Record<string, unknown>;
    connectionHandlers: ((conn: unknown) => void)[];
    connections: FakeConnection[];
    calls: { sql: string; values?: unknown[] }[];
    ended: boolean;
    endError: unknown;
    endThrows: unknown;
    respond: (sql: string, values?: unknown[]) => unknown;
    on: (event: string, handler: (conn: unknown) => void) => FakePool;
    promise: () => { getConnection: () => Promise<FakeConnection> };
    end: (cb: (err?: unknown) => void) => void;
}

// mysql2 is the wire boundary: stub the driver's pool so we can assert on
// the exact SQL, parameters and connection choreography the adapter emits.
const { createPoolMock, createdPools } = vi.hoisted(() => {
    const createdPools: FakePool[] = [];

    const createPoolMock = vi.fn((poolConfig: Record<string, unknown>) => {
        const pool: FakePool = {
            poolConfig,
            connectionHandlers: [],
            connections: [],
            calls: [],
            ended: false,
            endError: null,
            endThrows: null,
            respond: () => [[], undefined],
            on(event, handler) {
                if (event === 'connection') {
                    pool.connectionHandlers.push(handler);
                }
                return pool;
            },
            promise() {
                return {
                    getConnection: async () => {
                        const run = async (sql: string, values?: unknown[]) => {
                            pool.calls.push({ sql, values });
                            return pool.respond(sql, values);
                        };
                        const conn: FakeConnection = {
                            query: vi.fn(run),
                            execute: vi.fn(run),
                            beginTransaction: vi.fn(async () => {}),
                            commit: vi.fn(async () => {}),
                            rollback: vi.fn(async () => {}),
                            release: vi.fn(),
                        };
                        pool.connections.push(conn);
                        return conn;
                    },
                };
            },
            end(cb) {
                if (pool.endThrows) throw pool.endThrows;
                pool.ended = true;
                cb(pool.endError ?? undefined);
            },
        };
        createdPools.push(pool);
        return pool;
    });

    return { createPoolMock, createdPools };
});

vi.mock('mysql2', () => ({ createPool: createPoolMock }));

describe('compareMigrationFilenames', () => {
    it('orders numbered migrations numerically, not lexically', () => {
        const input = [
            'mysql_mig_10.sql',
            'mysql_mig_2.sql',
            'mysql_mig_1.sql',
            'mysql_mig_9.sql',
            'mysql_mig_3.sql',
        ];
        const sorted = [...input].sort(compareMigrationFilenames);
        expect(sorted).toEqual([
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_3.sql',
            'mysql_mig_9.sql',
            'mysql_mig_10.sql',
        ]);
    });

    it('keeps mig_10 after mig_9 when the real prod set is shuffled', () => {
        // Reflects the current migrations/mysql/ listing — guards against
        // a future "let's just rename to padded" suggestion accidentally
        // re-introducing the lex bug if the rename is incomplete.
        const real = [
            'mysql_mig_9.sql',
            'mysql_mig_3.sql',
            'mysql_mig_10.sql',
            'mysql_mig_1.sql',
            'mysql_mig_7.sql',
            'mysql_mig_5.sql',
            'mysql_mig_2.sql',
            'mysql_mig_4.sql',
            'mysql_mig_8.sql',
            'mysql_mig_6.sql',
        ];
        const sorted = [...real].sort(compareMigrationFilenames);
        for (let i = 1; i <= sorted.length; i += 1) {
            expect(sorted[i - 1]).toBe(`mysql_mig_${i}.sql`);
        }
    });

    it('sorts non-numeric filenames after numbered ones, lexically among themselves', () => {
        // Numbered files always run first (they're the canonical history);
        // unmatched names follow in localeCompare order. Mixing the two
        // sets prevents a vendor dump from accidentally wedging itself
        // between mig_4 and mig_5 if it happened to lex-sort there.
        const mixed = [
            'mysql_mig_2.sql',
            'mysql_vendor_dump.sql',
            'mysql_mig_10.sql',
            'mysql_bootstrap.sql',
            'mysql_mig_1.sql',
        ];
        const sorted = [...mixed].sort(compareMigrationFilenames);
        expect(sorted).toEqual([
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_10.sql',
            'mysql_bootstrap.sql',
            'mysql_vendor_dump.sql',
        ]);
    });

    it('is stable for already-sorted input', () => {
        const sorted = [
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_10.sql',
            'mysql_mig_11.sql',
        ];
        expect([...sorted].sort(compareMigrationFilenames)).toEqual(sorted);
    });
});

// ── Replica read failover ───────────────────────────────────────────
//
// `read()` normally goes to the replica batcher; when the replica side is
// degraded (batcher load-shed or a transient connection error) and a real
// replica is configured, the read retries once on the primary batcher.

type Batcher = { execute: ReturnType<typeof vi.fn> };

const makeClient = (opts: {
    replica: Batcher;
    primary: Batcher;
    multiNode?: boolean;
}) => {
    const client = new MySQLDatabaseClient({
        database: { engine: 'mysql' },
    } as IConfig);
    // Bypass onServerStart (which would connect to a real database) and
    // inject the batchers directly. Configuration enum: SINGLE=0, REPLICA=1.
    Object.assign(client as unknown as Record<string, unknown>, {
        dbReplica: opts.replica,
        db: opts.primary,
        configuration: opts.multiNode === false ? 0 : 1,
    });
    return client;
};

const codedError = (code: string) => {
    const err = new Error(code) as Error & { code: string };
    err.code = code;
    return err;
};

describe('MySQLDatabaseClient.read — replica failover', () => {
    it('fails over to the primary on batcher load-shed errors', async () => {
        const replica = {
            execute: vi.fn().mockRejectedValue(codedError('dbBatchFailed')),
        };
        const primary = { execute: vi.fn().mockResolvedValue([[{ ok: 1 }]]) };
        const client = makeClient({ replica, primary });

        await expect(client.read('SELECT 1')).resolves.toEqual([{ ok: 1 }]);
        expect(primary.execute).toHaveBeenCalledTimes(1);
    });

    it('fails over on transient connection errors', async () => {
        const replica = {
            execute: vi.fn().mockRejectedValue(codedError('ECONNRESET')),
        };
        const primary = { execute: vi.fn().mockResolvedValue([[{ ok: 1 }]]) };
        const client = makeClient({ replica, primary });

        await expect(client.read('SELECT 1')).resolves.toEqual([{ ok: 1 }]);
    });

    it('rethrows deterministic SQL errors without touching the primary', async () => {
        const replica = {
            execute: vi.fn().mockRejectedValue(codedError('ER_PARSE_ERROR')),
        };
        const primary = { execute: vi.fn() };
        const client = makeClient({ replica, primary });

        await expect(client.read('SELEC oops')).rejects.toMatchObject({
            code: 'ER_PARSE_ERROR',
        });
        expect(primary.execute).not.toHaveBeenCalled();
    });

    it('does not fail over in single-node configuration', async () => {
        const replica = {
            execute: vi.fn().mockRejectedValue(codedError('dbBatchFailed')),
        };
        const primary = { execute: vi.fn() };
        const client = makeClient({ replica, primary, multiNode: false });

        await expect(client.read('SELECT 1')).rejects.toMatchObject({
            code: 'dbBatchFailed',
        });
        expect(primary.execute).not.toHaveBeenCalled();
    });
});

// -- Driver-level behaviour (stubbed mysql2 pool) ---------------------

const mysqlConfig = (
    database: Partial<NonNullable<IConfig['database']>> = {},
): IConfig =>
    ({
        port: 0,
        extensions: [],
        database: { engine: 'mysql', ...database },
    }) as IConfig;

const startClient = async (
    database: Partial<NonNullable<IConfig['database']>> = {},
): Promise<MySQLDatabaseClient> => {
    const client = new MySQLDatabaseClient(mysqlConfig(database));
    await client.onServerStart();
    return client;
};

// The batcher coalesces a batch into `stmt1;stmt2; SELECT 1`, so the driver
// must answer with one row-set per statement plus one for the SELECT 1.
const rowSets = (...sets: unknown[][]) => [[...sets, [{ 1: 1 }]], undefined];

beforeEach(() => {
    createdPools.length = 0;
    createPoolMock.mockClear();
});

describe('MySQLDatabaseClient — pool construction', () => {
    it('builds the primary pool from config with multi-statement support', async () => {
        await startClient({
            host: 'db.internal',
            port: 3307,
            user: 'puter',
            password: 'hunter2',
            database: 'puterdb',
        });

        expect(createPoolMock).toHaveBeenCalledTimes(1);
        expect(createdPools[0].poolConfig).toEqual({
            maxPreparedStatements: 900,
            connectionLimit: 30,
            enableKeepAlive: true,
            host: 'db.internal',
            port: 3307,
            user: 'puter',
            password: 'hunter2',
            database: 'puterdb',
            multipleStatements: true,
        });
    });

    it('falls back to loopback defaults when the endpoint is unspecified', async () => {
        await startClient();

        expect(createdPools[0].poolConfig).toMatchObject({
            host: '127.0.0.1',
            port: 3306,
            user: 'root',
            password: '',
            database: 'puter',
        });
    });

    it('arms a server-side statement timeout on every new connection', async () => {
        await startClient({ selectTimeoutMs: 12_000 });

        const pool = createdPools[0];
        expect(pool.connectionHandlers).toHaveLength(1);

        const conn = { query: vi.fn() };
        pool.connectionHandlers[0](conn);
        expect(conn.query).toHaveBeenCalledWith(
            'SET SESSION max_execution_time = 12000',
        );
    });

    it('omits the statement timeout when configured to 0', async () => {
        await startClient({ selectTimeoutMs: 0 });
        expect(createdPools[0].connectionHandlers).toHaveLength(0);
    });

    it('shares one pool between reads and writes without a replica', async () => {
        await startClient();
        expect(createPoolMock).toHaveBeenCalledTimes(1);
    });

    it('creates a second pool when a read-replica is configured', async () => {
        await startClient({
            replica: { host: 'replica.internal', port: 3306 },
        });

        expect(createPoolMock).toHaveBeenCalledTimes(2);
        expect(createdPools[1].poolConfig).toMatchObject({
            host: 'replica.internal',
            multipleStatements: true,
        });
    });
});

describe('MySQLDatabaseClient — query interface', () => {
    it('sends the query and its parameters through to the driver', async () => {
        const client = await startClient();
        const pool = createdPools[0];
        pool.respond = () => rowSets([{ id: 1, username: 'ada' }]);

        await expect(
            client.read('SELECT * FROM `user` WHERE `id` = ?', [1]),
        ).resolves.toEqual([{ id: 1, username: 'ada' }]);

        expect(pool.calls).toEqual([
            {
                sql: 'SELECT * FROM `user` WHERE `id` = ?; SELECT 1',
                values: [1],
            },
        ]);
    });

    it('returns an empty array when the driver yields no row-set', async () => {
        const client = await startClient();
        createdPools[0].respond = () => [[], undefined];

        await expect(client.read('SELECT 1')).resolves.toEqual([]);
        await expect(client.pread('SELECT 1')).resolves.toEqual([]);
    });

    it('reads from the replica pool and primary-reads from the primary', async () => {
        const client = await startClient({ replica: { host: 'replica' } });
        const [primary, replica] = createdPools;
        primary.respond = () => rowSets([{ from: 'primary' }]);
        replica.respond = () => rowSets([{ from: 'replica' }]);

        await expect(client.read('SELECT 1')).resolves.toEqual([
            { from: 'replica' },
        ]);
        await expect(client.pread('SELECT 1')).resolves.toEqual([
            { from: 'primary' },
        ]);
    });

    it('maps the mysql result header onto the shared write result', async () => {
        const client = await startClient();
        createdPools[0].respond = () =>
            rowSets({ insertId: 42, affectedRows: 2 } as unknown as unknown[]);

        await expect(
            client.write('UPDATE `user` SET `username` = ? WHERE `id` = ?', [
                'ada',
                1,
            ]),
        ).resolves.toEqual({
            insertId: 42,
            affectedRows: 2,
            anyRowsAffected: true,
        });
    });

    it('reports no rows affected when the header omits the counters', async () => {
        const client = await startClient();
        createdPools[0].respond = () => rowSets({} as unknown as unknown[]);

        await expect(client.write('DELETE FROM `user`')).resolves.toEqual({
            insertId: 0,
            affectedRows: 0,
            anyRowsAffected: false,
        });
    });

    it('builds an INSERT with quoted identifiers and positional params', async () => {
        const client = await startClient();
        const pool = createdPools[0];
        pool.respond = () =>
            rowSets({ insertId: 7, affectedRows: 1 } as unknown as unknown[]);

        await expect(
            client.insert('user', { username: 'ada', email: null }),
        ).resolves.toMatchObject({ insertId: 7 });

        expect(pool.calls[0]).toEqual({
            sql:
                'INSERT INTO `user` (`username`, `email`) VALUES (?, ?); ' +
                'SELECT 1',
            values: ['ada', null],
        });
    });
});

describe('MySQLDatabaseClient — batchWrite transactions', () => {
    it('runs every statement on one connection inside a transaction', async () => {
        const client = await startClient();
        const pool = createdPools[0];

        await client.batchWrite([
            { statement: 'UPDATE `user` SET `x` = ?', values: [1] },
            {
                statement: 'DELETE FROM `sessions` WHERE `uuid` = ?',
                values: ['s'],
            },
        ]);

        expect(pool.connections).toHaveLength(1);
        const conn = pool.connections[0];
        expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
        expect(conn.execute.mock.calls).toEqual([
            ['UPDATE `user` SET `x` = ?', [1]],
            ['DELETE FROM `sessions` WHERE `uuid` = ?', ['s']],
        ]);
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.rollback).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases the connection when a statement fails', async () => {
        const client = await startClient();
        const pool = createdPools[0];
        pool.respond = (sql) => {
            if (sql.startsWith('DELETE')) throw new Error('constraint blew up');
            return [[], undefined];
        };

        await expect(
            client.batchWrite([
                { statement: 'UPDATE `user` SET `x` = ?', values: [1] },
                { statement: 'DELETE FROM `user`', values: [] },
            ]),
        ).rejects.toThrow('constraint blew up');

        const conn = pool.connections[0];
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('still rethrows the original failure when the rollback also fails', async () => {
        const client = await startClient();
        const pool = createdPools[0];
        pool.respond = () => {
            throw new Error('statement blew up');
        };

        const original = client.batchWrite([
            { statement: 'UPDATE `user` SET `x` = ?', values: [1] },
        ]);
        // The rollback is attached after the connection is handed out, so
        // patch it once the adapter has acquired one.
        await Promise.resolve();
        pool.connections[0]?.rollback.mockRejectedValue(
            new Error('rollback blew up'),
        );

        await expect(original).rejects.toThrow('statement blew up');
        expect(pool.connections[0].release).toHaveBeenCalledTimes(1);
    });

    it('never acquires a connection for an empty batch', async () => {
        const client = await startClient();
        await client.batchWrite([]);
        expect(createdPools[0].connections).toHaveLength(0);
    });
});

describe('MySQLDatabaseClient — tryHardRead', () => {
    it('issues exactly one query in single-node configuration', async () => {
        const client = await startClient();
        const pool = createdPools[0];
        pool.respond = () => rowSets([{ id: 1 }]);

        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { id: 1 },
        ]);
        expect(pool.calls).toHaveLength(1);
    });

    it('prefers replica rows when the replica has them', async () => {
        const client = await startClient({ replica: { host: 'replica' } });
        const [primary, replica] = createdPools;
        primary.respond = () => rowSets([{ from: 'primary' }]);
        replica.respond = () => rowSets([{ from: 'replica' }]);

        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { from: 'replica' },
        ]);
    });

    it('falls back to the primary when the replica is behind', async () => {
        const client = await startClient({ replica: { host: 'replica' } });
        const [primary, replica] = createdPools;
        primary.respond = () => rowSets([{ from: 'primary' }]);
        replica.respond = () => rowSets([]);

        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { from: 'primary' },
        ]);
    });

    it('falls back to the primary when the replica query throws', async () => {
        const client = await startClient({ replica: { host: 'replica' } });
        const [primary, replica] = createdPools;
        primary.respond = () => rowSets([{ from: 'primary' }]);
        replica.respond = () => {
            throw new Error('replica down');
        };

        await expect(client.tryHardRead('SELECT 1')).resolves.toEqual([
            { from: 'primary' },
        ]);
    });
});

describe('MySQLDatabaseClient — migrations', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'puter-mysql-mig-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('applies mysql migrations in numeric order, one statement at a time', async () => {
        writeFileSync(
            join(dir, 'mysql_mig_2.sql'),
            'CREATE TABLE b (id INT);\nCREATE TABLE c (id INT);\n',
        );
        writeFileSync(
            join(dir, 'mysql_mig_10.sql'),
            'CREATE TABLE d (id INT);',
        );
        // Other engines' files and non-SQL noise must be ignored.
        writeFileSync(join(dir, 'postgres_mig_1.sql'), 'CREATE TABLE nope ();');
        writeFileSync(join(dir, 'mysql_notes.txt'), 'not sql');

        await startClient({ migrationPaths: [dir] });

        const pool = createdPools[0];
        expect(pool.calls.map((c) => c.sql)).toEqual([
            'CREATE TABLE b (id INT)',
            'CREATE TABLE c (id INT)',
            'CREATE TABLE d (id INT)',
        ]);
        expect(pool.connections[0].release).toHaveBeenCalledTimes(1);
    });

    it('reports which file and statement index failed', async () => {
        writeFileSync(
            join(dir, 'mysql_mig_1.sql'),
            'CREATE TABLE ok (id INT);\nCREATE TABLE bad (id INT);',
        );

        const client = new MySQLDatabaseClient(
            mysqlConfig({ migrationPaths: [dir] }),
        );
        const cause = new Error('ER_PARSE_ERROR');
        // The pool only exists once onServerStart runs, so arm the failure
        // through the factory.
        createPoolMock.mockImplementationOnce((poolConfig) => {
            const pool = createPoolMock.getMockImplementation()!(poolConfig);
            pool.respond = (sql: string) => {
                if (sql.includes('bad')) throw cause;
                return [[], undefined];
            };
            return pool;
        });

        await expect(client.onServerStart()).rejects.toThrow(
            '[mysql] failed to apply mysql_mig_1.sql at statement 1',
        );
    });

    it('fails loudly when a configured migration path is unreadable', async () => {
        await expect(
            startClient({ migrationPaths: [join(dir, 'does-not-exist')] }),
        ).rejects.toThrow('[mysql] migration path is unreadable');
    });

    it('skips a configured directory that holds no mysql migrations', async () => {
        writeFileSync(join(dir, 'readme.md'), '# nothing here');
        await startClient({ migrationPaths: [dir] });
        expect(createdPools[0].calls).toEqual([]);
    });
});

describe('MySQLDatabaseClient — pool lifecycle', () => {
    it('replaces and closes the previous primary pool on reinit', async () => {
        const client = await startClient();
        const original = createdPools[0];

        client.reinitPrimary();

        expect(createdPools).toHaveLength(2);
        expect(original.ended).toBe(true);
        // Single-node: the replica batcher must follow the new primary.
        createdPools[1].respond = () => rowSets([{ from: 'new-primary' }]);
        await expect(client.read('SELECT 1')).resolves.toEqual([
            { from: 'new-primary' },
        ]);
    });

    it('replaces only the replica pool on replica reinit', async () => {
        const client = await startClient({ replica: { host: 'replica' } });
        const [primary, originalReplica] = createdPools;

        client.reinitReplica();

        expect(createdPools).toHaveLength(3);
        expect(originalReplica.ended).toBe(true);
        expect(primary.ended).toBe(false);
    });

    it('ignores a replica reinit when no replica is configured', async () => {
        const client = await startClient();
        client.reinitReplica();
        expect(createdPools).toHaveLength(1);
    });

    it('ignores reinit once shutdown has started', async () => {
        const client = await startClient();
        await client.onServerPrepareShutdown();
        client.reinitPrimary();
        expect(createdPools).toHaveLength(1);
        await client.onServerShutdown();
    });

    it('closes both pools on shutdown when a replica is configured', async () => {
        const client = await startClient({ replica: { host: 'replica' } });
        await client.onServerShutdown();

        expect(createdPools[0].ended).toBe(true);
        expect(createdPools[1].ended).toBe(true);
    });

    it('closes the pools once the drain window elapses', async () => {
        vi.useFakeTimers();
        try {
            const client = await startClient();
            await client.onServerPrepareShutdown();
            expect(createdPools[0].ended).toBe(false);

            await vi.advanceTimersByTimeAsync(60_000);
            expect(createdPools[0].ended).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels the drain timer when shutdown arrives first', async () => {
        vi.useFakeTimers();
        try {
            const client = await startClient();
            await client.onServerPrepareShutdown();
            // A second prepare is a no-op — only one drain timer may exist.
            await client.onServerPrepareShutdown();
            expect(vi.getTimerCount()).toBe(1);

            await client.onServerShutdown();
            expect(vi.getTimerCount()).toBe(0);
            expect(createdPools[0].ended).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('surfaces a driver error raised while closing the pool', async () => {
        const client = await startClient();
        createdPools[0].endError = new Error('pool refused to close');

        await expect(client.onServerShutdown()).rejects.toThrow(
            'pool refused to close',
        );
    });

    it('surfaces a driver error thrown synchronously by end()', async () => {
        const client = await startClient();
        createdPools[0].endThrows = new Error('end exploded');

        await expect(client.onServerShutdown()).rejects.toThrow('end exploded');
    });
});

describe('MySQLDatabaseClient.readWithRetry', () => {
    const codedFailure = (code: string) => {
        const err = new Error(code) as Error & { code: string };
        err.code = code;
        return err;
    };

    it('classifies transient connection failures as retriable', () => {
        expect(
            MySQLDatabaseClient.isRetriableError(codedFailure('ECONNRESET')),
        ).toBe(true);
        expect(
            MySQLDatabaseClient.isRetriableError(codedFailure('ER_DUP_ENTRY')),
        ).toBe(false);
        expect(
            MySQLDatabaseClient.isRetriableError(new Error('Connection lost')),
        ).toBe(true);
    });

    it('retries a transient failure and returns the eventual result', async () => {
        const client = await startClient();
        let attempts = 0;
        const operation = vi.fn(async () => {
            attempts += 1;
            if (attempts < 3) throw codedFailure('PROTOCOL_CONNECTION_LOST');
            return [{ ok: 1 }];
        });

        await expect(
            client.readWithRetry('health', operation, { baseBackoffMs: 0 }),
        ).resolves.toEqual([{ ok: 1 }]);
        expect(operation).toHaveBeenCalledTimes(3);
    });

    it('gives up after the attempt budget is spent', async () => {
        const client = await startClient();
        const operation = vi.fn(async () => {
            throw codedFailure('ETIMEDOUT');
        });

        await expect(
            client.readWithRetry('health', operation, {
                maxAttempts: 2,
                baseBackoffMs: 0,
            }),
        ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('never retries a deterministic SQL error', async () => {
        const client = await startClient();
        const operation = vi.fn(async () => {
            throw codedFailure('ER_PARSE_ERROR');
        });

        await expect(
            client.readWithRetry('health', operation, { baseBackoffMs: 0 }),
        ).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('stops retrying once shutdown has started', async () => {
        const client = await startClient();
        await client.onServerPrepareShutdown();
        const operation = vi.fn(async () => {
            throw codedFailure('ECONNRESET');
        });

        await expect(
            client.readWithRetry('health', operation, { baseBackoffMs: 0 }),
        ).rejects.toMatchObject({ code: 'ECONNRESET' });
        expect(operation).toHaveBeenCalledTimes(1);
        await client.onServerShutdown();
    });

    it('applies jittered exponential backoff capped at maxBackoffMs', async () => {
        const client = await startClient();
        const delays: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        const timeoutSpy = vi
            .spyOn(globalThis, 'setTimeout')
            .mockImplementation(((fn: () => void, ms?: number) => {
                delays.push(ms ?? 0);
                return realSetTimeout(fn, 0);
            }) as typeof setTimeout);

        try {
            const operation = vi.fn(async () => {
                throw codedFailure('ECONNRESET');
            });
            await expect(
                client.readWithRetry('health', operation, {
                    maxAttempts: 4,
                    baseBackoffMs: 100,
                    maxBackoffMs: 150,
                    jitterRatio: 0,
                }),
            ).rejects.toMatchObject({ code: 'ECONNRESET' });
            expect(delays).toEqual([100, 150, 150]);
        } finally {
            timeoutSpy.mockRestore();
        }
    });
});
