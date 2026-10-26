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
 * Withdrawing a share against a replica that lags the primary, and the MySQL
 * matching rules a share's grants and rows meet. Runs on SQLite, and also on
 * MySQL when `PUTER_TEST_MYSQL_PORT` names one.
 */

import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { EVENTS_KV_HANDLE_LIMIT } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    kvShareGrantAtEveryLevel,
    kvSharePermission,
    type KvShareAccess,
} from './kvShares.js';

const BOOT_TIMEOUT_MS = 300_000;
const GLOBAL = 'os-global';
const MYSQL = {
    host: '127.0.0.1',
    port: Number(process.env.PUTER_TEST_MYSQL_PORT ?? 3307),
    user: 'root',
    password: 'puter',
};
const MIGRATIONS = fileURLToPath(
    new URL('../../clients/database/migrations/mysql', import.meta.url),
);
const ENGINES = [
    'sqlite',
    ...(process.env.PUTER_TEST_MYSQL_PORT ? ['mysql'] : []),
] as const;

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
    uuid: string;
}

describe.each(ENGINES)('key-value shares on %s', (engine) => {
    const database = `kv_share_${Date.now().toString(36)}`;
    let env: PuterTestEnv;
    let owner: TestUser;
    let guest: TestUser;

    const db = () => env.server.clients.db;
    const shares = () => env.server.services.kvShare;
    const permissions = () => env.server.services.permission;
    const handles = () => env.server.stores.kvShareHandle;
    const flat = () => env.server.stores.permission;

    const userFor = async (username: string): Promise<TestUser> => {
        const row = await env.server.stores.user.getByUsername(username);
        return {
            actor: makeActor({ user: row as never }),
            username,
            id: row!.id,
            uuid: row!.uuid as string,
        };
    };

    const region = (label: string) => `${label}-${uuidv4().slice(0, 8)}:`;

    const share = (prefix: string, access: KvShareAccess) =>
        shares().mintKvHandle(
            owner.actor,
            { prefix, recipient: { username: guest.username }, access },
            { defaultAccess: 'read' },
        );

    const grantRows = async (prefix: string) =>
        (
            await db().pread(
                'SELECT `permission` FROM `user_to_user_permissions` ' +
                    'WHERE `holder_user_id` = ? AND `permission` IN (?, ?, ?)',
                [
                    guest.id,
                    ...kvShareGrantAtEveryLevel(
                        kvSharePermission(owner.uuid, GLOBAL, prefix),
                    ),
                ],
            )
        ).map((row) => String(row.permission));

    /**
     * From here until the returned function runs, replica reads see the grant
     * table as it is now and primary reads see it as it really is.
     */
    const lagReplica = async () => {
        await db().write('DROP TABLE IF EXISTS `u2u_lagging`');
        await db().write(
            'CREATE TABLE `u2u_lagging` AS SELECT * FROM `user_to_user_permissions`',
        );
        const read = db().read.bind(db());
        const replica = vi
            .spyOn(db(), 'read')
            .mockImplementation((query, params) =>
                read(
                    query.replaceAll(
                        '`user_to_user_permissions`',
                        '`u2u_lagging`',
                    ),
                    params,
                ),
            );
        // SQLite's own primary read goes through `read`, so route it past the
        // lagging view explicitly.
        const primary = vi
            .spyOn(db(), 'pread')
            .mockImplementation((query, params) => read(query, params));
        return async () => {
            replica.mockRestore();
            primary.mockRestore();
            await db().write('DROP TABLE `u2u_lagging`');
        };
    };

    /** No row, no flat entry, and no write reaching a later nested share. */
    const expectWithdrawn = async (prefix: string) => {
        expect(await grantRows(prefix)).toEqual([]);
        expect(
            await flat().getFlatUserPerms(
                guest.id,
                kvShareGrantAtEveryLevel(
                    kvSharePermission(owner.uuid, GLOBAL, prefix),
                ),
            ),
        ).toEqual([]);
        const nested = await share(`${prefix}nested:`, 'watch');
        await expect(
            runWithContext({ actor: guest.actor }, () =>
                env.server.drivers.kvStore.set({
                    key: 'k',
                    value: 1,
                    optConfig: { handle: nested.handle },
                }),
            ),
        ).rejects.toMatchObject({ legacyCode: 'kv_handle_access_denied' });
    };

    beforeAll(async () => {
        const flags = {
            events: { enabled: true, kvHandles: true },
            kv: { shareHandles: true },
            unlimitedMetering: true,
        };
        if (engine === 'mysql') {
            const admin = await mysql.createConnection(MYSQL);
            await admin.query(`CREATE DATABASE \`${database}\``);
            await admin.end();
            env = await setupPuterTestEnv({
                ...flags,
                database: {
                    engine: 'mysql',
                    ...MYSQL,
                    database,
                    migrationPaths: [MIGRATIONS],
                },
            } as never);
        } else {
            env = await setupPuterTestEnv(flags as IConfig);
        }
        owner = await userFor(env.users.user.username);
        guest = await userFor(env.users.other.username);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
        if (engine !== 'mysql') return;
        const admin = await mysql.createConnection(MYSQL);
        await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await admin.end();
    });

    beforeEach(async () => {
        for (const user of [owner, guest])
            await env.server.clients.redis.del(
                `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${user.id}`,
            );
    });

    describe('an owner revoke while the replica lags', () => {
        it('withdraws a share minted inside the lag', async () => {
            const prefix = region('lag-mint');
            const thaw = await lagReplica();
            try {
                const { handle } = await share(prefix, 'write');
                await shares().removeKvShare(owner.actor, handle);
            } finally {
                await thaw();
            }
            await expectWithdrawn(prefix);
        });

        it('withdraws the write grant of a read share raised inside the lag', async () => {
            const prefix = region('lag-raise');
            const { handle } = await share(prefix, 'read');
            const thaw = await lagReplica();
            try {
                await share(prefix, 'write');
                await shares().removeKvShare(owner.actor, handle);
            } finally {
                await thaw();
            }
            await expectWithdrawn(prefix);
        });

        it('clears a flat entry under the region that no row backs', async () => {
            const prefix = region('orphan');
            const { handle } = await share(prefix, 'read');
            const orphan = kvSharePermission(
                owner.uuid,
                GLOBAL,
                `${prefix}deep:`,
                'write',
            );
            await flat().setFlatUserPerm(guest.id, orphan, {
                permission: orphan,
                issuer_user_id: owner.id,
                deleted: false,
            });

            await shares().removeKvShare(owner.actor, handle);

            expect(await flat().getFlatUserPerms(guest.id, [orphan])).toEqual(
                [],
            );
        });
    });

    describe('matching a share`s prefix', () => {
        it('finds a live share by its exact bytes only', async () => {
            const prefix = region('exact');
            await share(prefix, 'read');
            const input = {
                ownerUserId: owner.id,
                granteeUserId: guest.id,
                appUid: GLOBAL,
                keyPrefix: prefix,
            };
            expect(await handles().findLive(input)).not.toBeNull();
            expect(
                await handles().findLive({
                    ...input,
                    keyPrefix: prefix.toUpperCase(),
                }),
            ).toBeNull();
        });

        it.skipIf(engine !== 'mysql')(
            'uses no operator MySQL warns is deprecated, whatever the connection charset',
            async () => {
                const pread = vi.spyOn(db(), 'pread');
                let call: unknown[] | undefined;
                try {
                    await handles().findLive({
                        ownerUserId: owner.id,
                        granteeUserId: guest.id,
                        appUid: GLOBAL,
                        keyPrefix: region('warn'),
                    });
                    call = pread.mock.calls.find(([query]) =>
                        query.includes('`key_prefix`'),
                    );
                } finally {
                    pread.mockRestore();
                }
                expect(call).toBeDefined();

                // The text protocol, so the statement is parsed (and warned
                // about) as it runs.
                const connection = await mysql.createConnection({
                    ...MYSQL,
                    database,
                    charset: 'LATIN1_SWEDISH_CI',
                });
                try {
                    await connection.query(
                        String(call![0]),
                        call![1] as never[],
                    );
                    const [warnings] = await connection.query('SHOW WARNINGS');
                    expect(warnings).toEqual([]);
                } finally {
                    await connection.end();
                }
            },
        );
    });

    describe('revoking a grant the database spells differently', () => {
        it.skipIf(engine !== 'mysql')(
            'clears the flat entry under the spelling it removed',
            async () => {
                const tag = uuidv4().slice(0, 8);
                const stored = kvSharePermission(
                    owner.uuid,
                    GLOBAL,
                    `Notes-${tag}:`,
                    'read',
                );
                const asked = kvSharePermission(
                    owner.uuid,
                    GLOBAL,
                    `notes-${tag}:`,
                    'read',
                );
                await permissions().grantUserUserPermission(
                    owner.actor,
                    guest.username,
                    stored,
                );
                expect(await permissions().check(guest.actor, stored)).toBe(
                    true,
                );

                const removed = await permissions().revokeUserUserPermissions(
                    owner.actor,
                    guest.username,
                    [asked],
                );

                expect(removed).toEqual([stored]);
                expect(
                    await flat().getFlatUserPerms(guest.id, [stored]),
                ).toEqual([]);
                expect(await permissions().check(guest.actor, stored)).toBe(
                    false,
                );
            },
        );
    });
});
