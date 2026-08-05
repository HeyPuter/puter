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

/**
 * kv key under which the names of apps the user uninstalled from the My Apps
 * grid are stored. Uninstall itself only revokes permissions, and the
 * recommended launch list is a global hardcoded set that knows nothing about
 * per-user revokes — this list is what keeps an uninstalled recommended app
 * from resurrecting on the next load. Only the recommended merge is filtered
 * against it: an app the user actually (re)installs always shows via
 * installedApps.
 */
export const REMOVED_APPS_KV_KEY = 'dashboard_removed_apps';

/**
 * Hard cap on how many uninstalled-app names are persisted. Names are short,
 * so this allows years of uninstalls while bounding the kv value; past the
 * cap the oldest entries fall off (new names append at the tail).
 */
export const REMOVED_APPS_MAX = 500;

/**
 * Parse the persisted removed-apps value into a Set of app names. Tolerates
 * every shape kv can hand back — a JSON string, an already-deserialized
 * array, null/undefined for "never saved" — and any corruption inside it
 * (non-string entries, an absurdly long list). Corrupt input degrades to an
 * empty set rather than throwing: the worst outcome is a recommended tile
 * reappearing, never a broken Apps tab.
 *
 * @param {unknown} raw - value returned by `puter.kv.get`
 * @returns {Set<string>}
 */
export function parseRemovedApps (raw) {
    let list = raw;
    if ( typeof raw === 'string' ) {
        try {
            list = JSON.parse(raw);
        } catch ( _e ) {
            return new Set();
        }
    }
    if ( ! Array.isArray(list) ) return new Set();
    const names = list.filter(name => typeof name === 'string' && name.length > 0);
    // Keep the tail: new names append there, so the cap sheds oldest first.
    return new Set(names.slice(-REMOVED_APPS_MAX));
}

/**
 * Serialize a set of removed app names to the persisted array shape, applying
 * the same cap as {@link parseRemovedApps} so the read and write shapes stay
 * in lockstep.
 *
 * @param {Set<string>|Iterable<string>} names
 * @returns {string[]}
 */
export function serializeRemovedApps (names) {
    const out = [];
    const seen = new Set();
    // Reject strings even though they're iterable — a raw kv value passed by
    // mistake must not shred into single-character "names".
    if ( names && typeof names !== 'string' && typeof names[Symbol.iterator] === 'function' ) {
        for ( const name of names ) {
            if ( typeof name !== 'string' || name.length === 0 ) continue;
            if ( seen.has(name) ) continue;
            seen.add(name);
            out.push(name);
        }
    }
    return out.slice(-REMOVED_APPS_MAX);
}
