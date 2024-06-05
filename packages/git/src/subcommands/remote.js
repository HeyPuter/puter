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
import { find_repo_root } from '../git-helpers.js';

export default {
    name: 'remote',
    usage: 'git remote',
    description: `Manage remote repositories.`,
    args: {
        allowPositionals: true,
        tokens: true,
        options: {
            verbose: {
                description: 'Verbose if the commit verbose was used',
                type: 'boolean',
                short: 'v',
                default: false,
            }
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals, tokens } = args;

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        // TODO: Other subcommands:
        //  - set-head
        //  - set-branches
        //  - get-url
        //  - set-url
        //  - show
        //  - prune
        //  - update
        const subcommand = positionals.shift();
        switch (subcommand) {
            case undefined: {
                // No subcommand, so list remotes
                const remotes = await git.listRemotes({
                    fs,
                    dir,
                    gitdir,
                });
                for (const remote of remotes) {
                    if (options.verbose) {
                        // TODO: fetch and push urls can be overridden per remote. That's what this is supposed to show.
                        stdout(`${remote.remote}\t${remote.url} (fetch)`);
                        stdout(`${remote.remote}\t${remote.url} (push)`);
                    } else {
                        stdout(remote.remote);
                    }
                }
                return;
            }

            case 'add': {
                if (positionals.length !== 2) {
                    stderr(`error: Wrong number of arguments to 'git remote add'. Expected 2 but got ${positionals.length}`);
                    return 1;
                }
                const [ name, url ] = positionals;
                await git.addRemote({
                    fs,
                    dir,
                    gitdir,
                    remote: name,
                    url: url,
                });
                return;
            }

            case 'remove':
            case 'rm': {
                if (positionals.length !== 1) {
                    stderr(`error: Wrong number of arguments to 'git remote remove'. Expected 1 but got ${positionals.length}`);
                    return 1;
                }
                const [ name ] = positionals;

                // First, check if the remote exists so we can show an error if it doesn't.
                const remotes = await git.listRemotes({
                    fs,
                    dir,
                    gitdir,
                });
                if (!remotes.find(it => it.remote === name)) {
                    stderr(`error: No such remote: '${name}'`);
                    return 1;
                }

                await git.deleteRemote({
                    fs,
                    dir,
                    gitdir,
                    remote: name,
                });
                return;
            }

            default: {
                stderr(`fatal: Unrecognized command 'git remote ${subcommand}'`);
                return 1;
            }
        }


    }
}
