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
const { trace } = require('@opentelemetry/api');
const BaseService = require('../BaseService');
const { DB_WRITE, DB_READ } = require('./consts');
const { spanify } = require('../../util/otelutil');

/**
* BaseDatabaseAccessService class extends BaseService to provide
* an abstraction layer for database access, enabling operations
* like reading, writing, and inserting data while managing
* different database configurations and optimizations.
*/
class BaseDatabaseAccessService extends BaseService {
    static DB_WRITE = DB_WRITE;
    static DB_READ = DB_READ;
    _setDbSpanAttributes (query) {
        const activeSpan = trace.getActiveSpan();
        if ( ! activeSpan ) return;
        activeSpan.setAttribute('query', query);
        activeSpan.setAttribute('trace', (new Error()).stack);
    }
    case ( choices ) {
        const engine_name = this.constructor.ENGINE_NAME;
        if ( Object.prototype.hasOwnProperty.call(choices, engine_name) ) {
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
    get (_accessLevel, _scope) {
        return this;
    }

    read = spanify('database:read', async (query, params) => {
        this._setDbSpanAttributes(query);
        if ( this.config.slow ) await new Promise(rslv => setTimeout(rslv, 70));
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
        if ( this.config.slow ) await new Promise(rslv => setTimeout(rslv, 70));
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
        if ( this.config.slow ) await new Promise(rslv => setTimeout(rslv, 70));
        const results = this._tryHardRead(query, params);
        if ( results.length === 0 ) {
            throw new Error(`required read failed: ${ query}`);
        }
        return results;
    }

    pread = spanify('database:pread', async (query, params) => {
        this._setDbSpanAttributes(query);
        if ( this.config.slow ) await new Promise(rslv => setTimeout(rslv, 70));
        return await this._read(query, params, { use_primary: true });
    });

    write = spanify('database:write', async (query, params) => {
        this._setDbSpanAttributes(query);
        if ( this.config.slow ) await new Promise(rslv => setTimeout(rslv, 70));
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

module.exports = {
    BaseDatabaseAccessService,
};
