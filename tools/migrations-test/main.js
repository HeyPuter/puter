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

const path_ = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const prompt = require('prompt-sync')({sigint: true}); 

const ind_str = () => Array(ind).fill(' --').join('');

let ind = 0;

const log = {
    // log with unicode warning symbols in yellow
    warn: (msg) => {
        console.log(`\x1b[33;1m[!]${ind_str()} ${msg}\x1b[0m`);
    },
    crit: (msg) => {
        console.log(`\x1b[31;1m[!]${ind_str()} ${msg}\x1b[0m`);
    },
    info: (msg) => {
        console.log(`\x1B[36;1m[i]\x1B[0m${ind_str()} ${msg}`);
    },
    named: (name, value) => {
        console.log(`\x1B[36;1m[i]${ind_str()} ${name}\x1B[0m ${value}`);
    },
    error: e => {
        if ( e instanceof UserError ) {
            log.crit(e.message);
        } else {
            console.error(e);
        }
    },
    indent () { ind++; },
    dedent () { ind--; },
    heading (title) {
        const circle = '🔵';
        console.log(`\n\x1b[36;1m${circle} ${title} ${circle}\x1b[0m`);
    }
};

const areyousure = (message, options = {}) => {
    const { crit } = options;
    const logfn = crit ? log.crit : log.warn;
    
    logfn(message);
    const answer = prompt(`\x1B[35;1m[?]\x1B[0m ${ options?.prompt ?? 'Are you sure?' } (y/n): `);
    if ( answer !== 'y' ) {

        if ( options.fail_hint ) {
            log.info(options.fail_hint);
        }

        console.log(`\x1B[31;21;1mAborted.\x1B[0m`);
        process.exit(1);
    }
}

if ( ! fs.existsSync('.is_puter_repository') ) {
    throw new Error('This script must be run from the root of a puter repository');
}

areyousure(
    'This script will delete all data in the database. Are you sure you want to proceed?',
    { crit: true }
)

let backup_created = false;

const DBPATH = 'volatile/runtime/puter-database.sqlite';
const delete_db = () => {
    if ( ! fs.existsSync(DBPATH) ) {
        log.info('No database file to remove');
        // no need to create a backup if the database doesn't exist
        backup_created = true;
        return;
    }
    if ( ! backup_created ) {
        log.info(`Creating a backup of the database...`);
        const RANDOM = Math.floor(Math.random() * 1000000);
        const DATE = new Date().toISOString().replace(/:/g, '-');
        fs.renameSync(DBPATH, `${DBPATH}_${DATE}_${RANDOM}.bak`);
        backup_created = true;
        return;
    }
    log.info('Removing database file');
    fs.unlinkSync(DBPATH);
}

const pwd = process.cwd();
const boot_script_path = path_.join(pwd, 'tools/migrations-test/noop.puter.json');

const launch_puter = (args) => {
    const ret = spawnSync(
        'node',
        ['tools/run-selfhosted.js', ...args],
        {
            stdio: 'inherit',
            env: {
                ...process.env,
                NO_VAR_RUNTIME: '1',
            },
        }
    );
    ret.ok = ret.status === 0;
    return ret;
};

{
    delete_db();
    log.info(`Test case: fresh install`);
    if ( ! launch_puter([
        '--quit-on-alarm',
        `--boot-script=${boot_script_path}`,
    ]).ok ) {
        log.crit('Migration to v21 raised alarm');
        process.exit(1);
    }
}
{
    delete_db();
    log.info(`Test case: migrate to 21, then migrate to 24`);
    if ( ! launch_puter([
        `--database-target-version=21`,
        '--quit-on-alarm',
        `--boot-script=${boot_script_path}`,
    ]).ok ) {
        log.crit('Migration to v21 raised alarm');
        process.exit(1);
    }
    if ( ! launch_puter([
        `--database-target-version=24`,
        '--quit-on-alarm',
        `--boot-script=${boot_script_path}`,
    ]).ok ) {
        log.crit('Migration to v24 raised alarm');
        process.exit(1);
    }
}

log.info('No migration scripts produced any obvious errors.');
log.warn('This is not a substitute for release candidate migration testing!');
