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
import path from 'path-browserify';
import { find_repo_root, shorten_hash } from '../git-helpers.js';
import chalk from 'chalk';

export default {
    name: 'status',
    usage: 'git status',
    description: 'Describe the status of the git working tree.',
    args: {
        allowPositionals: false,
        options: {
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // Gather up file differences
        const file_status = await git.statusMatrix({
            fs,
            dir,
            gitdir,
            cache,
            ignored: false,
        });

        const staged = [];
        const unstaged = [];
        const untracked = [];

        const HEAD = 1;
        const WORKDIR = 2;
        const STAGE = 3;

        for (const file of file_status) {
            const absolute_path = path.resolve(dir, file[0]);
            const relative_path = path.relative(env.PWD, absolute_path);

            const status_string = `${file[1]}${file[2]}${file[3]}`;
            switch (status_string) {
                case '020': // new, untracked
                    untracked.push(relative_path);
                    break;
                case '022': // added, staged
                    staged.push([relative_path, 'added']);
                    break;
                case '023': // added, staged, with unstaged changes
                    staged.push([relative_path, 'added']);
                    unstaged.push([relative_path, 'modified']);
                    break;
                case '111': // unmodified
                    // Ignore it
                    break;
                case '121': // modified, unstaged
                    unstaged.push([relative_path, 'modified']);
                    break;
                case '122': // modified, staged
                    staged.push([relative_path, 'modified']);
                    break;
                case '123': // modified, staged, with unstaged changes
                    staged.push([relative_path, 'modified']);
                    unstaged.push([relative_path, 'modified']);
                    break;
                case '101': // deleted, unstaged
                    unstaged.push([relative_path, 'deleted']);
                    break;
                case '100': // deleted, staged
                    staged.push([relative_path, 'deleted']);
                    break;
                case '120': // deleted, staged, with unstaged-modified changes (new file of the same name)
                case '110': // deleted, staged, with unstaged changes (new file of the same name)
                    staged.push([relative_path, 'deleted']);
                    unstaged.push([relative_path, 'added']);
                    break;
            }
        }

        // TODO: Short-format output

        const padding = (length) => {
            if (length <= 0) return '';
            return ' '.repeat(length);
        }

        const current_branch = await git.currentBranch({
            fs,
            dir,
            gitdir,
        });
        if (current_branch) {
            stdout(`On branch ${current_branch}`);
            // Check if the branch actually exists. If not, this is a fresh repo that's never been committed to.
            const actual_current_branch = await git.currentBranch({ fs, dir, gitdir, test: true });
            if (!actual_current_branch) {
                stdout('\nNo commits yet\n');
            }
        } else {
            const oid = await git.resolveRef({ fs, dir, gitdir, ref: 'HEAD' });
            const short_oid = await shorten_hash({ fs, dir, gitdir, cache }, oid);
            stdout(`${chalk.redBright('HEAD detached at')} ${short_oid}`);
        }

        if (staged.length) {
            stdout('Changes to be committed:');
            for (const [file, change] of staged) {
                stdout(chalk.greenBright(`        ${change}: ${padding(10 - change.length)}${file}`));
            }
            stdout('');
        }

        if (unstaged.length) {
            stdout('Changes not staged for commit:');
            for (const [file, change] of unstaged) {
                stdout(chalk.redBright(`        ${change}: ${padding(10 - change.length)}${file}`));
            }
            stdout('');
        }

        if (untracked.length) {
            stdout('Untracked files:');
            // TODO: Native git is smart enough to only list a top-level directory if all its contents are untracked
            for (const file of untracked) {
                stdout(chalk.redBright(`        ${file}`));
            }
        }

        if (staged.length + unstaged.length + untracked.length === 0) {
            stdout('nothing to commit, working tree clean');
        }
    }
}
