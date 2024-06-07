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
import { find_repo_root, group_positional_arguments } from '../git-helpers.js';
import { commit_formatting_options, format_commit, process_commit_formatting_options } from '../format.js';
import { SHOW_USAGE } from '../help.js';

export default {
    name: 'log',
    usage: 'git log [<formatting-option>...] [--max-count <n>] [<revision>] [[--] <path>]',
    description: 'Show commit logs, starting at the given revision.',
    args: {
        allowPositionals: true,
        tokens: true,
        options: {
            ...commit_formatting_options,
            'max-count': {
                description: 'Maximum number of commits to output.',
                type: 'string',
                short: 'n',
            },
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals, tokens } = args;

        process_commit_formatting_options(options);

        const depth = Number(options['max-count']) || undefined;

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        const { before: refs, after: paths } = group_positional_arguments(tokens);
        if (refs.length > 1 || paths.length > 1) {
            stderr('error: Too many revisions or paths given. Expected [<revision>] [[--] <path>]');
            throw SHOW_USAGE;
        }

        const log = await git.log({
            fs,
            dir,
            gitdir,
            depth,
            ref: refs[0],
            filepath: paths[0],
        });

        for (const commit of log) {
            stdout(format_commit(commit.commit, commit.oid, options));
        }
    }
}
