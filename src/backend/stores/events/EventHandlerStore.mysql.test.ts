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

/**
 * The user-scope handler schema and queries against MySQL 8.4. Runs only when
 * `PUTER_TEST_MYSQL_PORT` points at a server (root / `puter`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { splitMysqlStatements } from '../../clients/database/splitMysqlStatements.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { appHandlerScope, hashContent } from './EventHandlerStore.js';

const connection = {
    host: '127.0.0.1',
    port: Number(process.env.PUTER_TEST_MYSQL_PORT ?? 3307),
    user: 'root',
    password: 'puter',
};
const database = `event_user_handlers_${Date.now().toString(36)}`;
const migrationDir = fileURLToPath(
    new URL('../../clients/database/migrations/mysql', import.meta.url),
);
const SOURCE = 'async ({ event }) => { console.log(event.path); }';

describe.skipIf(!process.env.PUTER_TEST_MYSQL_PORT)(
    'user-scoped handlers (MySQL)',
    () => {
        let server: PuterServer;
        let conn: mysql.Connection;
        const userIds: number[] = [];

        const handlers = () => server.stores.eventHandler;
        const rows = async (sql: string, params: unknown[] = []) =>
            (await conn.query(sql, params))[0] as Record<string, unknown>[];

        const applyMig55 = async () => {
            const sql = readFileSync(
                `${migrationDir}/mysql_mig_55.sql`,
                'utf8',
            );
            for (const statement of splitMysqlStatements(sql))
                await conn.query(statement);
        };

        const bind = async (
            holder: number,
            app: string,
            name: string,
            handlerScope: number,
            suspended = false,
        ) => {
            await conn.query(
                'INSERT INTO `event_subscriptions` (`sub_id`, `token`, `owner_user_id`, `holder_user_id`, `app_uid`, `subject`, `anchor_uid`, `anchor_path`, `delivery`, `handler_name`, `handler_scope`, `targets`, `permission`, `suspended_at`, `suspended_reason`, `created_at`) ' +
                    "VALUES (?, ?, ?, ?, ?, 'fs:/x', 'a', '/x', 'single', ?, ?, '[]', 'list', ?, ?, 1)",
                [
                    uuidv4(),
                    `f#${uuidv4()}`,
                    holder,
                    holder,
                    app,
                    name,
                    handlerScope,
                    suspended ? 1 : null,
                    suspended ? 'handler_not_found' : null,
                ],
            );
        };

        /**
         * The `key` column of every table in the plan of the last statement a
         * spy saw.
         */
        const planKeys = async (spy: {
            mock: { calls: unknown[][] };
        }): Promise<Record<string, string | null>> => {
            const [statement, params] = spy.mock.calls.at(-1) as [
                string,
                unknown[],
            ];
            const plan = await rows(`EXPLAIN ${statement}`, params);
            return Object.fromEntries(
                plan.map((row) => [
                    String(row.table),
                    (row.key as string | null) ?? null,
                ]),
            );
        };

        beforeAll(async () => {
            const admin = await mysql.createConnection(connection);
            await admin.query(`CREATE DATABASE \`${database}\``);
            await admin.end();
            server = await setupTestServer({
                database: {
                    engine: 'mysql',
                    ...connection,
                    database,
                    migrationPaths: [migrationDir],
                },
                events: { enabled: true },
            } as never);
            conn = await mysql.createConnection({ ...connection, database });
            for (let i = 0; i < 12; i++) {
                const user = await server.stores.user.create({
                    username: `ush-${uuidv4().slice(0, 8)}`,
                    uuid: uuidv4(),
                    password: null,
                    email: null,
                });
                userIds.push(user.id);
            }
        }, 240_000);

        afterAll(async () => {
            await conn?.end();
            await server?.shutdown();
            const admin = await mysql.createConnection(connection);
            await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
            await admin.end();
        });

        it('runs on MySQL 8.4', async () => {
            const [row] = await rows('SELECT VERSION() AS version');
            expect(String(row!.version)).toMatch(/^8\.4\./);
        });

        it('applies over existing subscription rows, and a replay is a no-op', async () => {
            // Back to the state before the migration, with rows already in.
            await conn.query('DROP TABLE `event_user_handlers`');
            await conn.query(
                'ALTER TABLE `event_subscriptions` DROP COLUMN `handler_scope`',
            );
            await conn.query('DELETE FROM `event_subscriptions`');
            for (const name of ['a', 'b', 'c'])
                await conn.query(
                    'INSERT INTO `event_subscriptions` (`sub_id`, `token`, `owner_user_id`, `holder_user_id`, `app_uid`, `subject`, `anchor_uid`, `anchor_path`, `delivery`, `handler_name`, `targets`, `permission`, `created_at`) ' +
                        "VALUES (?, ?, ?, ?, 'app-old', 'fs:/x', 'a', '/x', 'single', ?, '[]', 'list', 1)",
                    [uuidv4(), `f#${uuidv4()}`, userIds[0], userIds[0], name],
                );

            await applyMig55();
            const scopes = async () =>
                (
                    await rows(
                        'SELECT `handler_scope` FROM `event_subscriptions`',
                    )
                ).map((row) => Number(row.handler_scope));
            expect(await scopes()).toEqual([0, 0, 0]);

            await applyMig55();
            expect(await scopes()).toEqual([0, 0, 0]);

            const [column] = await rows(
                "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_subscriptions' AND COLUMN_NAME = 'handler_scope'",
            );
            expect(column).toMatchObject({
                COLUMN_TYPE: 'tinyint unsigned',
                IS_NULLABLE: 'NO',
                COLUMN_DEFAULT: '0',
            });

            const indexes = await rows(
                "SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_user_handlers' ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            );
            const byIndex = (name: string) =>
                indexes
                    .filter((row) => row.INDEX_NAME === name)
                    .map((row) => String(row.COLUMN_NAME));
            expect(byIndex('idx_event_user_handlers_app_holder_name')).toEqual([
                'app_uid',
                'holder_user_id',
                'name',
            ]);
            expect(byIndex('idx_event_user_handlers_holder_app')).toEqual([
                'holder_user_id',
                'app_uid',
            ]);
            expect(
                indexes.find(
                    (row) =>
                        row.INDEX_NAME ===
                        'idx_event_user_handlers_app_holder_name',
                ),
            ).toMatchObject({ NON_UNIQUE: 0 });

            const [appUidColumn] = await rows(
                "SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_user_handlers' AND COLUMN_NAME = 'app_uid'",
            );
            expect(appUidColumn).toMatchObject({
                CHARACTER_SET_NAME: 'latin1',
                COLLATION_NAME: 'latin1_swedish_ci',
            });
        });

        it('keeps the same name once in the app scope and once per holder', async () => {
            const app = `app-${uuidv4()}`;
            const insert = (holder: number) =>
                conn.query(
                    'INSERT INTO `event_user_handlers` (`app_uid`, `holder_user_id`, `name`, `source`, `source_hash`, `created_at`, `updated_at`, `scope_since`) VALUES (?, ?, ?, ?, ?, 1, 1, 1)',
                    [app, holder, 'daily', SOURCE, hashContent(SOURCE)],
                );
            await handlers().publish({
                scope: appHandlerScope(app),
                name: 'daily',
                source: SOURCE,
            });
            await insert(userIds[1]!);
            await insert(userIds[2]!);
            await expect(insert(userIds[1]!)).rejects.toMatchObject({
                code: 'ER_DUP_ENTRY',
            });
        });

        it('runs the store against both tables', async () => {
            const app = `app-${uuidv4()}`;
            const [a, b] = [userIds[3]!, userIds[4]!];
            const scope = (holder: number) => ({ appUid: app, holder });
            await handlers().publish({
                scope: appHandlerScope(app),
                name: 'daily',
                source: SOURCE,
            });
            for (const holder of [a, b])
                await handlers().publish({
                    scope: scope(holder),
                    name: 'daily',
                    source: `${SOURCE} // ${holder}`,
                });
            await handlers().publish({
                scope: scope(a),
                name: `@${hashContent(SOURCE)}`,
                source: SOURCE,
            });

            expect(await handlers().countForApp(scope(a))).toBe(2);
            expect(await handlers().countForApp(appHandlerScope(app))).toBe(1);
            expect(await handlers().totalSourceBytesForApp(scope(b))).toBe(
                Buffer.byteLength(`${SOURCE} // ${b}`),
            );
            expect(
                (await handlers().setForApp(scope(a), { replica: true })).map(
                    (h) => h.name,
                ),
            ).toEqual([`@${hashContent(SOURCE)}`, 'daily']);
            expect(await handlers().countUserScopesWithHandlersForUser(a)).toBe(
                1,
            );
            expect(
                await handlers().countUserScopesWithHandlersForUser(a, {
                    createdBefore: 1_000,
                }),
            ).toBe(0);
            expect(
                await handlers().countUserScopesWithHandlersForUser(a, {
                    createdBefore: Date.now() + 60_000,
                }),
            ).toBe(1);
            const page = await handlers().listUserScopesForUser(a);
            expect(page.total).toBe(1);
            expect(page.items).toEqual([
                expect.objectContaining({ appUid: app, handlerCount: 2 }),
            ]);
            expect(
                (await handlers().listUserScopes(app)).items.map(
                    (s) => s.holder,
                ),
            ).toEqual([a, b].sort((x, y) => x - y));

            await bind(a, app, 'daily', 1);
            await bind(b, app, 'daily', 1, true);
            await bind(a, app, 'daily', 0);
            expect(
                await handlers().countSubscriptionsByHandler(scope(a)),
            ).toEqual(new Map([['daily', 1]]));
            expect(
                await handlers().countSubscriptionsByHandler(
                    appHandlerScope(app),
                ),
            ).toEqual(new Map([['daily', 1]]));

            await conn.query(
                'UPDATE `event_user_handlers` SET `updated_at` = 1 WHERE `app_uid` = ?',
                [app],
            );
            const found = await handlers().listUnboundUserHandlers(1_000);
            expect(
                found.items
                    .filter((item) => item.appUid === app)
                    .map((item) => [item.holder, item.name]),
            ).toEqual([[a, `@${hashContent(SOURCE)}`]]);
            await expect(
                handlers().deleteUserHandlerIfUnbound(scope(a), 'daily', 1_000),
            ).resolves.toBe(false);
            await expect(
                handlers().deleteUserHandlerIfUnbound(
                    scope(a),
                    `@${hashContent(SOURCE)}`,
                    1_000,
                ),
            ).resolves.toBe(true);

            await expect(handlers().deleteUserScopesForHolder(b)).resolves.toBe(
                1,
            );
            await expect(handlers().deleteForApp(app)).resolves.toBe(2);
            expect(await handlers().countForApp(scope(a))).toBe(0);
        });

        it('serves the user-scope reads from the holder-leading indexes', async () => {
            const app = `app-${uuidv4()}`;
            // A popular handler: many holders on one (app, name), so the
            // (app_uid, handler_name) index is the wrong one to pick.
            for (const holder of userIds)
                for (let i = 0; i < 80; i++)
                    await bind(holder, app, 'popular', 1);
            await handlers().publish({
                scope: { appUid: app, holder: userIds[0]! },
                name: 'popular',
                source: SOURCE,
            });
            await conn.query('ANALYZE TABLE `event_subscriptions`');
            await conn.query('ANALYZE TABLE `event_user_handlers`');

            const pread = vi.spyOn(server.clients.db, 'pread');
            const read = vi.spyOn(server.clients.db, 'read');
            try {
                await server.stores.durableSubscription.listByHandler(
                    app,
                    'user',
                    userIds[0]!,
                    'popular',
                );
                expect(await planKeys(pread)).toEqual({
                    event_subscriptions: 'idx_event_subscriptions_holder',
                });

                await handlers().countSubscriptionsByHandler({
                    appUid: app,
                    holder: userIds[0]!,
                });
                expect(await planKeys(read)).toEqual({
                    event_subscriptions: 'idx_event_subscriptions_holder',
                });

                await handlers().countUserScopesWithHandlersForUser(
                    userIds[0]!,
                    {
                        createdBefore: Date.now(),
                    },
                );
                expect((await planKeys(pread)).event_user_handlers).toBe(
                    'idx_event_user_handlers_holder_app',
                );

                await handlers().listUserScopesForUser(userIds[0]!);
                expect((await planKeys(read)).event_user_handlers).toBe(
                    'idx_event_user_handlers_holder_app',
                );

                await handlers().listUnboundUserHandlers(1_000);
                expect((await planKeys(read)).s).toBe(
                    'idx_event_subscriptions_holder',
                );
            } finally {
                pread.mockRestore();
                read.mockRestore();
            }
        }, 120_000);
    },
);
