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
const { es_import_promise } = require("../../fun/dev-console-ui-utils");
const { surrounding_box } = require("../../fun/dev-console-ui-utils");
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

        // Database upgrade logic
        const TARGET_VERSION = 9;

        if ( do_setup ) {
            this.log.noticeme(`SETUP: creating database at ${this.config.path}`);
            const sql_files = [
                '0001_create-tables.sql',
                '0002_add-default-apps.sql',
                '0003_user-permissions.sql',
                '0004_sessions.sql',
                '0005_background-apps.sql',
                '0006_update-apps.sql',
                '0007_sessions.sql',
                '0008_otp.sql',
                '0009_app-prefix-fix.sql',
                '0010_add-git-app.sql',
            ].map(p => path_.join(__dirname, 'sqlite_setup', p));
            const fs = require('fs');
            for ( const filename of sql_files ) {
                const basename = path_.basename(filename);
                this.log.noticeme(`applying ${basename}`);
                const contents = fs.readFileSync(filename, 'utf8');
                this.db.exec(contents);
            }
            await this.db.exec(`PRAGMA user_version = ${TARGET_VERSION};`);
        }

        const [{ user_version }] = await this._read('PRAGMA user_version');
        this.log.info('database version: ' + user_version);

        const upgrade_files = [];

        if ( user_version <= 0 ) {
            upgrade_files.push('0003_user-permissions.sql');
        }

        if ( user_version <= 1 ) {
            upgrade_files.push('0004_sessions.sql');
        }

        if ( user_version <= 2 ) {
            upgrade_files.push('0005_background-apps.sql');
        }

        if ( user_version <= 3 ) {
            upgrade_files.push('0006_update-apps.sql');
        }

        if ( user_version <= 4 ) {
            upgrade_files.push('0007_sessions.sql');
        }

        if ( user_version <= 5 ) {
            upgrade_files.push('0008_otp.sql');
        }

        if ( user_version <= 6 ) {
            upgrade_files.push('0009_app-prefix-fix.sql');
        }

        if ( user_version <= 7 ) {
            upgrade_files.push('0010_add-git-app.sql');
        }

        if ( user_version <= 8 ) {
            upgrade_files.push('0011_notification.sql');
        }

        if ( upgrade_files.length > 0 ) {
            this.log.noticeme(`Database out of date: ${this.config.path}`);
            this.log.noticeme(`UPGRADING DATABASE: ${user_version} -> ${TARGET_VERSION}`);
            this.log.noticeme(`${upgrade_files.length} .sql files to apply`);

            const sql_files = upgrade_files.map(
                p => path_.join(__dirname, 'sqlite_setup', p)
            );
            const fs = require('fs');
            for ( const filename of sql_files ) {
                const basename = path_.basename(filename);
                this.log.noticeme(`applying ${basename}`);
                const contents = fs.readFileSync(filename, 'utf8');
                this.db.exec(contents);
            }

            // Update version number
            await this.db.exec(`PRAGMA user_version = ${TARGET_VERSION};`);

            // Add sticky notification
            this.database_update_notice = () => {
                const lines = [
                    `Database has been updated!`,
                    `Current version: ${TARGET_VERSION}`,
                    `Type sqlite:dismiss to dismiss this message`,
                ];
                surrounding_box('33;1', lines);
                return lines;
            };

            (async () => {
                await es_import_promise;
                const svc_devConsole = this.services.get('dev-console');
                svc_devConsole.add_widget(this.database_update_notice);
            })();
        }

        const svc_serverHealth = this.services.get('server-health');

        svc_serverHealth.add_check('sqlite', async () => {
            const [{ user_version }] = await this._requireRead('PRAGMA user_version');
            if ( user_version !== TARGET_VERSION ) {
                throw new Error(
                    `Database version mismatch: expected ${TARGET_VERSION}, ` +
                    `got ${user_version}`);
            }
        });
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

        const stmt = this.db.prepare(query);
        const info = stmt.run(...params);

        return {
            insertId: info.lastInsertRowid,
            anyRowsAffected: info.changes > 0,
        };
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
            {
                id: 'dismiss',
                description: 'dismiss the database update notice',
                handler: async (_, log) => {
                    const svc_devConsole = this.services.get('dev-console');
                    if ( ! svc_devConsole ) return;
                    if ( ! this.database_update_notice ) return;
                    svc_devConsole.remove_widget(this.database_update_notice);
                    const lines = this.database_update_notice();
                    for ( const line of lines ) log.log(line);
                    this.database_update_notice = null;
                }
            }
        ])
    }
}

module.exports = {
    SqliteDatabaseAccessService,
};
