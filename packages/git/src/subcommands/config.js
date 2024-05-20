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
import { find_repo_root } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';

export default {
    name: 'config',
    usage: ['git config name', 'git config name value', 'git config --unset name'],
    description: 'Get or set git configuration options.',
    args: {
        allowPositionals: true,
        options: {
            'unset': {
                description: 'Remove the matching line from the config.',
                type: 'boolean',
            },
            // TODO: --list, which doesn't have a isomorphic-git command yet.
            //  See https://github.com/isomorphic-git/isomorphic-git/issues/1917
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;

        if (positionals.length === 0 || positionals.length > 2)
            throw SHOW_USAGE;

        const key = positionals.shift();
        const value = positionals.shift();

        const { repository_dir, git_dir } = await find_repo_root(fs, env.PWD);

        if (value || options.unset) {
            // Set it
            // TODO: If --unset AND we have a value, we should only remove an entry that has that value
            await git.setConfig({
                fs,
                dir: repository_dir,
                gitdir: git_dir,
                path: key,
                value: options.unset ? undefined : value,
            });
            return;
        }

        // Get it
        const result = await git.getConfig({
            fs,
            dir: repository_dir,
            gitdir: git_dir,
            path: key,
        });
        if (result === undefined) {
            // Not found, so return 1
            return 1;
        }
        stdout(result);
    }
}
