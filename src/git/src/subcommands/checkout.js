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
import { find_repo_root, resolve_to_commit, shorten_hash } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';

const CHECKOUT = {
    name: 'checkout',
    usage: [
        'git checkout [--force] <branch>',
        'git checkout (-b | -B) [--force] <new-branch> [<start-point>]',
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

        // TODO: This manual processing is done because parseArgs() doesn't allow options to have only a short name.
        //       Replace it with a better args parsing library.
        for (const token of tokens) {
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

        // DRY: Copied from branch.js
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

        if (options['new-branch']) {
            const { branches, current_branch } = await get_branch_data();
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
                dir,
                gitdir,
                ref: branch_name,
                object: starting_point,
                checkout: true,
                force: options.force,
            });
            stdout(`Switched to a new branch '${branch_name}'`);
            return;
        }

        // Check out a branch or commit
        // TODO: Check out files.
        // TODO: Checking out a branch name that exists in a remote but not locally, should create a new branch tracking that remote.
        {
            if (positionals.length === 0 || positionals.length > 1) {
                stderr('error: Expected 1 argument, for <branch>.');
                throw SHOW_USAGE;
            }
            const { branches, current_branch } = await get_branch_data();
            const reference = positionals.shift();

            if (reference === current_branch) {
                stdout(`Already on '${reference}'`);
                return;
            }

            const [ old_commit, commit ] = await Promise.all([
                resolve_to_commit({ fs, dir, gitdir, cache }, 'HEAD'),
                resolve_to_commit({ fs, dir, gitdir, cache }, reference ),
            ]);
            if (!commit)
                throw new Error(`Reference '${reference}' not found.`);

            await git.checkout({
                fs,
                dir,
                gitdir,
                cache,
                ref: reference,
                force: options.force,
            });
            if (branches.includes(reference)) {
                stdout(`Switched to branch '${reference}'`);
            } else {
                const commit_title = commit.commit.message.split('\n', 2)[0];
                const old_commit_title = old_commit.commit.message.split('\n', 2)[0];

                const short_oid = await shorten_hash({ fs, dir, gitdir, cache }, commit.oid);
                const short_old_oid = await shorten_hash({ fs, dir, gitdir, cache }, old_commit.oid);

                stdout(`Previous HEAD position was ${short_old_oid} ${old_commit_title}`);
                stdout(`HEAD is now at ${short_oid} ${commit_title}`);
            }
        }
    }
};
export default CHECKOUT;
