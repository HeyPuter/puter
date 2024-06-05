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
import http from 'isomorphic-git/http/web';
import { find_repo_root, PROXY_URL } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';

const CHECKOUT = {
    name: 'checkout',
    usage: [
        'git checkout [--force] <branch>',
        'git checkout (-b | -B) [--force] <new-branch> [<start-point>]',
        'git checkout [--force] [<from>] [--] <pathspec>...',
    ],
    description: `Switch branches.`,
    args: {
        allowPositionals: true,
        tokens: true,
        strict: false,
        options: {
            'new-branch': {
                description: 'Create a new branch and then check it out.',
                type: 'boolean',
                short: 'b',
                default: false,
            },
            'force': {
                description: 'Perform the checkout forcefully. For --new-branch, ignores whether the branch already exists. For checking out branches, ignores and overwrites any unstaged changes.',
                type: 'boolean',
                short: 'f',
            },
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals, tokens } = args;
        const cache = {};

        const checkout_targets = {
            from: null,
            seen_separator: false,
            pathspecs: [],
        };
        let reading_pathspecs = false;
        for (const token of tokens) {

            // Parse "[<from>] [--] <pathspec>..."
            if (token.kind === 'option-terminator') {
                checkout_targets.seen_separator = true;
                reading_pathspecs = true;
                continue;
            }
            if (token.kind === 'positional') {
                if (reading_pathspecs) {
                    checkout_targets.pathspecs.push(token.value);
                } else {
                    checkout_targets.from = token.value;
                    reading_pathspecs = true;
                }
                continue;
            }

            // Parse options
            if (token.kind !== 'option') continue;

            if (token.name === 'B') {
                options['new-branch'] = true;
                options.force = true;
                delete options['B'];
                continue;
            }

            // Report any options that we don't recognize
            let option_recognized = false;
            for (const [key, value] of Object.entries(CHECKOUT.args.options)) {
                if (key === token.name || value.short === token.name) {
                    console.log('matches!');
                    option_recognized = true;
                    break;
                }
            }
            if (!option_recognized) {
                stderr(`Unrecognized option: ${token.rawName}`);
                throw SHOW_USAGE;
            }
        }

        const { repository_dir, git_dir } = await find_repo_root(fs, env.PWD);

        // DRY: Copied from branch.js
        const get_current_branch = async () => git.currentBranch({
            fs,
            dir: repository_dir,
            gitdir: git_dir,
            test: true,
        });
        const get_all_branches = async () => git.listBranches({
            fs,
            dir: repository_dir,
            gitdir: git_dir,
        });
        const get_branch_data = async () => {
            const [branches, current_branch] = await Promise.all([
                get_all_branches(),
                get_current_branch(),
            ]);
            return { branches, current_branch };
        }

        const { branches, current_branch } = await get_branch_data();

        if (options['new-branch']) {
            if (positionals.length === 0 || positionals.length > 2) {
                stderr('error: Expected 1 or 2 arguments, for <new-branch> [<start-point>].');
                throw SHOW_USAGE;
            }
            const branch_name = positionals.shift();
            const starting_point = positionals.shift() ?? current_branch;

            if (branches.includes(branch_name) && !options.force)
                throw new Error(`A branch named '${branch_name}' already exists.`);

            await git.branch({
                fs,
                dir: repository_dir,
                gitdir: git_dir,
                ref: branch_name,
                object: starting_point,
                checkout: true,
                force: options.force,
            });
            stdout(`Switched to a new branch '${branch_name}'`);
            return;
        }

        // Check out a branch, or files
        if (positionals.length === 0) {
            stderr('error: Expected at least 1 argument, for either a branch name or some path specs.');
            throw SHOW_USAGE;
        }

        if (checkout_targets.from) {
            const branch_name = checkout_targets.from;

            const specified_pathspecs = checkout_targets.pathspecs.length > 0;

            if (branch_name === current_branch && !specified_pathspecs) {
                stdout(`Already on '${branch_name}'`);
                return;
            }

            if (branches.includes(branch_name)) {
                await git.checkout({
                    fs,
                    dir: repository_dir,
                    gitdir: git_dir,
                    cache,
                    ref: branch_name,
                    ...(specified_pathspecs ? { filepaths: checkout_targets.pathspecs } : {}),
                    force: options.force,
                    onProgress: progress => {
                        console.log(progress.phase, progress.loaded, progress.total);
                    },
                });
                if (specified_pathspecs) {
                    // TODO: We should mention which files got updated!
                    stdout(`Updated files from '${branch_name}'`);
                } else {
                    stdout(`Switched to branch '${branch_name}'`);
                }
                return;
            } else if (checkout_targets.seen_separator) {
                throw new Error(`Branch '${branch_name}' not found.`);
            }
        }

        if (positionals.length === 1) {
            const branch_name = positionals[0];

            if (branch_name === current_branch) {
                stdout(`Already on '${branch_name}'`);
                return;
            }

            if (branches.includes(branch_name)) {
                await git.checkout({
                    fs,
                    dir: repository_dir,
                    gitdir: git_dir,
                    cache,
                    ref: branch_name,
                    force: options.force,
                });
                stdout(`Switched to branch '${branch_name}'`);
                return;
            }
        }

        // Not a branch, so check out files
        await git.checkout({
            fs,
            dir: repository_dir,
            gitdir: git_dir,
            cache,
            filepaths: [positionals],
            force: options.force,
        });
    }
};
export default CHECKOUT;
