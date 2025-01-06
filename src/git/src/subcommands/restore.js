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
import { find_repo_root } from '../git-helpers.js';
import path from 'path-browserify';

export default {
    name: 'restore',
    usage: 'git restore [--staged] [--worktree] [--] [<pathspec>...]',
    description: 'Add file contents to the index.',
    args: {
        allowPositionals: true,
        options: {
            'staged': {
                description: 'Restore the file in the index.',
                type: 'boolean',
                short: 'S',
            },
            'worktree': {
                description: 'Restore the file in the working tree.',
                type: 'boolean',
                short: 'W',
            },
            'overlay': {
                description: 'Enable overlay mode. In overlay mode, files that do not exist in the source are not deleted.',
                type: 'boolean',
                value: false,
            },
            'no-overlay': {
                description: 'Disable overlay mode. Any files not in the source will be deleted.',
                type: 'boolean',
            },
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        if (!options.staged && !options.worktree)
            options.worktree = true;

        if (options['no-overlay'])
            options.overlay = false;

        const FROM_INDEX = Symbol('FROM_INDEX');
        const source_ref = options.staged ? 'HEAD' : FROM_INDEX;

        const pathspecs = positionals.map(it => path.resolve(env.PWD, it));
        if (pathspecs.length === 0)
            throw new Error(`you must specify path(s) to restore`);

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // TODO: We should complain if one or more pathspecs don't match anything.

        const operations = await git.walk({
            fs, dir, gitdir, cache,
            trees: [
                source_ref === FROM_INDEX ? STAGE() : TREE({ ref: source_ref }),
                TREE({ ref: 'HEAD' }), // Only required to check if a file is tracked.
                STAGE(),
                WORKDIR(),
            ],
            map: async (filepath, [ source, head, staged, workdir]) => {
                // Reject paths that don't match pathspecs.
                const abs_filepath = path.resolve(env.PWD, filepath);
                if (!pathspecs.some(abs_path =>
                    (filepath === '.') || (abs_filepath.startsWith(abs_path)) || (path.dirname(abs_filepath) === abs_path),
                )) {
                    return null;
                }

                // FIXME: Allow restoring ignored files that are tracked
                if (await git.isIgnored({ fs, dir, gitdir, filepath }))
                    return null;

                const [
                    source_type, staged_type, workdir_type
                ] = await Promise.all([
                    source?.type(), staged?.type(), workdir?.type()
                ]);

                // Exclude directories from results, but still iterate them.
                if ((!source_type || source_type === 'tree')
                    && (!staged_type || staged_type === 'tree')
                    && (!workdir_type || workdir_type === 'tree')) {
                    return;
                }

                // We need to modify the index or working tree if their oid doesn't match the source's.
                const [
                    source_oid, staged_oid, workdir_oid
                ] = await Promise.all([
                    source_type === 'blob' ? source.oid() : undefined,
                    staged_type === 'blob' ? staged.oid() : undefined,
                    workdir_type === 'blob' ? workdir.oid() : undefined,
                ]);
                const something_changed = (options.staged && staged_oid !== source_oid) || (options.worktree && workdir_oid !== source_oid);
                if (!something_changed)
                    return null;

                return Promise.all([
                    // Update the index
                    (async () => {
                        if (!options.staged || staged_oid === source_oid)
                            return;

                        await git.resetIndex({
                            fs, dir, gitdir, cache,
                            filepath,
                            ref: source_ref,
                        });
                    })(),
                    // Update the working tree
                    (async () => {
                        if (!options.worktree || workdir_oid === source_oid)
                            return;

                        // If the file isn't in source, it needs to be deleted if it is tracked by git.
                        // For now, I'll consider a file tracked if it exists in HEAD. This may not be correct though.
                        // TODO: Add an isTracked(file) method to isomorphic-git
                        if (!source && !head)
                            return null;

                        if (source_oid) {
                            // Write the file
                            // Unfortunately, reading the source's file data is done differently depending on if it's the index or not.
                            const source_content = source_ref === FROM_INDEX
                                ? (await git.readBlob({ fs, dir, gitdir, cache, oid: source_oid })).blob
                                : await source.content();
                            await fs.promises.writeFile(abs_filepath, source_content);
                        } else if (!options.overlay) {
                            // Delete the file
                            await fs.promises.unlink(abs_filepath);
                        }
                    })(),
                ]);
            },
        });
        await Promise.all(operations);
    }
}
