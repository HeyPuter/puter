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
const seedrandom = require("seedrandom");
const { id2path, get_user } = require("../../helpers");
const { generate_random_code } = require("../../util/identifier");
const { DB_MODE_WRITE } = require("../MysqlAccessService");
const { DB_MODE_READ } = require("../MysqlAccessService");

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
    maybe_stop_ () {
        if ( this.state !== this.constructor.STATE_GREEN ) {
            this.log.info(`Stopping job`);
            this.state = this.constructor.STATE_RED;
            return true;
        }
        return false;
    }
    stop () {
        this.state = this.constructor.STATE_YELLOW;
    }
    set_progress (progress) {
        let bar = '';
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

class Mig_StorePath extends Job {
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

class Mig_IndexAccessed extends Job {
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

class Mig_FixTrash extends Job {
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

class Mig_AddReferralCodes extends Job {
    async start (args) {
        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        let existing_codes = new Set();
        const SQL_EXISTING_CODES = `SELECT referral_code FROM user`;
        let [codes] = await dbrr.promise().execute(SQL_EXISTING_CODES);
        for ( const { referal_code } of codes ) {
            existing_codes.add(referal_code);
        }

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

class Mig_AuditInitialStorage extends Job {
    async start (args) {
        this.state = this.constructor.STATE_GREEN;
        const { dbrr, dbrw, log } = this;

        // TODO: this migration will add an audit log for each user's
        //       storage capacity before auditing was implemented.
    }
}

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
