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
import { commit_formatting_options, process_commit_formatting_options, format_commit, format_tag, format_tree } from '../format.js';

export default {
    name: 'show',
    usage: 'git show [<formatting-option>...] <object>',
    description: 'Show information about an object (commit, tree, tag, blob, etc.) in git.',
    args: {
        allowPositionals: true,
        options: {
            ...commit_formatting_options,
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;

        process_commit_formatting_options(options);

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        const objects = [...positionals];

        const cache = {};

        const format_object = async (parsed_object, options) => {
            switch (parsed_object.type) {
                case 'blob':
                    return parsed_object.object;
                case 'commit':
                    return format_commit(parsed_object.object, parsed_object.oid, options);
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
                    s += await format_object(target, options);
                    return s;
                }
            }
        }

        for (const ref of objects) {
            // Could be any ref, so first get the oid that's referred to.
            const oid = await git.resolveRef({
                fs,
                dir,
                gitdir,
                ref,
            });

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
            stdout(await format_object(parsed_object, options));
        }
    }
}
