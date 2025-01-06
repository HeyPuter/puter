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
import git, { STAGE, TREE, WORKDIR } from 'isomorphic-git';
import { find_repo_root, group_positional_arguments, resolve_to_commit, resolve_to_oid } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';
import * as Diff from 'diff';
import path from 'path-browserify';
import { diff_formatting_options, format_diffs, process_diff_formatting_options } from '../format.js';
import { diff_git_trees } from '../diff.js';
import { color_options, process_color_options } from '../color.js';

export default {
    name: 'diff',
    usage: [
        'git diff [<options>] [--] [<path>...]',
        'git diff [<options>] --cached [--] [<path>...]',
        'git diff [<options>] <commit> [--] [<path>...]',
        'git diff [<options>] <commit> <commit> [--] [<path>...]',
        'git diff [<options>] --no-index [--] <path> <path>',
    ],
    description: `Show changes between commits, the working tree, and elsewhere.`,
    args: {
        allowPositionals: true,
        tokens: true,
        options: {
            ...diff_formatting_options,
            'cached': {
                description: 'Show changes staged for commit.',
                type: 'boolean',
            },
            'exit-code': {
                description: 'Exit with 1 if there are differences, or 0 if there are no differences.',
                type: 'boolean',
            },
            'staged': {
                description: 'Alias for --cached.',
                type: 'boolean',
            },
            'no-index': {
                description: 'Compare files, ignoring git.',
                type: 'boolean',
            },
            ...color_options,
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals, tokens } = args;
        const cache = {};

        process_color_options(options);

        const diff_options = process_diff_formatting_options(options);
        if (diff_options.no_patch && !options['exit-code'])
            return;

        if (options['staged']) {
            options['cached'] = true;
            delete options['staged'];
        }

        if (options['cached'] && options['no-index']) {
            stderr('error: --cached and --no-index are mutually exclusive.');
            throw SHOW_USAGE;
        }

        if (options['no-index']) {
            if (positionals.length !== 2) {
                stderr('error: git diff --no-index expects exactly 2 file paths to compare.');
                throw SHOW_USAGE;
            }

            const [ a_rel_path, b_rel_path ] = positionals;
            const a_path = path.resolve(env.PWD, a_rel_path);
            const b_path = path.resolve(env.PWD, b_rel_path);
            const [ a_source, b_source, a_stat, b_stat ] = await Promise.all([
                fs.promises.readFile(a_path, { encoding: 'utf8' }),
                fs.promises.readFile(b_path, { encoding: 'utf8' }),
                fs.promises.stat(a_path),
                fs.promises.stat(b_path),
            ]);

            const diff = Diff.structuredPatch(a_rel_path, b_rel_path, a_source, b_source, undefined, undefined, {
                context: diff_options.context_lines,
                newlineIsToken: true,
            });

            // Git mode format is, in octal:
            //   2 digits for the type of file
            //   a 0
            //   3 digits for the permissions
            const mode_string = (stat) => {
                return (stat.isSymbolicLink() ? '12' : '10') + '0' + Number(a_stat.mode).toString(8);
            }

            const a = { path: a_rel_path, oid: '00000000', mode: mode_string(a_stat) };
            const b = { path: b_rel_path, oid: '00000000', mode: mode_string(b_stat) };
            stdout(await format_diffs({ fs, dir, gitdir, cache }, { a, b, diff }, diff_options));

            return;
        }

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // TODO: Canonical git is more permissive about requiring `--` before the file paths, when it's unambiguous.
        const { before: commit_args, after: path_args } = group_positional_arguments(tokens);

        // Ensure all commit_args are commit references
        const resolved_commits = await Promise.allSettled(commit_args.map(commit_arg => {
            return resolve_to_commit({ fs, dir, gitdir, cache }, commit_arg);
        }));
        for (const [i, commit] of resolved_commits.entries()) {
            if (commit.status === 'rejected')
                throw new Error(`bad revision '${commit_args[i]}'`);
        }
        const [ from_oid, to_oid ] = resolved_commits.map(it => it.value.oid);

        const path_filters = path_args.map(it => path.resolve(env.PWD, it));
        const diff_ctx = {
            fs, dir, gitdir, cache, env,
            context_lines: diff_options.context_lines,
            path_filters,
        };

        const read_tree = walker => walker?.content()?.then(it => new TextDecoder().decode(it));
        const read_staged = walker => walker?.oid()
            ?.then(oid => git.readBlob({ fs, dir, gitdir, oid, cache }))
            .then(it => new TextDecoder().decode(it.blob));

        let diffs = [];

        if (options['cached']) {
            if (commit_args.length > 1) {
                stderr('error: Too many <commit>s passed to `git diff --cached`. Up to 1 is allowed.');
                throw SHOW_USAGE;
            }
            // Show staged changes
            diffs = await diff_git_trees({
                ...diff_ctx,
                a_tree: TREE({ ref: from_oid ?? 'HEAD' }),
                b_tree: STAGE(),
                read_a: read_tree,
                read_b: read_staged,
            });
        } else if (commit_args.length === 0) {
            // Show unstaged changes
            diffs = await diff_git_trees({
                ...diff_ctx,
                a_tree: STAGE(),
                b_tree: WORKDIR(),
                read_a: read_staged,
                read_b: read_tree,
            });
        } else if (commit_args.length === 1) {
            // Changes from commit to workdir
            diffs = await diff_git_trees({
                ...diff_ctx,
                a_tree: TREE({ ref: from_oid }),
                b_tree: WORKDIR(),
                read_a: read_tree,
                read_b: read_tree,
            });
        } else if (commit_args.length === 2) {
            // Changes from one commit to another
            diffs = await diff_git_trees({
                ...diff_ctx,
                a_tree: TREE({ ref: from_oid }),
                b_tree: TREE({ ref: to_oid }),
                read_a: read_tree,
                read_b: read_tree,
            });
        } else {
            // TODO: Canonical git supports >2 <commit>s for merge commits.
            stderr('error: Too many <commit>s passed to `git diff`. Up to 2 are supported.');
            throw SHOW_USAGE;
        }

        if (!diff_options.no_patch)
            stdout(await format_diffs({ fs, dir, gitdir, cache }, diffs, diff_options));

        if (options['exit-code'])
            return diffs.length > 0 ? 1 : 0;
    }
}
