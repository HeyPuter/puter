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
import path from 'path-browserify';

export default {
    name: 'init',
    usage: 'git init [--bare] [--initial-branch=BRANCH] [--separate-git-dir=DIR]',
    description: `Initialize or re-initialize a git repository.`,
    args: {
        allowPositionals: true,
        options: {
            'bare': {
                description: 'Create a bare repository',
                type: 'boolean',
                default: false,
            },
            'initial-branch': {
                description: 'Name of the initial branch',
                type: 'string',
                short: 'b',
            },
            'separate-git-dir': {
                description: 'Name of directory to store the git repository, instead of ./.git/',
                type: 'string',
                default: './.git',
            },
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;

        const [ directory, ...extra_positionals ] = positionals ?? [];
        if (extra_positionals.length) {
            stderr('Too many parameters');
            return 1;
        }

        const dir = directory ? path.resolve(env.PWD, directory) : env.PWD;
        const gitdir = path.resolve(dir, options['separate-git-dir']);
        const dot_git_path = path.resolve(dir, './.git');

        // Check if repo already initialized
        let repo_exists = false;
        try {
            const stat = await fs.promises.stat(dot_git_path);
            repo_exists = true;
        } catch (e) {
            if (e.code === 'ENOENT') {
                repo_exists = false;
            }
        }

        if (repo_exists) {
            // TODO: `git init` in an existing repo re-initializes it without erasing anything.
            //  If the git dir provided is different than the existing one, it moves the contents to the new location.
            //  isomorphic-git does not seem to do this, and it's an unusual case, so for now we just prevent `git init`
            //  for existing repos.
            stderr('Git repository already initialized');
            return 1;
        }

        await git.init({
            fs,
            bare: options.bare,
            dir,
            gitdir,
            defaultBranch: options['initial-branch'],
        }).then(() => {
            // If we're using a different git dir, create a .git file pointing to it
            if (gitdir !== dot_git_path) {
                return fs.promises.writeFile(dot_git_path, `gitdir: ${gitdir}\n`, { encoding: 'utf8' });
            }
        });

        stdout(`Initialized empty git repository in ${gitdir}`);
    }
}
