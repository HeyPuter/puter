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
 * How each folder is shown — its sort and its layout — kept in the user's
 * key-value store, one key per folder uid, as `{ sort_by, sort_order, layout }`.
 */

export const LAYOUTS = ['icons', 'list', 'details'];
export const SORT_BYS = ['name', 'modified', 'type', 'size'];
export const SORT_ORDERS = ['asc', 'desc'];

export const DEFAULT_FOLDER_VIEW = Object.freeze({
    sort_by: 'name',
    sort_order: 'asc',
    layout: 'icons',
});

const ALLOWED = { sort_by: SORT_BYS, sort_order: SORT_ORDERS, layout: LAYOUTS };

export const folderViewKey = uid => `folder_view:${uid}`;

/**
 * The known preferences in `value`, without anything unrecognized.
 *
 * @param {unknown} value
 * @returns {{ sort_by?: string, sort_order?: string, layout?: string }}
 */
export function pickFolderView(value) {
    if ( typeof value === 'string' ) {
        try {
            value = JSON.parse(value);
        } catch {
            return {};
        }
    }
    const picked = {};
    if ( !value || typeof value !== 'object' ) return picked;
    for ( const [field, allowed] of Object.entries(ALLOWED) ) {
        if ( allowed.includes(value[field]) ) picked[field] = value[field];
    }
    return picked;
}

const usableUid = uid => typeof uid === 'string' && uid !== '' && uid !== 'null' && uid !== 'undefined';

// The last stored value this session knows of, per folder, so a change to
// one preference keeps the others it doesn't touch.
const known = new Map();

const kv = () => globalThis.puter.kv;

/**
 * How to show a folder: what's stored for it, then what its fsentry carries
 * (the server kept a layout there before), then the defaults.
 *
 * @param {object | null | undefined} fsentry - from `puter.fs.stat()`
 * @returns {Promise<{ sort_by: string, sort_order: string, layout: string }>}
 */
export async function getFolderView(fsentry) {
    const uid = fsentry?.uid ?? fsentry?.id;
    let stored = {};
    if ( usableUid(uid) ) {
        const read = kv().get(folderViewKey(uid)).then(pickFolderView);
        known.set(uid, read.catch(() => ({})));
        try {
            stored = await read;
        } catch ( err ) {
            console.warn('Could not load folder view:', err);
        }
    }
    return { ...DEFAULT_FOLDER_VIEW, ...pickFolderView(fsentry), ...stored };
}

/**
 * Store some of a folder's preferences; the rest stay as they were.
 *
 * @param {string} uid
 * @param {{ sort_by?: string, sort_order?: string, layout?: string }} changes
 * @returns {Promise<void>}
 */
export function setFolderView(uid, changes) {
    if ( ! usableUid(uid) ) return Promise.resolve();
    const base = known.get(uid)
        ?? kv().get(folderViewKey(uid)).then(pickFolderView).catch(() => ({}));
    const next = base.then(stored => ({ ...stored, ...pickFolderView(changes) }));
    known.set(uid, next);
    return next
        .then(value => kv().set(folderViewKey(uid), value))
        .catch(err => console.warn('Could not save folder view:', err));
}

/** Forget what this session knows of stored values; for tests. */
export function resetFolderViewCache() {
    known.clear();
}
