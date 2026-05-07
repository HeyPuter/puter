import { deepMerge } from '../../tools/lib/configMigration.mjs';
import { PuterServer } from './server';
import { IConfig } from './types';

export const setupTestServer = async (configOverrides?: IConfig) => {
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
            database: { engine: 'sqlite', inMemory: true },
            dynamo: { inMemory: true, bootstrapTables: true },
            redis: { useMock: true },
            s3: { localConfig: { inMemory: true } },
            no_default_user: true,
            no_devwatch: true,
        }),
        configOverrides ?? {},
    );
    const server = new PuterServer(config);
    await server.start(true);
    return server;
};
