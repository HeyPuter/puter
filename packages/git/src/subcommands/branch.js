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
import { find_repo_root, shorten_hash } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';

const BRANCH = {
    name: 'branch',
    usage: [
        'git branch [--list]',
        'git branch [--force] <branch-name> [<start-point>]',
        'git branch --show-current',
        'git branch --delete [--force] <branch-name>...',
        'git branch --move [--force] [<old-branch-name>] <new-branch-name>',
        'git branch --copy [--force] [<old-branch-name>] <new-branch-name>',
    ],
    description: `Manage git branches.`,
    args: {
        allowPositionals: true,
        tokens: true,
        strict: false,
        options: {
            'delete': {
                description: 'Delete the named branch.',
                type: 'boolean',
                short: 'd',
            },
            'list': {
                description: 'List branches.',
                type: 'boolean',
                short: 'l',
            },
            'move': {
                description: 'Rename a branch. Defaults to renaming the current branch if only 1 argument is given.',
                type: 'boolean',
                short: 'm',
            },
            'copy': {
                description: 'Create a copy of a branch. Defaults to copying the current branch if only 1 argument is given.',
                type: 'boolean',
                short: 'c',
            },
            'show-current': {
                description: 'Print out the name of the current branch. Prints nothing in a detached HEAD state.',
                type: 'boolean',
            },
            'force': {
                description: 'Perform the action forcefully. For --delete, ignores whether the branches are fully merged. For --move, --copy, and creating new branches, ignores whether a branch already exists with that name.',
                type: 'boolean',
                short: 'f',
            }
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals, tokens } = args;

        for (const token of tokens) {
            if (token.kind !== 'option') continue;

            if (token.name === 'C') {
                options.copy = true;
                options.force = true;
                delete options['C'];
                continue;
            }
            if (token.name === 'D') {
                options.delete = true;
                options.force = true;
                delete options['D'];
                continue;
            }
            if (token.name === 'M') {
                options.move = true;
                options.force = true;
                delete options['M'];
                continue;
            }

            // Report any options that we don't recognize
            let option_recognized = false;
            for (const [key, value] of Object.entries(BRANCH.args.options)) {
                if (key === token.name || value.short === token.name) {
                    option_recognized = true;
                    break;
                }
            }
            if (!option_recognized) {
                stderr(`Unrecognized option: ${token.rawName}`);
                throw SHOW_USAGE;
            }
        }

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        const get_current_branch = async () => git.currentBranch({
            fs,
            dir,
            gitdir,
            test: true,
        });
        const get_all_branches = async () => git.listBranches({
            fs,
            dir,
            gitdir,
        });
        const get_branch_data = async () => {
            const [branches, current_branch] = await Promise.all([
                get_all_branches(),
                get_current_branch(),
            ]);
            return { branches, current_branch };
        }

        if (options['copy']) {
            const { branches, current_branch } = await get_branch_data();
            if (positionals.length === 0 || positionals.length > 2) {
                stderr('error: Expected 1 or 2 arguments, for [<old-branch-name>] <new-branch-name>.');
                throw SHOW_USAGE;
            }
            const new_name = positionals.pop();
            const old_name = positionals.pop() ?? current_branch;

            if (new_name === old_name)
                return;

            if (!branches.includes(old_name))
                throw new Error(`Branch '${old_name}' not found.`);

            if (branches.includes(new_name) && !options.force)
                throw new Error(`A branch named '${new_name}' already exists.`);

            await git.branch({
                fs,
                dir,
                gitdir,
                ref: new_name,
                object: old_name,
                checkout: false,
                force: options.force,
            });
            return;
        }

        if (options['delete']) {
            const { branches, current_branch } = await get_branch_data();
            const branches_to_delete = [...positionals];
            if (branches_to_delete.length === 0) {
                stderr('error: Expected a list of branch names to delete.');
                throw SHOW_USAGE;
            }

            // TODO: We should only allow non-merged branches to be deleted, unless --force is specified.

            const results = await Promise.allSettled(branches_to_delete.map(async branch => {
                if (branch === current_branch)
                    throw new Error(`Cannot delete branch '${branch}' while it is checked out.`);
                if (!branches.includes(branch))
                    throw new Error(`Branch '${branch}' not found.`);
                const oid = await git.resolveRef({
                    fs,
                    dir,
                    gitdir,
                    ref: branch,
                });
                const result = await git.deleteBranch({
                    fs,
                    dir,
                    gitdir,
                    ref: branch,
                });
                return oid;
            }));

            let any_failed = false;
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const branch = branches_to_delete[i];

                if (result.status === 'rejected') {
                    any_failed = true;
                    stderr(`error: ${result.reason}`);
                } else {
                    const oid = result.value;
                    const hash = shorten_hash(result.value);
                    stdout(`Deleted branch ${branch} (was ${hash}).`);
                }
            }

            return any_failed ? 1 : 0;
        }

        if (options['move']) {
            const { branches, current_branch } = await get_branch_data();
            if (positionals.length === 0 || positionals.length > 2) {
                stderr('error: Expected 1 or 2 arguments, for [<old-branch-name>] <new-branch-name>.');
                throw SHOW_USAGE;
            }
            const new_name = positionals.pop();
            const old_name = positionals.pop() ?? current_branch;

            if (new_name === old_name)
                return;

            if (!branches.includes(old_name))
                throw new Error(`Branch '${old_name}' not found.`);

            if (branches.includes(new_name)) {
                if (!options.force)
                    throw new Error(`A branch named '${new_name}' already exists.`);
                await git.deleteBranch({
                    fs,
                    dir,
                    gitdir,
                    ref: new_name,
                });
            }

            await git.renameBranch({
                fs,
                dir,
                gitdir,
                ref: new_name,
                oldref: old_name,
                checkout: old_name === current_branch,
            });

            return;
        }

        if (options['show-current']) {
            if (positionals.length !== 0) {
                stderr('error: Unexpected arguments.');
                throw SHOW_USAGE;
            }
            const current_branch = await get_current_branch();
            if (current_branch)
                stdout(current_branch);
            return;
        }

        if (options['list'] || positionals.length === 0) {
            const { branches, current_branch } = await get_branch_data();
            // TODO: Allow a pattern here for branch names to match.
            if (positionals.length > 0) {
                stderr('error: Unexpected arguments.');
                throw SHOW_USAGE;
            }

            for (const branch of branches) {
                if (branch === current_branch) {
                    stdout(`\x1b[32;1m* ${branch}\x1b[0m`);
                } else {
                    stdout(`  ${branch}`);
                }
            }
            return;
        }

        // Finally, we have a positional argument, so we should create a branch
        {
            const { branches, current_branch } = await get_branch_data();
            const branch_name = positionals.shift();
            const starting_point = positionals.shift() ?? current_branch;

            if (branches.includes(branch_name) && !options.force)
                throw new Error(`A branch named '${branch_name}' already exists.`);

            await git.branch({
                fs,
                dir,
                gitdir,
                ref: branch_name,
                object: starting_point,
                checkout: false,
                force: options.force,
            });
        }
    }
};
export default BRANCH;
