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
