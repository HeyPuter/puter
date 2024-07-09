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
import { simpleGit } from 'simple-git';

const REPO_URL = 'https://github.com/HeyPuter/puter';

const params = {
    from: 'v2.3.0',
    // from: 'v2.4.0',
    to: 'v2.5.0',
    date: '2024-07-08',
};

const git = simpleGit();
const log = await git.log({ from: params.from });
const commits = log.all;

const CC_REGEX = /^([a-z]+)(\([a-z]+\))?:\s(.*)/;
const parse_conventional_commit = message => {
    const parts = CC_REGEX.exec(message);
    if ( ! parts ) return null;
    let [match, type, scope, summary] = parts;
    if ( ! match ) return null;
    if ( scope ) scope = scope.slice(1, -1);
    return { type, scope, summary };
};

const types = {
    feat: {
        label: 'Features'
    },
    fix: {
        label: 'Bug Fixes'
    }
};

const scopes = {
    puter: {
        label: 'Puter'
    },
    phoenix: {
        label: 'Phoenix Shell'
    },
    git: {
        label: 'Puter Git'
    },
    backend: {
        label: 'Backend'
    },
    gui: {
        label: 'GUI'
    },
};

const scope_aliases = {
    main: 'puter',
    ui: 'gui',
    parsely: 'phoenix',
};

const data = {};
const ensure_scope = name => {
    if ( data[name] ) return;
    const o = data[name] = {};
    for ( const k in types ) o[k] = [];
};

for ( const commit of commits ) {
    const meta = parse_conventional_commit(commit.message);
    if ( ! meta ) continue;
    let scope = meta.scope ?? 'puter';
    while ( scope in scope_aliases ) {
        scope = scope_aliases[scope];
    }
    ensure_scope(scope);
    if ( ! scopes[scope] ) {
        console.log(commit);
        throw new Error(`missing scope: ${scope}`);
    }
    
    if ( types.hasOwnProperty(meta.type) ) {
        data[scope][meta.type].push({ meta, commit });
    }
}

let s = '';
s += `## ${params.from} (${params.date})\n\n`;
for ( const scope_name in data ) {
    const scope = data[scope_name];
    s += `### ${scopes[scope_name].label}\n\n`;
    for ( const type_name in types ) {
        const type = types[type_name];
        const items = scope[type_name];
        if ( items.length == 0 ) continue;
        s += `#### ${type.label}\n\n`;
        for ( const { meta, commit } of items ) {
            const shorthash = commit.hash.slice(0,7)
            s += `- ${meta.summary} ([${shorthash}](${REPO_URL}/commit/${commit.hash}))\n`;
        }
    }
}

console.log(s);