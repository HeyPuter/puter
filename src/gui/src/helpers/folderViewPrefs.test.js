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
    DEFAULT_FOLDER_VIEW,
    folderViewKey,
    getFolderView,
    pickFolderView,
    resetFolderViewCache,
    setFolderView,
} from './folderViewPrefs.js';

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
    resetFolderViewCache();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('pickFolderView', () => {
    it('keeps known values only', () => {
        expect(pickFolderView({
            sort_by: 'size',
            sort_order: 'sideways',
            layout: 'details',
            extra: 1,
        })).toEqual({ sort_by: 'size', layout: 'details' });
    });

    it('reads a JSON string and ignores anything else', () => {
        expect(pickFolderView('{"sort_order":"desc"}')).toEqual({ sort_order: 'desc' });
        expect(pickFolderView('nope')).toEqual({});
        expect(pickFolderView(null)).toEqual({});
        expect(pickFolderView(7)).toEqual({});
    });
});

describe('getFolderView', () => {
    it('prefers what is stored, then the fsentry, then the defaults', async () => {
        store.set(folderViewKey('dir'), { sort_by: 'modified' });
        expect(await getFolderView({ uid: 'dir', layout: 'list', sort_by: 'size' })).toEqual({
            sort_by: 'modified',
            sort_order: 'asc',
            layout: 'list',
        });
    });

    it('falls back when the store can\'t be read', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        kv.get.mockRejectedValue(new Error('offline'));
        expect(await getFolderView({ id: 'dir', layout: 'details' }))
            .toEqual({ ...DEFAULT_FOLDER_VIEW, layout: 'details' });
    });

    it('doesn\'t ask the store about a folder without a uid', async () => {
        expect(await getFolderView({ uid: 'null' })).toEqual(DEFAULT_FOLDER_VIEW);
        expect(await getFolderView(undefined)).toEqual(DEFAULT_FOLDER_VIEW);
        expect(kv.get).not.toHaveBeenCalled();
    });
});

describe('setFolderView', () => {
    it('keeps the preferences a change doesn\'t touch', async () => {
        store.set(folderViewKey('dir'), { layout: 'details', sort_by: 'size' });
        await setFolderView('dir', { sort_by: 'name', sort_order: 'desc' });
        expect(store.get(folderViewKey('dir'))).toEqual({
            layout: 'details',
            sort_by: 'name',
            sort_order: 'desc',
        });
    });

    it('builds on the last change, not on a read that predates it', async () => {
        await getFolderView({ uid: 'dir' });
        const sort = setFolderView('dir', { sort_by: 'type' });
        const layout = setFolderView('dir', { layout: 'list' });
        await Promise.all([sort, layout]);
        expect(store.get(folderViewKey('dir'))).toEqual({ sort_by: 'type', layout: 'list' });
        expect(kv.get).toHaveBeenCalledOnce();
    });

    it('drops unknown values and folders without a uid', async () => {
        await setFolderView('dir', { layout: 'grid', sort_by: 'size' });
        expect(store.get(folderViewKey('dir'))).toEqual({ sort_by: 'size' });
        await setFolderView('null', { layout: 'list' });
        await setFolderView(undefined, { layout: 'list' });
        expect(kv.set).toHaveBeenCalledOnce();
    });

    it('reports a failed save instead of throwing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        kv.set.mockRejectedValue(new Error('offline'));
        await expect(setFolderView('dir', { layout: 'list' })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
    });
});
