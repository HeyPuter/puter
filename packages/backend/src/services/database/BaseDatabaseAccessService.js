/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const BaseService = require("../BaseService");
const { DB_WRITE, DB_READ } = require("./consts");

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
    get () {
        return this;
    }

    read (query, params) {
        return this._read(query, params);
    }

    pread (query, params) {
        return this._read(query, params, { use_primary: true });
    }

    write (query, params) {
        return this._write(query, params);
    }

    batch_write (statements) {
        return this._batch_write(statements);
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
    requireRead (query, params) {
        return this._requireRead(query, params);
    }
}

module.exports = {
    BaseDatabaseAccessService,
};
