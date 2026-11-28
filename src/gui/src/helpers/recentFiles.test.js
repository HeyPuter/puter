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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_RECENT_FILES,
    RECENT_FILES_KEY,
    applyItemChange,
    clearRecentFiles,
    forgetRecentFile,
    getRecentFiles,
    knownRecentFiles,
    onRecentFilesChange,
    pickRecentFiles,
    recordOpenedFile,
    recordOpenedFiles,
    resetRecentFilesCache,
    withMoved,
    withOpened,
    withRemoved,
} from './recentFiles.js';

const file = (uid, path = `/u/Documents/${uid}.txt`, extra = {}) => ({
    uid,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    appName: 'editor',
    openedAt: 1,
    ...extra,
});

let store;
let kv;

beforeEach(() => {
    store = new Map();
    kv = {
        get: vi.fn(async key => store.get(key) ?? null),
        set: vi.fn(async (key, value) => {
            store.set(key, value);
            return true;
        }),
    };
    vi.stubGlobal('puter', { kv });
    vi.stubGlobal('window', { trash_path: '/u/Trash' });
    resetRecentFilesCache();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('pickRecentFiles', () => {
    it('keeps well-formed entries, first of each uid, up to the cap', () => {
        const many = Array.from({ length: MAX_RECENT_FILES + 3 }, (_, i) => file(`f${i}`));
        expect(pickRecentFiles(many)).toHaveLength(MAX_RECENT_FILES);
        expect(pickRecentFiles([
            file('a'),
            file('a', '/u/other.txt'),
            { ...file('b'), appName: '' },
            { ...file('c'), openedAt: 'yesterday' },
            null,
            'x',
        ])).toEqual([file('a')]);
    });

    it('reads a JSON string and ignores anything else', () => {
        expect(pickRecentFiles(JSON.stringify([file('a')]))).toEqual([file('a')]);
        expect(pickRecentFiles('nope')).toEqual([]);
        expect(pickRecentFiles(null)).toEqual([]);
        expect(pickRecentFiles({ uid: 'a' })).toEqual([]);
    });

    it('drops fields it does not know', () => {
        expect(pickRecentFiles([{ ...file('a'), token: 'secret' }])).toEqual([file('a')]);
    });
});

describe('withOpened', () => {
    it('moves a reopened file to the front and caps the list', () => {
        const list = Array.from({ length: MAX_RECENT_FILES }, (_, i) => file(`f${i}`));
        const reopened = withOpened(list, file('f3', undefined, { openedAt: 2 }));
        expect(reopened[0]).toEqual(file('f3', undefined, { openedAt: 2 }));
        expect(reopened.filter(f => f.uid === 'f3')).toHaveLength(1);
        expect(reopened).toHaveLength(MAX_RECENT_FILES);

        const added = withOpened(list, file('new'));
        expect(added[0].uid).toBe('new');
        expect(added).toHaveLength(MAX_RECENT_FILES);
        expect(added.at(-1).uid).toBe(`f${MAX_RECENT_FILES - 2}`);
    });
});

describe('withRemoved', () => {
    const list = [file('a', '/u/Docs/a.txt'), file('b', '/u/Docs/sub/b.txt'), file('c', '/u/Docsx/c.txt')];

    it('removes a file by uid or path', () => {
        expect(withRemoved(list, { uid: 'a' }).map(f => f.uid)).toEqual(['b', 'c']);
        expect(withRemoved(list, { path: '/u/Docsx/c.txt' }).map(f => f.uid)).toEqual(['a', 'b']);
    });

    it('removes the files under a removed folder only', () => {
        expect(withRemoved(list, { uid: 'dir', path: '/u/Docs', is_dir: true }).map(f => f.uid)).toEqual(['c']);
    });

    it('returns the same list when nothing matched', () => {
        expect(withRemoved(list, { uid: 'zzz', path: '/u/zzz' })).toBe(list);
    });
});

describe('withMoved', () => {
    const list = [file('a', '/u/Docs/a.txt'), file('b', '/u/Docs/sub/b.txt')];

    it('follows a renamed or moved file', () => {
        expect(withMoved(list, { uid: 'a', path: '/u/Desktop/renamed.txt' }, '/u/Trash')[0])
            .toEqual(file('a', '/u/Desktop/renamed.txt'));
    });

    it('rewrites the paths of files under a moved folder', () => {
        const moved = withMoved(list, { uid: 'dir', path: '/u/Archive', old_path: '/u/Docs', is_dir: true }, '/u/Trash');
        expect(moved.map(f => f.path)).toEqual(['/u/Archive/a.txt', '/u/Archive/sub/b.txt']);
    });

    it('removes files moved to the Trash', () => {
        expect(withMoved(list, { uid: 'a', path: '/u/Trash/a.txt', old_path: '/u/Docs/a.txt' }, '/u/Trash').map(f => f.uid))
            .toEqual(['b']);
        expect(withMoved(list, { uid: 'dir', path: '/u/Trash/Docs', old_path: '/u/Docs', is_dir: true }, '/u/Trash'))
            .toEqual([]);
    });

    it('returns the same list when nothing changed', () => {
        expect(withMoved(list, { uid: 'a', path: '/u/Docs/a.txt', name: 'a.txt' }, '/u/Trash')).toBe(list);
        expect(withMoved(list, { uid: 'zzz', path: '/u/zzz' }, '/u/Trash')).toBe(list);
        expect(withMoved(list, { uid: 'a' }, '/u/Trash')).toBe(list);
    });
});

describe('the stored list', () => {
    it('records opens newest first in the key-value store', async () => {
        await recordOpenedFile({ uid: 'a', path: '/u/a.txt', appName: 'editor' });
        await recordOpenedFile({ uid: 'b', path: '/u/b.png', name: 'b.png', appName: 'viewer' });
        await recordOpenedFile({ uid: 'a', path: '/u/a.txt', appName: 'code' });

        const stored = store.get(RECENT_FILES_KEY);
        expect(stored.map(f => [f.uid, f.name, f.appName])).toEqual([
            ['a', 'a.txt', 'code'],
            ['b', 'b.png', 'viewer'],
        ]);
        expect(await getRecentFiles()).toEqual(stored);
    });

    it('records several picked files with the first one topmost, in one write', async () => {
        await recordOpenedFiles([
            { uid: 'a', path: '/u/a.txt', appName: 'editor' },
            { uid: 'b', path: '/u/b.txt', appName: 'editor' },
        ]);
        expect(store.get(RECENT_FILES_KEY).map(f => f.uid)).toEqual(['a', 'b']);
        expect(kv.set).toHaveBeenCalledTimes(1);
    });

    it('skips a file without a uid, path, or app', async () => {
        await recordOpenedFiles([
            { path: '/u/a.txt', appName: 'editor' },
            { uid: 'b', appName: 'editor' },
            { uid: 'c', path: '/u/c.txt' },
        ]);
        expect(kv.get).not.toHaveBeenCalled();
        expect(kv.set).not.toHaveBeenCalled();
    });

    it('keeps an open another tab recorded', async () => {
        await recordOpenedFile({ uid: 'a', path: '/u/a.txt', appName: 'editor' });
        store.set(RECENT_FILES_KEY, [file('other'), ...store.get(RECENT_FILES_KEY)]);
        await recordOpenedFile({ uid: 'b', path: '/u/b.txt', appName: 'editor' });
        expect(store.get(RECENT_FILES_KEY).map(f => f.uid)).toEqual(['b', 'other', 'a']);
    });

    it('forgets one file and clears the list', async () => {
        store.set(RECENT_FILES_KEY, [file('a'), file('b')]);
        await forgetRecentFile('a');
        expect(store.get(RECENT_FILES_KEY).map(f => f.uid)).toEqual(['b']);
        await clearRecentFiles();
        expect(store.get(RECENT_FILES_KEY)).toEqual([]);
    });

    it('tells listeners about each change', async () => {
        const seen = [];
        onRecentFilesChange(list => seen.push(list.map(f => f.uid)));
        await recordOpenedFile({ uid: 'a', path: '/u/a.txt', appName: 'editor' });
        await clearRecentFiles();
        expect(seen).toEqual([['a'], []]);
        expect(knownRecentFiles()).toEqual([]);
    });

    it('warns and leaves the list when the store fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        kv.set.mockRejectedValueOnce(new Error('offline'));
        await recordOpenedFile({ uid: 'a', path: '/u/a.txt', appName: 'editor' });
        expect(warn).toHaveBeenCalled();
        expect(store.has(RECENT_FILES_KEY)).toBe(false);
        // The queue keeps going after a failure.
        await recordOpenedFile({ uid: 'b', path: '/u/b.txt', appName: 'editor' });
        expect(store.get(RECENT_FILES_KEY).map(f => f.uid)).toEqual(['b']);
    });
});

describe('applyItemChange', () => {
    it('does no I/O for an item the list does not have', async () => {
        await applyItemChange('removed', { uid: 'zzz', path: '/u/zzz' });
        expect(kv.get).not.toHaveBeenCalled();

        store.set(RECENT_FILES_KEY, [file('a')]);
        await getRecentFiles();
        kv.get.mockClear();
        await applyItemChange('removed', { uid: 'zzz', path: '/u/zzz' });
        await applyItemChange('renamed', { uid: 'a', path: file('a').path, name: file('a').name });
        expect(kv.get).not.toHaveBeenCalled();
        expect(kv.set).not.toHaveBeenCalled();
    });

    it('removes, moves, and renames entries', async () => {
        store.set(RECENT_FILES_KEY, [file('a', '/u/Docs/a.txt'), file('b', '/u/Docs/b.txt'), file('c', '/u/Pics/c.png')]);
        await getRecentFiles();

        await applyItemChange('removed', { uid: 'c', path: '/u/Pics/c.png' });
        await applyItemChange('renamed', { uid: 'a', path: '/u/Docs/notes.txt', name: 'notes.txt' });
        await applyItemChange('moved', { uid: 'dir', path: '/u/Old', from_path: '/u/Docs', is_dir: true });

        expect(store.get(RECENT_FILES_KEY).map(f => [f.uid, f.path, f.name])).toEqual([
            ['a', '/u/Old/notes.txt', 'notes.txt'],
            ['b', '/u/Old/b.txt', 'b.txt'],
        ]);
    });

    it('removes the files of an emptied folder', async () => {
        store.set(RECENT_FILES_KEY, [file('a', '/u/Docs/a.txt'), file('b', '/u/Pics/b.png')]);
        await getRecentFiles();
        await applyItemChange('removed', { uid: 'docs', path: '/u/Docs', is_dir: true, descendants_only: true });
        expect(store.get(RECENT_FILES_KEY).map(f => f.uid)).toEqual(['b']);
    });
});
