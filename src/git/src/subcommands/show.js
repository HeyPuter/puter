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
import { find_repo_root, resolve_to_oid } from '../git-helpers.js';
import {
    commit_formatting_options,
    diff_formatting_options,
    format_commit, format_diffs,
    format_tag,
    format_tree,
    process_commit_formatting_options,
    process_diff_formatting_options,
} from '../format.js';
import { diff_git_trees } from '../diff.js';
import { color_options, process_color_options } from '../color.js';

export default {
    name: 'show',
    usage: 'git show [<formatting-option>...] <object>',
    description: 'Show information about an object (commit, tree, tag, blob, etc.) in git.',
    args: {
        allowPositionals: true,
        options: {
            ...commit_formatting_options,
            ...diff_formatting_options,
            ...color_options,
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;

        process_commit_formatting_options(options);
        const diff_options = process_diff_formatting_options(options);
        process_color_options(options);

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        const objects = [...positionals];

        const cache = {};
        const diff_ctx = {
            fs, dir, gitdir, cache, env,
            context_lines: diff_options.context_lines,
            path_filters: [],
        };

        const read_tree = walker => walker?.content()?.then(it => new TextDecoder().decode(it));

        const format_object = async (parsed_object) => {
            switch (parsed_object.type) {
                case 'blob':
                    return new TextDecoder().decode(parsed_object.object);
                case 'commit': {
                    let s = await format_commit({ fs, dir, gitdir, cache }, parsed_object.object, parsed_object.oid, options);
                    if (diff_options.display_diff()) {
                        const diffs = await diff_git_trees({
                            ...diff_ctx,
                            // NOTE: Using an empty string for a non-existent parent prevents the default value 'HEAD' getting used.
                            // TREE() then fails to resolve that ref, and defaults to the empty commit, which is what we want.
                            a_tree: TREE({ ref: parsed_object.object.parent[0] ?? '' }),
                            b_tree: TREE({ ref: parsed_object.oid }),
                            read_a: read_tree,
                            read_b: read_tree,
                        });
                        s += '\n';
                        s += await format_diffs({ fs, dir, gitdir, cache }, diffs, diff_options);
                    }
                    return s;
                }
                case 'tree':
                    return format_tree(parsed_object.oid, parsed_object.object, options);
                case 'tag': {
                    const tag = parsed_object.object;
                    let s = format_tag(tag, options);
                    // Formatting a tag also outputs the formatted object it points to.
                    // That may also be a tag, so we recurse.
                    const target = await git.readObject({
                        fs,
                        dir,
                        gitdir,
                        oid: tag.object,
                        format: 'parsed',
                        cache,
                    });
                    s += await format_object(target);
                    return s;
                }
            }
        }

        for (const ref of objects) {
            // Could be any ref, so first get the oid that's referred to.
            const oid = await resolve_to_oid({ fs, dir, gitdir, cache }, ref);

            // Then obtain the object and parse it.
            const parsed_object = await git.readObject({
                fs,
                dir,
                gitdir,
                oid,
                format: 'parsed',
                cache,
            });

            // Then, print it out
            stdout(await format_object(parsed_object));
        }
    }
}
