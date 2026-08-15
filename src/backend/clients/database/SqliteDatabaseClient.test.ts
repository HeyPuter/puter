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

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types';
import { DatabaseClientFactory } from './index.js';
import { SqliteDatabaseClient } from './SqliteDatabaseClient.js';

/** Highest schema version the migration table can reach. */
const CURRENT_SCHEMA_VERSION = 62;
const SYSTEM_USER_UUID = '5d4adce0-a381-4982-9c02-6e2540026238';

const sqliteConfig = (
    database: Partial<NonNullable<IConfig['database']>> = {},
): IConfig =>
    ({
        port: 0,
        extensions: [],
        database: { engine: 'sqlite', inMemory: true, ...database },
    }) as IConfig;

const bootClient = async (
    database: Partial<NonNullable<IConfig['database']>> = {},
): Promise<SqliteDatabaseClient> => {
    const client = new SqliteDatabaseClient(sqliteConfig(database));
    await client.onServerStart();
    return client;
};

const userVersionOf = async (client: SqliteDatabaseClient): Promise<number> => {
    const [row] = await client.read('PRAGMA user_version');
    return row.user_version as number;
};

describe('SqliteDatabaseClient — boot and migrations', () => {
    let client: SqliteDatabaseClient;

    beforeEach(async () => {
        client = await bootClient();
    });

    afterEach(() => {
        client.onServerShutdown();
    });

    it('is what the factory picks for the sqlite engine', () => {
        expect(new DatabaseClientFactory(sqliteConfig())).toBeInstanceOf(
            SqliteDatabaseClient,
        );
    });

    it('migrates a fresh database all the way to the current version', async () => {
        expect(await userVersionOf(client)).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('runs the javascript migrations, not just the .sql ones', async () => {
        // The `system` user only exists because 0025 (a .dbmig.js file) ran
        // inside the migration VM.
        const rows = await client.read(
            'SELECT `username` FROM `user` WHERE `uuid` = ?',
            [SYSTEM_USER_UUID],
        );
        expect(rows).toEqual([{ username: 'system' }]);
    });

    it('leaves an already-migrated database untouched on a second boot', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'puter-sqlite-'));
        const path = join(dir, 'nested', 'puter.sqlite');
        try {
            const first = new SqliteDatabaseClient(
                sqliteConfig({ inMemory: false, path }),
            );
            await first.onServerStart();
            await first.write(
                'INSERT INTO `kv` (`user_id`, `kkey_hash`, `kkey`, `value`) ' +
                    'VALUES (?, ?, ?, ?)',
                [1, 1, 'boot-marker', '"kept"'],
            );
            first.onServerShutdown();

            expect(existsSync(path)).toBe(true);

            const second = new SqliteDatabaseClient(
                sqliteConfig({ inMemory: false, path }),
            );
            await second.onServerStart();
            await expect(
                second.read('SELECT `value` FROM `kv` WHERE `kkey` = ?', [
                    'boot-marker',
                ]),
            ).resolves.toEqual([{ value: '"kept"' }]);
            expect(await userVersionOf(second)).toBe(CURRENT_SCHEMA_VERSION);
            second.onServerShutdown();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('stops early at a configured target version', async () => {
        const partial = await bootClient({ targetVersion: 5 });
        try {
            expect(await userVersionOf(partial)).toBe(5);
            // 0005 landed (apps.background); 0011 (notification) did not.
            await expect(
                partial.read(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notification'",
                ),
            ).resolves.toEqual([]);
            await expect(
                partial.read(
                    "SELECT 1 FROM pragma_table_info('apps') WHERE name = 'background'",
                ),
            ).resolves.toHaveLength(1);
        } finally {
            partial.onServerShutdown();
        }
    });
});

describe('SqliteDatabaseClient — legacy version inference', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'puter-sqlite-legacy-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('treats user_version=0 with no bootstrap tables as uninitialized', async () => {
        const path = join(dir, 'blank.sqlite');
        new Database(path).close();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const client = new SqliteDatabaseClient(
            sqliteConfig({ inMemory: false, path }),
        );
        try {
            await client.onServerStart();
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('bootstrap tables are missing'),
            );
            // A full migration run followed, so the schema is current.
            expect(await userVersionOf(client)).toBe(CURRENT_SCHEMA_VERSION);
        } finally {
            client.onServerShutdown();
            warn.mockRestore();
        }
    });

    it('infers the schema version from table and column markers', async () => {
        const path = join(dir, 'legacy.sqlite');
        const seed = new Database(path);
        seed.exec(`
            CREATE TABLE user (
                id INTEGER PRIMARY KEY,
                username TEXT,
                otp_secret TEXT,
                otp_enabled INTEGER,
                otp_recovery_codes TEXT
            );
            CREATE TABLE apps (
                id INTEGER PRIMARY KEY,
                uid TEXT,
                background INTEGER,
                metadata TEXT
            );
            CREATE TABLE user_to_user_permissions (id INTEGER PRIMARY KEY);
            CREATE TABLE audit_user_to_user_permissions (
                id INTEGER PRIMARY KEY,
                issuer_user_id INTEGER,
                holder_user_id INTEGER
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                created_at INTEGER,
                last_activity INTEGER
            );
            CREATE TABLE kv (id INTEGER PRIMARY KEY, value JSON);
            INSERT INTO apps (uid)
                VALUES ('app-e3ac5486-da8c-42ad-8377-8728086e0980');
        `);
        seed.close();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // targetVersion just past the inferred version keeps the run a
        // no-op, so the assertion is about inference alone.
        const client = new SqliteDatabaseClient(
            sqliteConfig({ inMemory: false, path, targetVersion: 22 }),
        );
        try {
            await client.onServerStart();
            expect(warn).toHaveBeenCalledWith(
                '[sqlite] user_version=0; inferred legacy schema version 21',
            );
            // Nothing was applied, so user_version stays where it was.
            expect(await userVersionOf(client)).toBe(0);
        } finally {
            client.onServerShutdown();
            warn.mockRestore();
        }
    });

    it('reports version 0 when only the bootstrap tables exist', async () => {
        const path = join(dir, 'bootstrap-only.sqlite');
        const seed = new Database(path);
        seed.exec(`
            CREATE TABLE user (id INTEGER PRIMARY KEY);
            CREATE TABLE apps (id INTEGER PRIMARY KEY);
        `);
        seed.close();

        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const client = new SqliteDatabaseClient(
            sqliteConfig({ inMemory: false, path, targetVersion: 1 }),
        );
        try {
            await client.onServerStart();
            expect(log).toHaveBeenCalledWith('[sqlite] database version: 0');
        } finally {
            client.onServerShutdown();
            log.mockRestore();
        }
    });
});

describe('SqliteDatabaseClient — query interface', () => {
    let client: SqliteDatabaseClient;

    beforeEach(async () => {
        client = await bootClient();
        await client.write(
            'CREATE TABLE `widget` (`id` INTEGER PRIMARY KEY, ' +
                '`name` TEXT, `enabled` INTEGER, `seen_at` TEXT)',
        );
    });

    afterEach(() => {
        client.onServerShutdown();
    });

    it('reports lastInsertRowid and change counts on write', async () => {
        const inserted = await client.write(
            'INSERT INTO `widget` (`name`) VALUES (?)',
            ['spanner'],
        );
        expect(inserted).toEqual({
            insertId: 1,
            affectedRows: 1,
            anyRowsAffected: true,
        });

        const missed = await client.write(
            'UPDATE `widget` SET `name` = ? WHERE `id` = ?',
            ['nope', 999],
        );
        expect(missed).toMatchObject({
            affectedRows: 0,
            anyRowsAffected: false,
        });
    });

    it('binds booleans as sqlite integers', async () => {
        await client.write(
            'INSERT INTO `widget` (`name`, `enabled`) VALUES (?, ?)',
            ['toggled', true],
        );
        await client.write(
            'INSERT INTO `widget` (`name`, `enabled`) VALUES (?, ?)',
            ['untoggled', false],
        );

        await expect(
            client.read('SELECT `name`, `enabled` FROM `widget` ORDER BY `id`'),
        ).resolves.toEqual([
            { name: 'toggled', enabled: 1 },
            { name: 'untoggled', enabled: 0 },
        ]);
    });

    it('rewrites now() into the sqlite equivalent', async () => {
        await client.write(
            'INSERT INTO `widget` (`name`, `seen_at`) VALUES (?, NOW())',
            ['stamped'],
        );
        const [row] = await client.read(
            'SELECT `seen_at` FROM `widget` WHERE `name` = ?',
            ['stamped'],
        );
        expect(row.seen_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('generates an INSERT from a data object', async () => {
        await client.insert('widget', { name: 'generated', enabled: true });
        await expect(
            client.read('SELECT `name`, `enabled` FROM `widget`'),
        ).resolves.toEqual([{ name: 'generated', enabled: 1 }]);
    });

    it('primary-reads through the same single-node connection', async () => {
        await client.write('INSERT INTO `widget` (`name`) VALUES (?)', ['p']);
        await expect(
            client.pread('SELECT `name` FROM `widget`'),
        ).resolves.toEqual([{ name: 'p' }]);
    });

    it('applies a batch write atomically', async () => {
        await client.batchWrite([
            {
                statement:
                    'INSERT INTO `widget` (`name`, `enabled`) VALUES (?, ?)',
                values: ['one', true],
            },
            {
                statement: 'INSERT INTO `widget` (`name`) VALUES (?)',
                values: ['two'],
            },
        ]);

        await expect(
            client.read('SELECT `name` FROM `widget` ORDER BY `id`'),
        ).resolves.toEqual([{ name: 'one' }, { name: 'two' }]);
    });

    it('rolls the whole batch back when one statement fails', async () => {
        await expect(
            client.batchWrite([
                {
                    statement: 'INSERT INTO `widget` (`name`) VALUES (?)',
                    values: ['kept-if-broken'],
                },
                {
                    statement: 'INSERT INTO `nonexistent` (`name`) VALUES (?)',
                    values: ['boom'],
                },
            ]),
        ).rejects.toThrow(/no such table/i);

        await expect(
            client.read('SELECT `name` FROM `widget`'),
        ).resolves.toEqual([]);
    });

    it('surfaces sqlite errors for malformed SQL', async () => {
        await expect(client.read('SELEC oops')).rejects.toThrow(
            /syntax error/i,
        );
    });

    it('closes the database on shutdown', async () => {
        const closable = await bootClient();
        closable.onServerShutdown();
        await expect(closable.read('SELECT 1')).rejects.toThrow(
            'The database connection is not open',
        );
    });
});

// Single-node engines have no replica to race, so `tryHardRead` must not
// issue the query twice — the base-class default fires `pread()` and
// `read()` in parallel, which on sqlite is the same connection.
describe('SqliteDatabaseClient — tryHardRead', () => {
    let client: SqliteDatabaseClient;

    beforeEach(async () => {
        client = await bootClient();
        await client.write(
            'CREATE TABLE `widget` (`id` INTEGER PRIMARY KEY, `name` TEXT)',
        );
    });

    afterEach(() => {
        client.onServerShutdown();
    });

    it('executes the statement exactly once', async () => {
        await client.write('INSERT INTO `widget` (`name`) VALUES (?)', ['one']);
        const readSpy = vi.spyOn(client, 'read');
        const preadSpy = vi.spyOn(client, 'pread');

        await expect(
            client.tryHardRead('SELECT `name` FROM `widget`'),
        ).resolves.toEqual([{ name: 'one' }]);

        expect(readSpy).toHaveBeenCalledTimes(1);
        expect(preadSpy).not.toHaveBeenCalled();
    });

    it('executes the statement exactly once when it matches no rows', async () => {
        const readSpy = vi.spyOn(client, 'read');
        const preadSpy = vi.spyOn(client, 'pread');

        await expect(
            client.tryHardRead('SELECT `name` FROM `widget`'),
        ).resolves.toEqual([]);

        expect(readSpy).toHaveBeenCalledTimes(1);
        expect(preadSpy).not.toHaveBeenCalled();
    });

    it('throws from requireRead when nothing matches', async () => {
        await expect(
            client.requireRead(
                'SELECT `name` FROM `widget` WHERE `id` = ?',
                [42],
            ),
        ).rejects.toThrow('required read returned no rows');
    });

    it('returns the rows from requireRead when something matches', async () => {
        await client.write('INSERT INTO `widget` (`name`) VALUES (?)', ['ok']);
        await expect(
            client.requireRead('SELECT `name` FROM `widget`'),
        ).resolves.toEqual([{ name: 'ok' }]);
    });
});
