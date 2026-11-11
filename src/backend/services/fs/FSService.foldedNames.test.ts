/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterServer } from '../../server.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSService } from './FSService.js';
import { resolveNode } from './resolveNode.js';

// On MySQL, `fsentries.name` and `path` compare under collations that fold
// case, accents and every supplementary-plane character (most emoji) together,
// so a lookup can return a differently named sibling. SQLite compares bytes;
// there the same comparisons are routed through a function that folds the
// same way. With PUTER_TEST_MYSQL_PORT set the suite also runs on MySQL 8.4.

const mysqlFold = (value: unknown): unknown =>
    typeof value === 'string'
        ? value
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
              .toLowerCase()
        : value;

const foldComparisons = (sql: string): string =>
    sql
        .replace(
            /\b(WHERE|AND) path = \?/g,
            '$1 mysql_fold(path) = mysql_fold(?)',
        )
        .replace(
            /\bpath IN \(([?, ]+)\)/g,
            (_match, list: string) =>
                `mysql_fold(path) IN (${list.replace(/\?/g, 'mysql_fold(?)')})`,
        )
        .replace(
            /\bf\.name = s\.name\b/g,
            'mysql_fold(f.name) = mysql_fold(s.name)',
        );

const emulateMysqlCollation = (server: PuterServer): void => {
    const client = server.clients.db as unknown as Record<string, unknown> & {
        db: {
            function: (
                name: string,
                options: { deterministic: boolean },
                fn: (value: unknown) => unknown,
            ) => void;
            exec: (sql: string) => void;
        };
    };
    client.db.function('mysql_fold', { deterministic: true }, mysqlFold);
    // MySQL's `parent_id_filename` unique key.
    client.db.exec(
        'CREATE UNIQUE INDEX folded_parent_name ON fsentries (parent_id, mysql_fold(name))',
    );
    for (const method of ['read', 'pread', 'tryHardRead', 'write']) {
        const original = (
            client[method] as (sql: string, params?: unknown[]) => unknown
        ).bind(client);
        client[method] = (sql: string, params?: unknown[]) =>
            original(foldComparisons(sql), params);
    }
};

const MYSQL_PORT = process.env.PUTER_TEST_MYSQL_PORT;
const MYSQL = {
    host: '127.0.0.1',
    port: Number(MYSQL_PORT ?? 3307),
    user: 'root',
    password: 'puter',
};
const MYSQL_MIGRATIONS = fileURLToPath(
    new URL('../../clients/database/migrations/mysql', import.meta.url),
);

interface Engine {
    label: string;
    skip: boolean;
    boot: () => Promise<{ server: PuterServer; teardown: () => Promise<void> }>;
}

const engines: Engine[] = [
    {
        label: 'SQLite, MySQL collation emulated',
        skip: false,
        boot: async () => {
            const server = await setupTestServer();
            emulateMysqlCollation(server);
            return { server, teardown: () => server.shutdown() };
        },
    },
    {
        label: 'MySQL',
        skip: !MYSQL_PORT,
        boot: async () => {
            const database = `t_folded_${Date.now().toString(36)}`;
            const admin = await mysql.createConnection(MYSQL);
            await admin.query(`CREATE DATABASE \`${database}\``);
            await admin.end();
            const server = await setupTestServer({
                database: {
                    engine: 'mysql',
                    ...MYSQL,
                    database,
                    migrationPaths: [MYSQL_MIGRATIONS],
                },
            } as unknown as IConfig);
            const [row] = (await server.clients.db.read(
                'SELECT VERSION() AS version',
            )) as Array<{ version: string }>;
            expect(row?.version.startsWith('8.4')).toBe(true);
            return {
                server,
                teardown: async () => {
                    await server.shutdown();
                    const cleanup = await mysql.createConnection(MYSQL);
                    await cleanup.query(
                        `DROP DATABASE IF EXISTS \`${database}\``,
                    );
                    await cleanup.end();
                },
            };
        },
    },
];

describe.each(engines.filter((engine) => !engine.skip))(
    'names the database folds together ($label)',
    ({ boot }) => {
        let server: PuterServer;
        let fs: FSService;
        let teardown: () => Promise<void>;
        let userId: number;
        let home: string;
        let actor: Actor;

        beforeAll(async () => {
            ({ server, teardown } = await boot());
            fs = server.services.fs as unknown as FSService;
            const username = `fold${Math.random().toString(36).slice(2, 8)}`;
            const created = await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email: `${username}@test.local`,
                free_storage: 100 * 1024 * 1024,
                requires_email_confirmation: false,
            });
            await generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                created,
            );
            const user = (await server.stores.user.getById(created.id))!;
            userId = user.id;
            home = `/${user.username}`;
            actor = makeActor({
                user: {
                    id: user.id,
                    uuid: user.uuid,
                    username: user.username,
                    email: user.email ?? null,
                    email_confirmed: true,
                } as Actor['user'],
            });
        }, 240_000);

        afterAll(async () => {
            await teardown?.();
        });

        let dirCount = 0;
        const freshDir = async (): Promise<string> => {
            const dir = `${home}/Documents/d${++dirCount}`;
            await fs.mkdir(userId, { path: dir });
            return dir;
        };

        const write = async (
            path: string,
            content: string,
            extra: Record<string, unknown> = {},
        ): Promise<FSEntry> =>
            (
                await fs.write(userId, {
                    fileMetadata: {
                        path,
                        size: Buffer.byteLength(content),
                        contentType: 'text/plain',
                        ...extra,
                    },
                    fileContent: content,
                })
            ).fsEntry;

        const readBack = async (entry: FSEntry): Promise<string> => {
            const result = await fs.readContent(entry, {});
            const chunks: Buffer[] = [];
            for await (const chunk of result.body) {
                chunks.push(Buffer.from(chunk));
            }
            return Buffer.concat(chunks).toString();
        };

        const at = (path: string) =>
            server.stores.fsEntry.getEntryByPath(path, {
                useTryHardRead: true,
                skipCache: true,
            });

        const names = async (dir: string): Promise<string[]> => {
            const parent = (await at(dir))!;
            return (await fs.listDirectory(parent.uuid))
                .map((entry) => entry.name)
                .sort();
        };

        const caught = async (run: () => Promise<unknown>) => {
            let error: unknown;
            try {
                await run();
            } catch (e) {
                error = e;
            }
            expect(error).toBeInstanceOf(HttpError);
            return error as HttpError;
        };

        it('refuses a default write whose name folds onto a sibling, leaving the sibling intact', async () => {
            const dir = await freshDir();
            const original = await write(`${dir}/😀.txt`, 'grinning');

            const error = await caught(() =>
                write(`${dir}/😁.txt`, 'beaming', { overwrite: true }),
            );
            expect(error.statusCode).toBe(409);
            expect(error.legacyCode).toBe('conflict');

            expect(await names(dir)).toEqual(['😀.txt']);
            const kept = (await at(`${dir}/😀.txt`))!;
            expect(kept.uuid).toBe(original.uuid);
            expect(await readBack(kept)).toBe('grinning');
        });

        it('refuses an accent-only twin the same way', async () => {
            const dir = await freshDir();
            await write(`${dir}/résumé.pdf`, 'fr');

            const error = await caught(() =>
                write(`${dir}/resume.pdf`, 'en', { overwrite: true }),
            );
            expect(error.statusCode).toBe(409);
            expect(await names(dir)).toEqual(['résumé.pdf']);
            expect(await readBack((await at(`${dir}/résumé.pdf`))!)).toBe('fr');
        });

        it('dedupes a write onto a folded name when asked, and offers the usual prompt otherwise', async () => {
            const dir = await freshDir();
            await write(`${dir}/😀.txt`, 'grinning');

            const deduped = await write(`${dir}/😁.txt`, 'beaming', {
                dedupeName: true,
            });
            expect(deduped.name).toBe('😁 (1).txt');
            expect(await readBack(deduped)).toBe('beaming');

            const error = await caught(() =>
                write(`${dir}/😁.txt`, 'beaming', { overwrite: false }),
            );
            expect(error.statusCode).toBe(409);
            expect(error.legacyCode).toBe('item_with_same_name_exists');
            expect(await readBack((await at(`${dir}/😀.txt`))!)).toBe(
                'grinning',
            );
        });

        it('refuses a signed upload onto a folded name before handing out a URL', async () => {
            const dir = await freshDir();
            await write(`${dir}/😀.txt`, 'grinning');

            const error = await caught(() =>
                fs.startUrlWrite(userId, {
                    fileMetadata: {
                        path: `${dir}/😁.txt`,
                        size: 7,
                        contentType: 'text/plain',
                        overwrite: true,
                    },
                }),
            );
            expect(error.statusCode).toBe(409);
        });

        it('still overwrites a case-only spelling of the same file in place', async () => {
            const dir = await freshDir();
            const original = await write(`${dir}/Notes.txt`, 'one');

            const replaced = await write(`${dir}/notes.txt`, 'two', {
                overwrite: true,
            });
            expect(replaced.uuid).toBe(original.uuid);
            expect(await names(dir)).toEqual(['notes.txt']);
            expect(await readBack(replaced)).toBe('two');
        });

        it('reads nothing at a folded name, without caching the sibling under it', async () => {
            const dir = await freshDir();
            const original = await write(`${dir}/😀.txt`, 'grinning');
            const requested = `${dir}/😁.txt`;

            expect(
                await server.stores.fsEntry.getEntryByPath(requested),
            ).toBeNull();
            expect(
                await resolveNode(server.stores.fsEntry, { path: requested }),
            ).toBeNull();
            expect(
                await server.stores.fsEntry.getEntriesByPathsForUser(userId, [
                    requested,
                ]),
            ).toEqual([null]);
            expect(
                await server.clients.redis.get(
                    `prodfsv2:fsentry:path:any:${requested}`,
                ),
            ).toBeNull();

            const exact = await server.stores.fsEntry.getEntryByPath(
                `${dir}/😀.txt`,
            );
            expect(exact?.uuid).toBe(original.uuid);
        });

        it('reads a case-only or NFD spelling of a name as the stored entry', async () => {
            const dir = await freshDir();
            const original = await write(`${dir}/café.txt`, 'nfc');

            const nfd = `${dir}/café.txt`.normalize('NFD');
            expect(nfd).not.toBe(`${dir}/café.txt`);
            expect(
                (await server.stores.fsEntry.getEntryByPath(nfd))?.uuid,
            ).toBe(original.uuid);
            expect(
                (await server.stores.fsEntry.getEntryByPath(`${dir}/CAFÉ.txt`))
                    ?.uuid,
            ).toBe(original.uuid);
        });

        it('does not walk a path-less legacy row onto a folded name', async () => {
            const dir = await freshDir();
            const original = await write(`${dir}/😀.txt`, 'grinning');
            await server.clients.db.write(
                'UPDATE fsentries SET path = NULL WHERE uuid = ?',
                [original.uuid],
            );
            await server.stores.fsEntry.invalidateEntryCacheByUuid(
                original.uuid,
            );

            expect(await at(`${dir}/😁.txt`)).toBeNull();
            expect((await at(`${dir}/😀.txt`))?.uuid).toBe(original.uuid);
        });

        it('keeps names the collation folds but the unique key does not apart', async () => {
            const dir = await freshDir();
            const hiragana = await write(`${dir}/あ.txt`, 'hiragana');
            const katakana = await write(`${dir}/ア.txt`, 'katakana');
            const emoji = await write(`${dir}/❤️.txt`, 'with selector');
            const bare = await write(`${dir}/❤.txt`, 'bare');

            for (const [entry, content] of [
                [hiragana, 'hiragana'],
                [katakana, 'katakana'],
                [emoji, 'with selector'],
                [bare, 'bare'],
            ] as const) {
                const found = await server.stores.fsEntry.getEntryByPath(
                    entry.path,
                );
                expect(found?.uuid).toBe(entry.uuid);
                expect(await readBack(found!)).toBe(content);
            }
        });

        it('refuses a mkdir whose name folds onto a sibling folder instead of returning it', async () => {
            const dir = await freshDir();
            const work = await fs.mkdir(userId, { path: `${dir}/📁 Work` });

            const error = await caught(() =>
                fs.mkdir(userId, { path: `${dir}/📂 Work` }),
            );
            expect(error.statusCode).toBe(409);

            const deduped = await fs.mkdir(userId, {
                path: `${dir}/📂 Work`,
                dedupeName: true,
            });
            expect(deduped.name).toBe('📂 Work (1)');
            expect(deduped.uuid).not.toBe(work.uuid);

            const nested = await caught(() =>
                fs.mkdir(userId, {
                    path: `${dir}/📂 Work/inner`,
                    createMissingParents: true,
                }),
            );
            expect(nested.statusCode).toBe(409);
            expect(await fs.listDirectory(work.uuid)).toEqual([]);
        });

        it('still returns the existing folder for a case-only mkdir', async () => {
            const dir = await freshDir();
            const created = await fs.mkdir(userId, { path: `${dir}/Photos` });
            const again = await fs.mkdir(userId, { path: `${dir}/photos` });
            expect(again.uuid).toBe(created.uuid);
        });

        it('refuses touch and rename onto a folded name', async () => {
            const dir = await freshDir();
            await write(`${dir}/😀.txt`, 'grinning');
            const other = await write(`${dir}/other.txt`, 'other');

            const touched = await caught(() =>
                fs.touch(userId, { path: `${dir}/😁.txt` }),
            );
            expect(touched.statusCode).toBe(409);

            const renamed = await caught(() =>
                runWithContext({ actor }, () =>
                    fs.rename(userId, other, '😁.txt'),
                ),
            );
            expect(renamed.statusCode).toBe(409);
            expect(await names(dir)).toEqual(['other.txt', '😀.txt']);
        });

        it('dedupes or refuses a shortcut onto a folded name', async () => {
            const dir = await freshDir();
            await write(`${dir}/😀.txt`, 'grinning');
            const target = await write(`${dir}/target.txt`, 'target');
            const parent = (await at(dir))!;

            const refused = await caught(() =>
                fs.mkshortcut(userId, { parent, name: '😁.txt', target }),
            );
            expect(refused.statusCode).toBe(409);
            const deduped = await fs.mkshortcut(userId, {
                parent,
                name: '😁.txt',
                target,
                dedupeName: true,
            });
            expect(deduped.name).toBe('😁 (1).txt');
        });

        it('never replaces a folded occupant on an overwriting move or copy', async () => {
            const dest = await freshDir();
            const src = await freshDir();
            const occupant = await write(`${dest}/😀.txt`, 'occupant');
            const moving = await write(`${src}/😁.txt`, 'moving');
            const destination = (await at(dest))!;

            const moveError = await caught(() =>
                runWithContext({ actor }, () =>
                    fs.move(userId, {
                        source: moving,
                        destinationParent: destination,
                        overwrite: true,
                    }),
                ),
            );
            expect(moveError.statusCode).toBe(409);
            expect(moveError.legacyCode).toBe('conflict');

            const copyError = await caught(() =>
                runWithContext({ actor }, () =>
                    fs.copy(userId, {
                        source: moving,
                        destinationParent: destination,
                        overwrite: true,
                    }),
                ),
            );
            expect(copyError.statusCode).toBe(409);

            const prompt = await caught(() =>
                runWithContext({ actor }, () =>
                    fs.move(userId, {
                        source: moving,
                        destinationParent: destination,
                    }),
                ),
            );
            expect(prompt.legacyCode).toBe('item_with_same_name_exists');

            expect(await names(dest)).toEqual(['😀.txt']);
            const kept = (await at(`${dest}/😀.txt`))!;
            expect(kept.uuid).toBe(occupant.uuid);
            expect(await readBack(kept)).toBe('occupant');

            const copied = await runWithContext({ actor }, () =>
                fs.copy(userId, {
                    source: moving,
                    destinationParent: destination,
                    dedupeName: true,
                }),
            );
            expect(copied.name).toBe('😁 (1).txt');
            const moved = await runWithContext({ actor }, () =>
                fs.move(userId, {
                    source: moving,
                    destinationParent: destination,
                    overwrite: true,
                    dedupeName: true,
                }),
            );
            expect(moved.name).toBe('😁 (2).txt');
            expect(await names(dest)).toEqual([
                '😀.txt',
                '😁 (1).txt',
                '😁 (2).txt',
            ]);
        });

        it('still replaces a case-only occupant on an overwriting move', async () => {
            const dest = await freshDir();
            const src = await freshDir();
            await write(`${dest}/Report.txt`, 'old');
            const moving = await write(`${src}/report.txt`, 'new');
            const destination = (await at(dest))!;

            const moved = await runWithContext({ actor }, () =>
                fs.move(userId, {
                    source: moving,
                    destinationParent: destination,
                    overwrite: true,
                }),
            );
            expect(moved.uuid).toBe(moving.uuid);
            expect(await names(dest)).toEqual(['report.txt']);
        });
    },
);
