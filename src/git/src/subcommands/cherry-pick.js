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
import { find_repo_root, has_staged_changes, resolve_to_commit, shorten_hash } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';
import chalk from 'chalk';
import { diff_git_trees } from '../diff.js';
import * as Diff from 'diff';
import path from 'path-browserify';

// TODO: cherry-pick is a multi-stage process. Any issue that occurs should pause it, print a message,
//       and return to the prompt, letting the user decide how to proceed.
export default {
    name: 'cherry-pick',
    usage: 'git cherry-pick <commit>...',
    description: 'Apply changes from existing commits.',
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

        if (positionals.length < 1) {
            stderr('error: Must specify commits to cherry-pick.');
            throw SHOW_USAGE;
        }

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // Ensure nothing is staged, as it would be overwritten
        if (await has_staged_changes({ fs, dir, gitdir, cache })) {
            stderr('error: your local changes would be overwritten by cherry-pick.');
            stderr(chalk.yellow('hint: commit your changes or stash them to proceed.'));
            stderr('fatal: cherry-pick failed');
            return 1;
        }

        const branch = await git.currentBranch({ fs, dir, gitdir });

        const commits = await Promise.all(positionals.map(commit_ref => resolve_to_commit({ fs, dir, gitdir, cache }, commit_ref)));
        let head_oid = await git.resolveRef({ fs, dir, gitdir, ref: 'HEAD' });
        const original_head_oid = head_oid;

        const read_tree = walker => walker?.content()?.then(it => new TextDecoder().decode(it));

        for (const commit_data of commits) {
            const commit = commit_data.commit;
            const commit_title = commit.message.split('\n')[0];
            const short_commit_oid = await shorten_hash({ fs, dir, gitdir, cache }, commit_data.oid);

            // We can't just add the old commit directly:
            // - Its parent is wrong
            // - Its tree is a snapshot of the files then. We intead need a new snapshot applying its changes
            //   to the current HEAD.
            // So, we instead stage its changes one at a time, then commit() as if this was a new commit.

            const diffs = await diff_git_trees({
                fs, dir, gitdir, cache, env,
                a_tree: TREE({ ref: commit.parent[0] }),
                b_tree: TREE({ ref: commit_data.oid }),
                read_a: read_tree,
                read_b: read_tree,
            });
            for (const { a, b, diff } of diffs) {
                // If the file was deleted, just remove it.
                if (diff.newFileName === '/dev/null') {
                    await git.remove({
                        fs, dir, gitdir, cache,
                        filepath: diff.oldFileName,
                    });
                    continue;
                }

                // If the file was created, just add it.
                if (diff.oldFileName === '/dev/null') {
                    await git.updateIndex({
                        fs, dir, gitdir, cache,
                        filepath: diff.newFileName,
                        add: true,
                        oid: b.oid,
                    });
                    continue;
                }

                // Otherwise, the file was modified. Calculate and then apply the patch.
                const existing_file_contents = await fs.promises.readFile(path.resolve(env.PWD, diff.newFileName), { encoding: 'utf8' });
                const new_file_contents = Diff.applyPatch(existing_file_contents, diff);
                if (!new_file_contents) {
                    // TODO: We should insert merge conflict markers and wait for the user resolve the conflict.
                    throw new Error(`Merge conflict: Unable to apply commit ${short_commit_oid} ${commit_title}`);
                }
                // Now, stage the new file contents
                const file_oid = await git.writeBlob({
                    fs, dir, gitdir,
                    blob: new TextEncoder().encode(new_file_contents),
                });
                await git.updateIndex({
                    fs, dir, gitdir, cache,
                    filepath: diff.newFileName,
                    oid: file_oid,
                    add: true,
                });
            }

            // Reject empty commits
            // TODO: The --keep option controls what to do about these.
            const file_status = await git.statusMatrix({
                fs, dir, gitdir, cache,
                ignored: false,
            });
            if (! await has_staged_changes({ fs, dir, gitdir, cache })) {
                // For now, just skip empty commits.
                // TODO: cherry-picking should be a multi-step process.
                stderr(`Skipping empty commit ${short_commit_oid} ${commit_title}`);
                continue;
            }

            // Make the commit!
            head_oid = await git.commit({
                fs, dir, gitdir, cache,
                message: commit.message,
                author: commit.author,
                committer: commit.committer,
            });
            const short_head_oid = await shorten_hash({ fs, dir, gitdir, cache }, head_oid);

            // Print out information about the new commit.
            // TODO: Should be a lot more output. See commit.js for a similar list of TODOs.
            stdout(`[${branch} ${short_head_oid}] ${commit_title}`);
        }
    }
}
