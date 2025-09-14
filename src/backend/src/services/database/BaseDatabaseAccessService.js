// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const BaseService = require("../BaseService");
const { DB_WRITE, DB_READ } = require("./consts");


/**
* BaseDatabaseAccessService class extends BaseService to provide 
* an abstraction layer for database access, enabling operations 
* like reading, writing, and inserting data while managing 
* different database configurations and optimizations.
*/
class BaseDatabaseAccessService extends BaseService {
    static DB_WRITE = DB_WRITE;
    static DB_READ = DB_READ;
    case ( choices ) {
        const engine_name = this.constructor.ENGINE_NAME;
        if ( choices.hasOwnProperty(engine_name) ) {
            return choices[engine_name];
        }
        return choices.otherwise;
    }

    // Call get() with an access mode and a scope.
    // Right now it just returns `this`, but in the
    // future it can be used to audit the behaviour
    // of other services or handle service-specific
    // database optimizations.
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

    async read (query, params) {
        const svc_trace = this.services.get('traceService');
        return await svc_trace.spanify(`database:read`, async () => {
            return await this._read(query, params);
        }, { attributes: { query, trace: (new Error()).stack } });
    }

    /**
     * requireRead will fallback to the primary database
     * when a read-replica configuration is in use;
     * otherwise it behaves the same as `read()`.
     *
     * @param {string} query
     * @param {array} params
     * @returns {Promise<*>}
     */
    tryHardRead (query, params) {
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
    requireRead (query, params) {
        const results = this._tryHardRead(query, params);
        if ( results.length === 0 ) {
            throw new Error('required read failed: ' + query);
        }
        return results;
    }

    async pread (query, params) {
        const svc_trace = this.services.get('traceService');
        return await svc_trace.spanify(`database:pread`, async () => {
            return await this._read(query, params, { use_primary: true });
        }, { attributes: { query, trace: (new Error()).stack } });
    }

    async write (query, params) {
        const svc_trace = this.services.get('traceService');
        return await svc_trace.spanify(`database:write`, async () => {
            return await this._write(query, params);
        }, { attributes: { query, trace: (new Error()).stack } });
    }

    insert (table_name, data) {
        const values = Object.values(data);
        const sql = this._gen_insert_sql(table_name, data);
        console.log('INSERT SQL', sql);
        return this.write(sql, values);
    }

    _gen_insert_sql (table_name, data) {
        const cols = Object.keys(data);
        return 'INSERT INTO `' + table_name + '` ' +
            '(' + cols.map(str => '`' + str + '`').join(', ') + ') ' +
            'VALUES (' + cols.map(() => '?').join(', ') + ')';
    }


    batch_write (statements) {
        return this._batch_write(statements);
    }
}

module.exports = {
    BaseDatabaseAccessService,
};
