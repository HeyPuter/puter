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
import { find_repo_root, PROXY_URL } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';

export default {
    name: 'fetch',
    usage: [
        'git fetch <repository>',
        'git fetch --all',
    ],
    description: `Download objects and refs from another repository.`,
    args: {
        allowPositionals: true,
        options: {
            all: {
                description: 'Fetch all remotes.',
                type: 'boolean',
                default: false,
            }
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        const { repository_dir, git_dir } = await find_repo_root(fs, env.PWD);

        const remotes = await git.listRemotes({
            fs,
            dir: repository_dir,
            gitdir: git_dir,
        });

        if (options.all) {
            for (const { remote, url } of remotes) {
                stdout(`Fetching ${remote}\nFrom ${url}`);
                await git.fetch({
                    fs,
                    http,
                    cache,
                    corsProxy: PROXY_URL,
                    dir: repository_dir,
                    gitdir: git_dir,
                    remote,
                    onMessage: (message) => { stdout(message); },
                });
            }
            return;
        }

        const remote = positionals.shift();
        // Three situations:
        // 1) remote is an URL: Fetch it
        // 2) remote is a remote name: Fetch it
        // 3) remote is undefined: If there's an upstream for this branch, fetch that. Otherwise fetch the default origin.
        // For simplicity, we'll leave 3) for later.
        // TODO: Support `git fetch` with no positional arguments
        if (!remote) {
            stderr('Missing remote name to fetch.');
            throw SHOW_USAGE;
        }

        const remote_id = {};
        if (URL.canParse(remote)) {
            remote_id.url = remote;
        } else {
            // Named remote. First, check if the remote exists. `git.fetch` reports non-existent remotes as:
            //     "The function requires a "remote OR url" parameter but none was provided."
            // ...which is not helpful to the user.
            if (!remotes.find(it => it.remote === remote))
                throw new Error(`'${remote}' does not appear to be a git repository`);
            remote_id.remote = remote;
        }

        await git.fetch({
            fs,
            http,
            cache,
            corsProxy: PROXY_URL,
            dir: repository_dir,
            gitdir: git_dir,
            ...remote_id,
            onMessage: (message) => { stdout(message); },
        });
    }
}
