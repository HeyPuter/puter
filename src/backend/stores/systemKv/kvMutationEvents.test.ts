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
 * What every mutating KV method says on the bus. Driven through the real store
 * against a real table rather than a stubbed one, because the claim being made
 * is that each method emits exactly once and after its own write commits.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.ts';
import { SYSTEM_ACTOR } from '../../core/actor.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import type { IConfig } from '../../types.ts';
import { KV_GLOBAL_APP_KEY, type SystemKVStore } from './SystemKVStore.ts';

let server: PuterServer;
let store: SystemKVStore;
let actor: Actor;
let opts: { actor: Actor };
let emitted: Array<{ key: string; data: Record<string, unknown> }>;

const KEY = 'cart:items';

/** Record what the store says on the bus, without silencing anything. */
const recordEmits = (target: PuterServer): void => {
    const bus = target.clients.event;
    const passThrough = bus.emit.bind(bus);
    vi.spyOn(bus, 'emit').mockImplementation(((
        key: string,
        data: Record<string, unknown>,
        meta: unknown,
    ) => {
        emitted.push({ key, data });
        return passThrough(key as never, data as never, meta as never);
    }) as never);
};

const mutations = () =>
    emitted.filter((event) => event.key.startsWith('kv.'));

/** The one mutation event a call made, failing loudly if it made several. */
const onlyMutation = (): Record<string, unknown> => {
    const seen = mutations();
    expect(seen).toHaveLength(1);
    return seen[0].data;
};

beforeAll(async () => {
    // The default install caches no reads, which is the configuration R2-10's
    // predecessor was silent in — so this whole file already runs cache-off.
    server = await setupTestServer();
    store = server.stores.kv;
    recordEmits(server);
}, 120_000);

afterAll(async () => {
    vi.restoreAllMocks();
    await server?.shutdown();
});

beforeEach(() => {
    emitted = [];
    actor = {
        user: {
            id: 42,
            uuid: `user-${Math.random().toString(36).slice(2)}`,
        },
        effectiveApp: null,
    } as unknown as Actor;
    opts = { actor };
});

const namespaceOf = (): string =>
    `v1:${(actor.user as { uuid: string }).uuid}:${KV_GLOBAL_APP_KEY}`;

describe('what a mutation announces', () => {
    it('names the namespace, its owner, the keys and the op', async () => {
        await store.set({ key: KEY, value: 1 }, opts);

        expect(onlyMutation()).toEqual({
            namespace: namespaceOf(),
            userId: 42,
            keys: [KEY],
            op: 'set',
        });
        expect(mutations()[0].key).toBe('kv.mutated');
    });

    it('reports a batch as one event over its keys', async () => {
        await store.batchPut(
            {
                items: [
                    { key: 'a', value: 1 },
                    { key: 'b', value: 2 },
                    { key: 'a', value: 3 },
                ],
            },
            opts,
        );

        expect(onlyMutation()).toMatchObject({ keys: ['a', 'b'], op: 'set' });
    });

    it('says nothing for a batch with nothing in it', async () => {
        await store.batchPut({ items: [] }, opts);
        await store.batchDel({ keys: [] }, opts);

        expect(mutations()).toEqual([]);
    });
});

describe('every mutating method emits once', () => {
    const cases: Array<{
        name: string;
        op: string;
        keys?: string[];
        run: () => Promise<unknown>;
    }> = [
        { name: 'set', op: 'set', run: () => store.set({ key: KEY, value: 1 }, opts) },
        {
            name: 'batchPut',
            op: 'set',
            keys: ['a', 'b'],
            run: () =>
                store.batchPut(
                    { items: [{ key: 'a', value: 1 }, { key: 'b', value: 2 }] },
                    opts,
                ),
        },
        { name: 'del', op: 'del', run: () => store.del({ key: KEY }, opts) },
        { name: 'take', op: 'del', run: () => store.take({ key: KEY }, opts) },
        {
            name: 'batchDel',
            op: 'del',
            keys: ['a', 'b'],
            run: () => store.batchDel({ keys: ['a', 'b'] }, opts),
        },
        {
            name: 'expireAt',
            op: 'expire',
            run: () =>
                store.expireAt(
                    { key: KEY, timestamp: Math.floor(Date.now() / 1000) + 60 },
                    opts,
                ),
        },
        {
            name: 'expire',
            op: 'expire',
            run: () => store.expire({ key: KEY, ttl: 60 }, opts),
        },
        {
            name: 'incr',
            op: 'set',
            run: () =>
                store.incr({ key: KEY, pathAndAmountMap: { count: 1 } }, opts),
        },
        {
            name: 'decr',
            op: 'set',
            run: () =>
                store.decr({ key: KEY, pathAndAmountMap: { count: 1 } }, opts),
        },
        {
            name: 'add',
            op: 'set',
            run: () =>
                store.add({ key: KEY, pathAndValueMap: { list: [1] } }, opts),
        },
        {
            name: 'remove',
            op: 'set',
            run: () => store.remove({ key: KEY, paths: ['count'] }, opts),
        },
        {
            name: 'update',
            op: 'set',
            run: () =>
                store.update(
                    { key: KEY, pathAndValueMap: { count: 7 } },
                    opts,
                ),
        },
    ];

    it.each(cases)('$name announces $op', async (testCase) => {
        // A seeded entry so the path-mutating methods have something to act on
        // and take the committing branch rather than their no-op fallback.
        await store.set({ key: KEY, value: { count: 1, list: [] } }, opts);
        emitted = [];

        await testCase.run();

        expect(onlyMutation()).toMatchObject({
            op: testCase.op,
            keys: testCase.keys ?? [KEY],
        });
    });
});

describe('flush', () => {
    it('marks the namespace rather than fanning out per key', async () => {
        await store.batchPut(
            { items: [{ key: 'a', value: 1 }, { key: 'b', value: 2 }] },
            opts,
        );
        emitted = [];

        await store.flush(opts);

        expect(mutations()).toHaveLength(1);
        expect(mutations()[0].key).toBe('kv.flushed');
        expect(mutations()[0].data).toEqual({
            namespace: namespaceOf(),
            userId: 42,
        });
    });
});

describe('who is left out', () => {
    it('says nothing for internal system data', async () => {
        await store.set({ key: KEY, value: 1 }, { actor: SYSTEM_ACTOR });

        expect(mutations()).toEqual([]);
    });

    it('says nothing for an actor with no user row to key on', async () => {
        await store.set(
            { key: KEY, value: 1 },
            { actor: { user: { uuid: 'no-id' } } as unknown as Actor },
        );

        expect(mutations()).toEqual([]);
    });
});

describe('the read cache does not decide this', () => {
    let cached: PuterServer;

    beforeAll(async () => {
        cached = await setupTestServer({
            kvCache: { enabled: true },
        } as IConfig);
        recordEmits(cached);
    }, 120_000);

    afterAll(async () => {
        await cached?.shutdown();
    });

    it('announces the change with cached reads switched on too', async () => {
        emitted = [];
        await cached.stores.kv.set({ key: KEY, value: 1 }, opts);

        expect(onlyMutation()).toMatchObject({ op: 'set', keys: [KEY] });
    });
});
