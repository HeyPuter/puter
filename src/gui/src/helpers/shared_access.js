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

import list_all_shared from './list_all_shared.js';

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
 * The shared root `path` sits in, from what is already loaded — no await, so
 * render paths can use it. Returns null when nothing is known yet; callers
 * that can tolerate a round trip should await `shared_mode_for` first.
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

/** Kick off the load so a later sync lookup has something to answer with. */
export const prime_shared_roots = () => load_once();

/**
 * May you rename or delete the item at `item_path`? The folder holding it
 * decides, so a shared folder stays out of reach while its contents do not.
 *
 * @param {string} item_path
 * @returns {Promise<boolean>}
 */
export const can_restructure = async (item_path) => {
    if ( typeof item_path !== 'string' ) return false;
    const parent = item_path.slice(0, item_path.lastIndexOf('/'));
    return ['write', 'manage'].includes(await shared_mode_for(parent));
};
