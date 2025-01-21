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
import { find_repo_root, shorten_hash } from '../git-helpers.js';

export default {
    name: 'commit',
    usage: 'git commit [-m|--message <message>] [-a|--author <author>]',
    description: 'Commit staged changes to the repository.',
    args: {
        allowPositionals: false,
        options: {
            message: {
                description: 'Specify the commit message',
                type: 'string',
                short: 'm',
            },
            author: {
                description: 'Specify the commit author, as `A U Thor <author@example.com>`',
                type: 'string',
            },
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        if (!options.message) {
            // TODO: Support opening a temporary file in an editor,
            //  where the user can edit the commit message if it's not specified.
            stderr('You must specify a commit message with --message or -m');
            return 1;
        }

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        let user_name;
        let user_email;

        if (options.author) {
            const author_regex = /(.+?)\s+<(.+)>/;
            const matches = options.author.match(author_regex);
            if (!matches)
                throw new Error('Failed to parse author string');
            user_name = matches[1];
            user_email = matches[2];
        } else {
            user_name = await git.getConfig({
                fs,
                dir,
                gitdir,
                path: 'user.name',
            });
            user_email = await git.getConfig({
                fs,
                dir,
                gitdir,
                path: 'user.email',
            });
        }

        if (!user_name || !user_email) {
            throw new Error('Missing author information. Either provide --author="A <a@b.c>" or set user.name and user.email in the git config');
        }

        const commit_hash = await git.commit({
            fs,
            dir,
            gitdir,
            message: options.message,
            author: {
                name: user_name,
                email: user_email,
            },
        });

        const branch = await git.currentBranch({
            fs,
            dir,
            gitdir,
        });
        const commit_title = options.message.split('\n')[0];
        const short_hash = await shorten_hash({ fs, dir, gitdir, cache }, commit_hash);
        let output = `[${branch ?? 'detached HEAD'} ${short_hash}] ${commit_title}\n`;
        // TODO: --amend prints out the date of the original commit here, as:
        //  ` Date: Fri May 17 15:45:47 2024 +0100`
        // TODO: Print out file change count, insertion count, and deletion count
        //  (Seems if insertions and deletions are both 0, we should print both.
        //   Otherwise we just print nonzero ones.)
        // TODO: Print out each file created or deleted. eg:
        //  create mode 100644 bar
        //  delete mode 100644 foo.txt
        stdout(output);
    }
}
