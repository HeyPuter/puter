import bcrypt from 'bcrypt';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { deepMerge } from '../../tools/lib/configMigration.mjs';
import { PuterServer } from './server';
import { IConfig } from './types';
import { puterClients } from './clients';
import {
    PostgresDatabaseClient,
    type PostgresPool,
} from './clients/database/PostgresDatabaseClient';
import type { PoolConfig } from 'pg';
import { ADMIN_GROUP_UID } from './services/selfhosted/DefaultUserService';
import { FULL_API_ACCESS } from './services/permission/consts';
import { generateDefaultFsentries } from './util/userProvisioning';

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

export type SetupTestServerOptions = {
    /**
     * Listen on a real HTTP port so external clients (puter.js runners,
     * workerd, browsers) can connect. Default: in-process only, no listener.
     */
    listen?: boolean;
};

/**
 * Grab a free port by binding to 0 and releasing it. Done up-front (rather
 * than letting the server listen on 0) so the port is known while building
 * config — `origin` / `api_base_url` consumers like LocalWorkerService read
 * it at construction time.
 */
export const allocateEphemeralPort = (): Promise<number> =>
    new Promise((resolve, reject) => {
        const probe = createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as AddressInfo;
            probe.close(() => resolve(port));
        });
    });

// The JSON module's payload lives on `.default` — merging the namespace
// itself would bury every value under a stray `default` key.
const loadDefaultConfig = async (): Promise<IConfig> => {
    const { default: defaultConfig } = await import(
        '../../config.default.json',
        {
            with: {
                type: 'json',
            },
        }
    );
    return defaultConfig as unknown as IConfig;
};

export const setupTestServer = async (
    configOverrides?: IConfig,
    options?: SetupTestServerOptions,
): Promise<PuterServer> => {
    const defaultConfig = await loadDefaultConfig();
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
            no_browser_launch: true,
            import_ts_extensions: true,
        }),
        configOverrides ?? {},
    ) as IConfig;

    if (options?.listen) {
        if (!config.port) config.port = await allocateEphemeralPort();
        // Derive from `domain` so the advertised origins match the host
        // the subdomain gates expect (`api.<domain>` for API routes).
        const host = config.domain ?? '127.0.0.1';
        config.origin ??= `http://${host}:${config.port}`;
        config.api_base_url ??= config.domain
            ? `http://api.${config.domain}:${config.port}`
            : config.origin;
    }

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
        await server.start(!options?.listen);
    } catch (e) {
        pgMockClient?.destroy();
        throw e;
    }
    return server;
};

export type TestUserCredentials = {
    username: string;
    password: string;
    token: string;
    /**
     * Full-access access token (what the dashboard's "API Token" flow
     * mints). AI surfaces reject bare session tokens (`noUserSession`),
     * so suites exercising them authenticate with this instead.
     */
    apiToken: string;
    /**
     * User-scoped worker session token (what deploying a worker with no
     * app binding mints — `kind='worker'` session row). Never treated as
     * a root token: suites use it to prove worker credentials pass the
     * `noUserSession` gates.
     */
    workerToken: string;
};

/**
 * Seed a user with a known password directly through the stores (same steps
 * as DefaultUserService's admin bootstrap: bcrypt-hashed password, home
 * directory tree, optional admin-group membership) and mint a session token
 * the same way `POST /login` does.
 */
export const createTestUser = async (
    server: PuterServer,
    opts: { username: string; password: string; admin?: boolean },
): Promise<TestUserCredentials> => {
    const passwordHash = await bcrypt.hash(opts.password, 8);
    const created = await server.stores.user.create({
        username: opts.username,
        uuid: uuidv4(),
        password: passwordHash,
        email: null,
        requires_email_confirmation: false,
    });

    // Base driver permissions (kv, notifications, …) are system grants on
    // the default user group — membership is what a verified signup gets.
    const { default_user_group } = await loadDefaultConfig();
    if (default_user_group) {
        await server.stores.group.addUsers(default_user_group, [opts.username]);
    }
    if (opts.admin) {
        await server.stores.group.addUsers(ADMIN_GROUP_UID, [opts.username]);
    }

    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const user = (await server.stores.user.getById(created.id)) ?? created;

    const { token } = await server.services.auth.createSessionToken(user, {
        user_agent: 'puter-test-env',
    });

    // Mint the delegated credential the same way the dashboard's
    // "API Token" flow does (POST /auth/create-access-token with the
    // full-api-access sentinel).
    const apiToken = await server.services.auth.createAccessToken(
        { user },
        [[FULL_API_ACCESS]],
        { label: 'puter-test-env' },
    );

    // Mint a user-scoped worker token the same way deploying an app-less
    // worker does (WorkerDriver falls back to createWorkerSessionToken).
    const { token: workerToken } =
        await server.services.auth.createWorkerSessionToken(
            user,
            'puter-test-env-worker',
        );

    return {
        username: opts.username,
        password: opts.password,
        token,
        apiToken,
        workerToken,
    };
};

export type PuterTestEnv = {
    /**
     * Root origin (`http://puter.localhost:<port>`) — GUI and root-only
     * routes like `POST /login` live here.
     */
    origin: string;
    /**
     * API origin (`http://api.puter.localhost:<port>`) — what puter.js
     * clients use as their APIOrigin. Routes gated on the `api` subdomain
     * (e.g. `/whoami`) only match this host.
     */
    apiOrigin: string;
    /**
     * Seeded accounts: an admin and two regular (non-privileged) users.
     * `other` exists so suites can exercise cross-user flows (permission
     * grants, access denials) without creating users on the fly.
     */
    users: {
        admin: TestUserCredentials;
        user: TestUserCredentials;
        other: TestUserCredentials;
    };
    server: PuterServer;
    shutdown: () => Promise<void>;
};

export const TEST_ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'puter-test-admin-password',
};
export const TEST_USER_CREDENTIALS = {
    username: 'testuser',
    password: 'puter-test-user-password',
};
export const TEST_OTHER_USER_CREDENTIALS = {
    username: 'otheruser',
    password: 'puter-test-other-password',
};

/**
 * Boot an in-memory Puter server on a real ephemeral port with deterministic
 * credentials, for client test runners (puter.js on node, browsers, workerd).
 * Clients can authenticate with the pre-minted tokens or via a real
 * `POST /login` using the fixed passwords — no stdout scraping.
 */
export const setupPuterTestEnv = async (
    configOverrides?: IConfig,
): Promise<PuterTestEnv> => {
    const port = await allocateEphemeralPort();
    // Real hostnames rather than 127.0.0.1: API routes are gated on the
    // `api` subdomain, and `*.localhost` resolves to loopback on modern
    // platforms (and in browsers).
    const domain = 'puter.localhost';
    const origin = `http://${domain}:${port}`;
    const apiOrigin = `http://api.${domain}:${port}`;

    // Unlike unit-test servers (extensions: []), the client env loads the
    // real extensions — clients depend on endpoints that live there
    // (e.g. /whoami). Resolved from this module so cwd doesn't matter.
    const extensionsDir = fileURLToPath(
        new URL('../../extensions', import.meta.url),
    );

    const server = await setupTestServer(
        deepMerge(
            {
                port,
                domain,
                origin,
                api_base_url: apiOrigin,
                extensions: [extensionsDir],
            },
            configOverrides ?? {},
        ) as IConfig,
        { listen: true },
    );

    try {
        const admin = await createTestUser(server, {
            ...TEST_ADMIN_CREDENTIALS,
            admin: true,
        });
        const user = await createTestUser(server, TEST_USER_CREDENTIALS);
        const other = await createTestUser(server, TEST_OTHER_USER_CREDENTIALS);

        return {
            origin,
            apiOrigin,
            users: { admin, user, other },
            server,
            shutdown: () => server.shutdown(),
        };
    } catch (e) {
        await server.shutdown().catch(() => {});
        throw e;
    }
};
