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
const { es_import_promise } = require('../../fun/dev-console-ui-utils');
const { surrounding_box } = require('../../fun/dev-console-ui-utils');
const { Context } = require('../../util/context');
const { CompositeError } = require('../../util/errorutil');
const structutil = require('../../util/structutil');
const { BaseDatabaseAccessService } = require('./BaseDatabaseAccessService');

class SqliteDatabaseAccessService extends BaseDatabaseAccessService {
    static ENGINE_NAME = 'sqlite';

    static MODULES = {
        // Documentation calls it 'Database'; it's new-able so
        // I'll stick with their convention over ours.
        Database: require('better-sqlite3'),
    };

    /**
    * @description Method to handle database schema upgrades.
    * This method checks the current database version against the available migration scripts and performs any necessary upgrades.
    * @param {void}
    * @returns {void}
    */
    async _init() {
        const require = this.require;
        const Database = require('better-sqlite3');

        this._register_commands(this.services.get('commands'));

        const fs = require('fs');
        const path_ = require('path');
        const do_setup = !fs.existsSync(this.config.path);

        this.db = new Database(this.config.path);

        const upgrade_files = [];

        const available_migrations = [
            [-1, [
                '0001_create-tables.sql',
                '0002_add-default-apps.sql',
            ]],
            [0, [
                '0003_user-permissions.sql',
            ]],
            [1, [
                '0004_sessions.sql',
            ]],
            [2, [
                '0005_background-apps.sql',
            ]],
            [3, [
                '0006_update-apps.sql',
            ]],
            [4, [
                '0007_sessions.sql',
            ]],
            [5, [
                '0008_otp.sql',
            ]],
            [6, [
                '0009_app-prefix-fix.sql',
            ]],
            [7, [
                '0010_add-git-app.sql',
            ]],
            [8, [
                '0011_notification.sql',
            ]],
            [9, [
                '0012_appmetadata.sql',
            ]],
            [10, [
                '0013_protected-apps.sql',
            ]],
            [11, [
                '0014_share.sql',
            ]],
            [12, [
                '0015_group.sql',
            ]],
            [13, [
                '0016_group-permissions.sql',
            ]],
            [14, [
                '0017_publicdirs.sql',
            ]],
            [15, [
                '0018_fix-0003.sql',
            ]],
            [16, [
                '0019_fix-0016.sql',
            ]],
            [17, [
                '0020_dev-center.sql',
            ]],
            [18, [
                '0021_app-owner-id.sql',
            ]],
            [19, [
                '0022_dev-center-max.sql',
            ]],
            [20, [
                '0023_fix-kv.sql',
            ]],
            [21, [
                '0024_default-groups.sql',
            ]],
            [22, [
                '0025_system-user.dbmig.js',
            ]],
            [23, [
                '0026_user-groups.dbmig.js',
            ]],
            [24, [
                '0027_emulator-app.dbmig.js',
            ]],
            [25, [
                '0028_clean-email.sql',
            ]],
            [26, [
                '0029_emulator_priv.sql',
            ]],
            [27, [
                '0030_comments.sql',
            ]],
            [28, [
                '0031_audit-meta.sql',
            ]],
            [29, [
                '0032_signup_metadata.sql',
            ]],
            [30, [
                '0033_ai-usage.sql',
            ]],
            [31, [
                '0034_app-redirect.sql',
            ]],
            [32, [
                '0035_threads.sql',
            ]],
            [33, [
                '0036_dev-to-app.sql',
            ]],
            [34, [
                '0038_custom-domains.sql',
            ]],
            [35, [
                '0039_add-expireAt-to-kv-store.sql',
            ]],
        ];

        // Database upgrade logic
        const HIGHEST_VERSION =
            available_migrations[available_migrations.length - 1][0] + 1;
        /**
        * Upgrades the database schema to the specified version.
        *
        * @param {number} targetVersion - The target version to upgrade the database to.
        * @returns {Promise<void>} A promise that resolves when the database has been upgraded.
        */
        const TARGET_VERSION = (() => {
            const args = Context.get('args');
            if ( args['database-target-version'] ) {
                return parseInt(args['database-target-version']);
            }
            return HIGHEST_VERSION;
        })();

        const [{ user_version }] = do_setup
            ? [{ user_version: -1 }]
            : await this._read('PRAGMA user_version');
        this.log.info('database version: ' + user_version);

        for ( const [v_lt_or_eq, files] of available_migrations ) {
            if ( v_lt_or_eq + 1 >= TARGET_VERSION && TARGET_VERSION !== HIGHEST_VERSION ) {
                this.log.noticeme(`Early exit: target version set to ${TARGET_VERSION}`);
                break;
            }
            if ( user_version <= v_lt_or_eq ) {
                upgrade_files.push(...files);
            }
        }

        if ( upgrade_files.length > 0 ) {
            this.log.noticeme(`Database out of date: ${this.config.path}`);
            this.log.noticeme(`UPGRADING DATABASE: ${user_version} -> ${TARGET_VERSION}`);
            this.log.noticeme(`${upgrade_files.length} .sql files to apply`);

            const sql_files = upgrade_files.map(p => path_.join(__dirname, 'sqlite_setup', p));
            const fs = require('fs');
            for ( const filename of sql_files ) {
                const basename = path_.basename(filename);
                this.log.noticeme(`applying ${basename}`);
                const contents = fs.readFileSync(filename, 'utf8');
                switch ( path_.extname(filename) ) {
                case '.sql':
                {
                    const stmts = contents.split(/;\s*\n/);
                    for ( let i = 0; i < stmts.length; i++ ) {
                        if ( stmts[i].trim() === '' ) continue;
                        const stmt = stmts[i] + ';';
                        try {
                            this.db.exec(stmt);
                        } catch( e ) {
                            throw new CompositeError(`failed to apply: ${basename} at line ${i}`, e);
                        }
                    }
                    break;
                }
                case '.js':
                    try {
                        await this.run_js_migration_({
                            filename, contents,
                        });
                    } catch( e ) {
                        throw new CompositeError(`failed to apply: ${basename}`, e);
                    }
                    break;
                default:
                    throw new Error(`unrecognized migration type: ${filename}`);
                }
            }

            // Update version number
            await this.db.exec(`PRAGMA user_version = ${TARGET_VERSION};`);

            // Add sticky notification
            /**
            * This method is responsible for applying database migrations. It checks the current version of the database against the available migrations, and if the database is out of date, it applies the necessary SQL files to bring it up to date.
            *
            * @param {void}
            * @returns {void}
            */
            // Add this comment above line 222
            // It describes the purpose of the method and its behavior
            // It does not include any parameters or return values since the method does not take any inputs and does not return any output.
            this.database_update_notice = () => {
                const lines = [
                    'Database has been updated!',
                    `Current version: ${TARGET_VERSION}`,
                    'Type sqlite:dismiss to dismiss this message',
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

        /**
        * @description This method is used to register SQLite database-related commands with the dev-console service.
        * @param {object} commands - The dev-console service commands object.
        */
        svc_serverHealth.add_check('sqlite', async () => {
            const [{ user_version }] = await this.requireRead('PRAGMA user_version');
            if ( user_version !== TARGET_VERSION ) {
                throw new Error(`Database version mismatch: expected ${TARGET_VERSION}, ` +
                    `got ${user_version}`);
            }
        });
    }

    /**
    * Implementation for prepared statements for READ operations.
    */
    async _read(query, params = []) {
        query = this.sqlite_transform_query_(query);
        params = this.sqlite_transform_params_(params);
        return this.db.prepare(query).all(...params);
    }

    /**
    * Implementation for prepared statements for READ operations.
    * This method may perform additional steps to obtain the data, which
    * is not applicable to the SQLite implementation.
    */
    async _tryHardRead(query, params) {
        return await this._read(query, params);
    }

    /**
     * Implementation for prepared statements for WRITE operations.
     */
    async _write(query, params) {
        query = this.sqlite_transform_query_(query);
        params = this.sqlite_transform_params_(params);

        const stmt = this.db.prepare(query);
        const info = stmt.run(...params);

        return {
            insertId: info.lastInsertRowid,
            anyRowsAffected: info.changes > 0,
        };
    }

    /**
    * This method initializes the SQLite database by checking if it exists, setting up the connection, and performing any necessary database upgrades based on the current version.
    *
    * @param {object} config - The configuration object for the database.
    * @returns {Promise} A promise that resolves when the database is initialized.
    */
    async _batch_write(entries) {
        /**
        * @description This method is used to execute SQL queries in batch mode.
        * It accepts an array of objects, where each object contains a SQL query as the `statement` property and an array of parameters as the `values` property.
        * The method executes each SQL query in the transaction block, ensuring that all operations are atomic.
        * @param {Array<{statement: string, values: any[]}>} entries - An array of SQL queries and their corresponding parameters.
        * @return {void} This method does not return any value.
        */
        this.db.transaction(() => {
            for ( let { statement, values } of entries ) {
                statement = this.sqlite_transform_query_(statement);
                values = this.sqlite_transform_params_(values);
                this.db.prepare(statement).run(values);
            }
        })();
    }

    sqlite_transform_query_(query) {
        // replace `now()` with `datetime('now')`
        query = query.replace(/now\(\)/g, 'datetime(\'now\')');

        return query;
    }

    sqlite_transform_params_(params) {
        return params.map(p => {
            if ( typeof p === 'boolean' ) {
                return p ? 1 : 0;
            }
            return p;
        });
    }

    /**
    * @description This method is responsible for performing database upgrades. It checks the current database version against the available versions and applies any necessary migrations.
    * @param {object} options - Optional parameters for the method.
    * @returns {Promise} A promise that resolves when the database upgrade is complete.
    */
    async run_js_migration_({ filename: _filename, contents }) {
        /**
        * Method to run JavaScript migrations. This method is used to apply JavaScript code to the SQLite database during the upgrade process.
        *
        * @param {Object} options - An object containing the following properties:
        *   - `filename`: The name of the JavaScript file containing the migration code.
        *   - `contents`: The contents of the JavaScript file.
        *
        * @returns {Promise<void>} A promise that resolves when the migration is completed.
        */
        contents = `(async () => {${contents}})()`;
        const vm = require('vm');
        const context = vm.createContext({
            read: this.read.bind(this),
            write: this.write.bind(this),
            log: this.log,
            structutil,
        });
        await vm.runInContext(contents, context);
    }

    _register_commands(commands) {
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
                    } catch( err ) {
                        log.error(err.message);
                    }
                },
            },
            {
                id: 'read',
                description: 'read a query',
                handler: async (args, log) => {
                    try {
                        const [query] = args;
                        const rows = this._read(query, []);
                        log.log(rows);
                    } catch( err ) {
                        log.error(err.message);
                    }
                },
            },
            {
                id: 'dismiss',
                description: 'dismiss the database update notice',
                handler: async (_, log) => {
                    const svc_devConsole = this.services.get('dev-console');
                    if ( !svc_devConsole ) return;
                    if ( !this.database_update_notice ) return;
                    svc_devConsole.remove_widget(this.database_update_notice);
                    const lines = this.database_update_notice();
                    for ( const line of lines ) log.log(line);
                    this.database_update_notice = null;
                },
            },
        ]);
    }
}

module.exports = {
    SqliteDatabaseAccessService,
};
