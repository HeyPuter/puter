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

export {
    AbstractDatabaseClient as DatabaseClient,
    type WriteResult,
    type BatchEntry,
} from './DatabaseClient';
export { SqliteDatabaseClient } from './SqliteDatabaseClient';
export { MySQLDatabaseClient } from './MySQLDatabaseClient';

import type { IConfig } from '../../types';
import { AbstractDatabaseClient } from './DatabaseClient';
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
} as new (config: IConfig) => AbstractDatabaseClient;
