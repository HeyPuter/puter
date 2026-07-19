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

/** kv key under which the user's custom My Apps ordering is stored. */
export const APPS_ORDER_KV_KEY = 'dashboard_apps_order';

/**
 * Reorder `apps` to honour a user-defined order expressed as a list of app
 * names. Apps present in `orderedNames` come first, in that order; apps not
 * mentioned (e.g. installed since the order was saved) keep their incoming
 * relative order and are appended at the end. Names in `orderedNames` that no
 * longer correspond to an app are ignored. The input array is not mutated.
 *
 * @param {Array<{name: string}>} apps
 * @param {string[]|null|undefined} orderedNames
 * @returns {Array<{name: string}>}
 */
export function reconcileAppOrder (apps, orderedNames) {
    if ( ! Array.isArray(apps) ) return [];
    if ( ! Array.isArray(orderedNames) || orderedNames.length === 0 ) {
        return apps.slice();
    }

    const rank = new Map();
    for ( let i = 0; i < orderedNames.length; i++ ) {
        const name = orderedNames[i];
        // First occurrence wins so a corrupt/duplicated entry can't reshuffle.
        if ( typeof name === 'string' && ! rank.has(name) ) {
            rank.set(name, i);
        }
    }

    const known = [];
    const unknown = [];
    for ( const app of apps ) {
        if ( rank.has(app.name) ) known.push(app);
        else unknown.push(app);
    }

    known.sort((a, b) => rank.get(a.name) - rank.get(b.name));

    return [...known, ...unknown];
}

/**
 * Serialize the persisted order from a list of apps. Kept beside
 * {@link reconcileAppOrder} so the read and write shapes stay in lockstep.
 *
 * @param {Array<{name: string}>} apps
 * @returns {string[]}
 */
export function serializeAppOrder (apps) {
    if ( ! Array.isArray(apps) ) return [];
    return apps
        .map(app => app && app.name)
        .filter(name => typeof name === 'string' && name.length > 0);
}

/**
 * Merge the order being saved with the previously saved one so that names
 * absent from `currentNames` (e.g. apps on an installedApps page that failed
 * to load this session) keep their saved positions instead of being dropped
 * or demoted to the tail. Each missing name keeps its RANK: if k survivors
 * (names in both lists) preceded it in the saved order, it is re-inserted
 * after the k-th survivor of the new order — so a drag of some visible tile
 * neither drags hidden apps along nor pushes them off their slots. Present
 * names appear exactly in `currentNames` order. Kept beside
 * {@link serializeAppOrder} because it produces the same persisted shape.
 *
 * @param {string[]} currentNames - the on-screen order being saved
 * @param {string[]|null|undefined} previousNames - the last saved order
 * @returns {string[]}
 */
export function mergeSavedOrder (currentNames, previousNames) {
    const result = Array.isArray(currentNames) ? currentNames.slice() : [];
    if ( ! Array.isArray(previousNames) || previousNames.length === 0 ) return result;

    const currentSet = new Set(result);
    const prevSet = new Set(previousNames);
    // A survivor is a name present in both lists; re-inserted missing names
    // and brand-new names never count when locating the k-th survivor.
    const isSurvivor = name => currentSet.has(name) && prevSet.has(name);

    const seen = new Set();
    let rank = 0;        // survivors encountered so far in the saved order
    let lastInsert = -1; // keeps runs of missing names in their saved order
    for ( const name of previousNames ) {
        if ( typeof name !== 'string' || name.length === 0 ) continue;
        if ( seen.has(name) ) continue;
        seen.add(name);
        if ( currentSet.has(name) ) {
            rank++;
            lastInsert = -1;
            continue;
        }
        // Find the index just past the rank-th survivor in the result.
        let at = 0;
        if ( rank > 0 ) {
            let survivors = 0;
            for ( let i = 0; i < result.length; i++ ) {
                if ( isSurvivor(result[i]) && ++survivors === rank ) {
                    at = i + 1;
                    break;
                }
            }
        }
        if ( lastInsert >= at ) at = lastInsert + 1;
        result.splice(at, 0, name);
        lastInsert = at;
    }
    return result;
}
