import { deepMerge } from '../../tools/lib/configMigration.mjs';
import { PuterServer } from './server';
import { IConfig } from './types';
import { puterClients } from './clients';
import {
    PostgresDatabaseClient,
    type PostgresPool,
} from './clients/database/PostgresDatabaseClient';
import type { PoolConfig } from 'pg';

export const POSTGRES_TEST_MIGRATIONS_PATH =
    'src/backend/clients/database/migrations/postgres';

type PgMockPostgresHarness = {
    client: PostgresDatabaseClient;
    createClient: () => PostgresDatabaseClient;
    destroy: () => void;
};

const usesPgMockPostgres = (config: IConfig): boolean => {
    const database = config.database;
    if (database?.engine !== 'postgres' || database.inMemory !== true) {
        return false;
    }

    return !(
        database.connectionString ||
        database.url ||
        database.host ||
        database.port ||
        database.user ||
        database.password ||
        database.database ||
        database.replica
    );
};

export const createPgMockPostgresDatabaseClient = async (
    config: IConfig,
): Promise<PgMockPostgresHarness> => {
    const [{ PostgresMock }, { Pool }] = await Promise.all([
        import('pgmock'),
        import('pg'),
    ]);
    const mock = await PostgresMock.create();
    const pgMockConfig = mock.getNodePostgresConfig();
    const createPgMockStream = pgMockConfig.stream;
    const poolFactory = (poolConfig: PoolConfig): PostgresPool =>
        new Pool({
            ...poolConfig,
            database: 'postgres',
            ...pgMockConfig,
            stream: () => {
                const stream = createPgMockStream();
                stream.ref = () => stream;
                stream.unref = () => stream;
                return stream;
            },
        }) as unknown as PostgresPool;
    const createClient = () => new PostgresDatabaseClient(config, poolFactory);

    return {
        client: createClient(),
        createClient,
        destroy: () => mock.destroy(),
    };
};

/**
 * When `PUTER_TEST_DB_ENGINE=postgres` is set, `setupTestServer` swaps its
 * default sqlite test database for an in-memory Postgres backed by pgmock
 * (with the bundled Postgres migrations applied on boot). Tests that
 * explicitly override `database` still win — the env var only affects the
 * implicit default used by callers that don't pass any DB overrides.
 *
 * Recognized values: `postgres` → pgmock. Anything else (including unset) →
 * the original sqlite-in-memory default.
 */
const testDatabaseDefault = (): IConfig['database'] => {
    const engine = (process.env.PUTER_TEST_DB_ENGINE ?? '').toLowerCase();
    if (engine === 'postgres') {
        return {
            engine: 'postgres',
            inMemory: true,
            migrationPaths: [POSTGRES_TEST_MIGRATIONS_PATH],
        };
    }
    return { engine: 'sqlite', inMemory: true };
};

export const setupTestServer = async (
    configOverrides?: IConfig,
): Promise<PuterServer> => {
    // read default config json
    const defaultConfig = await import('../../config.default.json', {
        with: {
            type: 'json',
        },
    });
    // merge default config with overrides and test defaults
    const config = deepMerge(
        deepMerge(defaultConfig, {
            extensions: [],
            port: 0,
            database: testDatabaseDefault(),
            dynamo: { inMemory: true, bootstrapTables: true },
            redis: { useMock: true },
            s3: { localConfig: { inMemory: true } },
            no_default_user: true,
            no_devwatch: true,
        }),
        configOverrides ?? {},
    ) as IConfig;

    let pgMockClient: PgMockPostgresHarness | undefined;
    if (usesPgMockPostgres(config)) {
        const database = config.database;
        if (!database) {
            throw new Error('Postgres test database config is missing');
        }
        database.migrationPaths ??= [POSTGRES_TEST_MIGRATIONS_PATH];
        pgMockClient = await createPgMockPostgresDatabaseClient(config);
    }

    const server = new PuterServer(
        config,
        pgMockClient ? { ...puterClients, db: pgMockClient.client } : undefined,
    );

    if (pgMockClient) {
        const originalShutdown = server.shutdown.bind(server);
        let destroyPgMock: (() => void) | undefined = pgMockClient.destroy;
        server.shutdown = async () => {
            try {
                await originalShutdown();
            } finally {
                destroyPgMock?.();
                destroyPgMock = undefined;
            }
        };
    }

    try {
        await server.start(true);
    } catch (e) {
        pgMockClient?.destroy();
        throw e;
    }
    return server;
};
