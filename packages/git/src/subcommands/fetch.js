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

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // TODO: Support <refspec> syntax.

        const remotes = await git.listRemotes({
            fs,
            dir,
            gitdir,
        });

        if (options.all) {
            for (const { remote, url } of remotes) {
                stdout(`Fetching ${remote}\nFrom ${url}`);
                await git.fetch({
                    fs,
                    http,
                    cache,
                    corsProxy: globalThis.__CONFIG__.proxy_url,
                    dir,
                    gitdir,
                    remote,
                    onMessage: (message) => { stdout(message); },
                });
            }
            return;
        }

        const remote = positionals.shift();
        const remote_data = determine_fetch_remote(remote, remotes);

        await git.fetch({
            fs,
            http,
            cache,
            corsProxy: globalThis.__CONFIG__.proxy_url,
            dir,
            gitdir,
            ...remote_data,
            onMessage: (message) => { stdout(message); },
        });
    }
}
