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

// Mode held on each shared root, by path. A `readdir` inside a shared folder
// returns plain entries, so nothing else records what we hold above them.
const modes = new Map();
let loaded = false;
let inflight = null;

/**
 * Record what a Shared listing reported. Replaces rather than merges, so a
 * share withdrawn elsewhere does not linger.
 */
export const remember_shared_roots = (shares) => {
    modes.clear();
    for ( const share of shares ) {
        if ( share?.path && share?.mode ) modes.set(share.path, share.mode);
    }
    loaded = true;
};

/** Drop what we know; the next lookup re-reads it. */
export const invalidate_shared_roots = () => {
    modes.clear();
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

    let best = null;
    for ( const root of modes.keys() ) {
        if ( path !== root && ! path.startsWith(`${root}/`) ) continue;
        if ( best === null || root.length > best.length ) best = root;
    }
    return best === null ? null : modes.get(best);
};
