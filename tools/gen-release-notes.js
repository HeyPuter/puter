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
    from: 'v2.4.0',
    // from: 'v2.4.0',
    to: 'v2.4.1',
    date: '2024-07-11',
};

const git = simpleGit();
const log = await git.log({ from: params.from });
const commits = log.all;

const CC_REGEX = /^([a-z0-9]+)(\([a-z0-9]+\))?:\s(.*)/;
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
    i18n: {
        label: 'Translations'
    },
    fix: {
        label: 'Bug Fixes'
    },
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
    tools: {
        ignore: true,
    },
};

const scope_aliases = {
    main: 'puter',
    ui: 'gui',
    parsely: 'phoenix',
};

const retro_prefixes_0 = {
    i18n: [
        '883601142873f10d69c84874499065a7d29af054',
        '17145d0be6a9a1445947cc0c4bec8f16a475144c',
        'e61039faf409b0ad85c7513b0123f3f2e92ebe32',
        'bffa192805216fc17045cd8d629f34784dca7f3f',
        'fe5be7f3cf7f336730137293ba86a637e8d8591d',
        '78a0acea6980b6d491da4874edbd98e17c0d9577',
        'a96abb5793528d0dc56d75f95d771e1dcf5960d1',
        'f5a8ee1c6ab950d62c90b6257791f026a508b4e4',
        '47ec74f0aa6adb3952e6460909029a4acb0c3039',
        '473b6512c697854e3f3badae1eb7b87742954da5',
        '8440f566b91c9eb4f01addcb850061e3fbe3afc7',
        '92abc9947f811f94f17a5ee5a4b73ee2b210900a',
        'cff488f4f4378ca6c7568a585a665f2a3b87b89c',
        
    ],
    fix: [
        '535475b3c36a37e3319ed067a24fb671790dcda3',
    ],
    doc: [
        '338004474f078a00608af1d0ebf8a7f9534bad28',
        '6c4c73a9e85ff8eb5e7663dcce11f4d1f824032b',
    ],
};

const retro_prefixes = {};
for ( const prefix in retro_prefixes_0 ) {
    for ( const commit_hash of retro_prefixes_0[prefix] ) {
        console.log('PREFIX', commit_hash, prefix);
        retro_prefixes[commit_hash] = prefix;
    }
}

const data = {};
const ensure_scope = name => {
    if ( data[name] ) return;
    const o = data[name] = {};
    for ( const k in types ) o[k] = [];
};

for ( const commit of commits ) {
    if ( retro_prefixes.hasOwnProperty(commit.hash) ) {
        commit.message = retro_prefixes[commit.hash] + ': ' +
            commit.message;
    }
    const meta = parse_conventional_commit(commit.message);
    if ( ! meta ) continue;
    let scope = meta.scope ?? 'puter';
    while ( scope in scope_aliases ) {
        scope = scope_aliases[scope];
    }
    if ( ! scopes[scope] ) {
        console.log(commit);
        throw new Error(`missing scope: ${scope}`);
    }
    if ( scopes[scope].ignore ) continue;
    ensure_scope(scope);
    
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
        s += `\n#### ${type.label}\n\n`;
        for ( const { meta, commit } of items ) {
            const shorthash = commit.hash.slice(0,7)
            s += `- ${meta.summary} ([${shorthash}](${REPO_URL}/commit/${commit.hash}))\n`;
        }
    }
}

console.log(s);