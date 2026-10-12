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

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { setupTestServer } from '../testUtil.ts';
import type { PuterServer } from '../server.ts';
import type { IConfig } from '../types';
import { PuterStore } from './types.ts';

interface Widget {
    id: number;
    name: string | null;
    owned?: boolean;
}

/** A store over an in-memory "table" that records every load. */
class WidgetStore extends PuterStore {
    replica = new Map<number, Widget>();
    primary = new Map<number, Widget>();
    loads: Array<{ ids: number[]; primary: boolean }> = [];

    cache = this.rowCache<Widget>({
        prefix: `widgets-${Math.random().toString(36).slice(2, 8)}`,
        props: ['id', 'name'],
        ttlSeconds: 60,
        // An unowned widget is never cached under its name.
        writeKeysFor: (row) =>
            row.owned === false
                ? [this.cache.key('id', row.id)]
                : this.cache.keysFor(row),
    });

    put(row: Widget) {
        this.replica.set(row.id, { ...row });
        this.primary.set(row.id, { ...row });
    }

    async load(ids: number[], primary: boolean): Promise<Widget[]> {
        this.loads.push({ ids, primary });
        const table = primary ? this.primary : this.replica;
        return ids.flatMap((id) => {
            const row = table.get(id);
            return row ? [{ ...row }] : [];
        });
    }

    get(id: number, opts: { skipRead?: boolean; primary?: boolean } = {}) {
        return this.cache.get(
            this.cache.key('id', id),
            async (primary) => (await this.load([id], primary))[0] ?? null,
            opts,
        );
    }

    tombstone(keys: string[]) {
        return this.tombstoneCacheKeys(keys);
    }
}

describe('RowCache', () => {
    let server: PuterServer;
    let store: WidgetStore;
    let nextId = 1;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    beforeEach(() => {
        store = new WidgetStore({} as IConfig, server.clients);
    });

    const widget = (patch: Partial<Widget> = {}): Widget => {
        const id = nextId++;
        const row = { id, name: `w${id}`, ...patch };
        store.put(row);
        return row;
    };

    // Lets fire-and-forget backfills land.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('builds one key per non-empty identifying property', () => {
        expect(store.cache.keysFor({ id: 7, name: 'seven' })).toEqual([
            store.cache.key('id', 7),
            store.cache.key('name', 'seven'),
        ]);
        expect(store.cache.keysFor({ id: 7, name: '' })).toEqual([
            store.cache.key('id', 7),
        ]);
        expect(store.cache.keysFor({ id: 7, name: null })).toEqual([
            store.cache.key('id', 7),
        ]);
    });

    it('loads a miss from the replica, backfills it, then serves it from cache', async () => {
        const row = widget();

        expect(await store.get(row.id)).toEqual(row);
        await settle();
        expect(store.loads).toEqual([{ ids: [row.id], primary: false }]);
        expect(
            await store.cache.read(store.cache.key('name', row.name)),
        ).toEqual(row);

        expect(await store.get(row.id)).toEqual(row);
        expect(store.loads).toHaveLength(1);
    });

    it('caches a row only under the keys `writeKeysFor` allows', async () => {
        const row = widget({ owned: false });
        await store.get(row.id);
        await settle();
        expect(await store.cache.read(store.cache.key('id', row.id))).toEqual(
            row,
        );
        expect(
            await store.cache.read(store.cache.key('name', row.name)),
        ).toBeNull();
    });

    it('reads a tombstoned key from the primary and does not cache it back', async () => {
        const row = widget();
        await store.tombstone([store.cache.key('id', row.id)]);
        store.primary.delete(row.id);

        expect(await store.get(row.id)).toBeNull();
        expect(store.loads).toEqual([{ ids: [row.id], primary: true }]);

        // The replica still has it; the tombstone keeps it out of the cache.
        await store.cache.write([row]);
        expect(
            await store.cache.read(store.cache.key('id', row.id)),
        ).toBeNull();
    });

    it('skips the cache read and reads the primary when asked', async () => {
        const row = widget();
        await store.get(row.id);
        store.primary.set(row.id, { ...row, name: 'renamed' });

        expect((await store.get(row.id, { primary: true }))?.name).toBe(
            'renamed',
        );
        expect(store.loads.at(-1)).toEqual({ ids: [row.id], primary: true });
    });

    it('shares one load between concurrent misses and hands each caller its own copy', async () => {
        const row = widget();
        const [a, b, c] = await Promise.all([
            store.get(row.id),
            store.get(row.id),
            store.get(row.id),
        ]);

        expect(store.loads).toHaveLength(1);
        expect(a).toEqual(row);
        expect(b).toEqual(row);
        expect(c).toEqual(row);
        a!.name = 'mutated';
        expect(b!.name).toBe(row.name);
        expect(b).not.toBe(c);
    });

    it('rejects every waiting caller when the shared load fails', async () => {
        const row = widget();
        const failing = vi
            .spyOn(store, 'load')
            .mockRejectedValue(new Error('db down'));
        const results = await Promise.allSettled([
            store.get(row.id),
            store.get(row.id),
        ]);
        failing.mockRestore();

        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
        // The failed load isn't remembered.
        expect(await store.get(row.id)).toEqual(row);
    });

    it('getMany pipelines its reads, tombstone checks and backfills', async () => {
        const rows = Array.from({ length: 25 }, () => widget());
        const warm = rows[0]!;
        await store.get(warm.id);
        await settle();
        store.loads = [];

        const pipelineSpy = vi.spyOn(server.clients.redis, 'pipeline');
        const found = await store.cache.getMany(
            'id',
            [...rows.map((r) => r.id), warm.id, 999_999],
            (ids, primary) => store.load(ids, primary),
        );
        await settle();
        const pipelines = pipelineSpy.mock.calls.length;
        pipelineSpy.mockRestore();

        expect(found.size).toBe(rows.length);
        expect(found.get(warm.id)).toEqual(warm);
        // One load for every miss, none for the warm row.
        expect(store.loads).toHaveLength(1);
        expect(store.loads[0]!.ids).toHaveLength(rows.length);
        // Cache read, tombstone check, and a three-step backfill: the count
        // does not grow with the number of rows.
        expect(pipelines).toBeLessThanOrEqual(5);
        for (const row of rows) {
            expect(
                await store.cache.read(store.cache.key('name', row.name)),
            ).toEqual(row);
        }
    });

    it('getMany re-reads tombstoned misses from the primary', async () => {
        const live = widget();
        const gone = widget();
        await store.tombstone([store.cache.key('id', gone.id)]);
        store.primary.delete(gone.id);

        const found = await store.cache.getMany(
            'id',
            [live.id, gone.id],
            (ids, primary) => store.load(ids, primary),
        );

        expect([...found.keys()]).toEqual([live.id]);
        expect(store.loads).toEqual([
            { ids: [live.id, gone.id], primary: false },
            { ids: [gone.id], primary: true },
        ]);
    });

    it('refreshes peers and skips a deleted row', async () => {
        const row = widget();
        const emit = vi.spyOn(server.clients.event, 'emit');

        await store.cache.refresh({ ...row, name: 'fresh' });
        expect(emit).toHaveBeenCalledWith(
            'outer.cacheUpdate',
            expect.objectContaining({
                cacheKey: [
                    store.cache.key('id', row.id),
                    store.cache.key('name', 'fresh'),
                ],
            }),
            {},
        );

        emit.mockClear();
        await store.tombstone([store.cache.key('id', row.id)]);
        emit.mockClear();
        await store.cache.refresh(row);
        expect(emit).not.toHaveBeenCalled();
        emit.mockRestore();
    });

    it('tombstones only the keys a deleted row owned', async () => {
        const row = widget({ owned: false });
        await store.cache.markDeleted(row);

        // The name key may still find another row, so it stays cacheable.
        await store.cache.write([{ id: 424242, name: row.name }]);
        expect(
            await store.cache.read(store.cache.key('name', row.name)),
        ).not.toBeNull();
        await store.cache.write([row]);
        expect(
            await store.cache.read(store.cache.key('id', row.id)),
        ).toBeNull();

        await store.cache.clearTombstones(row);
        await store.cache.write([row]);
        expect(await store.cache.read(store.cache.key('id', row.id))).toEqual(
            row,
        );
    });
});
