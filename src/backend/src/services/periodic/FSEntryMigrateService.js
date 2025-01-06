// METADATA // {"ai-commented":{"service":"claude"}}
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
const seedrandom = require("seedrandom");
const { id2path, get_user } = require("../../helpers");
const { generate_random_code } = require("../../util/identifier");
const { DB_MODE_WRITE } = require("../MysqlAccessService");
const { DB_MODE_READ } = require("../MysqlAccessService");


/**
* Base Job class for handling migration tasks in the FSEntryMigrateService.
* Provides common functionality for managing job state (green/yellow/red),
* progress tracking, and graceful stopping of migration jobs.
* Contains methods for state management, progress visualization,
* and controlled execution flow.
*/
class Job {
    static STATE_GREEN = {};
    static STATE_YELLOW = {};
    static STATE_RED = {};
    constructor ({ dbrr, dbrw, log }) {
        this.dbrr = dbrr;
        this.dbrw = dbrw;
        this.log = log;
        this.state = this.constructor.STATE_RED;
    }
    /**
    * Checks if the job should stop based on its current state
    * @returns {boolean} True if the job should stop, false if it can continue
    * @private
    */
    maybe_stop_ () {
        if ( this.state !== this.constructor.STATE_GREEN ) {
            this.log.info(`Stopping job`);
            this.state = this.constructor.STATE_RED;
            return true;
        }
        return false;
    }
    /**
    * Sets the job state to YELLOW, which means it will stop as soon as possible
    * (generally after the current batch of work being processed)
    */
    stop () {
        this.state = this.constructor.STATE_YELLOW;
    }
    set_progress (progress) {
        // Progress bar string to display migration progress in the console
        let bar = '';
        // Width of the progress bar display in characters
        const WIDTH = 30;
        const N = Math.floor(WIDTH * progress);
        for ( let i = 0 ; i < WIDTH ; i++ ) {
            if ( i < N ) {
                bar += '=';
            } else {
                bar += ' ';
            }
        }
        this.log.info(`${this.constructor.name} :: [${bar}] ${progress.toFixed(2)}%`);
    }
}


/**
* @class Mig_StorePath
* @extends Job
* @description Handles the migration of file system entries to include path information.
* This class processes fsentries that don't have path data set, calculating and storing
* their full paths in batches. It includes rate limiting and progress tracking to prevent
* server overload during migration.
*/
class Mig_StorePath extends Job {
    /**
    * Handles migration of file system entries to update storage paths
    * @param {Object} args - Command line arguments for the migration
    * @param {string[]} args.verbose - If --verbose is included, logs detailed path info
    * @returns {Promise<void>} Resolves when migration is complete
    * 
    * Migrates fsentry records that have null paths by:
    * - Processing entries in batches of 50
    * - Converting UUIDs to full paths
    * - Updating the path column in the database
    * - Includes throttling between batches to reduce server load
    */
    async start (args) {
        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        for ( ;; ) {
            const t_0 = performance.now();
            const [fsentries] = await dbrr.promise().execute(
                `SELECT id, uuid FROM fsentries WHERE path IS NULL ORDER BY accessed DESC LIMIT 50`
            );

            if ( fsentries.length === 0 ) {
                log.info(`No more fsentries to migrate`);
                this.state = this.constructor.STATE_RED;
                return;
            }
            log.info(`Running migration on ${fsentries.length} fsentries`);

            for ( let i=0 ; i < fsentries.length ; i++ ) {
                const fsentry = fsentries[i];
                let path;
                try {
                    path = await id2path(fsentry.uuid);
                } catch (e) {
                    // This happens when an fsentry has a missing parent
                    log.error(e);
                    continue;
                }
                if ( args.includes('--verbose') ) {
                    log.info(`id=${fsentry.id} uuid=${fsentry.uuid} path=${path}`);
                }
                await dbrw.promise().execute(
                    `UPDATE fsentries SET path=? WHERE id=?`,
                    [path, fsentry.id],
                );
            }

            const t_1 = performance.now();

            // Give the server a break for twice the time it took to execute the query,
            // or 100ms at least.
            const time_to_wait = Math.max(100, 2 * (t_1 - t_0));
            
            if ( this.maybe_stop_() ) return;
            
            log.info(`Waiting for ${time_to_wait.toFixed(2)}ms`);
            await new Promise(rslv => setTimeout(rslv, time_to_wait));

            if ( this.maybe_stop_() ) return;
        }
    }
}


/**
* @class Mig_IndexAccessed
* @extends Job
* @description Migration job that updates the 'accessed' timestamp for file system entries.
* Sets the 'accessed' field to match the 'created' timestamp for entries where 'accessed' is NULL.
* Processes entries in batches of 10000 to avoid overloading the database, with built-in delays
* between batches for server load management.
*/
class Mig_IndexAccessed extends Job {
    /**
    * Migrates fsentries to include 'accessed' timestamps by setting null values to their 'created' time
    * @param {Array} args - Command line arguments passed to the migration
    * @returns {Promise<void>} 
    * 
    * Processes fsentries in batches of 10000, updating any null 'accessed' fields
    * to match their 'created' timestamp. Includes built-in delays between batches
    * to reduce server load. Continues until no more records need updating.
    */
    async start (args) {
        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        for ( ;; ) {
            log.info(`Running update statement`);
            const t_0 = performance.now();
            const [results] = await dbrr.promise().execute(
                `UPDATE fsentries SET accessed = COALESCE(accessed, created) WHERE accessed IS NULL LIMIT 10000`
            );
            log.info(`Updated ${results.affectedRows} rows`);

            if ( results.affectedRows === 0 ) {
                log.info(`No more fsentries to migrate`);
                this.state = this.constructor.STATE_RED;
                return;
            }

            const t_1 = performance.now();

            // Give the server a break for twice the time it took to execute the query,
            // or 100ms at least.
            const time_to_wait = Math.max(100, 2 * (t_1 - t_0));
            
            if ( this.maybe_stop_() ) return;
            
            log.info(`Waiting for ${time_to_wait.toFixed(2)}ms`);
            await new Promise(rslv => setTimeout(rslv, time_to_wait));

            if ( this.maybe_stop_() ) return;
        }
    }
}


/**
* @class Mig_FixTrash
* @extends Job
* @description Migration job that ensures each user has a Trash directory in their root folder.
* Creates missing Trash directories with proper UUIDs, updates user records with trash_uuid,
* and sets appropriate timestamps and permissions. The Trash directory is marked as immutable
* and is created with standardized path '/Trash'.
*/
class Mig_FixTrash extends Job {
    /**
    * Handles migration to fix missing Trash directories for users
    * Creates a new Trash directory and updates necessary records if one doesn't exist
    * 
    * @param {Array} args - Command line arguments passed to the migration
    * @returns {Promise<void>} Resolves when migration is complete
    * 
    * @description
    * - Identifies users without a Trash directory
    * - Creates new Trash directory with UUID for each user
    * - Updates user table with new trash_uuid
    * - Includes throttling between operations to reduce server load
    */
    async start (args) {
        const { v4: uuidv4 } = require('uuid');

        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        const SQL_NOTRASH_USERS = `
            SELECT parent.name, parent.uuid FROM fsentries AS parent
            WHERE parent_uid IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM fsentries AS child
                WHERE child.parent_uid = parent.uuid
                AND child.name = 'Trash'
            )
        `;

        let [user_dirs] = await dbrr.promise().execute(SQL_NOTRASH_USERS);

        for ( const { name, uuid } of user_dirs ) {
            const username = name;
            const user_dir_uuid = uuid;

            const t_0 = performance.now();
            const user = await get_user({ username });
            const trash_uuid = uuidv4();
            const trash_ts = Date.now()/1000;
            log.info(`Fixing trash for user ${user.username} ${user.id} ${user_dir_uuid} ${trash_uuid} ${trash_ts}`);
            
            const insert_res = await dbrw.promise().execute(`
                INSERT INTO fsentries
                (uuid, parent_uid, user_id, name, path, is_dir, created, modified, immutable)
                VALUES 
                (   ?,          ?,       ?,    ?,    ?,   true,       ?,        ?,      true)
            `, [trash_uuid, user_dir_uuid, user.id, 'Trash', '/Trash', trash_ts, trash_ts]);
            log.info(`Inserted ${insert_res[0].affectedRows} rows in fsentries`);
            // Update uuid cached in the user table
            const update_res = await dbrw.promise().execute(`
                UPDATE user SET trash_uuid=? WHERE username=?
            `, [trash_uuid, user.username]);
            log.info(`Updated ${update_res[0].affectedRows} rows in user`);
            const t_1 = performance.now();

            const time_to_wait = Math.max(100, 2 * (t_1 - t_0));
            
            if ( this.maybe_stop_() ) return;
            
            log.info(`Waiting for ${time_to_wait.toFixed(2)}ms`);
            await new Promise(rslv => setTimeout(rslv, time_to_wait));

            if ( this.maybe_stop_() ) return;
        }
    }
}


/**
* Class for managing referral code migrations in the user database.
* Generates and assigns unique referral codes to users who don't have them.
* Uses deterministic random generation with seeding to ensure consistent codes
* while avoiding collisions with existing codes. Processes users in batches
* and provides progress tracking.
*/
class Mig_AddReferralCodes extends Job {
    /**
    * Adds referral codes to users who don't have them yet.
    * Generates unique 8-character random codes using a seeded RNG.
    * If a generated code conflicts with existing ones, it iterates with
    * a new seed until finding an unused code.
    * Updates users in batches, showing progress every 500 users.
    * Can be stopped gracefully via stop() method.
    * @returns {Promise<void>}
    */
    async start (args) {
        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        let existing_codes = new Set();
        // Set to store existing referral codes to avoid duplicates during migration
        const SQL_EXISTING_CODES = `SELECT referral_code FROM user`;
        let [codes] = await dbrr.promise().execute(SQL_EXISTING_CODES);
        for ( const { referal_code } of codes ) {
            existing_codes.add(referal_code);
        }

        // SQL query to fetch all user IDs and their referral codes from the user table
        const SQL_USER_IDS = `SELECT id, referral_code FROM user`;

        let [users] = await dbrr.promise().execute(SQL_USER_IDS);

        let i = 0;

        for ( const user of users ) {
            if ( user.referal_code ) continue;
            // create seed for deterministic random value
            let iteration = 0;
            let rng = seedrandom(`gen1-${user.id}`);
            let referal_code = generate_random_code(8, { rng });

            while ( existing_codes.has(referal_code) ) {
                rng = seedrandom(`gen1-${user.id}-${++iteration}`);
                referal_code = generate_random_code(8, { rng });
            }

            const update_res = await dbrw.promise().execute(`
                UPDATE user SET referral_code=? WHERE id=?
            `, [referal_code, user.id]);

            i++;
            if ( i % 500 == 0 ) this.set_progress(i / users.length);
            
            if ( this.maybe_stop_() ) return;
        }
    }
}


/**
* @class Mig_AuditInitialStorage
* @extends Job
* @description Migration class responsible for adding audit logs for users' initial storage capacity.
* This migration is designed to retroactively create audit records for each user's storage capacity
* from before the implementation of the auditing system. Inherits from the base Job class to
* handle migration state management and progress tracking.
*/
class Mig_AuditInitialStorage extends Job {
    /**
    * Handles migration for auditing initial storage capacity for users
    * before auditing was implemented. Creates audit log entries for each
    * user's storage capacity from before the auditing system existed.
    * 
    * @param {Array} args - Command line arguments passed to the migration
    * @returns {Promise<void>}
    */
    async start (args) {
        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        // TODO: this migration will add an audit log for each user's
        //       storage capacity before auditing was implemented.
    }
}


/**
* @class FSEntryMigrateService
* @description Service responsible for managing and executing database migrations for filesystem entries.
* Provides functionality to run various migrations including path storage updates, access time indexing,
* trash folder fixes, and referral code generation. Exposes commands to start and stop migrations through
* a command interface. Each migration is implemented as a separate Job class that can be controlled
* independently.
*/
class FSEntryMigrateService {
    constructor ({ services }) {
        const mysql = services.get('mysql');
        const dbrr = mysql.get(DB_MODE_READ, 'fsentry-migrate');
        const dbrw = mysql.get(DB_MODE_WRITE, 'fsentry-migrate');
        const log = services.get('log-service').create('fsentry-migrate');

        const migrations = {
            'store-path': new Mig_StorePath({ dbrr, dbrw, log }),
            'index-accessed': new Mig_IndexAccessed({ dbrr, dbrw, log }),
            'fix-trash': new Mig_FixTrash({ dbrr, dbrw, log }),
            'gen-referral-codes': new Mig_AddReferralCodes({ dbrr, dbrw, log }),
        };

        services.get('commands').registerCommands('fsentry-migrate', [
            {
                id: 'start',
                description: 'start a migration',
                handler: async (args, log) => {
                    const [migration] = args;
                    if ( ! migrations[migration] ) {
                        throw new Error(`unknown migration: ${migration}`);
                    }
                    migrations[migration].start(args.slice(1));
                }
            },
            {
                id: 'stop',
                description: 'stop a migration',
                handler: async (args, log) => {
                    const [migration] = args;
                    if ( ! migrations[migration] ) {
                        throw new Error(`unknown migration: ${migration}`);
                    }
                    migrations[migration].stop();
                }
            }
        ]);
    }
}

module.exports = { FSEntryMigrateService };
