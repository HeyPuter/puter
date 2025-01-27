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
import { determine_fetch_remote, find_repo_root, resolve_to_oid, shorten_hash } from '../git-helpers.js';
import { SHOW_USAGE } from '../help.js';
import { authentication_options, Authenticator } from '../auth.js';
import { color_options, process_color_options } from '../color.js';
import chalk from 'chalk';

export default {
    name: 'push',
    usage: [
        'git push [<repository> [<refspec>...]]',
    ],
    description: `Send local changes to a remote repository.`,
    args: {
        allowPositionals: true,
        options: {
            force: {
                description: 'Force the changes, even if a fast-forward is not possible.',
                type: 'boolean',
                short: 'f',
            },
            ...authentication_options,
            ...color_options,
        },
    },
    execute: async (ctx) => {
        const { io, fs, env, args } = ctx;
        const { stdout, stderr } = io;
        const { options, positionals } = args;
        const cache = {};

        process_color_options(options);

        const { dir, gitdir } = await find_repo_root(fs, env.PWD);

        const remotes = await git.listRemotes({
            fs,
            dir,
            gitdir,
        });

        const remote = positionals.shift();
        const input_refspecs = [...positionals];

        if (!options.username !== !options.password) {
            stderr('Please specify both --username and --password, or neither');
            return 1;
        }
        const authenticator = new Authenticator({
            username: options.username,
            password: options.password,
        });

        // Possible inputs:
        // - Remote and refspecs: Look up remote normally
        // - Remote only: Use current branch as refspec
        // - Neither: Use current branch as refspec, then use its default remote
        let remote_url;
        if (input_refspecs.length === 0) {
            const branch = await git.currentBranch({ fs, dir, gitdir, test: true });
            if (!branch)
                throw new Error('You are not currently on a branch.');
            input_refspecs.push(branch);

            if (!remote) {
                // "When the command line does not specify where to push with the <repository> argument,
                // branch.*.remote configuration for the current branch is consulted to determine where to push.
                // If the configuration is missing, it defaults to origin."
                const default_remote = await git.getConfig({ fs, dir, gitdir, path: `branch.${branch}.remote` });
                if (default_remote) {
                    remote_url = default_remote;
                } else {
                    const origin_url = remotes.find(it => it.remote === 'origin');
                    if (origin_url) {
                        remote_url = origin_url.url;
                    } else {
                        throw new Error(`Unable to determine remote for branch '${branch}'`);
                    }
                }
            }
        }
        if (!remote_url) {
            // NOTE: By definition, we know that `remote` has a value here.
            remote_url = await determine_fetch_remote(remote, remotes).url;
            if (!remote_url) {
                throw new Error(`Unable to determine remote`);
            }
        }

        const [ local_branches, remote_refs ] = await Promise.all([
            git.listBranches({ fs, dir, gitdir }),
            git.listServerRefs({
                http,
                corsProxy: globalThis.__CONFIG__.proxy_url,
                url: remote_url,
                forPush: true,
                ...authenticator.get_auth_callbacks(stderr),
            }),
        ]);

        // Parse the refspecs into a more useful format
        const refspecs = [];
        const add_refspec = (refspec) => {
            // Only add each src:dest pair once.
            for (let i = 0; i < refspecs.length; i++) {
                const existing = refspecs[i];
                if (existing.source === refspec.source && existing.dest === refspec.dest) {
                    // If this spec already exists, then ensure its `force` flag is set if the new one has it.
                    existing.force |= refspec.force;
                    return;
                }
            }
            refspecs.push(refspec);
        };
        let branches;
        for (let refspec of input_refspecs) {
            const original_refspec = refspec;

            // Format is:
            // - Optional '+'
            // - Source
            // - ':'
            // - Dest
            //
            // Source and/or Dest may be omitted:
            // - If both are omitted, that's a special "push all branches that exist locally and on the remote".
            // - If only Dest is provided, delete it on the remote.
            // - If only Source is provided, use its default destination. (There's nuance here we can worry about later.)

            let force = options.force;

            if (refspec.startsWith('+')) {
                force = true;
                refspec = refspec.slice(1);
            }

            if (refspec === ':') {
                // "The special refspec : (or +: to allow non-fast-forward updates) directs Git to push "matching"
                // branches: for every branch that exists on the local side, the remote side is updated if a branch of
                // the same name already exists on the remote side."
                for (const local_branch of local_branches) {
                    if (remote_refs.find(it => it.ref === `refs/heads/${local_branch}`)) {
                        add_refspec({
                            source: local_branch,
                            dest: local_branch,
                            force,
                        });
                    }
                }
                continue;
            }

            if (refspec.includes(':')) {
                const parts = refspec.split(':');
                if (parts.length > 2)
                    throw new Error(`Invalid refspec '${original_refspec}': Too many colons`);
                if (parts[1].length === 0)
                    throw new Error(`Invalid refspec '${original_refspec}': Colon present but dest is empty`);

                add_refspec({
                    source: parts[0].length ? parts[0] : null,
                    dest: parts[1],
                    force,
                });
                continue;
            }

            // Just a source present. So determine what the dest is from the config.
            // Default to using the same name.
            // TODO: Canonical git behaves a bit differently!
            const tracking_branch = await git.getConfig({ fs, dir, gitdir, path: `branch.${refspec}.merge` }) ?? refspec;
            add_refspec({
                source: refspec,
                dest: tracking_branch,
                force,
            });
        }

        const push_ref = async (refspec) => {
            const { source, dest, force } = refspec;
            // At this point, source or Dest may be null:
            // - If no source, delete dest on the remote.
            // - If no dest, use the default dest for the source. (This is handled by `git.push()` I think.)
            const delete_ = source === null;

            // TODO: This assumes the dest is a branch not a tag, is that always true?
            // TODO: What if the source or dest already has the refs/foo/ prefix?
            const remote_ref = remote_refs.find(it => it.ref === `refs/heads/${dest}`);
            const is_new = !remote_ref;
            // TODO: Canonical git only pushes "new" branches to the remote when configured to do so, or with --set-upstream.
            //       So, we should show some kind of warning and stop, if that's not the case.

            const source_oid = await resolve_to_oid({ fs, dir, gitdir, cache }, source);
            const old_dest_oid = remote_ref?.oid;

            const is_up_to_date = source_oid === old_dest_oid;

            try {
                const result = await git.push({
                    fs,
                    http,
                    corsProxy: globalThis.__CONFIG__.proxy_url,
                    dir,
                    gitdir,
                    cache,
                    url: remote_url,
                    ref: source,
                    remoteRef: dest,
                    force,
                    delete: delete_,
                    onMessage: (message) => {
                        stdout(message);
                    },
                    ...authenticator.get_auth_callbacks(stderr),
                });
                let flag = ' ';
                const short_old_oid = await shorten_hash({ fs, dir, gitdir, cache }, old_dest_oid);
                const short_new_oid = await shorten_hash({ fs, dir, gitdir, cache }, source_oid);
                let summary = `${short_old_oid}..${short_new_oid}`;
                if (delete_) {
                    flag = '-';
                    summary = '[deleted]';
                } else if (is_new) {
                    flag = '*';
                    summary = '[new branch]';
                } else if (force) {
                    flag = '+';
                    summary = `${short_old_oid}...${short_new_oid}`;
                } else if (is_up_to_date) {
                    flag = '=';
                    summary = `[up to date]`;
                }
                return {
                    flag,
                    summary,
                    source,
                    dest,
                    reason: null,
                };
            } catch (e) {
                return {
                    flag: '!',
                    summary: '[rejected]',
                    source,
                    dest,
                    reason: e.data.reason,
                };
            };
        };

        const results = await Promise.all(refspecs.map((refspec) => push_ref(refspec)));

        stdout(`To ${remote_url}`);
        let any_failed = false;
        for (const { flag, summary, source, dest, reason } of results) {
            const flag_and_summary = `${flag} ${summary.padEnd(19, ' ')}`;
            stdout(` ${ (flag === '!') ? chalk.redBright(flag_and_summary) : flag_and_summary } ${source} -> ${dest}${reason ? ` (${reason})` : ''}`);
            if (reason)
                any_failed = true;
        }
        if (any_failed) {
            stderr(chalk.redBright(`error: Failed to push some refs to '${remote_url}'`));
        }
    },
};
