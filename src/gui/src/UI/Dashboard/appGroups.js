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
 * The My Apps folder model. A folder is a named set of app names; the grid's
 * left-to-right ORDER still lives entirely in the saved app order (see
 * appOrder.js) — a folder occupies the slot of its first member, and its
 * members sit contiguously in that flat order. Keeping the two records
 * orthogonal means an app that is temporarily missing (an installedApps page
 * that failed to load) keeps both its folder and its position, and every
 * existing saved order stays valid without migration.
 */

/** kv key under which the user's My Apps folders are stored. */
export const APP_GROUPS_KV_KEY = 'dashboard_app_groups';

/** Longest folder name that is stored; longer input is clipped. */
export const MAX_GROUP_NAME_LENGTH = 40;

/** Sanity caps, so a corrupt (or hostile) kv value can't wedge the grid. */
export const MAX_GROUPS = 100;
export const MAX_GROUP_APPS = 100;

/**
 * @typedef {{ id: string, name: string, apps: string[] }} AppGroup
 * @typedef {{ type: 'app', app: object } | { type: 'group', group: AppGroup, apps: object[] }} GridItem
 */

/**
 * Trim a folder name to what is worth storing: whitespace collapsed, clipped
 * to {@link MAX_GROUP_NAME_LENGTH}. Anything unusable becomes '' — callers
 * decide whether that means "keep the old name" (rename) or "use the default"
 * (creation).
 *
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeGroupName (name) {
    if ( typeof name !== 'string' ) return '';
    return name.replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH);
}

/**
 * Parse the persisted folders value. Tolerates every shape kv can hand back
 * (a JSON string, an already-deserialized array, null for "never saved") and
 * any corruption inside it. Two invariants are enforced here rather than at
 * every call site: an app belongs to at most one folder (first claim wins),
 * and a folder always has at least two members — a folder of one is strictly
 * worse than a plain tile, so it is dropped and its member becomes loose.
 * Corrupt input degrades to "no folders", never to a broken Apps tab.
 *
 * @param {unknown} raw - value returned by `puter.kv.get`
 * @returns {AppGroup[]}
 */
export function parseAppGroups (raw) {
    let list = raw;
    if ( typeof raw === 'string' ) {
        try {
            list = JSON.parse(raw);
        } catch ( _e ) {
            return [];
        }
    }
    if ( ! Array.isArray(list) ) return [];

    const out = [];
    const seenIds = new Set();
    const claimed = new Set();
    for ( const entry of list ) {
        if ( ! entry || typeof entry !== 'object' ) continue;
        const id = typeof entry.id === 'string' ? entry.id : '';
        if ( ! id || seenIds.has(id) ) continue;

        const apps = [];
        if ( Array.isArray(entry.apps) ) {
            for ( const name of entry.apps ) {
                if ( typeof name !== 'string' || name.length === 0 ) continue;
                if ( claimed.has(name) ) continue;
                apps.push(name);
                claimed.add(name);
                if ( apps.length >= MAX_GROUP_APPS ) break;
            }
        }
        if ( apps.length < 2 ) {
            // Release the names so a later, well-formed folder can claim them.
            for ( const name of apps ) claimed.delete(name);
            continue;
        }

        seenIds.add(id);
        out.push({ id, name: normalizeGroupName(entry.name), apps });
        if ( out.length >= MAX_GROUPS ) break;
    }
    return out;
}

/**
 * Serialize folders to the persisted shape. Runs the value back through
 * {@link parseAppGroups} so the read and write shapes stay in lockstep and a
 * folder that an edit emptied out can never be written.
 *
 * @param {AppGroup[]} groups
 * @returns {AppGroup[]}
 */
export function serializeAppGroups (groups) {
    return parseAppGroups(Array.isArray(groups) ? groups : []);
}

/**
 * An id for a new folder. Folders are stored as one kv value that is written
 * whole, so two devices creating a folder at the same moment already resolve
 * last-write-wins; the id only has to be unique enough that a surviving
 * record never collides with one made elsewhere.
 *
 * @returns {string}
 */
export function makeGroupId () {
    return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A default name for a new folder: `base`, then `base 2`, `base 3`, … so two
 * folders are never named the same thing. The base is passed in (rather than
 * read from i18n here) to keep this module free of UI dependencies.
 *
 * @param {AppGroup[]} groups
 * @param {string} base
 * @returns {string}
 */
export function defaultGroupName (groups, base) {
    const taken = new Set(
        (Array.isArray(groups) ? groups : []).map(g => g && g.name),
    );
    if ( ! taken.has(base) ) return base;
    for ( let n = 2; n < MAX_GROUPS + 2; n++ ) {
        const candidate = `${base} ${n}`;
        if ( ! taken.has(candidate) ) return candidate;
    }
    return base;
}

/**
 * The folder holding `appName`, or null when the app is loose.
 *
 * @param {AppGroup[]} groups
 * @param {string} appName
 * @returns {AppGroup|null}
 */
export function findGroupOfApp (groups, appName) {
    if ( ! Array.isArray(groups) || typeof appName !== 'string' ) return null;
    for ( const g of groups ) {
        if ( g && Array.isArray(g.apps) && g.apps.includes(appName) ) return g;
    }
    return null;
}

/**
 * Fold an ordered app list into the items the grid actually renders: loose
 * apps stay as they are, and each folder is emitted once, at the slot of its
 * first present member, carrying its members in the folder's own order.
 *
 * A folder whose members mostly failed to load renders as whatever it has:
 * with fewer than two present members its member is drawn as a plain tile and
 * the record is left untouched — the same "stale names are ignored, never
 * destroyed" rule reconcileAppOrder follows, so a flaky page of installedApps
 * can't dissolve a folder.
 *
 * @param {Array<{name: string}>} apps - apps in grid order
 * @param {AppGroup[]} groups
 * @returns {GridItem[]}
 */
export function buildGridItems (apps, groups) {
    if ( ! Array.isArray(apps) ) return [];
    const list = Array.isArray(groups) ? groups : [];
    if ( list.length === 0 ) return apps.map(app => ({ type: 'app', app }));

    const owner = new Map();
    for ( const g of list ) {
        if ( ! g || ! Array.isArray(g.apps) ) continue;
        for ( const name of g.apps ) {
            if ( ! owner.has(name) ) owner.set(name, g);
        }
    }

    // Members present in `apps`, in the folder's own order.
    const members = new Map();
    for ( const app of apps ) {
        const g = owner.get(app && app.name);
        if ( ! g ) continue;
        if ( ! members.has(g.id) ) members.set(g.id, []);
        members.get(g.id).push(app);
    }
    for ( const g of list ) {
        const present = members.get(g.id);
        if ( ! present || present.length < 2 ) continue;
        const rank = new Map(g.apps.map((name, i) => [name, i]));
        present.sort((a, b) => rank.get(a.name) - rank.get(b.name));
    }

    const emitted = new Set();
    const items = [];
    for ( const app of apps ) {
        const g = owner.get(app && app.name);
        const present = g ? (members.get(g.id) || []) : [];
        if ( ! g || present.length < 2 ) {
            items.push({ type: 'app', app });
            continue;
        }
        if ( emitted.has(g.id) ) continue;
        emitted.add(g.id);
        items.push({ type: 'group', group: g, apps: present });
    }
    return items;
}

/**
 * The apps behind {@link buildGridItems}' output, flattened back to a single
 * ordered list — folder members contiguous, in folder order. This is the
 * shape the saved app order wants, so a folder edit and a drag both persist
 * through the same path.
 *
 * @param {GridItem[]} items
 * @returns {object[]}
 */
export function flattenGridItems (items) {
    const out = [];
    if ( ! Array.isArray(items) ) return out;
    for ( const item of items ) {
        if ( ! item ) continue;
        if ( item.type === 'group' ) out.push(...(item.apps || []));
        else if ( item.app ) out.push(item.app);
    }
    return out;
}

/**
 * Move `movedName` to sit immediately after the last of `anchorNames` in a
 * flat order — how a drop into a folder places the app beside the rest of
 * that folder's members, and how ejecting one places it beside the folder it
 * came out of. With no anchor present the name goes to the tail rather than
 * jumping the queue at the front. The input array is not mutated.
 *
 * @param {string[]} names
 * @param {string} movedName
 * @param {string[]} anchorNames
 * @returns {string[]}
 */
export function orderWithAppAfter (names, movedName, anchorNames) {
    const out = (Array.isArray(names) ? names : []).filter(name => name !== movedName);
    const anchors = new Set(Array.isArray(anchorNames) ? anchorNames : []);
    let at = -1;
    for ( let i = 0; i < out.length; i++ ) {
        if ( anchors.has(out[i]) ) at = i;
    }
    if ( at === -1 ) out.push(movedName);
    else out.splice(at + 1, 0, movedName);
    return out;
}

/**
 * A new folder holding `appNames`, replacing any folder membership those apps
 * already had. Returns the new folder list and the new folder's id; a folder
 * left with fewer than two members by the move dissolves (serializeAppGroups
 * enforces it). Returns `{ groups, id: null }` unchanged when there aren't two
 * distinct apps to put in it.
 *
 * @param {AppGroup[]} groups
 * @param {string[]} appNames
 * @param {string} name
 * @returns {{ groups: AppGroup[], id: string|null }}
 */
export function createGroup (groups, appNames, name) {
    const members = [];
    for ( const appName of (Array.isArray(appNames) ? appNames : []) ) {
        if ( typeof appName !== 'string' || appName.length === 0 ) continue;
        if ( ! members.includes(appName) ) members.push(appName);
    }
    if ( members.length < 2 ) {
        return { groups: serializeAppGroups(groups), id: null };
    }

    const id = makeGroupId();
    const stripped = withoutApps(groups, members);
    return {
        groups: serializeAppGroups([
            ...stripped,
            { id, name: normalizeGroupName(name), apps: members.slice(0, MAX_GROUP_APPS) },
        ]),
        id,
    };
}

/**
 * Add `appName` to the folder `groupId` (at the end, where a drop lands),
 * taking it out of whatever folder it was in. A no-op when the folder is
 * gone or full.
 *
 * @param {AppGroup[]} groups
 * @param {string} groupId
 * @param {string} appName
 * @returns {AppGroup[]}
 */
export function addAppToGroup (groups, groupId, appName) {
    const target = findGroupById(groups, groupId);
    if ( ! target || typeof appName !== 'string' || appName.length === 0 ) {
        return serializeAppGroups(groups);
    }
    if ( target.apps.includes(appName) ) return serializeAppGroups(groups);
    if ( target.apps.length >= MAX_GROUP_APPS ) return serializeAppGroups(groups);

    return serializeAppGroups(withoutApps(groups, [appName]).map(g => (
        g.id === groupId ? { ...g, apps: [...g.apps, appName] } : g
    )));
}

/**
 * Take `appName` out of every folder. The folder it leaves dissolves if that
 * empties it below two members.
 *
 * @param {AppGroup[]} groups
 * @param {string} appName
 * @returns {AppGroup[]}
 */
export function removeAppFromGroups (groups, appName) {
    return serializeAppGroups(withoutApps(groups, [appName]));
}

/**
 * Dissolve a folder; its members become loose tiles where the folder stood.
 *
 * @param {AppGroup[]} groups
 * @param {string} groupId
 * @returns {AppGroup[]}
 */
export function removeGroup (groups, groupId) {
    return serializeAppGroups(
        (Array.isArray(groups) ? groups : []).filter(g => g && g.id !== groupId),
    );
}

/**
 * Rename a folder. An unusable name (empty, whitespace only) leaves the
 * existing one alone — a nameless folder is a folder the user can't tell
 * apart from the next one.
 *
 * @param {AppGroup[]} groups
 * @param {string} groupId
 * @param {string} name
 * @returns {AppGroup[]}
 */
export function renameGroup (groups, groupId, name) {
    const clean = normalizeGroupName(name);
    if ( ! clean ) return serializeAppGroups(groups);
    return serializeAppGroups((Array.isArray(groups) ? groups : []).map(g => (
        g && g.id === groupId ? { ...g, name: clean } : g
    )));
}

/**
 * Re-order a folder's members. Names not in `appNames` (members that weren't
 * on screen to be dragged) keep their relative order at the tail, so
 * reordering what you can see never drops what you can't.
 *
 * @param {AppGroup[]} groups
 * @param {string} groupId
 * @param {string[]} appNames
 * @returns {AppGroup[]}
 */
export function reorderGroupApps (groups, groupId, appNames) {
    const target = findGroupById(groups, groupId);
    if ( ! target ) return serializeAppGroups(groups);

    const wanted = (Array.isArray(appNames) ? appNames : [])
        .filter(name => target.apps.includes(name));
    const seen = new Set(wanted);
    const apps = [...new Set(wanted), ...target.apps.filter(name => ! seen.has(name))];

    return serializeAppGroups((Array.isArray(groups) ? groups : []).map(g => (
        g && g.id === groupId ? { ...g, apps } : g
    )));
}

/**
 * @param {AppGroup[]} groups
 * @param {string} groupId
 * @returns {AppGroup|null}
 */
export function findGroupById (groups, groupId) {
    if ( ! Array.isArray(groups) || typeof groupId !== 'string' ) return null;
    return groups.find(g => g && g.id === groupId && Array.isArray(g.apps)) || null;
}

/** Every folder with `names` removed from it; folders are left unsealed (a
 *  caller's serializeAppGroups drops any that fell below two members). */
function withoutApps (groups, names) {
    const drop = new Set(names);
    return (Array.isArray(groups) ? groups : [])
        .filter(g => g && Array.isArray(g.apps))
        .map(g => ({ ...g, apps: g.apps.filter(name => ! drop.has(name)) }));
}
