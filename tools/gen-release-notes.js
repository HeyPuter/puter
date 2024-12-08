// METADATA // {"ai-commented":{"service":"claude"}}
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

// GitHub repository URL for generating commit links in release notes
const REPO_URL = 'https://github.com/HeyPuter/puter';

const params = {
    from: 'v2.4.1',
    // from: 'v2.4.0',
    to: 'v2.4.2',
    date: '2024-07-22',
};

const git = simpleGit();
const log = await git.log({ from: params.from });
const commits = log.all;

// Array of all commits from git log between specified versions
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
    security: {
        label: 'Security',
    },
};

const scope_aliases = {
    main: 'puter',
    ui: 'gui',
    parsely: 'phoenix',
};

const complicated_cases = [
    /**
    * Handles special cases for commit message transformations
    * @type {Array<function>}
    */
    function fix_i18n ({ commit, meta }) {
        if ( meta.type === 'fix' && meta.scope === 'i18n' ) {
            meta.type = 'i18n';
            meta.scope = undefined;
        }
    }
];

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
        '3b8af7cc5c1be8ed67be827360bbfe0f0b5027e9',
        '84e31eff2f58584d8fab7dd10606f2f6ced933a2',
        '81781f80afc07cd1e6278906cdc68c8092fbfedf',
        '56820cf6ee56ff810a6b495a281ccbb2e7f9d8fb',
        '69a80ab3d2c94ee43d96021c3bcbdab04a4b5dc6',
        '8e297cd7e30757073e2f96593c363a273b639466',
        '151527825f1eb4b060aaf97feb7d18af4fcddbf2',
        '8bece96f6224a060d5b408e08c58865fadb8b79c',
        '333d6e3b651e460caca04a896cbc8c175555b79b',
        '8a3d0430f39f872b8a460c344cce652c340b700b',
        'b9e73b7288aebb14e6bbf1915743e9157fc950b1',
        'c2d3d69dbe33f36fcae13bcbc8e2a31a86025af9',
        '382fb24dbb1737a8a54ed2491f80b2e2276cde61',
    ],
    fix: [
        '535475b3c36a37e3319ed067a24fb671790dcda3',
        '45f131f8eaf94cf3951ca7ffeb6f311590233b8a',
        '02e1b1e8f5f8e22d7ab39ebff99f7dd8e08a4221',
    ],
    doc: [
        '338004474f078a00608af1d0ebf8a7f9534bad28',
        '6c4c73a9e85ff8eb5e7663dcce11f4d1f824032b',
        'c19c18bfcf163b37e3d173b8fa50393dfb9f540f',
    ],
    feat: [
        '8e7306c23be01ee6c31cdb4c99f2fb1f71a2247f',
    ],
    meta: [
        'b3c1b128e2d8519bc816cdcd3220c8f40e05bb01',
        '452b7495b1736df90bc748dbf818407488875754',
    ],
};

const message_changes = {
    '1f7f094282fae915a2436701cfb756444cd3f781': 'feat: add new file templates',
    '64e4299ac0a4c9e1de7a9d089e2d7529a9530818': 'doc: docker instructions for Windows',
    'f897e844989083b0b369ba0ce4d2c5a9f3db5ad8': 'fix: #432',
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
    if ( message_changes.hasOwnProperty(commit.hash) ) {
        commit.message = message_changes[commit.hash];
    }
    if ( retro_prefixes.hasOwnProperty(commit.hash) ) {
        commit.message = retro_prefixes[commit.hash] + ': ' +
            commit.message;
    }
    const meta = parse_conventional_commit(commit.message);
    if ( ! meta ) continue;
    for ( const transformer of complicated_cases ) {
        transformer({ commit, meta });
    }
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
s += `## ${params.to} (${params.date})\n\n`;
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