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
import { setupTestServer } from '../../testUtil.ts';
import {
    chunkPathsForIncr,
    INCR_EXPRESSION_BUDGET_BYTES,
    incrExpressionBytes,
    type SystemKVStore,
} from './SystemKVStore.ts';
import { PuterServer } from '../../server.ts';
import type { Actor } from '../../core/actor.ts';

describe('incr expression sizing', () => {
    const longPath = (i: number): string =>
        `together:meta-llama/Meta-Llama-3_dot_1-405B-Instruct-Turbo:kind${i}.units`;

    it('grows with the length of the path names, not just their count', () => {
        const long = Array.from({ length: 10 }, (_, i) => longPath(i));
        const short = Array.from({ length: 10 }, (_, i) => `m${i}.units`);
        expect(incrExpressionBytes(long)).toBeGreaterThan(
            incrExpressionBytes(short),
        );
    });

    it('keeps every batch within the budget', () => {
        const paths = Array.from({ length: 120 }, (_, i) => longPath(i));
        const batches = chunkPathsForIncr(paths);

        expect(batches.length).toBeGreaterThan(1);
        for (const batch of batches) {
            expect(incrExpressionBytes(batch)).toBeLessThanOrEqual(
                INCR_EXPRESSION_BUDGET_BYTES,
            );
        }
        expect(batches.flat()).toEqual(paths);
    });

    it('leaves paths that already fit in a single batch', () => {
        const paths = ['total', 'ai:chat.units', 'ai:chat.cost'];
        expect(chunkPathsForIncr(paths)).toEqual([paths]);
    });

    it('still batches a path that cannot fit on its own', () => {
        // A caller narrowing down a rejection needs the single-path attempt to
        // happen rather than being handed nothing to try.
        const enormous = `${'x'.repeat(INCR_EXPRESSION_BUDGET_BYTES)}.units`;
        expect(chunkPathsForIncr([enormous, 'total'])).toEqual([
            [enormous],
            ['total'],
        ]);
    });

    it('makes no batches out of no paths', () => {
        expect(chunkPathsForIncr([])).toEqual([]);
    });
});

describe('SystemKVStore', () => {
    let server: PuterServer;
    let target: SystemKVStore;

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.stores.kv;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // Each test runs against a fresh actor namespace so state from one test
    // never leaks into another. Actors are cheap; creating a unique uuid per
    // test gives full isolation without flush() teardown ceremony.
    let actor: Actor;
    let opts: { actor: Actor };
    beforeEach(() => {
        actor = {
            user: { uuid: `test-user-${Math.random().toString(36).slice(2)}` },
        };
        opts = { actor };
    });

    describe('set / get', () => {
        it('round-trips a value through the system namespace', async () => {
            await target.set({ key: 'systemKey', value: 'systemValue' });
            const value = await target.get({ key: 'systemKey' });
            expect(value.res).toBe('systemValue');
        });

        it('returns null for a missing key', async () => {
            const result = await target.get({ key: 'doesNotExist' }, opts);
            expect(result.res).toBeNull();
        });

        it('overwrites a previously-set value', async () => {
            await target.set({ key: 'k', value: 'first' }, opts);
            await target.set({ key: 'k', value: 'second' }, opts);
            const result = await target.get({ key: 'k' }, opts);
            expect(result.res).toBe('second');
        });

        it('stores complex object values', async () => {
            const value = { nested: { count: 1 }, items: [1, 2, 3] };
            await target.set({ key: 'obj', value }, opts);
            const result = await target.get({ key: 'obj' }, opts);
            expect(result.res).toEqual(value);
        });

        it('rejects an empty key', async () => {
            await expect(
                target.set({ key: '', value: 'x' }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a key over 1024 bytes', async () => {
            const oversized = 'a'.repeat(1025);
            await expect(
                target.set({ key: oversized, value: 'x' }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a value over the size limit', async () => {
            const huge = 'a'.repeat(400 * 1024);
            await expect(
                target.set({ key: 'big', value: huge }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('treats a value with an already-elapsed TTL as missing on read', async () => {
            const past = Math.floor(Date.now() / 1000) - 10;
            await target.set(
                { key: 'expired', value: 'gone', expireAt: past },
                opts,
            );
            const result = await target.get({ key: 'expired' }, opts);
            expect(result.res).toBeNull();
        });

        it('isolates values by actor namespace', async () => {
            const otherActor: Actor = { user: { uuid: 'other-user-uuid' } };
            await target.set({ key: 'shared', value: 'mine' }, opts);
            const otherResult = await target.get(
                { key: 'shared' },
                { actor: otherActor },
            );
            expect(otherResult.res).toBeNull();
        });

        it('returns an array of values when called with an array of keys', async () => {
            await target.set({ key: 'a', value: 1 }, opts);
            await target.set({ key: 'b', value: 2 }, opts);
            const result = await target.get(
                { key: ['a', 'b', 'missing'] },
                opts,
            );
            expect(result.res).toEqual([1, 2, null]);
        });
    });

    describe('batchPut', () => {
        it('writes multiple items and they read back', async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'bp1', value: 'v1' },
                        { key: 'bp2', value: 'v2' },
                        { key: 'bp3', value: { nested: true } },
                    ],
                },
                opts,
            );
            const result = await target.get(
                { key: ['bp1', 'bp2', 'bp3'] },
                opts,
            );
            expect(result.res).toEqual(['v1', 'v2', { nested: true }]);
        });

        it('is a no-op for an empty items array', async () => {
            const result = await target.batchPut({ items: [] }, opts);
            expect(result.res).toBe(true);
        });

        it('deduplicates by key, keeping the last value for repeated keys', async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'dup', value: 'first' },
                        { key: 'dup', value: 'last' },
                    ],
                },
                opts,
            );
            const result = await target.get({ key: 'dup' }, opts);
            expect(result.res).toBe('last');
        });

        it('rejects when any item has an oversized key', async () => {
            await expect(
                target.batchPut(
                    {
                        items: [
                            { key: 'ok', value: 1 },
                            { key: 'a'.repeat(1025), value: 2 },
                        ],
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('del', () => {
        it('removes a previously-set key', async () => {
            await target.set({ key: 'gone', value: 'bye' }, opts);
            await target.del({ key: 'gone' }, opts);
            const result = await target.get({ key: 'gone' }, opts);
            expect(result.res).toBeNull();
        });

        it('is idempotent when deleting a missing key', async () => {
            const result = await target.del({ key: 'never-existed' }, opts);
            expect(result.res).toBe(true);
        });
    });

    describe('list', () => {
        beforeEach(async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'fruit:apple', value: 'red' },
                        { key: 'fruit:banana', value: 'yellow' },
                        { key: 'veg:carrot', value: 'orange' },
                    ],
                },
                opts,
            );
        });

        it('returns key/value entries by default', async () => {
            const result = await target.list({}, opts);
            expect(Array.isArray(result.res)).toBe(true);
            expect(result.res).toEqual(
                expect.arrayContaining([
                    { key: 'fruit:apple', value: 'red' },
                    { key: 'fruit:banana', value: 'yellow' },
                    { key: 'veg:carrot', value: 'orange' },
                ]),
            );
        });

        it('returns just keys when as=keys', async () => {
            const result = await target.list({ as: 'keys' }, opts);
            expect(result.res).toEqual(
                expect.arrayContaining([
                    'fruit:apple',
                    'fruit:banana',
                    'veg:carrot',
                ]),
            );
        });

        it('returns just values when as=values', async () => {
            const result = await target.list({ as: 'values' }, opts);
            expect(result.res).toEqual(
                expect.arrayContaining(['red', 'yellow', 'orange']),
            );
        });

        it('rejects an unsupported as= value', async () => {
            await expect(
                // @ts-expect-error intentionally bad input
                target.list({ as: 'bogus' }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('filters by a wildcard prefix pattern', async () => {
            const result = await target.list(
                { as: 'keys', pattern: 'fruit:*' },
                opts,
            );
            expect(result.res).toEqual(
                expect.arrayContaining(['fruit:apple', 'fruit:banana']),
            );
            expect(result.res as string[]).not.toContain('veg:carrot');
        });

        it('returns a paginated envelope when limit is supplied', async () => {
            const result = await target.list({ limit: 1 }, opts);
            const envelope = result.res as {
                items: unknown[];
                cursor?: string;
            };
            expect(envelope.items.length).toBe(1);
            // With three items and limit 1 there should be a continuation cursor
            expect(typeof envelope.cursor).toBe('string');
        });

        it('rejects a non-positive limit', async () => {
            await expect(target.list({ limit: 0 }, opts)).rejects.toMatchObject(
                { statusCode: 400 },
            );
        });

        it('rejects a malformed cursor', async () => {
            await expect(
                target.list({ cursor: 'not-base64-or-json' }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('omits TTL-expired entries', async () => {
            await target.set(
                {
                    key: 'short-lived',
                    value: 'old',
                    expireAt: Math.floor(Date.now() / 1000) - 10,
                },
                opts,
            );
            const result = await target.list({ as: 'keys' }, opts);
            expect(result.res as string[]).not.toContain('short-lived');
        });

        it('skips ahead with offset', async () => {
            const all = (await target.list({ as: 'keys' }, opts))
                .res as string[];
            const result = await target.list(
                { as: 'keys', offset: 1, limit: 5 },
                opts,
            );
            const envelope = result.res as { items: string[] };
            expect(envelope.items).toEqual(all.slice(1));
        });

        it('returns an empty page when offset passes the end', async () => {
            const result = await target.list(
                { as: 'keys', offset: 50, limit: 5 },
                opts,
            );
            const envelope = result.res as { items: string[]; cursor?: string };
            expect(envelope.items).toEqual([]);
            expect(envelope.cursor).toBeUndefined();
        });

        it('rejects offset combined with cursor', async () => {
            const page = (await target.list({ limit: 1 }, opts)).res as {
                cursor?: string;
            };
            await expect(
                target.list({ offset: 1, cursor: page.cursor }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects offset above the cap', async () => {
            await expect(
                target.list({ offset: 5001 }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('reports total when includeTotal is set', async () => {
            const result = await target.list(
                { as: 'keys', limit: 1, includeTotal: true },
                opts,
            );
            const envelope = result.res as {
                items: string[];
                total?: number;
            };
            expect(envelope.items.length).toBe(1);
            expect(envelope.total).toBe(3);
        });

        it('excludes TTL-expired entries from total', async () => {
            await target.set(
                {
                    key: 'expired-one',
                    value: 'x',
                    expireAt: Math.floor(Date.now() / 1000) - 10,
                },
                opts,
            );
            const result = await target.list(
                { limit: 10, includeTotal: true },
                opts,
            );
            const envelope = result.res as { total?: number };
            expect(envelope.total).toBe(3);
        });

        it('scopes total to the pattern', async () => {
            const result = await target.list(
                { limit: 10, pattern: 'fruit:*', includeTotal: true },
                opts,
            );
            const envelope = result.res as { total?: number };
            expect(envelope.total).toBe(2);
        });

        it('refills short pages when fetchUntilFull is set', async () => {
            const now = Math.floor(Date.now() / 1000);
            await target.batchPut(
                {
                    items: [
                        { key: 'a:1', value: 1, expireAt: now - 10 },
                        { key: 'a:2', value: 2, expireAt: now - 10 },
                        { key: 'a:3', value: 3 },
                        { key: 'a:4', value: 4 },
                    ],
                },
                opts,
            );
            const result = await target.list(
                { as: 'keys', pattern: 'a:*', limit: 2, fetchUntilFull: true },
                opts,
            );
            const envelope = result.res as { items: string[] };
            expect(envelope.items).toEqual(['a:3', 'a:4']);
        });

        it('rejects fetchUntilFull without a limit', async () => {
            await expect(
                target.list({ fetchUntilFull: true }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('follows continuation pages across the full keyset via cursor', async () => {
            const keys: string[] = [];
            let cursor: string | undefined;
            do {
                const page = (
                    await target.list({ as: 'keys', limit: 1, cursor }, opts)
                ).res as { items: string[]; cursor?: string };
                keys.push(...page.items);
                cursor = page.cursor;
            } while (cursor);
            expect(keys.sort()).toEqual([
                'fruit:apple',
                'fruit:banana',
                'veg:carrot',
            ]);
        });
    });

    describe('flush', () => {
        it('removes every key in the actor namespace', async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'f1', value: 1 },
                        { key: 'f2', value: 2 },
                    ],
                },
                opts,
            );
            await target.flush(opts);
            const result = await target.list({ as: 'keys' }, opts);
            expect(result.res).toEqual([]);
        });

        it('only flushes the calling actor namespace', async () => {
            const otherActor: Actor = { user: { uuid: 'flush-other-user' } };
            await target.set({ key: 'mine', value: 1 }, opts);
            await target.set(
                { key: 'theirs', value: 2 },
                { actor: otherActor },
            );

            await target.flush(opts);

            const mine = await target.get({ key: 'mine' }, opts);
            const theirs = await target.get(
                { key: 'theirs' },
                { actor: otherActor },
            );
            expect(mine.res).toBeNull();
            expect(theirs.res).toBe(2);
        });
    });

    describe('expireAt / expire', () => {
        it('expireAt makes a key invisible once the timestamp passes', async () => {
            await target.set({ key: 'fade', value: 'soon' }, opts);
            await target.expireAt(
                { key: 'fade', timestamp: Math.floor(Date.now() / 1000) - 5 },
                opts,
            );
            const result = await target.get({ key: 'fade' }, opts);
            expect(result.res).toBeNull();
        });

        it('expire computes the TTL relative to now', async () => {
            await target.set({ key: 'fade2', value: 'soon' }, opts);
            // negative TTL is effectively expired
            await target.expire({ key: 'fade2', ttl: -10 }, opts);
            const result = await target.get({ key: 'fade2' }, opts);
            expect(result.res).toBeNull();
        });

        it('rejects an empty key', async () => {
            await expect(
                target.expireAt({ key: '', timestamp: 0 }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('incr / decr', () => {
        it('increments a top-level numeric counter from zero', async () => {
            const result = await target.incr(
                { key: 'counter', pathAndAmountMap: { hits: 1 } },
                opts,
            );
            expect(result.res).toMatchObject({ hits: 1 });
        });

        it('accumulates across calls', async () => {
            await target.incr(
                { key: 'counter2', pathAndAmountMap: { hits: 2 } },
                opts,
            );
            const result = await target.incr(
                { key: 'counter2', pathAndAmountMap: { hits: 3 } },
                opts,
            );
            expect(result.res).toMatchObject({ hits: 5 });
        });

        it('increments nested paths and creates intermediate maps', async () => {
            const result = await target.incr(
                {
                    key: 'metrics',
                    pathAndAmountMap: { 'page.views': 4 },
                },
                opts,
            );
            expect(result.res).toMatchObject({ page: { views: 4 } });
        });

        it('folds expireAt into the incr and stamps it once', async () => {
            const past = Math.floor(Date.now() / 1000) - 10;
            // First bump creates the counter and stamps the (already-elapsed)
            // ttl in the same write — no separate expireAt call.
            await target.incr(
                {
                    key: 'ttlCounter',
                    pathAndAmountMap: { hits: 1 },
                    expireAt: past,
                },
                opts,
            );
            const result = await target.get({ key: 'ttlCounter' }, opts);
            expect(result.res).toBeNull();
        });

        it('keeps the first expireAt stamp across later bumps (if_not_exists)', async () => {
            const future = Math.floor(Date.now() / 1000) + 3600;
            await target.incr(
                {
                    key: 'ttlKeep',
                    pathAndAmountMap: { hits: 1 },
                    expireAt: future,
                },
                opts,
            );
            // A later bump passing an already-elapsed ttl must NOT override the
            // first stamp, so the counter stays visible.
            const past = Math.floor(Date.now() / 1000) - 10;
            await target.incr(
                {
                    key: 'ttlKeep',
                    pathAndAmountMap: { hits: 1 },
                    expireAt: past,
                },
                opts,
            );
            const result = await target.get({ key: 'ttlKeep' }, opts);
            expect(result.res).toMatchObject({ hits: 2 });
        });

        it('creates nested intermediate maps lazily on the first bump, then accumulates', async () => {
            // First bump into a missing nested parent must still build the map
            // (optimistic path: the direct update fails, createPaths runs, retry
            // succeeds), and subsequent bumps keep accumulating.
            await target.incr(
                { key: 'lazyNest', pathAndAmountMap: { 'a.b.c': 2 } },
                opts,
            );
            const after = await target.incr(
                { key: 'lazyNest', pathAndAmountMap: { 'a.b.c': 3 } },
                opts,
            );
            expect(after.res).toMatchObject({ a: { b: { c: 5 } } });
        });

        it('does not try to build paths for an expression rejected on its size', async () => {
            // Both failures arrive as a ValidationException, but this one is
            // about the expression rather than the item: createPaths would
            // write a layer per nested path — each against this same item, so
            // each costing the whole item — and then re-send a byte-identical
            // expression to be rejected again. In production that ran as a
            // sweep every 5s and cost real money, so the guard is worth
            // pinning: one attempt, then out.
            const oversized = Object.assign(
                new Error(
                    '1 validation error detected: Invalid UpdateExpression: Expression size has exceeded the maximum allowed size;',
                ),
                { name: 'ValidationException' },
            );
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockRejectedValue(oversized);

            await expect(
                target.incr(
                    { key: 'oversized', pathAndAmountMap: { 'a.b': 1 } },
                    opts,
                ),
            ).rejects.toThrow(/Expression size/);
            expect(update).toHaveBeenCalledTimes(1);

            update.mockRestore();
        });

        it('still builds paths for a ValidationException about the item', async () => {
            // The other side of the guard above: a genuinely missing nested
            // parent must still be created and the update retried.
            const missingPath = Object.assign(
                new Error(
                    'The document path provided in the update expression is invalid for update',
                ),
                { name: 'ValidationException' },
            );
            const real = server.clients.dynamo.update.bind(
                server.clients.dynamo,
            );
            let first = true;
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockImplementation((...args) => {
                    if (first) {
                        first = false;
                        return Promise.reject(missingPath);
                    }
                    return real(...args);
                });

            const result = await target.incr(
                { key: 'guardedNest', pathAndAmountMap: { 'x.y.z': 4 } },
                opts,
            );

            expect(result.res).toMatchObject({ x: { y: { z: 4 } } });
            expect(update.mock.calls.length).toBeGreaterThan(1);
            update.mockRestore();
        });

        it('decr subtracts via the same machinery', async () => {
            await target.incr(
                { key: 'counter3', pathAndAmountMap: { hits: 10 } },
                opts,
            );
            const result = await target.decr(
                { key: 'counter3', pathAndAmountMap: { hits: 3 } },
                opts,
            );
            expect(result.res).toMatchObject({ hits: 7 });
        });

        it('rejects when pathAndAmountMap is missing', async () => {
            await expect(
                target.incr(
                    {
                        key: 'k',
                        // @ts-expect-error intentionally bad input
                        pathAndAmountMap: undefined,
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when pathAndAmountMap is empty', async () => {
            await expect(
                target.incr({ key: 'k', pathAndAmountMap: {} }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when any value in pathAndAmountMap is not a number', async () => {
            await expect(
                target.incr(
                    {
                        key: 'k',
                        // @ts-expect-error intentionally bad input
                        pathAndAmountMap: { x: 'nope' },
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('add', () => {
        it('appends a single element to an empty path, creating a new list', async () => {
            const result = await target.add(
                { key: 'list1', pathAndValueMap: { items: 'a' } },
                opts,
            );
            expect(result.res).toMatchObject({ items: ['a'] });
        });

        it('appends an array to an existing list', async () => {
            await target.add(
                { key: 'list2', pathAndValueMap: { items: ['a'] } },
                opts,
            );
            const result = await target.add(
                { key: 'list2', pathAndValueMap: { items: ['b', 'c'] } },
                opts,
            );
            expect(result.res).toMatchObject({ items: ['a', 'b', 'c'] });
        });

        it('rejects when pathAndValueMap is empty', async () => {
            await expect(
                target.add({ key: 'k', pathAndValueMap: {} }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('update', () => {
        it('sets a top-level path on a fresh key', async () => {
            const result = await target.update(
                {
                    key: 'doc',
                    pathAndValueMap: { name: 'puter' },
                },
                opts,
            );
            expect(result.res).toMatchObject({ name: 'puter' });
        });

        it('writes nested paths and creates intermediate maps', async () => {
            const result = await target.update(
                {
                    key: 'doc2',
                    pathAndValueMap: { 'profile.email': 'a@b.com' },
                },
                opts,
            );
            expect(result.res).toMatchObject({
                profile: { email: 'a@b.com' },
            });
        });

        it('preserves untouched fields when updating a single path', async () => {
            await target.update(
                {
                    key: 'doc3',
                    pathAndValueMap: { name: 'first', age: 1 },
                },
                opts,
            );
            const result = await target.update(
                { key: 'doc3', pathAndValueMap: { age: 2 } },
                opts,
            );
            expect(result.res).toMatchObject({ name: 'first', age: 2 });
        });

        it('applies a TTL when ttl is supplied', async () => {
            await target.update(
                {
                    key: 'doc4',
                    pathAndValueMap: { name: 'temp' },
                    ttl: -10,
                },
                opts,
            );
            const result = await target.get({ key: 'doc4' }, opts);
            expect(result.res).toBeNull();
        });

        it('rejects an empty pathAndValueMap', async () => {
            await expect(
                target.update({ key: 'k', pathAndValueMap: {} }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a non-numeric ttl', async () => {
            await expect(
                target.update(
                    {
                        key: 'k',
                        pathAndValueMap: { x: 1 },
                        ttl: Number.NaN,
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('remove', () => {
        it('removes a path that exists', async () => {
            await target.update(
                {
                    key: 'doc-rm',
                    pathAndValueMap: { keep: 1, drop: 2 },
                },
                opts,
            );
            const result = await target.remove(
                { key: 'doc-rm', paths: ['drop'] },
                opts,
            );
            expect(result.res).toMatchObject({ keep: 1 });
            expect(result.res).not.toHaveProperty('drop');
        });

        it('treats a missing path as a no-op and returns current value', async () => {
            await target.update(
                { key: 'doc-rm2', pathAndValueMap: { keep: 1 } },
                opts,
            );
            const result = await target.remove(
                { key: 'doc-rm2', paths: ['never.was.here'] },
                opts,
            );
            expect(result.res).toMatchObject({ keep: 1 });
        });

        it('rejects when paths is empty', async () => {
            await expect(
                target.remove({ key: 'k', paths: [] }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('prototype-chain safety', () => {
        const unsafeSegments = ['__proto__', 'constructor', 'prototype'];

        afterEach(() => {
            // Nothing a caller sends may end up on the shared prototype.
            expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain(
                'polluted',
            );
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        });

        it.each(unsafeSegments)(
            'incr rejects a path traversing `%s`',
            async (segment) => {
                await expect(
                    target.incr(
                        {
                            key: 'proto-incr',
                            pathAndAmountMap: {
                                [`${segment}.polluted.deep`]: 1,
                            },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it.each(unsafeSegments)(
            'decr rejects a path traversing `%s`',
            async (segment) => {
                await expect(
                    target.decr(
                        {
                            key: 'proto-decr',
                            pathAndAmountMap: {
                                [`${segment}.polluted.deep`]: 1,
                            },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it.each(unsafeSegments)(
            'update rejects a path traversing `%s`',
            async (segment) => {
                await expect(
                    target.update(
                        {
                            key: 'proto-update',
                            pathAndValueMap: {
                                [`${segment}.polluted.deep`]: 1,
                            },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it.each(unsafeSegments)(
            'add rejects a path traversing `%s`',
            async (segment) => {
                await expect(
                    target.add(
                        {
                            key: 'proto-add',
                            pathAndValueMap: {
                                [`${segment}.polluted.deep`]: 1,
                            },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it.each(unsafeSegments)(
            'remove rejects a path traversing `%s`',
            async (segment) => {
                await expect(
                    target.remove(
                        { key: 'proto-remove', paths: [`${segment}.polluted`] },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it('rejects an unsafe segment anywhere in the path', async () => {
            await expect(
                target.incr(
                    {
                        key: 'proto-deep',
                        pathAndAmountMap: { 'a.b.__proto__.polluted': 1 },
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it.each(unsafeSegments)(
            'set rejects a value carrying a `%s` key',
            async (unsafeKey) => {
                // A JSON body can carry these as real own properties even
                // though an object literal in JS source cannot.
                const value = JSON.parse(`{"${unsafeKey}":{"polluted":true}}`);
                await expect(
                    target.set({ key: 'proto-set', value }, opts),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it('rejects an unsafe key nested deep inside a value', async () => {
            const value = JSON.parse(
                '{"a":[{"b":{"constructor":{"polluted":true}}}]}',
            );
            await expect(
                target.set({ key: 'proto-nested', value }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an unsafe key in a batchPut item', async () => {
            const value = JSON.parse('{"__proto__":{"polluted":true}}');
            await expect(
                target.batchPut(
                    { items: [{ key: 'proto-batch', value }] },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('still allows ordinary paths and values', async () => {
            await target.set(
                { key: 'proto-ok', value: { safe: { nested: true } } },
                opts,
            );
            const stored = await target.get({ key: 'proto-ok' }, opts);
            expect(stored.res).toEqual({ safe: { nested: true } });

            const bumped = await target.incr(
                { key: 'proto-ok-counter', pathAndAmountMap: { 'a.b': 2 } },
                opts,
            );
            expect(bumped.res).toMatchObject({ a: { b: 2 } });
        });
    });

    describe('usage accounting', () => {
        it('reports write usage on set and read usage on get', async () => {
            const setRes = await target.set(
                { key: 'usage-k', value: 'v' },
                opts,
            );
            expect(setRes.usage.write).toBeGreaterThanOrEqual(0);
            expect(setRes.usage.read).toBe(0);

            const getRes = await target.get({ key: 'usage-k' }, opts);
            expect(getRes.usage.read).toBeGreaterThanOrEqual(0);
            expect(getRes.usage.write).toBe(0);
        });
    });

    // -- Cross-app privacy probe ---------------------------------------
    //
    // Reached only through `namespaceAppUuid`, which the KV driver sets after
    // its permission check. Asserted at the store so no permission machinery
    // (which reads flat perms through KV) is in the measurement.
    describe('cross-app mutations', () => {
        let crossOpts: { actor: Actor; namespaceAppUuid: string };
        beforeEach(() => {
            crossOpts = { actor, namespaceAppUuid: 'app-other' };
        });

        it('probes a whole batch in one read rather than one per key', async () => {
            const batchGet = vi.spyOn(server.clients.dynamo, 'batchGet');
            const get = vi.spyOn(server.clients.dynamo, 'get');
            try {
                await target.batchPut(
                    {
                        items: [
                            { key: 'b1', value: 1 },
                            { key: 'b2', value: 2 },
                            { key: 'b3', value: 3 },
                        ],
                    },
                    crossOpts,
                );
                // A per-key probe would make this N single-key gets.
                expect(batchGet).toHaveBeenCalledTimes(1);
                expect(get).not.toHaveBeenCalled();
            } finally {
                batchGet.mockRestore();
                get.mockRestore();
            }
        });

        it('bills the probe as a read', async () => {
            // The probe is a real round trip; metering runs off the usage the
            // store reports, so swallowing it under-bills the caller.
            const { usage } = await target.set(
                { key: 'metered', value: 'v' },
                crossOpts,
            );
            expect(usage.read).toBeGreaterThan(0);
            expect(usage.write).toBeGreaterThan(0);
        });

        it('still refuses a private entry through the batch probe', async () => {
            // Into the *target* namespace: a plain user actor may address any of
            // its own app namespaces via `appUuid`, which is how the owning app's
            // data is seeded here.
            await target.set(
                { key: 'secret', value: 's', disableSharing: true },
                { actor, appUuid: 'app-other' },
            );
            await expect(
                target.batchPut(
                    {
                        items: [
                            { key: 'ok', value: 1 },
                            { key: 'secret', value: 2 },
                        ],
                    },
                    crossOpts,
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });
});
