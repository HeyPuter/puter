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
 * The files the user last opened from the GUI (a double-click, Open With, a
 * drop on an app, the file picker), newest first, kept in the user's
 * key-value store so every device shows the same list.
 */

/**
 * @typedef {Object} RecentFile
 * @property {string} uid - The file's uid; it survives moves and renames.
 * @property {string} path - Where the file was when last seen.
 * @property {string} name
 * @property {string} appName - The app it was opened with.
 * @property {number} openedAt - Epoch ms.
 */

export const RECENT_FILES_KEY = 'recent_files';
export const MAX_RECENT_FILES = 10;

const nonEmpty = value => typeof value === 'string' && value !== '';

/**
 * The well-formed entries in a stored value, newest first, without
 * duplicates, at most `MAX_RECENT_FILES` of them.
 *
 * @param {unknown} value
 * @returns {RecentFile[]}
 */
export function pickRecentFiles(value) {
    if ( typeof value === 'string' ) {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if ( ! Array.isArray(value) ) return [];
    const seen = new Set();
    const picked = [];
    for ( const entry of value ) {
        if ( !entry || typeof entry !== 'object' ) continue;
        const { uid, path, name, appName, openedAt } = entry;
        if ( !nonEmpty(uid) || !nonEmpty(path) || !nonEmpty(name) || !nonEmpty(appName) ) continue;
        if ( !Number.isFinite(openedAt) || seen.has(uid) ) continue;
        seen.add(uid);
        picked.push({ uid, path, name, appName, openedAt });
        if ( picked.length === MAX_RECENT_FILES ) break;
    }
    return picked;
}

/**
 * The list with `entry` moved to the front.
 *
 * @param {RecentFile[]} list
 * @param {RecentFile} entry
 * @returns {RecentFile[]}
 */
export function withOpened(list, entry) {
    return [entry, ...list.filter(item => item.uid !== entry.uid)].slice(0, MAX_RECENT_FILES);
}

const isUnder = (filePath, dirPath) => filePath.startsWith(`${dirPath}/`);

/**
 * The list without the entries a removed item takes with it: the file
 * itself, or every file under a removed folder. Returns `list` itself when
 * nothing matched.
 *
 * @param {RecentFile[]} list
 * @param {{ uid?: string, path?: string, is_dir?: boolean }} item
 * @returns {RecentFile[]}
 */
export function withRemoved(list, item) {
    const next = list.filter(entry =>
        !(entry.uid === item.uid
          || (item.path && entry.path === item.path)
          || (item.is_dir && item.path && isUnder(entry.path, item.path))));
    return next.length === list.length ? list : next;
}

/**
 * The list after an item moved or was renamed: the file's entry follows it,
 * as do the files under a moved folder. A move into the Trash removes them.
 * Returns `list` itself when nothing matched.
 *
 * @param {RecentFile[]} list
 * @param {{ uid?: string, path: string, old_path?: string, name?: string, is_dir?: boolean }} item
 * @param {string} trashPath
 * @returns {RecentFile[]}
 */
export function withMoved(list, item, trashPath) {
    if ( !nonEmpty(item?.path) ) return list;
    const oldPath = item.old_path;
    if ( trashPath && isUnder(item.path, trashPath) ) {
        return withRemoved(list, { uid: item.uid, path: oldPath, is_dir: item.is_dir });
    }
    let changed = false;
    const next = list.map(entry => {
        if ( entry.uid === item.uid ) {
            const name = item.name || item.path.slice(item.path.lastIndexOf('/') + 1);
            if ( entry.path === item.path && entry.name === name ) return entry;
            changed = true;
            return { ...entry, path: item.path, name };
        }
        if ( item.is_dir && nonEmpty(oldPath) && isUnder(entry.path, oldPath) ) {
            changed = true;
            return { ...entry, path: item.path + entry.path.slice(oldPath.length) };
        }
        return entry;
    });
    return changed ? next : list;
}

// -- Store --

const kv = () => globalThis.puter.kv;

// What this session last read or wrote, so a socket event can tell whether
// it concerns the list before doing any I/O. Null until the first read.
/** @type {RecentFile[] | null} */
let known = null;
// Updates run one after another, each on the list the one before it left.
let queue = Promise.resolve();
const listeners = new Set();

const publish = (list) => {
    known = list;
    for ( const listener of listeners ) {
        try {
            listener(list);
        } catch ( err ) {
            console.error(err);
        }
    }
};

/**
 * The stored list. Rejects when the store can't be read.
 *
 * @returns {Promise<RecentFile[]>}
 */
export async function getRecentFiles() {
    const list = pickRecentFiles(await kv().get(RECENT_FILES_KEY));
    publish(list);
    return list;
}

/**
 * The list this session knows of, or null before the first read.
 *
 * @returns {RecentFile[] | null}
 */
export function knownRecentFiles() {
    return known;
}

/**
 * Calls `listener` with the list whenever it changes in this session.
 *
 * @param {(list: RecentFile[]) => void} listener
 * @returns {() => void} Removes the listener.
 */
export function onRecentFilesChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Applies `change` to a fresh read of the stored list, so an open recorded
 * by another tab isn't overwritten, and stores the result if it differs.
 *
 * @param {(list: RecentFile[]) => RecentFile[]} change
 * @returns {Promise<void>}
 */
function update(change) {
    queue = queue.then(async () => {
        const list = pickRecentFiles(await kv().get(RECENT_FILES_KEY));
        const next = change(list);
        if ( next !== list ) await kv().set(RECENT_FILES_KEY, next);
        publish(next);
    }).catch(err => console.warn('Could not update recent files:', err));
    return queue;
}

/**
 * @typedef {Object} OpenedFile
 * @property {string} [uid]
 * @property {string} [path]
 * @property {string} [name] - Defaults to the last part of `path`.
 * @property {string} [appName]
 */

/**
 * Puts files the user just opened at the top of the list, the first one
 * topmost. Files missing a uid, path, or app are skipped.
 *
 * @param {OpenedFile[]} files
 * @returns {Promise<void>}
 */
export function recordOpenedFiles(files) {
    const openedAt = Date.now();
    const entries = [];
    for ( const { uid, path, name, appName } of files ) {
        if ( !nonEmpty(uid) || !nonEmpty(path) || !nonEmpty(appName) ) continue;
        const entryName = nonEmpty(name) ? name : path.slice(path.lastIndexOf('/') + 1);
        if ( entryName ) entries.push({ uid, path, name: entryName, appName, openedAt });
    }
    if ( ! entries.length ) return Promise.resolve();
    return update(list => entries.reduceRight(withOpened, list));
}

/**
 * Puts a file the user just opened at the top of the list.
 *
 * @param {OpenedFile} file
 * @returns {Promise<void>}
 */
export function recordOpenedFile(file) {
    return recordOpenedFiles([file]);
}

/**
 * Removes one file from the list.
 *
 * @param {string} uid
 * @returns {Promise<void>}
 */
export function forgetRecentFile(uid) {
    return update(list => withRemoved(list, { uid }));
}

/**
 * Empties the list.
 *
 * @returns {Promise<void>}
 */
export function clearRecentFiles() {
    return update(list => (list.length ? [] : list));
}

/**
 * Keeps the list in step with an item that was removed, moved, or renamed.
 * Returns without I/O unless the item touches an entry this session knows of.
 *
 * @param {'removed' | 'moved' | 'renamed'} kind
 * @param {{ uid?: string, path?: string, old_path?: string, from_path?: string, name?: string, is_dir?: boolean, descendants_only?: boolean }} item
 * @returns {Promise<void>}
 */
export function applyItemChange(kind, item) {
    if ( !known?.length || !item ) return Promise.resolve();
    const trashPath = globalThis.window?.trash_path;
    const normalized = { ...item, old_path: item.old_path ?? item.from_path };
    // `descendants_only` empties a folder and keeps the folder itself.
    const removed = item.descendants_only ? { path: item.path, is_dir: true } : normalized;
    const change = kind === 'removed'
        ? list => withRemoved(list, removed)
        : list => withMoved(list, normalized, trashPath);
    if ( change(known) === known ) return Promise.resolve();
    return update(change);
}

/** Forgets what this session knows of the list; for tests. */
export function resetRecentFilesCache() {
    known = null;
    queue = Promise.resolve();
    listeners.clear();
}
