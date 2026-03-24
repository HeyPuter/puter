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
import { BaseService } from '../BaseService.js';
import { DB_WRITE, DB_READ } from './consts.js';
import { spanify } from '../../util/otelutil.js';

/**
* BaseDatabaseAccessService class extends BaseService to provide
* an abstraction layer for database access, enabling operations
* like reading, writing, and inserting data while managing
* different database configurations and optimizations.
*/
export class BaseDatabaseAccessService extends BaseService {
    static DB_WRITE = DB_WRITE;
    static DB_READ = DB_READ;

    case ( choices ) {
        const engine_name = this.constructor.ENGINE_NAME;
        if ( Object.prototype.hasOwnProperty.call(choices, engine_name) ) {
            return choices[engine_name];
        }
        return choices.otherwise;
    }

    /**
    * Retrieves the current instance of the service.
    * This method currently returns `this`, but it is designed
    * to allow for future enhancements such as auditing behavior
    * or implementing service-specific optimizations for database
    * interactions.
    *
    * @returns {BaseDatabaseAccessService} The current instance of the service.
    */
    get () {
        return this;
    }

    read = spanify('database:read', async (query, params) => {
        return await this._read(query, params);
    });

    /**
     * requireRead will fallback to the primary database
     * when a read-replica configuration is in use;
     * otherwise it behaves the same as `read()`.
     *
     * @param {string} query
     * @param {array} params
     * @returns {Promise<*>}
     */
    async tryHardRead (query, params) {
        return this._tryHardRead(query, params);
    }

    /**
     * requireRead will fallback to the primary database
     * when a read-replica configuration is in use by
     * delegating to `tryHardRead()`.
     * If the query returns no results, an error is thrown.
     *
     * @param {string} query
     * @param {array} params
     * @returns {Promise<*>}
     */
    async requireRead (query, params) {
        const results = this._tryHardRead(query, params);
        if ( results.length === 0 ) {
            throw new Error(`required read failed: ${ query}`);
        }
        return results;
    }

    pread = spanify('database:pread', async (query, params) => {
        return await this._read(query, params, { use_primary: true });
    });

    write = spanify('database:write', async (query, params) => {
        return await this._write(query, params);
    });

    async insert (table_name, data) {
        const values = Object.values(data);
        const sql = this._gen_insert_sql(table_name, data);
        return this.write(sql, values);
    }

    _gen_insert_sql (table_name, data) {
        const cols = Object.keys(data);
        return `INSERT INTO \`${ table_name }\` ` +
            `(${ cols.map(str => `\`${ str }\``).join(', ') }) ` +
            `VALUES (${ cols.map(() => '?').join(', ') })`;
    }

    batch_write (statements) {
        return this._batch_write(statements);
    }
}