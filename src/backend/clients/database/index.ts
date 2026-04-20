export {
    DatabaseClient,
    type WriteResult,
    type BatchEntry,
} from './DatabaseClient';
export { SqliteDatabaseClient } from './SqliteDatabaseClient';
export { MySQLDatabaseClient } from './MySQLDatabaseClient';

import type { IConfig } from '../../types';
import { DatabaseClient } from './DatabaseClient';
import { MySQLDatabaseClient } from './MySQLDatabaseClient';
import { SqliteDatabaseClient } from './SqliteDatabaseClient';

/**
 * Factory class registered in `puterClients`. PuterServer calls
 * `new DatabaseClientFactory(config)` — the constructor returns the
 * concrete subclass selected by `config.database.engine`.
 */
export const DatabaseClientFactory = class DatabaseClientFactory {
    constructor(config: IConfig) {
        const engine = config.database?.engine ?? 'sqlite';
        switch (engine) {
            case 'mysql':
                return new MySQLDatabaseClient(config);
            case 'sqlite':
                return new SqliteDatabaseClient(config);
            default:
                throw new Error(`Unknown database engine: ${engine}`);
        }
    }
} as new (config: IConfig) => DatabaseClient;
