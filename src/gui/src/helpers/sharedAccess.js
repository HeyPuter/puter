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

import list_all_shared from './listAllShared.js';
import { is_owned_by_me } from './pathOwner.js';
import { is_share_root } from './sharePaths.js';

// What we hold on each shared root, by path: `{ mode, name }`. A `readdir`
// inside a shared folder returns plain entries, so nothing else records it.
const roots = new Map();
let loaded = false;
let inflight = null;

/**
 * Record what a Shared listing reported. Replaces rather than merges, so a
 * share withdrawn elsewhere does not linger.
 */
export const remember_shared_roots = (shares) => {
    roots.clear();
    for ( const share of shares ) {
        if ( ! share?.path || ! share?.mode ) continue;
        roots.set(share.path, { mode: share.mode, name: share.name });
    }
    loaded = true;
};

/** Drop what we know; the next lookup re-reads it. */
export const invalidate_shared_roots = () => {
    roots.clear();
    loaded = false;
    inflight = null;
};

// A deep link or restored window never ran the Shared listing, so fetch on
// first use. One request per miss; concurrent callers share it.
const load_once = () => {
    if ( loaded ) return Promise.resolve();
    inflight ??= list_all_shared()
        .then(remember_shared_roots)
        .catch(() => {
            // Retry next time; a miss only hides an action, so never block.
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
};

/**
 * Mode held on `path` or on the nearest shared ancestor of it.
 *
 * @param {string} path
 * @returns {Promise<string|null>}
 */
export const shared_mode_for = async (path) => {
    if ( typeof path !== 'string' || path === '' ) return null;
    await load_once();
    return shared_root_for(path)?.mode ?? null;
};

/**
 * Whether anything is shared with the user at all.
 *
 * @returns {Promise<boolean>}
 */
export const has_shared_roots = async () => {
    await load_once();
    return roots.size > 0;
};

/**
 * The shared root `path` sits in, from what is already loaded.
 *
 * @param {string} path
 * @returns {{path: string, mode: string, name: string|undefined}|null}
 */
export const shared_root_for = (path) => {
    if ( typeof path !== 'string' || path === '' ) return null;
    let best = null;
    for ( const root of roots.keys() ) {
        if ( path !== root && ! path.startsWith(`${root}/`) ) continue;
        if ( best === null || root.length > best.length ) best = root;
    }
    return best === null ? null : { path: best, ...roots.get(best) };
};

/**
 * May you rename the item at `item_path`?
 *
 * A FILE shared directly with you renames with `write` on it — the name is
 * the file's own. A folder's name is structure the owner's subtree hangs
 * off, so a shared folder root stays fixed; everything reached inside a
 * shared folder goes by the holding folder, exactly like moving or deleting.
 * The backend authorizes rename the same way.
 *
 * @param {string} item_path
 * @param {boolean} [is_dir]
 * @returns {Promise<boolean>}
 */
export const can_rename = async (item_path, is_dir = false) => {
    if ( typeof item_path !== 'string' ) return false;
    if ( is_owned_by_me(item_path) ) return true;
    if ( is_share_root(item_path) ) {
        if ( is_dir ) return false;
        return ['write', 'manage'].includes(await shared_mode_for(item_path));
    }
    return can_restructure(item_path);
};

/**
 * May you share the item at `item_path` with someone else?
 *
 * Yours always is. Someone else's needs `manage`, which inherits downwards —
 * so a file inside a folder you manage counts, even though the row itself
 * carries a mode only at a shared root. Trashed items are never shareable.
 *
 * @param {string} item_path
 * @param {string} [row_mode] - The `data-share_mode` a Shared listing put on the
 *   row, which answers without a lookup when the item is a share root
 * @returns {Promise<boolean>}
 */
export const can_share = async (item_path, row_mode) => {
    if ( typeof item_path !== 'string' || item_path === '' ) return false;
    if ( item_path === window.trash_path || item_path.startsWith(`${window.trash_path}/`) ) return false;
    if ( is_owned_by_me(item_path) ) return true;
    if ( row_mode === 'manage' ) return true;
    return (await shared_mode_for(item_path)) === 'manage';
};

/**
 * May you move or delete the item at `item_path`?
 *
 * The folder holding it decides, which is what the backend enforces too. A
 * shared item is therefore fixed — its folder belongs to its owner — while
 * anything inside a folder you can write to is yours to reorganize.
 *
 * @param {string} item_path
 * @returns {Promise<boolean>}
 */
export const can_restructure = async (item_path) => {
    if ( typeof item_path !== 'string' ) return false;
    if ( is_owned_by_me(item_path) ) return true;
    if ( is_share_root(item_path) ) return false;
    const parent = item_path.slice(0, item_path.lastIndexOf('/'));
    return ['write', 'manage'].includes(await shared_mode_for(parent));
};
