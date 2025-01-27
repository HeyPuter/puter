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
import path from 'path-browserify';
import git from 'isomorphic-git';
import { GrammarContext, standard_parsers } from '@heyputer/parsely/exports.js';
import { StringStream } from '@heyputer/parsely/streams.js';

/**
 * Attempt to locate the git repository directory.
 * @throws Error If no git repository could be found, or another error occurred.
 * @param fs Filesystem API
 * @param pwd Directory to search from
 * @returns {Promise<{dir: (string|*), gitdir: (string|string)}>} dir and gitdir are the same as in git.foo({dir, gitdir}) APIs.
 */
export const find_repo_root = async (fs, pwd) => {
    if (!path.isAbsolute(pwd))
        throw new Error(`PWD is not absolute: ${pwd}`);

    let current_path = path.normalize(pwd);
    while (true) {
        let stat;
        const current_git_path = path.resolve(current_path, './.git');
        try {
            stat = await fs.promises.stat(current_git_path);
        } catch (e) {
            if (e.code === 'ENOENT') {
                if (current_path === '/')
                    break;

                current_path = path.dirname(current_path);
                continue;
            }

            throw e;
        }

        // If .git exists, we're probably in a git repo so call that good.
        // TODO: The git cli seems to check other things, maybe try to match that behaviour.

        const result = {
            dir: current_path,
            gitdir: current_git_path,
        };

        // Non-default-git-folder repos have .git as a text file containing the git dir path.
        if (stat.isFile()) {
            const contents = await fs.promises.readFile(current_git_path, { encoding: 'utf8' });
            // The format of .git is `gitdir: /path/to/git/dir`
            const prefix = 'gitdir:';
            if (!contents.startsWith(prefix))
                throw new Error(`invalid gitfile format: ${current_git_path}`);
            result.gitdir = contents.slice(prefix.length).trim();
        }

        return result;
    }

    throw new Error('not a git repository (or any of the parent directories): .git');
}

/**
 * Produce a shortened version of the given hash, which is still unique within the repo.
 * @param git_context {{ fs, dir, gitdir, cache }} as taken by most isomorphic-git methods.
 * @param hash
 * @returns {Promise<String>} The shortened hash
 */
export const shorten_hash = async (git_context, hash) => {
    // Repeatedly take the prefix of the hash, and try and resolve it into a full hash.
    // git.expandOid() will only succeed if there is exactly one possibility, so if it fails,
    // we make the prefix longer and try again.
    let short_hash = hash.slice(0, 7);
    while (true) {
        try {
            const expanded = await git.expandOid({ ...git_context, oid: short_hash });
            // Sanity-check: Ensure we got the original hash back.
            if (expanded === hash)
                return short_hash;
        } catch (e) {
            // Failed, so try again with a longer one
        }
        if (short_hash.length < hash.length) {
            short_hash = hash.slice(0, short_hash.length + 1);
            continue;
        }
        // Otherwise, we failed, so just return the original hash.
        return hash;
    }
}

/**
 * Determine the remot/url parameters to pass to git.fetch(), based on a `<repository>` string.
 * @param remote_name_or_url Command-line parameter, either a remote name, an url, or undefined.
 * @param remotes List of all existing remotes, from `git.listRemotes()`
 * @returns {remote, url} Object with fields to pass to git.fetch() or similar.
 */
export const determine_fetch_remote = (remote_name_or_url, remotes) => {
    if (!remote_name_or_url) {
        // We leave `url` and `remote` blank and git.fetch() handles the default.
        return {};
    }

    if (URL.canParse(remote_name_or_url)) {
        return { url: remote_name_or_url };
    }

    // Named remote. First, check if the remote exists. `git.fetch` reports non-existent remotes as:
    //     "The function requires a "remote OR url" parameter but none was provided."
    // ...which is not helpful to the user.
    const remote_data = remotes.find(it => it.remote === remote_name_or_url);
    if (!remote_data)
        throw new Error(`'${remote_name_or_url}' does not appear to be a git repository`);
    return remote_data;
}

/**
 * Divide up the positional arguments into those before the `--` separator, and those after it.
 * @param arg_tokens Tokens array from parseArgs({ tokens: true })
 * @returns {{before: string[], after: string[]}}
 */
export const group_positional_arguments = (arg_tokens) => {
    let saw_separator = false;
    const result = {
        before: [],
        after: [],
    };

    for (const token of arg_tokens) {
        if (token.kind === 'option-terminator') {
            saw_separator = true;
            continue;
        }
        if (token.kind === 'positional') {
            if (saw_separator) {
                result.after.push(token.value);
            } else {
                result.before.push(token.value);
            }
            continue;
        }
    }

    return result;
}

/**
 * Parse a ref string such as `HEAD`, `master^^^` or `tags/foo~3` into a usable format.
 * @param ref_string
 * @returns {{rev: string, suffixes: [{type: string, n: number}]}}
 */
const parse_ref = (ref_string) => {
    const grammar_context = new GrammarContext({
        ...standard_parsers(),
    });

    // See description at https://git-scm.com/docs/gitrevisions#_specifying_revisions
    const parser = grammar_context.define_parser({
        // sha-1 and named refs are ambiguous (eg, deadbeef can be either) so we treat them the same
        // TODO: This is not a complete list of valid characters.
        //       See https://git-scm.com/docs/git-check-ref-format#_description
        rev: a => a.stringOf(c => /[\w/.-]/.test(c)),

        suffix: a => a.firstMatch(
            a.symbol('parent'),
            a.symbol('ancestor'),
        ),
        parent: a => a.sequence(
            a.literal('^'),
            a.optional(
                a.symbol('number'),
            ),
        ),
        ancestor: a => a.sequence(
            a.literal('~'),
            a.optional(
                a.symbol('number'),
            ),
        ),

        number: a => a.stringOf(c => /\d/.test(c)),

        ref: a => a.sequence(
            a.symbol('rev'),
            a.optional(
                a.repeat(
                    a.symbol('suffix')
                ),
            ),
        ),
    }, {
        parent: it => {
            if (it.length === 2)
                return { type: 'parent', n: it[1].value };
            return { type: 'parent', n: 1 };
        },
        ancestor: it => {
            if (it.length === 2)
                return { type: 'ancestor', n: it[1].value };
            return { type: 'ancestor', n: 1 };
        },

        number: n => parseInt(n, 10),

        ref: it => {
            const rev = it[0].value;
            const suffixes = it[1]?.value?.map(s => s.value);
            return { rev, suffixes }
        }
    });

    const stream = new StringStream(ref_string);
    const result = parser(stream, 'ref', { must_consume_all_input: true });
    return result.value;
}

/**
 * Take some kind of reference, and resolve it to a full oid if possible.
 * @param git_context Object of common parameters to isomorphic-git methods
 * @param ref Reference to resolve
 * @returns {Promise<string>} Full oid, or a thrown Error
 */
export const resolve_to_oid = async (git_context, ref) => {

    let parsed_ref;
    try {
        parsed_ref = parse_ref(ref);
    } catch (e) {
        throw new Error(`Unable to resolve reference '${ref}'`);
    }

    const revision = parsed_ref.rev;
    const suffixes = parsed_ref.suffixes;

    const [ resolved_oid, expanded_oid ] = await Promise.allSettled([
        git.resolveRef({ ...git_context, ref: revision }),
        git.expandOid({ ...git_context, oid: revision }),
    ]);
    let oid;
    if (resolved_oid.status === 'fulfilled') {
        oid = resolved_oid.value;
    } else if (expanded_oid.status === 'fulfilled') {
        oid = expanded_oid.value;
    } else {
        throw new Error(`Unable to resolve reference '${ref}'`);
    }

    if (suffixes?.length) {
        for (const suffix of suffixes) {
            let commit;
            try {
                commit = await git.readCommit({ ...git_context, oid });
            } catch (e) {
                throw new Error(`bad revision '${ref}'`);
            }

            switch (suffix.type) {
                case 'ancestor': {
                    for (let i = 0; i < suffix.n; ++i) {
                        oid = commit.commit.parent[0];
                        try {
                            commit = await git.readCommit({ ...git_context, oid });
                        } catch (e) {
                            throw new Error(`bad revision '${ref}'`);
                        }
                    }
                    break;
                }
                case 'parent': {
                    // "As a special rule, <rev>^0 means the commit itself and is used when <rev> is the object name of
                    // a tag object that refers to a commit object."
                    if (suffix.n === 0)
                        continue;

                    oid = commit.commit.parent[suffix.n - 1];
                    if (!oid)
                        throw new Error(`bad revision '${ref}'`);
                    break;
                }
                default:
                    throw new Error(`Unable to resolve reference '${ref}' (unimplemented suffix '${suffix.type}')`);
            }
        }
    }

    return oid;
}

/**
 * Similar to resolve_to_oid, but makes sure the oid refers to a commit.
 * Returns the commit object because we had to retrieve it anyway.
 * @param git_context Object of common parameters to isomorphic-git methods
 * @param ref Reference to resolve
 * @returns {Promise<ReadCommitResult>} ReadCommitResult object as returned by git.readCommit(), or a thrown Error
 */
export const resolve_to_commit = async (git_context, ref) => {
    const resolved_oid = await resolve_to_oid(git_context, ref);
    try {
        return await git.readCommit({ ...git_context, oid: resolved_oid });
    } catch (e) {
        throw new Error(`bad revision '${ref}'`);
    }
}

/**
 * Determine if the index has any staged changes.
 * @param git_context {{ fs, dir, gitdir, cache }} as taken by most isomorphic-git methods.
 * @returns {Promise<boolean>}
 */
export const has_staged_changes = async (git_context) => {
    const file_status = await git.statusMatrix({
        ...git_context,
        ignored: false,
    });
    return file_status.some(([filepath, head, workdir, index]) => index !== head);
}
