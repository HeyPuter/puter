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
 * Deleted rows must not come back from a replica that hasn't caught up.
 *
 * Two real MySQL servers in replication, nothing mocked: `STOP REPLICA` freezes
 * the follower and MySQL raises the foreign-key errors itself. The co-located
 * unit tests inject them, since sqlite has neither a replica nor FK
 * enforcement.
 *
 * Needs both containers, so it is opt-in behind `PUTER_TEST_REPLICA_LAG` and
 * skipped everywhere it is unset, CI included.
 */

import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runWithContext } from '../core/context.ts';
import { optionalEnv, skipUnlessEnv } from '../drivers/integrationTestUtil.js';
import { PuterServer } from '../server.ts';
import { setupTestServer } from '../testUtil.ts';

const ENV_VAR = 'PUTER_TEST_REPLICA_LAG';
const PRIMARY = optionalEnv('PUTER_TEST_REPLICA_PRIMARY') ?? 'puter-mysql';
const REPLICA =
    optionalEnv('PUTER_TEST_REPLICA_FOLLOWER') ?? 'puter-mysql-replica';
const DB = 'puter_replica_lag_verify';

const mysql = (container: string, statement: string): string =>
    execFileSync(
        'docker',
        [
            'exec',
            container,
            'mysql',
            '-uroot',
            '-pputer',
            '-N',
            '-e',
            statement,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();

const onPrimary = (s: string) => mysql(PRIMARY, s);
const onReplica = (s: string) => mysql(REPLICA, s);
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

/** Freeze the follower: everything after this is primary-only. */
const freeze = () => onReplica('STOP REPLICA;');
const thaw = async () => {
    onReplica('START REPLICA;');
    await settle();
};

const randomName = (prefix: string) =>
    `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const makeUser = (server: PuterServer) =>
    server.stores.user.create({
        username: randomName('rl'),
        uuid: crypto.randomUUID(),
        password: null,
        email: null,
    });

const makeApp = (server: PuterServer, ownerUserId: number) =>
    (
        server.stores.app.create as unknown as (
            fields: Record<string, unknown>,
            opts: { ownerUserId: number },
        ) => Promise<{ uid: string; id: number; name: string }>
    )(
        {
            name: randomName('rlapp'),
            title: 'replica lag',
            index_url: 'https://example.test/rl.html',
        },
        { ownerUserId },
    );

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'a row deleted while a replica lags (integration)',
    () => {
        let server: PuterServer;

        beforeAll(async () => {
            onReplica('START REPLICA;');
            onPrimary(
                `DROP DATABASE IF EXISTS \`${DB}\`; CREATE DATABASE \`${DB}\`;`,
            );
            await settle(2000);

            server = await setupTestServer({
                database: {
                    engine: 'mysql',
                    host: '127.0.0.1',
                    port: 3306,
                    user: 'root',
                    password: 'puter',
                    database: DB,
                    migrationPaths: [
                        './src/backend/clients/database/migrations/mysql',
                    ],
                    replica: {
                        host: '127.0.0.1',
                        port: 3307,
                        user: 'root',
                        password: 'puter',
                        database: DB,
                    },
                },
            } as never);

            // Let the follower apply everything the migrations just wrote.
            await settle(3000);
        }, 300_000);

        afterAll(async () => {
            try {
                onReplica('START REPLICA;');
            } catch {
                // best effort
            }
            await server?.shutdown();
            try {
                onPrimary(`DROP DATABASE IF EXISTS \`${DB}\`;`);
            } catch {
                // best effort
            }
        });

        // Unconditional: a failed assertion must not leave the follower frozen.
        afterEach(async () => {
            await thaw();
        });

        it('is really stale on the follower — the premise of every case below', async () => {
            const user = await makeUser(server);
            const app = await makeApp(server, user.id);
            await settle();

            freeze();
            await server.stores.app.delete(app.id);

            expect(
                onPrimary(
                    `SELECT COUNT(*) FROM \`${DB}\`.apps WHERE uid='${app.uid}';`,
                ),
            ).toBe('0');
            expect(
                onReplica(
                    `SELECT COUNT(*) FROM \`${DB}\`.apps WHERE uid='${app.uid}';`,
                ),
            ).toBe('1');
        });

        it('does not let the follower put a deleted app back in cache', async () => {
            const user = await makeUser(server);
            const app = await makeApp(server, user.id);
            await settle();

            await server.stores.app.getByUid(app.uid);
            expect(
                await server.clients.redis.get(`apps:uid:${app.uid}`),
            ).not.toBeNull();

            freeze();
            await server.stores.app.delete(app.id);

            expect(await server.stores.app.getByUid(app.uid)).toBeNull();
            expect(
                await server.clients.redis.get(`apps:uid:${app.uid}`),
            ).toBeNull();
            expect(
                await server.clients.redis.get(`apps:uid:${app.uid}:deleted`),
            ).not.toBeNull();
        });

        it('does not let the follower put a deleted account back in cache', async () => {
            const user = await makeUser(server);
            await settle();

            await server.stores.user.getByUsername(user.username);
            expect(
                await server.clients.redis.get(
                    `users:username:${user.username}`,
                ),
            ).not.toBeNull();

            freeze();
            await server.services.userAccount.cascadeDelete(user.id);

            expect(
                onReplica(
                    `SELECT COUNT(*) FROM \`${DB}\`.user WHERE id=${user.id};`,
                ),
            ).toBe('1');
            expect(
                await server.stores.user.getByUsername(user.username),
            ).toBeNull();
            expect(
                await server.clients.redis.get(
                    `users:username:${user.username}`,
                ),
            ).toBeNull();
        });

        // Raw DELETE leaves the cache warm — the state a lost invalidation leaves.
        it('turns a real foreign-key rejection into 404, not an unhandled error', async () => {
            const user = await makeUser(server);
            const app = await makeApp(server, user.id);
            await settle();
            await server.stores.app.getByUid(app.uid);

            freeze();
            await server.clients.db.write('DELETE FROM `apps` WHERE `id` = ?', [
                app.id,
            ]);

            const actor = { user } as never;
            await expect(
                runWithContext({ actor }, () =>
                    server.services.permission.grantUserAppPermission(
                        actor,
                        app.uid,
                        'test:replica-lag',
                        {},
                        {},
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('turns a real foreign-key rejection on the session insert into 401', async () => {
            const user = await makeUser(server);
            await settle();
            await server.stores.user.getById(user.id);

            freeze();
            await server.clients.db.write('DELETE FROM `user` WHERE `id` = ?', [
                user.id,
            ]);

            await expect(
                server.stores.session.create(user.id, { kind: 'web' }),
            ).rejects.toMatchObject({ statusCode: 401 });
        });
    },
);
