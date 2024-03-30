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
const { BaseDatabaseAccessService } = require("./BaseDatabaseAccessService");

class SqliteDatabaseAccessService extends BaseDatabaseAccessService {
    static ENGINE_NAME = 'sqlite';

    static MODULES = {
        // Documentation calls it 'Database'; it's new-able so
        // I'll stick with their convention over ours.
        Database: require('better-sqlite3'),
    };

    async _init () {
        const require = this.require;
        const Database = require('better-sqlite3');

        this._register_commands(this.services.get('commands'));

        const fs = require('fs');
        const path_ = require('path');
        const do_setup = ! fs.existsSync(this.config.path);

        this.db = new Database(this.config.path);

        if ( do_setup ) {
            const sql_files = [
                '0001_create-tables.sql',
                '0002_add-default-apps.sql',
            ].map(p => path_.join(__dirname, 'sqlite_setup', p));
            const fs = require('fs');
            for ( const filename of sql_files ) {
                const contents = fs.readFileSync(filename, 'utf8');
                this.db.exec(contents);
            }
        }

        // Create the tables if they don't exist.
        const check =
            `SELECT name FROM sqlite_master WHERE type='table' AND name='fsentries'`;
        const rows = await this.db.prepare(check).all();
        if ( rows.length === 0 ) {
            throw new Error('it works');
        }
    }

    async _read (query, params = []) {
        query = this.sqlite_transform_query_(query);
        params = this.sqlite_transform_params_(params);
        return this.db.prepare(query).all(...params);
    }

    async _requireRead (query, params) {
        return this._read(query, params);
    }

    async _write (query, params) {
        query = this.sqlite_transform_query_(query);
        params = this.sqlite_transform_params_(params);

        try {
            const stmt = this.db.prepare(query);
            const info = stmt.run(...params);

            return {
                insertId: info.lastInsertRowid,
                anyRowsAffected: info.changes > 0,
            };
        } catch ( e ) {
            console.error(e);
            console.log('everything', {
                query, params,
            })
            console.log(params.map(p => typeof p));
            // throw e;
        }
    }

    async _batch_write (entries) {
        this.db.transaction(() => {
            for ( let { statement, values } of entries ) {
                statement = this.sqlite_transform_query_(statement);
                values = this.sqlite_transform_params_(values);
                this.db.prepare(statement).run(values);
            }
        })();
    }


    sqlite_transform_query_ (query) {
        // replace `now()` with `datetime('now')`
        query = query.replace(/now\(\)/g, 'datetime(\'now\')');

        return query;
    }

    sqlite_transform_params_ (params) {
        return params.map(p => {
            if ( typeof p === 'boolean' ) {
                return p ? 1 : 0;
            }
            return p;
        });
    }

    _register_commands (commands) {
        commands.registerCommands('sqlite', [
            {
                id: 'execfile',
                description: 'execute a file',
                handler: async (args, log) => {
                    try {
                        const [filename] = args;
                        const fs = require('fs');
                        const contents = fs.readFileSync(filename, 'utf8');
                        this.db.exec(contents);
                    } catch (err) {
                        log.error(err.message);
                    }
                }
            },
            {
                id: 'read',
                description: 'read a query',
                handler: async (args, log) => {
                    try {
                        const [query] = args;
                        const rows = this._read(query, []);
                        log.log(rows);
                    } catch (err) {
                        log.error(err.message);
                    }
                }
            },
        ])
    }
}

module.exports = {
    SqliteDatabaseAccessService,
};
