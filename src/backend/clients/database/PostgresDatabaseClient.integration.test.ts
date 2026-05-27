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

import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { IConfig } from '../../types';
import type { PuterServer } from '../../server';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { setupTestServer } from '../../testUtil.js';
import { PostgresDatabaseClient } from './PostgresDatabaseClient.js';

const postgresUrl = process.env.PUTER_TEST_POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;
const postgresMigrationsPath =
    'src/backend/clients/database/migrations/postgres';

const postgresConfig = (overrides: Partial<IConfig> = {}): IConfig => ({
    port: 0,
    extensions: [],
    database: {
        engine: 'postgres',
        connectionString: postgresUrl,
        migrationPaths: [postgresMigrationsPath],
    },
    ...overrides,
});

const resetPostgresSchema = async (): Promise<void> => {
    if (!postgresUrl) return;

    const pool = new Pool({ connectionString: postgresUrl });
    try {
        await pool.query('DROP SCHEMA public CASCADE');
        await pool.query('CREATE SCHEMA public');
    } finally {
        await pool.end();
    }
};

describePostgres('PostgresDatabaseClient integration', () => {
    let server: PuterServer | undefined;

    beforeEach(async () => {
        await resetPostgresSchema();
    });

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('applies the native migrations idempotently to an empty database', async () => {
        const firstClient = new PostgresDatabaseClient(postgresConfig());
        await firstClient.onServerStart();
        await firstClient.onServerShutdown();

        const secondClient = new PostgresDatabaseClient(postgresConfig());
        await secondClient.onServerStart();
        try {
            const [systemUser] = await secondClient.read(
                'SELECT `id`, `username` FROM `user` WHERE `username` = ?',
                ['system'],
            );
            const [devCenter] = await secondClient.read(
                'SELECT `name`, `index_url` FROM `apps` WHERE `name` = ?',
                ['dev-center'],
            );

            expect(systemUser).toMatchObject({
                id: 1,
                username: 'system',
            });
            expect(devCenter).toMatchObject({
                name: 'dev-center',
                index_url: 'https://builtins.namespaces.puter.com/dev-center',
            });
        } finally {
            await secondClient.onServerShutdown();
        }
    });

    it('starts the server and exercises user, app, fsentry, permission, and session flows', async () => {
        server = await setupTestServer(
            postgresConfig({
                no_default_user: false,
            }),
        );

        const admin = await server.stores.user.getByUsername('admin');
        expect(admin?.username).toBe('admin');

        const username = `pg-${uuidv4().slice(0, 8)}`;
        const createdUser = await server.stores.user.create({
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
            createdUser,
        );
        const user = await server.stores.user.getById(createdUser.id);
        if (!user) throw new Error('created user was not readable');
        expect(user.username).toBe(username);

        const authResult = await server.services.auth.createSessionToken(
            user,
            {
                ip: '127.0.0.1',
                user_agent: 'postgres-integration-test',
            },
        );
        const authenticated =
            await server.services.auth.authenticateFromToken(authResult.token);
        expect(authenticated?.user?.id).toBe(user?.id);

        const devCenter = await server.stores.app.getByName('dev-center');
        if (!devCenter) throw new Error('dev-center app was not seeded');
        expect(devCenter.name).toBe('dev-center');

        const documents = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );
        if (!documents) throw new Error('Documents directory was not created');
        expect(documents.is_dir).toBe(true);
        const folder = await server.stores.fsEntry.createNonFileEntry({
            userId: user.id,
            parent: documents,
            name: 'postgres-folder',
            kind: 'directory',
        });
        const renamedFolder = await server.stores.fsEntry.updateEntry(
            folder.uuid,
            {
                name: 'postgres-folder-renamed',
                path: `/${username}/Documents/postgres-folder-renamed`,
            },
        );
        expect(renamedFolder.name).toBe('postgres-folder-renamed');

        await server.stores.permission.upsertUserAppPerm(
            user.id,
            Number(devCenter.id),
            'driver:postgres-integration',
            { ok: true },
        );
        await expect(
            server.stores.permission.hasUserAppPerm(
                user.id,
                Number(devCenter.id),
                'driver:postgres-integration',
            ),
        ).resolves.toBe(true);

        const session = await server.stores.session.create(user.id, {
            meta: { source: 'postgres-integration-test' },
        });
        const activeSession = await server.stores.session.getByUuid(
            session.uuid,
        );
        expect(activeSession?.uuid).toBe(session.uuid);

        await server.stores.session.revoke(session.uuid);
        await expect(
            server.stores.session.getByUuid(session.uuid),
        ).resolves.toBeNull();
    });
});
