/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Puter's Git client.
 *
 * Puter's Git client is free software: you can redistribute it and/or modify
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
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { determine_fetch_remote, find_repo_root } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';

export default {
    name: 'pull',
    usage: [
        'git pull [<repository> [<remote-ref>]]',
    ],
    description: `Fetch and integrate changes from a remote repository.`,
    args: {
        allowPositionals: true,
        options: {
            'ff': {
                description: 'If possible, resolve the merge as a fast-forward, without a merge commit.',
                type: 'boolean',
                default: true,
            },
            'no-ff': {
                description: 'Always create a merge commit.',
                type: 'boolean',
            },
            'ff-only': {
                description: 'Only update history if a fast-forward is possible.',
                type: 'boolean',
            },
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        if (options['no-ff']) {
            options['ff'] = false;
            delete options['no-ff'];
        }

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        const remotes = await git.listRemotes({
            fs,
            dir,
            gitdir,
        });

        const remote = positionals.shift();
        const remote_branch = positionals.shift();

        // TODO: Support <refspec> syntax instead of a single remote branch name.

        if (positionals.length) {
            stderr('Too many arguments, expected 0 to 2 for [<repository> [<remote-ref>]].');
            throw SHOW_USAGE;
        }

        const remote_data = determine_fetch_remote(remote, remotes);
        await git.pull({
            fs,
            http,
            corsProxy: globalThis.__CONFIG__.proxy_url,
            dir,
            gitdir,
            cache,
            ...remote_data,
            ...(remote_branch ? { remoteRef: remote_branch } : {}),
            fastForward: options['ff'],
            fastForwardOnly: options['ff-only'],
            onMessage: (message) => { stdout(message); },
        });
    }
};
