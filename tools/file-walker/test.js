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
const fs = require('fs');
const fsp = fs.promises;
const path_ = require('path');

const EXCLUDE_LISTS = {
    NOT_SOURCE: [
        /^\.git/,
        /^volatile\//,
        /^node_modules\//,
        /\/node_modules$/,
        /^node_modules$/,
        /package-lock\.json/,
        /^src\/dev-center\/js/,
        /src\/backend\/src\/public\/assets/,
        /^src\/gui\/src\/lib/,
        /^eslint\.config\.js$/,
    ]
};

EXCLUDE_LISTS.NOT_AGPL = [
    ...EXCLUDE_LISTS.NOT_SOURCE,
    /^src\/puter-js/,
];

const hl_readdir = async path => {
    const names = await fs.promises.readdir(path);
    const entries = [];
    
    for ( const name of names ) {
        // wet: copied from phoenix shell
        const stat_path = path_.join(path, name);
        const stat = await fs.promises.lstat(stat_path);
        entries.push({
            name,
            is_dir: stat.isDirectory(),
            is_symlink: stat.isSymbolicLink(),
            symlink_path: stat.isSymbolicLink() ? await fs.promises.readlink(stat_path) : null,
            size: stat.size,
            modified: stat.mtimeMs / 1000,
            created: stat.ctimeMs / 1000,
            accessed: stat.atimeMs / 1000,
            mode: stat.mode,
            uid: stat.uid,
            gid: stat.gid,
        });
    }
    
    return entries;
};

const walk = async function* walk (options, root_path, components = []) {
    const current_path = path_.join(root_path, ...components);
    const entries = await hl_readdir(current_path);
    outer:
    for ( const entry of entries ) {
        entry.dirpath = current_path;
        entry.path = path_.join(current_path, entry.name);

        // TODO: labelled break?
        for ( const exclude_regex of (options.excludes ?? []) ) {
            if ( exclude_regex.test(entry.path) ) {
                continue outer;
            }
        }

        if ( ! options.pre_order ) yield entry;
        if ( entry.is_dir ) {
            yield* walk(options, root_path, [...components, entry.name]);
        }
        if ( options.pre_order ) yield entry;
    }
};

const modes = {
    primary_source_files: {
        excludes: [
        ]
    },
};

const util = require('util');
const exec = util.promisify(require('child_process').exec);

async function git_blame(path) {
  const abs_path = path_.resolve(path);
  
  try {
    const { stdout } = await exec(`git blame -f "${abs_path}"`, {
        maxBuffer: 1024 * 1024
    });
    
    const blameLines = stdout.split('\n');
    const parsedBlame = blameLines
        .map(line => {
            if (!line.trim()) return null;
            
            // console.log(line);
            const parts = line.split(/\s+/);
            let [commitHash, path, author, timestamp, lineNumber, , ,] = parts;
            author = author.slice(1);
            
            const o = {
                commitHash,
                author,
                timestamp,
                lineNumber: parseInt(lineNumber, 10),
            };
            return o;
        })
        .filter(item => item !== null)
        ;
        
    return parsedBlame;
  } catch (error) {
    console.log('AZXV')
    throw new Error(`Error executing git blame: ${error.message}`);
  }
}

// Example usage
const blame = async (path) => {
    try {
        const result = await git_blame(path);
        // console.log('result?', result)
        return result;
    } catch ( e ) {
        console.log('SKIPPED: ' + e.message);
    }
    return [];
}

const walk_test = async () => {
    // console.log(await hl_readdir('.'));
    for await ( const value of walk({
        excludes: EXCLUDE_LISTS.NOT_SOURCE,
    }, '.') ) {
        if ( ! value.is_dir ) continue;
        console.log('value', value.path);
    }
}

const authors = {};

const blame_test = async () => {
    // const results = await blame('src/backend/src/services/HostDiskUsageService.js');
    // const results = await blame('package.json');
    console.log('results', results)
    return;
    for ( const result of results ) {
        if ( ! authors[result.author] ) {
            authors[result.author] = { lines: 0 };
        }
        authors[result.author].lines++;
    }
    
    console.log('AUTHORS', authors);
}


/*
Contribution count function to test file walking and
git blame parsing.
*/
const walk_and_blame = async () => {
    // console.log(await hl_readdir('.'));
    for await ( const value of walk({
        excludes: EXCLUDE_LISTS.NOT_SOURCE,
    }, '.') ) {
        if ( value.is_dir ) continue;
        console.log('value', value.path);
        const results = await blame(value.path);
        for ( const result of results ) {
            if ( ! authors[result.author] ) {
                authors[result.author] = { lines: 0 };
            }
            authors[result.author].lines++;
        }
    }
    console.log('AUTHORS', authors);
}

if ( require.main === module ) {
    const main = walk_and_blame;
    main();
}

module.exports = {
    walk,
    EXCLUDE_LISTS,
};
