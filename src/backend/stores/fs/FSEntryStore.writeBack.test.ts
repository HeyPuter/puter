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

import { describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.js';
import { FSEntryStore } from './FSEntryStore.js';

const makeStore = (
    writeResult: { insertId: number },
    cachedEntry?: Record<string, unknown>,
) => {
    const pread = vi.fn(async () => []);
    const write = vi.fn(async () => ({
        insertId: writeResult.insertId,
        affectedRows: 1,
        anyRowsAffected: true,
    }));
    const setex = vi.fn(async () => 'OK');
    const eventEmit = vi.fn();
    const pipelineSet = vi.fn();
    const pipeline = {
        del: vi.fn(),
        set: pipelineSet,
        exec: vi.fn(async () => []),
    };
    const clients = {
        db: {
            write,
            pread,
            read: vi.fn(async () => []),
            tryHardRead: vi.fn(async () => []),
            booleanValue: (value: boolean) => (value ? 1 : 0),
            case: () => '',
            insertIgnoreInto: () => '',
        },
        redis: {
            setex,
            get: vi.fn(async () =>
                cachedEntry ? JSON.stringify(cachedEntry) : null,
            ),
            del: vi.fn(async () => 1),
            pipeline: () => pipeline,
        },
        event: { emit: eventEmit },
    };
    const store = new FSEntryStore(
        {} as IConfig,
        clients as never,
        {} as never,
    );
    return { store, clients, write, pread, setex, eventEmit, pipelineSet };
};

const cachedFile = {
    id: 5,
    uuid: '33333333-3333-4333-8333-333333333333',
    uid: '33333333-3333-4333-8333-333333333333',
    userId: 3,
    parentId: 7,
    parentUid: '11111111-1111-4111-8111-111111111111',
    path: '/alice/report.txt',
    name: 'report.txt',
    isDir: false,
    size: 1234,
    thumbnail: null,
    accessed: 100,
    modified: 100,
    created: 100,
    subdomains: [],
    workers: [],
    hasWebsite: false,
    suggestedApps: [],
};

const parent = {
    id: 7,
    uuid: '11111111-1111-4111-8111-111111111111',
    userId: 3,
    path: '/alice',
};

describe('FSEntryStore.createNonFileEntry', () => {
    it('returns the created entry without reading it back from the primary', async () => {
        const { store, pread, write } = makeStore({ insertId: 42 });

        const entry = await store.createNonFileEntry({
            parent,
            name: 'AppData',
            kind: 'directory',
            thumbnail: 'https://example.invalid/icon.png',
        } as never);

        // The read-back was a primary round trip on a path app launches wait
        // for, and the insert already supplied every column.
        expect(pread).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledTimes(1);
        expect(entry).toMatchObject({
            id: 42,
            userId: 3,
            parentId: 7,
            parentUid: parent.uuid,
            name: 'AppData',
            path: '/alice/AppData',
            isDir: true,
            isShortcut: false,
            isSymlink: false,
            immutable: false,
            thumbnail: 'https://example.invalid/icon.png',
            size: 0,
            subdomains: [],
            hasWebsite: false,
        });
        expect(entry.uuid).toMatch(/^[0-9a-f-]{36}$/);
        expect(entry.uid).toBe(entry.uuid);
    });

    it('falls back to reading the row when the engine reports no insert id', async () => {
        const { store, pread } = makeStore({ insertId: 0 });
        pread.mockResolvedValueOnce([
            {
                id: 99,
                uuid: '22222222-2222-4222-8222-222222222222',
                user_id: 3,
                parent_id: 7,
                parent_uid: parent.uuid,
                name: 'AppData',
                path: '/alice/AppData',
                is_dir: 1,
                is_shortcut: 0,
                is_symlink: 0,
                immutable: 0,
                modified: 1,
                created: 1,
                accessed: 1,
                size: 0,
            },
        ] as never);

        const entry = await store.createNonFileEntry({
            parent,
            name: 'AppData',
            kind: 'directory',
        } as never);

        expect(pread).toHaveBeenCalledTimes(1);
        expect(entry.id).toBe(99);
    });
});

describe('FSEntryStore.touchEntryTimestamps', () => {
    it('applies the touched timestamps without reading the primary', async () => {
        const { store, pread, write, eventEmit, pipelineSet } = makeStore(
            { insertId: 0 },
            cachedFile,
        );

        const entry = await store.touchEntryTimestamps(cachedFile.uuid, {
            setModified: true,
        });

        expect(pread).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledTimes(1);
        // Only `modified` was assigned, so the others keep the cached values.
        expect(entry.modified).toBeGreaterThan(cachedFile.modified);
        expect(entry.accessed).toBe(100);
        expect(entry.created).toBe(100);
        // Columns the update never named survive untouched.
        expect(entry.name).toBe('report.txt');
        expect(entry.size).toBe(1234);
        // Peers must get the patched row, not a hole they would refill from a
        // lagging replica.
        expect(pipelineSet).toHaveBeenCalled();
        expect(eventEmit).toHaveBeenCalledWith(
            'outer.cacheUpdate',
            expect.objectContaining({ data: expect.any(String) }),
            {},
        );
    });

    it('touches all three timestamps when none is named', async () => {
        const { store } = makeStore({ insertId: 0 }, cachedFile);

        const entry = await store.touchEntryTimestamps(cachedFile.uuid, {});

        expect(entry.accessed).toBeGreaterThan(100);
        expect(entry.modified).toBeGreaterThan(100);
        expect(entry.created).toBeGreaterThan(100);
    });

    it('reports not found when the entry is gone', async () => {
        const { store } = makeStore({ insertId: 0 });

        await expect(
            store.touchEntryTimestamps(cachedFile.uuid, { setModified: true }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('FSEntryStore.updateEntryThumbnailByUuidForUser', () => {
    it('applies the new thumbnail without reading the primary', async () => {
        const { store, pread, write } = makeStore({ insertId: 0 }, cachedFile);

        const entry = await store.updateEntryThumbnailByUuidForUser(
            3,
            cachedFile.uuid,
            'data:image/png;base64,AAAA',
        );

        expect(pread).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledTimes(1);
        expect(entry.thumbnail).toBe('data:image/png;base64,AAAA');
        expect(entry.modified).toBeGreaterThan(100);
        expect(entry.name).toBe('report.txt');
    });

    it('refuses to hand back an entry owned by another user', async () => {
        const { store } = makeStore(
            { insertId: 0 },
            { ...cachedFile, userId: 99 },
        );

        await expect(
            store.updateEntryThumbnailByUuidForUser(3, cachedFile.uuid, null),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
