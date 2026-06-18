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
import {
    createPgMockPostgresDatabaseClient,
    POSTGRES_TEST_MIGRATIONS_PATH,
    setupTestServer,
} from '../../testUtil.js';
import { PostgresDatabaseClient } from './PostgresDatabaseClient.js';

const postgresUrl = process.env.PUTER_TEST_POSTGRES_URL;
const postgresMigrationsPath = POSTGRES_TEST_MIGRATIONS_PATH;
const postgresTestSchemaPattern = /^puter_test_[a-f0-9]{32}$/u;
const postgresIntegrationTimeoutMs = 180_000;

let postgresTestSchema: string | undefined;
let postgresTestUrl: string | undefined;

const postgresConfig = (overrides: Partial<IConfig> = {}): IConfig => {
    if (postgresUrl && !postgresTestUrl) {
        throw new Error('Postgres test schema was not initialized');
    }

    const { database: databaseOverrides, ...rootOverrides } = overrides;
    const database = postgresUrl
        ? {
              engine: 'postgres' as const,
              inMemory: false,
              connectionString: postgresTestUrl,
              migrationPaths: [postgresMigrationsPath],
          }
        : {
              engine: 'postgres' as const,
              inMemory: true,
              migrationPaths: [postgresMigrationsPath],
          };

    return {
        port: 0,
        extensions: [],
        database: { ...database, ...(databaseOverrides ?? {}) },
        ...rootOverrides,
    };
};

const quoteTestSchemaIdentifier = (schema: string): string => {
    if (!postgresTestSchemaPattern.test(schema)) {
        throw new Error(`Unsafe Postgres test schema name: ${schema}`);
    }
    return `"${schema}"`;
};

const postgresConnectionStringForSchema = (
    connectionString: string,
    schema: string,
): string => {
    if (!postgresTestSchemaPattern.test(schema)) {
        throw new Error(`Unsafe Postgres test schema name: ${schema}`);
    }

    const url = new URL(connectionString);
    url.searchParams.set('options', `-c search_path=${schema}`);
    return url.toString();
};

const createPostgresTestSchema = async (): Promise<void> => {
    if (!postgresUrl) return;

    const schema = `puter_test_${uuidv4().replaceAll('-', '')}`;
    const pool = new Pool({ connectionString: postgresUrl });
    try {
        await pool.query(`CREATE SCHEMA ${quoteTestSchemaIdentifier(schema)}`);
        postgresTestSchema = schema;
        postgresTestUrl = postgresConnectionStringForSchema(
            postgresUrl,
            schema,
        );
    } finally {
        await pool.end();
    }
};

const dropPostgresTestSchema = async (): Promise<void> => {
    if (!postgresUrl || !postgresTestSchema) return;

    const schema = postgresTestSchema;
    postgresTestSchema = undefined;
    postgresTestUrl = undefined;

    const pool = new Pool({ connectionString: postgresUrl });
    try {
        await pool.query(
            `DROP SCHEMA IF EXISTS ${quoteTestSchemaIdentifier(schema)} CASCADE`,
        );
    } finally {
        await pool.end();
    }
};

describe('PostgresDatabaseClient integration', () => {
    let server: PuterServer | undefined;

    beforeEach(async () => {
        await createPostgresTestSchema();
    });

    afterEach(async () => {
        try {
            await server?.shutdown();
        } finally {
            server = undefined;
            await dropPostgresTestSchema();
        }
    });

    it(
        'applies the native migrations idempotently to an empty database',
        async () => {
            const config = postgresConfig();
            const pgMockClient = postgresUrl
                ? undefined
                : await createPgMockPostgresDatabaseClient(config);
            try {
                const firstClient =
                    pgMockClient?.client ?? new PostgresDatabaseClient(config);
                try {
                    await firstClient.onServerStart();
                } finally {
                    await firstClient.onServerShutdown();
                }

                const secondClient =
                    pgMockClient?.createClient() ??
                    new PostgresDatabaseClient(config);
                try {
                    await secondClient.onServerStart();
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
                        index_url:
                            'https://builtins.namespaces.puter.com/dev-center',
                    });
                } finally {
                    await secondClient.onServerShutdown();
                }
            } finally {
                pgMockClient?.destroy();
            }
        },
        postgresIntegrationTimeoutMs,
    );

    it('starts the server and exercises user, app, fsentry, permission, and session flows', async () => {
        const userStorageAllowance = 123_456_789;
        server = await setupTestServer(
            postgresConfig({
                no_default_user: false,
                is_storage_limited: true,
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
            free_storage: userStorageAllowance,
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
        await expect(
            server.stores.fsEntry.getUserStorageAllowance(user.id),
        ).resolves.toMatchObject({
            max: userStorageAllowance,
        });

        const otherUsername = `pg-other-${uuidv4().slice(0, 8)}`;
        const otherUser = await server.stores.user.create({
            username: otherUsername,
            uuid: uuidv4(),
            password: null,
            email: `${otherUsername}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });

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
        expect(documents.isDir).toBe(true);
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

        await server.stores.oidc.link(
            user.id,
            'postgres-integration-test',
            'subject-1',
            null,
        );
        await expect(
            server.stores.oidc.link(
                user.id,
                'postgres-integration-test',
                'subject-1',
                null,
            ),
        ).resolves.toBeUndefined();
        await expect(
            server.stores.oidc.link(
                otherUser.id,
                'postgres-integration-test',
                'subject-1',
                null,
            ),
        ).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'conflict',
        });

        const session = await server.stores.session.create(user.id, {
            meta: { source: 'postgres-integration-test' },
        });
        const activeSession = await server.stores.session.getByUuid(
            session.uuid,
        );
        expect(activeSession?.uuid).toBe(session.uuid);

        const workerName = `worker-${uuidv4().slice(0, 8)}`;
        const workerSession = await server.stores.session.getOrCreateWorker(
            user.id,
            { workerName },
        );
        expect(workerSession?.kind).toBe('worker');
        expect(workerSession?.meta?.worker_name).toBe(workerName);

        await server.stores.session.removeByUuid(session.uuid);
        await expect(
            server.stores.session.getByUuid(session.uuid),
        ).resolves.toBeNull();
    }, postgresIntegrationTimeoutMs);
});
