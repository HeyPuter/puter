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
import http from 'isomorphic-git/http/web';
import { SHOW_USAGE } from '../help.js';
import path from 'path-browserify';
import { authentication_options, Authenticator } from '../auth.js';

export default {
    name: 'clone',
    usage: 'git clone <repository> [<directory>]',
    description: 'Clone a repository into a new directory.',
    args: {
        allowPositionals: true,
        options: {
            depth: {
                description: 'Only clone the specified number of commits. Implies --single-branch unless --no-single-branch is given.',
                type: 'string',
            },
            'single-branch': {
                description: 'Only clone the history of the primary branch',
                type: 'boolean',
                default: false,
            },
            'no-single-branch': {
                description: 'Clone all history (default)',
                type: 'boolean',
            },
            'no-tags': {
                description: 'Do not clone any tags from the remote',
                type: 'boolean',
                default: false,
            },
            ...authentication_options,
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;

        if (options.depth) {
            const depth = Number.parseInt(options.depth);
            if (!depth) {
                stderr('Invalid --depth: Must be an integer greater than 0.');
                return 1;
            }
            options.depth = depth;
            options['single-branch'] = true;
        }

        if (options['no-single-branch']) {
            options['single-branch'] = false;
            delete options['no-single-branch'];
        }

        const [repository, directory] = positionals;
        if (!repository) {
            stderr('fatal: You must specify a repository to clone.');
            throw SHOW_USAGE;
        }

        if (!options.username !== !options.password) {
            stderr('Please specify both --username and --password, or neither');
            return 1;
        }
        const authenticator = new Authenticator({
            username: options.username,
            password: options.password,
        });

        let repo_path;
        if (directory) {
            repo_path = path.resolve(env.PWD, directory);
        } else {
            // Try to extract directory from the repository url
            let repo_name = repository.slice(repository.lastIndexOf('/') + 1);
            if (repo_name.endsWith('.git')) {
                repo_name = repo_name.slice(0, -4);
            }

            repo_path = path.resolve(env.PWD, repo_name);
        }

        // The path must either not exist, or be a directory that is empty
        try {
            const readdir = await fs.promises.readdir(repo_path);
            if (readdir.length !== 0) {
                stderr(`fatal: ${repo_path} is not empty.`);
                return 1;
            }
        } catch (e) {
            if (e.code !== 'ENOENT') {
                stderr(`fatal: ${repo_path} is a file.`);
                return 1;
            }
        }

        stdout(`Cloning into '${path.relative(env.PWD, repo_path)}'...`);

        await git.clone({
            fs,
            http,
            corsProxy: globalThis.__CONFIG__.proxy_url,
            dir: repo_path,
            url: repository,
            depth: options.depth,
            singleBranch: options['single-branch'],
            noTags: options['no-tags'],
            onMessage: (message) => { stdout(message); },
            ...authenticator.get_auth_callbacks(stderr),
        });
    }
}
