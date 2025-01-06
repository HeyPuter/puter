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
import git from 'isomorphic-git';
import { find_repo_root } from '../git-helpers.js';

export default {
    name: 'add',
    usage: 'git add [--] [<pathspec>...]',
    description: 'Add file contents to the index.',
    args: {
        allowPositionals: true,
        options: {
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        const pathspecs = [...positionals];
        if (pathspecs.length === 0) {
            stdout('Nothing specified, nothing added.');
            return;
        }

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // NOTE: Canonical git lets you `git add FILE` with a FILE that's been deleted, to add that deletion to the index.
        //       However, `git.add()` only handles files that currently exist. So, we have to implement this manually.
        const file_status = await git.statusMatrix({
            fs, dir, gitdir, cache,
            ignored: false,
            filepaths: pathspecs,
        });

        // TODO: We should complain if one or more pathspecs don't match anything.

        const operations = file_status
            .filter(([ filepath, head, worktree, staged ]) => worktree !== staged)
            .map(([ filepath, head, worktree, index ]) => {
                // Remove deleted files
                if (worktree === 0)
                    return git.remove({ fs, dir, gitdir, cache, filepath });

                // All other files have changes to add
                return git.add({ fs, dir, gitdir, cache, filepath });
            });

        await Promise.all(operations);
    }
}
