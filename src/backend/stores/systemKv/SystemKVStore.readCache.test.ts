import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Actor } from '../../core/actor.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import type { SystemKVStore } from './SystemKVStore.ts';
import { kvCacheKey } from './readCache.ts';
import { PUTER_KV_STORE_TABLE_NAME } from './tableDefinition.ts';

const BLOCK_SECONDS = 1;

describe('SystemKVStore read cache', () => {
    let server: PuterServer;
    let target: SystemKVStore;

    beforeAll(async () => {
        server = await setupTestServer({
            kvCache: {
                enabled: true,
                blockSeconds: BLOCK_SECONDS,
                // Emit as each invalidation happens so a test can assert on it
                // without waiting out a coalescing window.
                broadcastCoalesceMs: 0,
            },
        });
        target = server.stores.kv;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    let actor: Actor;
    let opts: { actor: Actor };
    let namespace: string;
    beforeEach(() => {
        const uuid = `test-user-${Math.random().toString(36).slice(2)}`;
        actor = { user: { uuid } };
        opts = { actor };
        // Mirrors the store's own namespacing for an actor with no app.
        namespace = `v1:${uuid}:os-global`;
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Seed an entry without going through the store, so no write block is left
     * behind and the very next read is free to cache what it finds.
     */
    const seed = (
        key: string,
        value: unknown,
        extra: Record<string, unknown> = {},
    ) =>
        server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
            namespace,
            key,
            value,
            ...extra,
        });

    /** Cache fills are deliberately not awaited by the read that triggers them. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * The dynamo client is shared by the whole test server, so a spy on it
     * also sees background work and the async tail of earlier tests. Only
     * calls for this test's own namespace prove anything about this test.
     */
    const dynamoCallsHere = (spy: { mock: { calls: unknown[][] } }) =>
        spy.mock.calls.filter(
            (call) =>
                (call[1] as { namespace?: string } | undefined)?.namespace ===
                namespace,
        );

    describe('get', () => {
        it('answers a repeat read without touching the underlying store', async () => {
            await seed('k', 'cached-value');
            await target.get({ key: 'k' }, opts);
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            const result = await target.get({ key: 'k' }, opts);

            expect(result.res).toBe('cached-value');
            expect(get).not.toHaveBeenCalled();
        });

        it('reports cached units separately from consumed capacity', async () => {
            await seed('k', 'v');
            const uncached = await target.get({ key: 'k' }, opts);
            await settle();
            const cached = await target.get({ key: 'k' }, opts);

            expect(uncached.usage.read).toBeGreaterThan(0);
            expect(uncached.usage.cachedRead).toBe(0);
            // The units a cached read replays are the ones the uncached read
            // consumed — the rate they are priced at is the driver's business.
            expect(cached.usage.read).toBe(0);
            expect(cached.usage.cachedRead).toBe(uncached.usage.read);
        });

        it('answers a repeat read of a missing key without touching the store', async () => {
            const first = await target.get({ key: 'never-written' }, opts);
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            const second = await target.get({ key: 'never-written' }, opts);

            expect(first.res).toBeNull();
            expect(second.res).toBeNull();
            expect(get).not.toHaveBeenCalled();
        });

        it('reads through when the caller asks for a consistent read', async () => {
            await seed('k', 'v');
            await target.get({ key: 'k' }, opts);
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            await target.get({ key: 'k', consistentRead: true }, opts);

            expect(get).toHaveBeenCalledTimes(1);
        });

        it('never caches the system namespace', async () => {
            const key = `sys-${Math.random().toString(36).slice(2)}`;
            await target.set({ key, value: 'v' });
            const get = vi.spyOn(server.clients.dynamo, 'get');

            await target.get({ key });
            await settle();
            await target.get({ key });

            expect(get).toHaveBeenCalledTimes(2);
        });

        it('leaves an oversized value uncached', async () => {
            await seed('big', 'x'.repeat(40 * 1024));
            await target.get({ key: 'big' }, opts);
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            const result = await target.get({ key: 'big' }, opts);

            expect(result.res).toHaveLength(40 * 1024);
            expect(get).toHaveBeenCalledTimes(1);
        });

        it('stops serving an entry once its own expiry lapses', async () => {
            // Three seconds, not one: the entry has to still be live when the
            // first read lands, and a one-second window is one the seed, the
            // read and a loaded machine can eat between them.
            const expiresAt = Math.floor(Date.now() / 1000) + 3;
            await seed('short-lived', 'v', { ttl: expiresAt });
            const before = await target.get({ key: 'short-lived' }, opts);
            await settle();
            expect(before.res).toBe('v');

            await sleep(Math.max(0, expiresAt * 1000 - Date.now()) + 200);
            const after = await target.get({ key: 'short-lived' }, opts);
            expect(after.res).toBeNull();
        });
    });

    describe('batch get', () => {
        it('fetches only the keys the cache could not answer', async () => {
            await seed('a', 1);
            await seed('b', 2);
            await target.get({ key: ['a'] }, opts);
            await settle();

            const batchGet = vi.spyOn(server.clients.dynamo, 'batchGet');
            const result = await target.get(
                { key: ['a', 'b', 'absent'] },
                opts,
            );

            expect(result.res).toEqual([1, 2, null]);
            expect(batchGet).toHaveBeenCalledTimes(1);
            const requested = (
                batchGet.mock.calls[0][0] as {
                    items: { key: string };
                }[]
            ).map((request) => request.items.key);
            expect(requested.sort()).toEqual(['absent', 'b']);
        });

        it('skips the store entirely when every key is cached', async () => {
            await seed('a', 1);
            await seed('b', 2);
            await target.get({ key: ['a', 'b'] }, opts);
            await settle();

            const batchGet = vi.spyOn(server.clients.dynamo, 'batchGet');
            const result = await target.get({ key: ['a', 'b'] }, opts);

            expect(result.res).toEqual([1, 2]);
            expect(batchGet).not.toHaveBeenCalled();
        });

        it('mixes cached and fetched units in one usage figure', async () => {
            await seed('a', 1);
            await seed('b', 2);
            await target.get({ key: ['a'] }, opts);
            await settle();

            const { usage } = await target.get({ key: ['a', 'b'] }, opts);
            expect(usage.cachedRead).toBeGreaterThan(0);
            expect(usage.read).toBeGreaterThan(0);
        });
    });

    describe('invalidation', () => {
        const warm = async (key: string, value: unknown) => {
            await seed(key, value);
            await target.get({ key }, opts);
            await settle();
        };

        it('serves the new value after a set', async () => {
            await warm('k', 'old');
            await target.set({ key: 'k', value: 'new' }, opts);
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toBe('new');
        });

        it('serves nothing after a del', async () => {
            await warm('k', 'v');
            await target.del({ key: 'k' }, opts);
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toBeNull();
        });

        it('serves the new value after a batchPut', async () => {
            await warm('a', 'old-a');
            await warm('b', 'old-b');
            await target.batchPut(
                {
                    items: [
                        { key: 'a', value: 'new-a' },
                        { key: 'b', value: 'new-b' },
                    ],
                },
                opts,
            );
            const result = await target.get({ key: ['a', 'b'] }, opts);
            expect(result.res).toEqual(['new-a', 'new-b']);
        });

        it('serves the new value after an update', async () => {
            await warm('k', { count: 1 });
            await target.update(
                { key: 'k', pathAndValueMap: { count: 9 } },
                opts,
            );
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toEqual({ count: 9 });
        });

        it('serves the new value after an incr', async () => {
            await warm('k', { count: 1 });
            await target.incr(
                { key: 'k', pathAndAmountMap: { count: 2 } },
                opts,
            );
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toEqual({ count: 3 });
        });

        it('serves the new value after an add', async () => {
            await warm('k', { items: ['a'] });
            await target.add(
                { key: 'k', pathAndValueMap: { items: ['b'] } },
                opts,
            );
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toEqual({ items: ['a', 'b'] });
        });

        it('serves the new value after a remove', async () => {
            await warm('k', { keep: 1, drop: 2 });
            await target.remove({ key: 'k', paths: ['drop'] }, opts);
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toEqual({ keep: 1 });
        });

        it('serves nothing after an expire lapses', async () => {
            await warm('k', 'v');
            await target.expire({ key: 'k', ttl: 1 }, opts);
            await sleep(1200);
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toBeNull();
        });

        it('serves nothing after a flush', async () => {
            await warm('a', 1);
            await warm('b', 2);
            await target.flush(opts);
            const result = await target.get({ key: ['a', 'b'] }, opts);
            expect(result.res).toEqual([null, null]);
        });

        it('keeps reads off the cache for a window, then lets it fill again', async () => {
            await warm('k', 'old');
            await target.set({ key: 'k', value: 'new' }, opts);

            // Inside the window a read cannot prove its value is the current
            // one, so nothing is cached and every read goes to the store.
            const blocked = vi.spyOn(server.clients.dynamo, 'get');
            await target.get({ key: 'k' }, opts);
            await settle();
            await target.get({ key: 'k' }, opts);
            expect(dynamoCallsHere(blocked)).toHaveLength(2);
            blocked.mockRestore();

            await sleep(BLOCK_SECONDS * 1000 + 200);
            await target.get({ key: 'k' }, opts);
            await settle();

            const after = vi.spyOn(server.clients.dynamo, 'get');
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toBe('new');
            expect(dynamoCallsHere(after)).toHaveLength(0);
        });
    });

    describe('cross-region broadcast', () => {
        it('announces the cache keys a write invalidated', async () => {
            const emit = vi.spyOn(server.clients.event, 'emit');
            await target.set({ key: 'k', value: 'v' }, opts);

            expect(emit).toHaveBeenCalledWith(
                'outer.kv.cacheInvalidated',
                { cacheKeys: [kvCacheKey(namespace, 'k')] },
                {},
            );
        });

        it('says nothing for a write to the system namespace', async () => {
            const emit = vi.spyOn(server.clients.event, 'emit');
            await target.set({ key: 'sys-key', value: 'v' });

            expect(emit).not.toHaveBeenCalledWith(
                'outer.kv.cacheInvalidated',
                expect.anything(),
                expect.anything(),
            );
        });

        it('applies an invalidation that arrived from another region', async () => {
            await seed('k', 'v');
            await target.get({ key: 'k' }, opts);
            await settle();

            server.clients.event.emit(
                'outer.kv.cacheInvalidated',
                { cacheKeys: [kvCacheKey(namespace, 'k')] },
                { from_outside: true },
            );
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            await target.get({ key: 'k' }, opts);
            expect(get).toHaveBeenCalledTimes(1);
        });

        it('ignores its own announcement, which it has already applied', async () => {
            await seed('k', 'v');
            await target.get({ key: 'k' }, opts);
            await settle();

            server.clients.event.emit(
                'outer.kv.cacheInvalidated',
                { cacheKeys: [kvCacheKey(namespace, 'k')] },
                {},
            );
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            await target.get({ key: 'k' }, opts);
            expect(get).not.toHaveBeenCalled();
        });
    });

    describe('private entries', () => {
        it('hides a private entry from a cross-app read the cache answers', async () => {
            await seed('secret', 'value', { noShare: true });

            // Warmed by a read from the owning side, which is allowed to see it.
            const owner = await target.get({ key: 'secret' }, opts);
            expect(owner.res).toBe('value');
            await settle();

            const get = vi.spyOn(server.clients.dynamo, 'get');
            const crossApp = await target.get(
                { key: 'secret' },
                { actor, namespaceAppUuid: 'os-global' },
            );

            expect(crossApp.res).toBeNull();
            expect(get).not.toHaveBeenCalled();
        });
    });
});
