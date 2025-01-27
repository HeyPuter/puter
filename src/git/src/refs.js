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

// Map of hash -> array of full reference names
import git from 'isomorphic-git';

const hash_to_refs = new Map();
const add_hash = (hash, ref) => {
    const existing_array = hash_to_refs.get(hash);
    if (existing_array) {
        existing_array.push(ref);
    } else {
        hash_to_refs.set(hash, [ref]);
    }
}

// Avoid loading everything multiple times
let mark_cache_loaded;
let started_loading = false;
const cache_loaded = new Promise(resolve => { mark_cache_loaded = resolve });

/**
 * Reverse search from a commit hash to the refs that point to it.
 * The first time this is called, we retrieve all the references and cache them, meaning that
 * later calls are much faster, but won't reflect changes.
 * @param git_context {{ fs, dir, gitdir, cache }} as taken by most isomorphic-git methods.
 * @param commit_oid
 * @returns {Promise<[string]>} An array of full references, eg `HEAD`, `refs/heads/main`, `refs/tags/foo`, or `refs/remotes/origin/main`
 */
export const get_matching_refs = async (git_context, commit_oid) => {
    if (started_loading) {
        // If someone else started loading the cache, just wait for it to be ready
        await cache_loaded;
    } else {
        // Otherwise, we have to load it!
        started_loading = true;

        // HEAD
        add_hash(await git.resolveRef({ ...git_context, ref: 'HEAD' }), 'HEAD');

        // Branches
        const branch_names = await git.listBranches(git_context);
        for (const branch of branch_names) {
            const ref = `refs/heads/${branch}`;
            add_hash(await git.resolveRef({ ...git_context, ref}), ref);
        }

        // Tags
        const tags = await git.listTags(git_context);
        for (const tag of tags)
            add_hash(await git.resolveRef({ ...git_context, ref: tag }), `refs/tags/${tag}`);

        // Remote branches
        const remotes = await git.listRemotes(git_context);
        for (const { remote } of remotes) {
            const remote_branches = await git.listBranches({ ...git_context, remote });
            for (const branch of remote_branches) {
                const ref = `refs/remotes/${remote}/${branch}`;
                add_hash(await git.resolveRef({ ...git_context, ref }), ref);
            }
        }

        if (window.DEBUG) {
            console.groupCollapsed('Collected refs');
            for (const [ hash, ref_list ] of hash_to_refs) {
                console.groupCollapsed(hash);
                for (const ref of ref_list)
                    console.log(ref);
                console.groupEnd();
            }
            console.groupEnd();
        }
        mark_cache_loaded();
    }

    return hash_to_refs.get(commit_oid) ?? [];
}
