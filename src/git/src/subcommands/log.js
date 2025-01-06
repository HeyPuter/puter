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
import git, { TREE } from 'isomorphic-git';
import { find_repo_root, group_positional_arguments } from '../git-helpers.js';
import {
    commit_formatting_options,
    diff_formatting_options,
    format_commit, format_diffs,
    process_commit_formatting_options,
    process_diff_formatting_options,
} from '../format.js';
import path from 'path-browserify';
import { SHOW_USAGE } from '../help.js';
import { diff_git_trees } from '../diff.js';
import { color_options, process_color_options } from '../color.js';

export default {
    name: 'log',
    usage: 'git log [<formatting-option>...] [--max-count <n>] [<revision>] [[--] <path>]',
    description: 'Show commit logs, starting at the given revision.',
    args: {
        allowPositionals: true,
        tokens: true,
        options: {
            ...commit_formatting_options,
            ...diff_formatting_options,
            ...color_options,
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
        const cache = {};

        process_commit_formatting_options(options);
        const diff_options = process_diff_formatting_options(options, { show_patch_by_default: false });
        process_color_options(options);

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
        const diff_ctx = {
            fs, dir, gitdir, cache, env,
            context_lines: diff_options.context_lines,
            path_filters: paths.map(it => path.resolve(env.PWD, it)),
        };
        const read_tree = walker => walker?.content()?.then(it => new TextDecoder().decode(it));

        for (const commit of log) {
            stdout(await format_commit({ fs, dir, gitdir, cache }, commit.commit, commit.oid, options));
            if (diff_options.display_diff()) {
                const diffs = await diff_git_trees({
                    ...diff_ctx,
                    // NOTE: Using an empty string for a non-existent parent prevents the default value 'HEAD' getting used.
                    // TREE() then fails to resolve that ref, and defaults to the empty commit, which is what we want.
                    a_tree: TREE({ ref: commit.commit.parent[0] ?? '' }),
                    b_tree: TREE({ ref: commit.oid }),
                    read_a: read_tree,
                    read_b: read_tree,
                });
                stdout(await format_diffs({ fs, dir, gitdir, cache }, diffs, diff_options));
            }
        }
    }
}
