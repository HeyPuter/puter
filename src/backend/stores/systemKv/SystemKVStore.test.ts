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
    KV_GLOBAL_APP_KEY,
    kvNamespace,
    type SystemKVStore,
} from './SystemKVStore.ts';
import { PUTER_KV_STORE_TABLE_NAME } from './tableDefinition.ts';
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
        // happen rather than being handed nothing to try, even under a budget
        // nothing could ever fit (a truncated alias keeps one real path from
        // reaching this on its own).
        expect(chunkPathsForIncr(['total', 'ai:chat.units'], 1)).toEqual([
            ['total'],
            ['ai:chat.units'],
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

        it('clamps a number too large to store, rather than failing the write', async () => {
            await target.set(
                { key: 'huge', value: 1.6515584833071455e55 },
                opts,
            );
            const result = await target.get({ key: 'huge' }, opts);
            expect(result.res).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('clamps numbers nested anywhere inside a value', async () => {
            await target.set(
                {
                    key: 'profile',
                    value: {
                        username: 'ambastha',
                        netWorth: 1.6515584833071455e55,
                        level: 29,
                        history: [{ delta: -1e55 }],
                    },
                },
                opts,
            );

            const result = await target.get({ key: 'profile' }, opts);
            expect(result.res).toEqual({
                username: 'ambastha',
                netWorth: Number.MAX_SAFE_INTEGER,
                level: 29,
                history: [{ delta: Number.MIN_SAFE_INTEGER }],
            });
        });

        it('stores a value with no numeric representation as null', async () => {
            await target.set(
                { key: 'special', value: { score: NaN, ceiling: Infinity } },
                opts,
            );
            const result = await target.get({ key: 'special' }, opts);
            expect(result.res).toEqual({
                score: null,
                ceiling: Number.MAX_SAFE_INTEGER,
            });
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

        it('clamps an out-of-range number in one item without failing the batch', async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'bpSafe', value: 7 },
                        { key: 'bpHuge', value: { netWorth: 1e55 } },
                    ],
                },
                opts,
            );
            const result = await target.get(
                { key: ['bpSafe', 'bpHuge'] },
                opts,
            );
            expect(result.res).toEqual([
                7,
                { netWorth: Number.MAX_SAFE_INTEGER },
            ]);
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

        it('rejects a key over 1024 bytes as a client error', async () => {
            await expect(
                target.del({ key: 'a'.repeat(1025) }, opts),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
        });
    });

    describe('batchDel', () => {
        it('removes every key in the batch and leaves the rest', async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'bd1', value: 'v1' },
                        { key: 'bd2', value: 'v2' },
                        { key: 'bd3', value: 'v3' },
                    ],
                },
                opts,
            );
            await target.batchDel({ keys: ['bd1', 'bd3'] }, opts);
            const result = await target.get(
                { key: ['bd1', 'bd2', 'bd3'] },
                opts,
            );
            expect(result.res).toEqual([null, 'v2', null]);
        });

        it('is a no-op for an empty keys array', async () => {
            const result = await target.batchDel({ keys: [] }, opts);
            expect(result.res).toBe(true);
        });

        it('tolerates missing keys and duplicates in the batch', async () => {
            await target.set({ key: 'bd-only', value: 'v' }, opts);
            const result = await target.batchDel(
                { keys: ['bd-only', 'bd-only', 'never-existed'] },
                opts,
            );
            expect(result.res).toBe(true);
            expect((await target.get({ key: 'bd-only' }, opts)).res).toBeNull();
        });

        it('rejects when any key is oversized', async () => {
            await expect(
                target.batchDel({ keys: ['ok', 'a'.repeat(1025)] }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
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

        it('lists backwards without changing the unpaginated shape', async () => {
            expect(
                (await target.list({ as: 'keys', reverse: true }, opts)).res,
            ).toEqual(['veg:carrot', 'fruit:banana', 'fruit:apple']);
            expect((await target.list({ as: 'keys' }, opts)).res).toEqual([
                'fruit:apple',
                'fruit:banana',
                'veg:carrot',
            ]);
        });

        it.each([false, true])(
            'preserves cursor direction reverse=%s',
            async (reverse) => {
                const first = (
                    await target.list({ as: 'keys', limit: 1, reverse }, opts)
                ).res as { items: string[]; cursor: string };
                expect(first.items).toEqual([
                    reverse ? 'veg:carrot' : 'fruit:apple',
                ]);
                const second = (
                    await target.list(
                        { as: 'keys', limit: 1, cursor: first.cursor },
                        opts,
                    )
                ).res as { items: string[] };
                expect(second.items).toEqual(['fruit:banana']);
                await expect(
                    target.list(
                        { limit: 1, cursor: first.cursor, reverse: !reverse },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it('applies reverse ordering to prefix filtering, offset, and totals', async () => {
            const result = await target.list(
                {
                    as: 'values',
                    pattern: 'fruit:*',
                    reverse: true,
                    offset: 1,
                    limit: 1,
                    includeTotal: true,
                },
                opts,
            );
            expect(result.res).toMatchObject({ items: ['red'], total: 2 });
        });

        it('fills reverse pages past expired keys', async () => {
            await target.set(
                {
                    key: 'fruit:blueberry',
                    value: 'expired',
                    expireAt: Math.floor(Date.now() / 1000) - 10,
                },
                opts,
            );
            const result = await target.list(
                {
                    as: 'keys',
                    pattern: 'fruit:*',
                    reverse: true,
                    limit: 2,
                    fetchUntilFull: true,
                },
                opts,
            );
            expect(result.res).toMatchObject({
                items: ['fruit:banana', 'fruit:apple'],
            });
        });

        it('rejects invalid reverse flags and cursor wrappers', async () => {
            await expect(
                target.list({ reverse: 'true' as unknown as boolean }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
            for (const cursor of [
                { reverse: true, key: 'bad' },
                { reverse: true, key: {} },
                { reverse: false, key: {} },
            ]) {
                await expect(
                    target.list({ cursor }, opts),
                ).rejects.toMatchObject({ statusCode: 400 });
            }
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

        it('returns an empty page when offset ends exactly at the last key', async () => {
            // A backend may close the last page without a continuation key
            // even though the limit is what stopped it.
            const real = server.clients.dynamo.query.bind(
                server.clients.dynamo,
            );
            const query = vi
                .spyOn(server.clients.dynamo, 'query')
                .mockImplementation(async (...args) => {
                    const response = await real(...args);
                    if (args[6]?.select === 'COUNT')
                        delete response.LastEvaluatedKey;
                    return response;
                });
            try {
                const result = await target.list(
                    { as: 'keys', offset: 3, limit: 5 },
                    opts,
                );
                expect(result.res).toEqual({ items: [] });
            } finally {
                query.mockRestore();
            }
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

        it('keeps deleting past the first page of a large namespace', async () => {
            // Four values this size don't fit in one query page.
            const big = 'x'.repeat(350 * 1024);
            for (const key of ['big1', 'big2', 'big3', 'big4']) {
                await target.set({ key, value: big }, opts);
            }
            await target.flush(opts);
            expect((await target.list({ as: 'keys' }, opts)).res).toEqual([]);
        });

        it('rejects when a delete fails rather than reporting success', async () => {
            await target.set({ key: 'f1', value: 1 }, opts);
            const batchDel = vi
                .spyOn(server.clients.dynamo, 'batchDel')
                .mockRejectedValueOnce(new Error('batch write failed'));
            try {
                await expect(target.flush(opts)).rejects.toThrow(
                    'batch write failed',
                );
            } finally {
                batchDel.mockRestore();
            }
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

        it('both resolve true', async () => {
            await target.set({ key: 'resolveTrue', value: 1 }, opts);
            const expireAtResult = await target.expireAt(
                {
                    key: 'resolveTrue',
                    timestamp: Math.floor(Date.now() / 1000) + 60,
                },
                opts,
            );
            expect(expireAtResult.res).toBe(true);
            const expireResult = await target.expire(
                { key: 'resolveTrue', ttl: 60 },
                opts,
            );
            expect(expireResult.res).toBe(true);
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

        it.each([
            ['a numeric string', '5'],
            ['a non-numeric string', 'abc'],
            ['null', null],
            ['a boolean', true],
        ])(
            'decr rejects %s as an amount, as incr does',
            async (_label, amount) => {
                for (const op of ['incr', 'decr'] as const) {
                    await expect(
                        target[op](
                            {
                                key: 'badAmount',
                                pathAndAmountMap: {
                                    '': amount as unknown as number,
                                },
                            },
                            opts,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        legacyCode: 'bad_request',
                    });
                }
                expect(
                    (await target.get({ key: 'badAmount' }, opts)).res,
                ).toBeNull();
            },
        );

        it('decr rejects a missing pathAndAmountMap as a client error', async () => {
            await expect(
                target.decr(
                    {
                        key: 'noMap',
                        pathAndAmountMap: undefined as unknown as Record<
                            string,
                            number
                        >,
                    },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
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

            try {
                await expect(
                    target.incr(
                        { key: 'oversized', pathAndAmountMap: { 'a.b': 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                    message: expect.not.stringMatching(/UpdateExpression|Expression size/),
                });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
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

            try {
                const result = await target.incr(
                    { key: 'guardedNest', pathAndAmountMap: { 'x.y.z': 4 } },
                    opts,
                );

                expect(result.res).toMatchObject({ x: { y: { z: 4 } } });
                expect(update.mock.calls.length).toBeGreaterThan(1);
            } finally {
                update.mockRestore();
            }
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

        it('rejects a text value with value_not_a_number and a plain message', async () => {
            await target.set({ key: 'textCounter', value: 'hello' }, opts);
            await expect(
                target.incr(
                    { key: 'textCounter', pathAndAmountMap: { '': 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'value_not_a_number',
                message: expect.not.stringMatching(/operand|expression/i),
            });
            const got = await target.get({ key: 'textCounter' }, opts);
            expect(got.res).toBe('hello');
        });

        it('rejects a numeric string the same way', async () => {
            await target.set({ key: 'numericStringCounter', value: '5' }, opts);
            await expect(
                target.incr(
                    {
                        key: 'numericStringCounter',
                        pathAndAmountMap: { '': 1 },
                    },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'value_not_a_number',
            });
        });

        it('rejects an object value when no field is named', async () => {
            await target.set(
                { key: 'objectCounter', value: { foo: 1 } },
                opts,
            );
            await expect(
                target.incr(
                    { key: 'objectCounter', pathAndAmountMap: { '': 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'value_not_a_number',
            });
        });

        it('rejects a null value', async () => {
            await target.set({ key: 'nullCounter', value: null }, opts);
            await expect(
                target.incr(
                    { key: 'nullCounter', pathAndAmountMap: { '': 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'value_not_a_number',
            });
        });

        it('decr rejects a text value the same way', async () => {
            await target.set({ key: 'decrTextCounter', value: 'hello' }, opts);
            await expect(
                target.decr(
                    { key: 'decrTextCounter', pathAndAmountMap: { '': 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'value_not_a_number',
            });
        });

        it('does not try to build paths for a type mismatch', async () => {
            await target.set({ key: 'noPathBuildCounter', value: 'hello' }, opts);
            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await expect(
                    target.incr(
                        {
                            key: 'noPathBuildCounter',
                            pathAndAmountMap: { '': 1 },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ code: 'value_not_a_number' });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
        });

        it('rejects a nested path through a stored number with invalid_path', async () => {
            await target.set({ key: 'nestedNumber', value: { a: 5 } }, opts);
            await expect(
                target.incr(
                    { key: 'nestedNumber', pathAndAmountMap: { 'a.b': 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
            await expect(
                target.decr(
                    { key: 'nestedNumber', pathAndAmountMap: { 'a.b': 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
            expect((await target.get({ key: 'nestedNumber' }, opts)).res).toEqual(
                { a: 5 },
            );
        });
    });

    describe('counter overflow', () => {
        it('reads back a counter incremented past the safe range as the bound', async () => {
            const halfway = Number.MAX_SAFE_INTEGER;
            await target.incr(
                { key: 'counter', pathAndAmountMap: { '': halfway } },
                opts,
            );
            const bumped = await target.incr(
                { key: 'counter', pathAndAmountMap: { '': halfway } },
                opts,
            );

            expect(bumped.res).toBe(Number.MAX_SAFE_INTEGER);
            const read = await target.get({ key: 'counter' }, opts);
            expect(read.res).toBe(Number.MAX_SAFE_INTEGER);
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

        it('rejects a bare object on a list with invalid_path and leaves the list unchanged', async () => {
            const key = 'list-of-objects';
            await target.set(
                { key, value: [{ at: 1, event: 'opened' }] },
                opts,
            );
            await expect(
                target.add(
                    { key, pathAndValueMap: { at: 2, event: 'closed' } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'invalid_path',
                message: expect.stringMatching(/`at`/),
            });
            await expect(
                target.add(
                    { key, pathAndValueMap: { at: 2, event: 'closed' } },
                    opts,
                ),
            ).rejects.toMatchObject({
                message: expect.stringMatching(/`event`/),
            });
            await expect(
                target.add(
                    { key, pathAndValueMap: { at: 2, event: 'closed' } },
                    opts,
                ),
            ).rejects.toMatchObject({
                message: expect.stringContaining(`\`${key}\``),
            });
            expect((await target.get({ key }, opts)).res).toEqual([
                { at: 1, event: 'opened' },
            ]);
        });

        it.each([
            ['a non-list field', { tags: 'alpha' }, { tags: 'beta' }],
            ['the whole root value', 'text', { '': 'x' }],
        ])(
            'rejects appending to a value that is not a list with value_not_a_list (%s)',
            async (_label, value, pathAndValueMap) => {
                const key = 'not-a-list';
                await target.set({ key, value }, opts);
                await expect(
                    target.add({ key, pathAndValueMap }, opts),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    code: 'value_not_a_list',
                });
                expect((await target.get({ key }, opts)).res).toEqual(value);
            },
        );
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

        it('clamps an out-of-range number written to a path', async () => {
            const result = await target.update(
                {
                    key: 'docHuge',
                    pathAndValueMap: { 'stats.netWorth': 1e55 },
                },
                opts,
            );
            expect(result.res).toMatchObject({
                stats: { netWorth: Number.MAX_SAFE_INTEGER },
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

        it('rejects a path through a text value with invalid_path and a plain message', async () => {
            const key = 'name-is-text';
            await target.set({ key, value: { name: 'Ada' } }, opts);
            await expect(
                target.update(
                    { key, pathAndValueMap: { 'name.first': 'A' } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'invalid_path',
                message: expect.not.stringMatching(
                    /document path|UpdateExpression|ValidationException|#value|#p\d/i,
                ),
            });
            expect((await target.get({ key }, opts)).res).toEqual({
                name: 'Ada',
            });
        });
    });

    describe('createPaths write bounding', () => {
        it('sends exactly one update when paths share a parent that already exists', async () => {
            const key = 'shared-parent';
            await target.update({ key, pathAndValueMap: { 'p.q': 1 } }, opts);

            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                const result = await target.update(
                    { key, pathAndValueMap: { 'p.r': 2, 'p.s': 3 } },
                    opts,
                );
                expect(result.res).toMatchObject({ p: { q: 1, r: 2, s: 3 } });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
        });

        it('add sends exactly one update when the parent list already exists', async () => {
            const key = 'shared-parent-list';
            await target.add(
                { key, pathAndValueMap: { 'items.a': 'x' } },
                opts,
            );

            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                const result = await target.add(
                    { key, pathAndValueMap: { 'items.a': 'y' } },
                    opts,
                );
                expect(result.res).toMatchObject({ items: { a: ['x', 'y'] } });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
        });

        it('rejects a write that would grow the value past the size limit with value_too_large, without building paths', async () => {
            const key = 'log-near-cap';
            await target.set(
                { key, value: { log: ['x'.repeat(398 * 1024)] } },
                opts,
            );

            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await expect(
                    target.add(
                        { key, pathAndValueMap: { log: 'y'.repeat(4096) } },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    code: 'value_too_large',
                });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
        });

        // The mocks below reject only the caller's own write, told apart from
        // createPaths writes by its `:value`/`:append` tokens.
        const oversized = () =>
            Object.assign(
                new Error(
                    '1 validation error detected: Invalid UpdateExpression: Expression size has exceeded the maximum allowed size;',
                ),
                { name: 'ValidationException' },
            );

        it('update rejects an oversized expression without any createPaths writes', async () => {
            const key = 'update-oversized';
            // An existing value rules out createPaths' fresh-key shortcut.
            await target.set({ key, value: { marker: true } }, opts);

            const real = server.clients.dynamo.update.bind(
                server.clients.dynamo,
            );
            const err = oversized();
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockImplementation((...args) => {
                    const expression = String(args[2]);
                    if (expression.includes(':value'))
                        return Promise.reject(err);
                    return real(...args);
                });

            try {
                await expect(
                    target.update(
                        {
                            key,
                            pathAndValueMap: { 'a.b.c': 1, 'a.d.e': 2 },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                    message: expect.not.stringMatching(/UpdateExpression|Expression size/),
                });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
        });

        it('add rejects an oversized expression without any createPaths writes', async () => {
            const key = 'add-oversized';
            await target.set({ key, value: { marker: true } }, opts);

            const real = server.clients.dynamo.update.bind(
                server.clients.dynamo,
            );
            const err = oversized();
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockImplementation((...args) => {
                    const expression = String(args[2]);
                    if (expression.includes(':append'))
                        return Promise.reject(err);
                    return real(...args);
                });

            try {
                await expect(
                    target.add(
                        {
                            key,
                            pathAndValueMap: { 'a.b.c': 1, 'a.d.e': 2 },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                    message: expect.not.stringMatching(/UpdateExpression|Expression size/),
                });
                expect(update).toHaveBeenCalledTimes(1);
            } finally {
                update.mockRestore();
            }
        });

        it('still rejects incompatible roots without any write', async () => {
            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await expect(
                    target.update(
                        {
                            key: 'incompatible-roots',
                            pathAndValueMap: { a: 1, '[0]': 2 },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                await expect(
                    target.add(
                        {
                            key: 'incompatible-roots-add',
                            pathAndValueMap: { a: [1], '[0]': [2] },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                expect(update).not.toHaveBeenCalled();
            } finally {
                update.mockRestore();
            }
        });

        it('still rejects incompatible containers without any write', async () => {
            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await expect(
                    target.update(
                        {
                            key: 'incompatible-containers',
                            pathAndValueMap: { 'a.b': 1, 'a[0]': 2 },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                await expect(
                    target.add(
                        {
                            key: 'incompatible-containers-add',
                            pathAndValueMap: { 'a.b': [1], 'a[0]': [2] },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                expect(update).not.toHaveBeenCalled();
            } finally {
                update.mockRestore();
            }
        });

        it('bounds the update count by depth on a wide nested update, not by path count', async () => {
            const key = 'wide-nested';
            // An existing value rules out createPaths' fresh-key shortcut.
            await target.set({ key, value: { marker: true } }, opts);

            const pathAndValueMap: Record<string, unknown> = {};
            for (let i = 0; i < 50; i++) {
                pathAndValueMap[`a.b.sib${i}.leaf`] = i;
            }
            pathAndValueMap['a.b.deep.x.y.leaf'] = 'deep';

            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                const result = await target.update(
                    { key, pathAndValueMap },
                    opts,
                );

                // 55 missing containers over 5 depths: one write per depth,
                // the wide one split to fit the budget, not one per container.
                expect(update.mock.calls.length).toBeLessThan(15);
                for (const [, , expression] of update.mock.calls) {
                    expect(Buffer.byteLength(expression)).toBeLessThanOrEqual(
                        INCR_EXPRESSION_BUDGET_BYTES,
                    );
                }

                const stored = await target.get({ key }, opts);
                expect(stored.res).toMatchObject(result.res as object);
                const value = stored.res as {
                    marker: boolean;
                    a: {
                        b: Record<string, unknown> & {
                            deep: { x: { y: { leaf: string } } };
                        };
                    };
                };
                expect(value.marker).toBe(true);
                expect(value.a.b.sib0).toMatchObject({ leaf: 0 });
                expect(value.a.b.sib49).toMatchObject({ leaf: 49 });
                expect(value.a.b.deep.x.y.leaf).toBe('deep');
            } finally {
                update.mockRestore();
            }
        });

        it('reports every write as usage, createPaths included', async () => {
            const key = 'fallback-usage';
            await target.set({ key, value: { marker: true } }, opts);

            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                const { usage } = await target.update(
                    { key, pathAndValueMap: { 'a.b.c': 1, 'a.d.e': 2 } },
                    opts,
                );

                let billed = 0;
                for (const result of update.mock.results) {
                    try {
                        const response = await result.value;
                        billed += Number(
                            response.ConsumedCapacity?.CapacityUnits ?? 0,
                        );
                    } catch {
                        // The first attempt fails and reports no capacity.
                    }
                }
                expect(update.mock.calls.length).toBeGreaterThan(2);
                expect(usage.write).toBeGreaterThan(0);
                expect(usage.write).toBe(billed);
            } finally {
                update.mockRestore();
            }
        });

        it('announces a write that needed createPaths exactly once', async () => {
            // Mutations are only announced for an actor with a numeric user id.
            const announcedOpts = {
                actor: { user: { id: 1, uuid: actor.user!.uuid } } as Actor,
            };
            const emit = vi.spyOn(server.clients.event, 'emit');
            try {
                const updated = await target.update(
                    { key: 'announced', pathAndValueMap: { 'a.b': 1 } },
                    announcedOpts,
                );
                const added = await target.add(
                    { key: 'announced', pathAndValueMap: { 'c.d': 'x' } },
                    announcedOpts,
                );

                const mutations = emit.mock.calls
                    .filter(([name]) => name === 'kv.mutated')
                    .map(([, payload]) => payload);
                expect(mutations).toEqual([
                    expect.objectContaining({
                        keys: ['announced'],
                        values: [updated.res],
                    }),
                    expect.objectContaining({
                        keys: ['announced'],
                        values: [added.res],
                    }),
                ]);
            } finally {
                emit.mockRestore();
            }
        });

        it('rejects a non-numeric ttl before writing anything', async () => {
            const key = 'nan-ttl';
            await expect(
                target.update(
                    { key, pathAndValueMap: { 'a.b': 1 }, ttl: Number.NaN },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
            expect((await target.get({ key }, opts)).res).toBeNull();
        });

        it.each([
            ['a string', 'str'],
            ['a number', 5],
            ['a null', null],
        ])(
            'rejects a nested path under %s value and leaves it unchanged',
            async (_label, value) => {
                const key = 'scalar-root';
                await target.set({ key, value }, opts);

                const attempts = [
                    () =>
                        target.update(
                            { key, pathAndValueMap: { 'a.b': 1 } },
                            opts,
                        ),
                    () =>
                        target.add(
                            { key, pathAndValueMap: { 'a.b': 1 } },
                            opts,
                        ),
                    () =>
                        target.incr(
                            { key, pathAndAmountMap: { 'a.b': 1 } },
                            opts,
                        ),
                ];
                for (const attempt of attempts) {
                    await expect(attempt()).rejects.toMatchObject({
                        statusCode: 400,
                        code: 'invalid_path',
                    });
                }
                expect((await target.get({ key }, opts)).res).toEqual(value);
            },
        );
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

        it('rejects the same path twice instead of silently removing nothing', async () => {
            const key = 'doc-rm-dup';
            await target.update({ key, pathAndValueMap: { a: 1 } }, opts);
            await expect(
                target.remove({ key, paths: ['a', 'a'] }, opts),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect((await target.get({ key }, opts)).res).toMatchObject({
                a: 1,
            });
        });

        it('rejects an oversized expression instead of treating it as a no-op', async () => {
            const key = 'doc-rm-oversized';
            await target.update({ key, pathAndValueMap: { a: 1 } }, opts);
            const oversized = Object.assign(
                new Error(
                    '1 validation error detected: Invalid UpdateExpression: Expression size has exceeded the maximum allowed size;',
                ),
                { name: 'ValidationException' },
            );
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockRejectedValue(oversized);
            try {
                await expect(
                    target.remove({ key, paths: ['a'] }, opts),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
            } finally {
                update.mockRestore();
            }
        });

        it.each(['', '.'])(
            'removing the root path %j deletes the key instead of leaving it empty',
            async (rootPath) => {
                const key = `remove-root-${rootPath === '' ? 'empty' : 'dot'}`;
                await target.set({ key, value: { a: 1 } }, opts);
                const result = await target.remove(
                    { key, paths: [rootPath] },
                    opts,
                );
                expect(result.res).toBeNull();
                const raw = await server.clients.dynamo.get(
                    PUTER_KV_STORE_TABLE_NAME,
                    {
                        namespace: kvNamespace(
                            actor.user.uuid!,
                            KV_GLOBAL_APP_KEY,
                        ),
                        key,
                    },
                );
                expect(raw.Item).toBeUndefined();
                const listed = await target.list({ as: 'keys' }, opts);
                expect(listed.res).not.toContain(key);
            },
        );
    });

    describe('document paths', () => {
        describe('empty quoted names', () => {
            const plainMessage = expect.not.stringMatching(
                /document path|UpdateExpression|ValidationException|Nesting Levels|attribute name|#value|#p\d/i,
            );

            it.each(['[""]', "['']", 'a[""]', 'a[""].b'])(
                'rejects %s in every path method with bad_request before any write',
                async (badPath) => {
                    const update = vi.spyOn(server.clients.dynamo, 'update');
                    try {
                        for (const method of [
                            'update',
                            'add',
                            'incr',
                            'decr',
                            'remove',
                        ] as const) {
                            const key =
                                `empty-quoted-${method}-${badPath}`.replace(
                                    /[^\w-]/g,
                                    '_',
                                );
                            const run =
                                method === 'remove'
                                    ? target.remove(
                                          { key, paths: [badPath] },
                                          opts,
                                      )
                                    : method === 'incr' || method === 'decr'
                                      ? target[method](
                                            {
                                                key,
                                                pathAndAmountMap: {
                                                    [badPath]: 1,
                                                },
                                            },
                                            opts,
                                        )
                                      : target[method](
                                            {
                                                key,
                                                pathAndValueMap: {
                                                    [badPath]: 1,
                                                },
                                            },
                                            opts,
                                        );
                            await expect(run).rejects.toMatchObject({
                                statusCode: 400,
                                legacyCode: 'bad_request',
                                message: plainMessage,
                            });
                        }
                        expect(update).not.toHaveBeenCalled();
                    } finally {
                        update.mockRestore();
                    }
                },
            );
        });

        describe('overlapping paths', () => {
            const overlapCases: Array<[string, string]> = [
                ['a', 'a.b'],
                ['a', '.a'],
                ['', 'a'],
            ];
            const methods = ['update', 'add', 'incr'] as const;

            it.each(methods)(
                '%s rejects overlapping paths before writing anything',
                async (method) => {
                    const update = vi.spyOn(server.clients.dynamo, 'update');
                    try {
                        for (const [first, second] of overlapCases) {
                            const key = `overlap-${method}-${first}-${second}`.replace(
                                /[^\w-]/g,
                                '_',
                            );
                            const pathAndValueMap = { [first]: 1, [second]: 1 };
                            const run =
                                method === 'incr'
                                    ? target.incr(
                                          {
                                              key,
                                              pathAndAmountMap: pathAndValueMap,
                                          },
                                          opts,
                                      )
                                    : method === 'add'
                                      ? target.add({ key, pathAndValueMap }, opts)
                                      : target.update({ key, pathAndValueMap }, opts);
                            await expect(run).rejects.toMatchObject({
                                statusCode: 400,
                                legacyCode: 'bad_request',
                            });
                            expect(
                                (await target.get({ key }, opts)).res,
                            ).toBeNull();
                        }
                        expect(update).not.toHaveBeenCalled();
                    } finally {
                        update.mockRestore();
                    }
                },
            );
        });

        describe('conflicting paths', () => {
            // A path pair that differs in token type (list index vs field
            // name) at the same shared position, so no single container can
            // satisfy both.
            const conflictCases: Array<[string, string]> = [
                ['a[0]', 'a.b'],
                ['a[0].b', 'a[0][1]'],
            ];
            const methods = ['update', 'add', 'incr', 'remove'] as const;

            it.each(methods)(
                '%s rejects conflicting paths before writing anything',
                async (method) => {
                    const update = vi.spyOn(server.clients.dynamo, 'update');
                    try {
                        for (const [first, second] of conflictCases) {
                            const key = `conflict-${method}-${first}-${second}`.replace(
                                /[^\w-]/g,
                                '_',
                            );
                            const run =
                                method === 'remove'
                                    ? target.remove(
                                          { key, paths: [first, second] },
                                          opts,
                                      )
                                    : method === 'incr'
                                      ? target.incr(
                                            {
                                                key,
                                                pathAndAmountMap: {
                                                    [first]: 1,
                                                    [second]: 1,
                                                },
                                            },
                                            opts,
                                        )
                                      : method === 'add'
                                        ? target.add(
                                              {
                                                  key,
                                                  pathAndValueMap: {
                                                      [first]: 1,
                                                      [second]: 1,
                                                  },
                                              },
                                              opts,
                                          )
                                        : target.update(
                                              {
                                                  key,
                                                  pathAndValueMap: {
                                                      [first]: 1,
                                                      [second]: 1,
                                                  },
                                              },
                                              opts,
                                          );
                            await expect(run).rejects.toMatchObject({
                                statusCode: 400,
                                legacyCode: 'bad_request',
                            });
                            expect(
                                (await target.get({ key }, opts)).res,
                            ).toBeNull();
                        }
                        expect(update).not.toHaveBeenCalled();
                    } finally {
                        update.mockRestore();
                    }
                },
            );
        });

        describe('path depth limit', () => {
            const maxDepthPath = Array.from(
                { length: 31 },
                (_, i) => `a${i}`,
            ).join('.');
            const tooDeepPath = `${maxDepthPath}.oneMore`;

            it('accepts a path at the depth cap', async () => {
                const result = await target.update(
                    { key: 'depth-cap', pathAndValueMap: { [maxDepthPath]: 'v' } },
                    opts,
                );
                expect(result.res).toBeTruthy();
            });

            it('rejects a path one level past the cap with bad_request, before any write', async () => {
                const update = vi.spyOn(server.clients.dynamo, 'update');
                try {
                    await expect(
                        target.update(
                            {
                                key: 'too-deep',
                                pathAndValueMap: { [tooDeepPath]: 'v' },
                            },
                            opts,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        legacyCode: 'bad_request',
                    });
                    expect(update).not.toHaveBeenCalled();
                } finally {
                    update.mockRestore();
                }
            });

            it('returns quickly for a path at the cap and for an oversized path', async () => {
                const atCapStart = Date.now();
                await target.update(
                    {
                        key: 'depth-cap-timing',
                        pathAndValueMap: { [maxDepthPath]: 'v' },
                    },
                    opts,
                );
                expect(Date.now() - atCapStart).toBeLessThan(1_000);

                // 3000 tokens is already ~18x the cap and clearly measures the
                // same quadratic cost a pathological path would; a much larger
                // one (the ~40 KB path this guard is really about) is checked
                // separately once rejection is known to be cheap.
                const oversizedPath = 'a.'.repeat(3000);
                const oversizedStart = Date.now();
                await expect(
                    target.update(
                        {
                            key: 'huge-path-timing',
                            pathAndValueMap: { [oversizedPath]: 'v' },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                expect(Date.now() - oversizedStart).toBeLessThan(1_000);
            });

            it('rejects a 40 KB oversized path near-instantly', async () => {
                // The actual shape the bug report measured at ~12 s pre-fix;
                // run only now that the cap makes it safe to exercise here.
                const hugePath = 'a.'.repeat(20000);
                const start = Date.now();
                await expect(
                    target.update(
                        {
                            key: 'huge-40kb-path',
                            pathAndValueMap: { [hugePath]: 'v' },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                expect(Date.now() - start).toBeLessThan(1_000);
            });

            it('rejects a path far past the depth cap without reading all of it', async () => {
                const enormousPath = 'a.'.repeat(5_000_000);
                const start = Date.now();
                await expect(
                    target.update(
                        {
                            key: 'enormous-path-timing',
                            pathAndValueMap: { [enormousPath]: 'v' },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                expect(Date.now() - start).toBeLessThan(1000);
            });
        });

        describe('call size', () => {
            it('rejects more path segments than one write could apply, before writing', async () => {
                const pathAndValueMap: Record<string, unknown> = {};
                for (let i = 0; i <= 1500; i++) pathAndValueMap[`p${i}`] = i;
                const update = vi.spyOn(server.clients.dynamo, 'update');
                try {
                    await expect(
                        target.update(
                            { key: 'call-size-over', pathAndValueMap },
                            opts,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        legacyCode: 'bad_request',
                        message: expect.stringMatching(
                            /too many or too long/,
                        ),
                    });
                    expect(update).not.toHaveBeenCalled();
                } finally {
                    update.mockRestore();
                }
            });

            it('accepts as many segments as the cap', async () => {
                const pathAndValueMap: Record<string, unknown> = {};
                for (let i = 0; i < 1500; i++) pathAndValueMap[`p${i}`] = i;
                const result = await target.update(
                    { key: 'call-size-at-cap', pathAndValueMap },
                    opts,
                );
                expect(result.res).toBeTruthy();
            });

            it('checks many long paths without re-reading every prefix of each', async () => {
                const long = 'x'.repeat(16 * 1024);
                const paths = Array.from({ length: 39 }, (_, i) =>
                    [`k${i}`, ...Array(30).fill(long)].join('.'),
                );
                paths.push('k0[0]');
                const start = Date.now();
                await expect(
                    target.remove({ key: 'call-size-long', paths }, opts),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                expect(Date.now() - start).toBeLessThan(1500);
            });
        });

        it("keeps every attribute name placeholder within the store's 255-byte limit", async () => {
            const key = 'placeholder-length';
            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await target.update(
                    { key, pathAndValueMap: { ['L'.repeat(300)]: 1 } },
                    opts,
                );
                for (const call of update.mock.calls) {
                    const names = call[4] as Record<string, string> | undefined;
                    for (const name of Object.keys(names ?? {})) {
                        expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(
                            255,
                        );
                    }
                }
            } finally {
                update.mockRestore();
            }
        });

        describe('error message formatting', () => {
            it('renders the empty root path as prose, not empty backticks', async () => {
                await expect(
                    target.update(
                        {
                            key: 'root-overlap-msg',
                            pathAndValueMap: { '': 1, a: 2 },
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    message:
                        'kv: paths the root and `a` overlap: one is the same as, or inside, the other',
                });
            });

            it('truncates a long echoed path instead of printing it in full', async () => {
                const longKey = 'x'.repeat(150);
                await expect(
                    target.remove(
                        {
                            key: 'long-path-msg',
                            paths: [longKey, `${longKey}.child`],
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    message: expect.stringContaining(
                        `${longKey.slice(0, 100)}…`,
                    ),
                });
                await expect(
                    target.remove(
                        {
                            key: 'long-path-msg',
                            paths: [longKey, `${longKey}.child`],
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    message: expect.not.stringContaining('child'),
                });
            });
        });

        describe('path methods', () => {
            const fixtures = [
                {
                    name: 'root index',
                    path: '[0]',
                    wrap: (value: unknown) => [value, 'keep'],
                    removed: ['keep'],
                },
                {
                    name: 'nested index',
                    path: 'a[0]',
                    wrap: (value: unknown) => ({ a: [value, 'keep'] }),
                    removed: { a: ['keep'] },
                },
                {
                    name: 'mixed path',
                    path: 'some.path[1].to.value',
                    wrap: (value: unknown) => ({
                        some: { path: ['keep', { to: { value } }] },
                    }),
                    removed: { some: { path: ['keep', { to: {} }] } },
                },
                {
                    name: 'repeated indexes',
                    path: '[0][1]',
                    wrap: (value: unknown) => [['keep', value]],
                    removed: [['keep']],
                },
                {
                    name: 'quoted dotted keys',
                    path: `["a.b"]['c.d']`,
                    wrap: (value: unknown) => ({
                        'a.b': { 'c.d': value },
                        keep: true,
                    }),
                    removed: { 'a.b': {}, keep: true },
                },
                {
                    name: 'escaped quote and backslash',
                    path: "['quote\\'and\\\\slash']",
                    wrap: (value: unknown) => ({
                        "quote'and\\slash": value,
                        keep: true,
                    }),
                    removed: { keep: true },
                },
                {
                    name: 'quoted numeric map key',
                    path: '["0"]',
                    wrap: (value: unknown) => ({ '0': value, keep: true }),
                    removed: { keep: true },
                },
            ];
            const operations = [
                {
                    name: 'update',
                    initial: 10,
                    next: 'after',
                    run: (key: string, path: string) =>
                        target.update(
                            { key, pathAndValueMap: { [path]: 'after' } },
                            opts,
                        ),
                },
                {
                    name: 'incr',
                    initial: 10,
                    next: 13,
                    run: (key: string, path: string) =>
                        target.incr(
                            { key, pathAndAmountMap: { [path]: 3 } },
                            opts,
                        ),
                },
                {
                    name: 'decr',
                    initial: 10,
                    next: 7,
                    run: (key: string, path: string) =>
                        target.decr(
                            { key, pathAndAmountMap: { [path]: 3 } },
                            opts,
                        ),
                },
                {
                    name: 'add',
                    initial: ['before'],
                    next: ['before', 'after'],
                    run: (key: string, path: string) =>
                        target.add(
                            { key, pathAndValueMap: { [path]: ['after'] } },
                            opts,
                        ),
                },
                {
                    name: 'remove',
                    initial: 10,
                    next: undefined,
                    run: (key: string, path: string) =>
                        target.remove({ key, paths: [path] }, opts),
                },
            ];

            describe.each(operations)('$name', (operation) => {
                it.each(fixtures)(
                    'supports $name and persists the result',
                    async (fixture) => {
                        const key = 'path-matrix';
                        await target.set(
                            { key, value: fixture.wrap(operation.initial) },
                            opts,
                        );
                        const expected =
                            operation.name === 'remove'
                                ? fixture.removed
                                : fixture.wrap(operation.next);
                        expect(
                            (await operation.run(key, fixture.path)).res,
                        ).toEqual(expected);
                        expect((await target.get({ key }, opts)).res).toEqual(
                            expected,
                        );
                    },
                );

                it.each([
                    'a[-1]',
                    'a[1.5]',
                    'a[',
                    'a[0]tail',
                    '["__proto__"].polluted',
                    "['constructor'].prototype.polluted",
                    'a[0]["prototype"]',
                    '["__pro\\to__"].polluted',
                ])('rejects %s without changing stored data', async (path) => {
                    const key = 'invalid-path-matrix';
                    const initial = { a: [10], keep: true };
                    await target.set({ key, value: initial }, opts);
                    await expect(
                        operation.run(key, path),
                    ).rejects.toMatchObject({ statusCode: 400 });
                    expect((await target.get({ key }, opts)).res).toEqual(
                        initial,
                    );
                });

                it('does not append an unintended element for a missing indexed ancestor', async () => {
                    const key = 'missing-index-matrix';
                    const initial = [{ keep: true }];
                    await target.set({ key, value: initial }, opts);
                    if (operation.name === 'remove') {
                        expect(
                            (await operation.run(key, '[4].value')).res,
                        ).toEqual(initial);
                    } else {
                        await expect(
                            operation.run(key, '[4].value'),
                        ).rejects.toMatchObject({
                            statusCode: 400,
                            code: 'invalid_path',
                        });
                    }
                    expect((await target.get({ key }, opts)).res).toEqual(
                        initial,
                    );
                });
            });
        });

        const rootArrayOperations: Array<[
            string,
            () => Promise<{ res: unknown }>,
            unknown,
        ]> = [
            [
                'incr',
                async () =>
                    target.incr(
                        { key: 'root-incr', pathAndAmountMap: { '[0]': 1 } },
                        opts,
                    ),
                [1],
            ],
            [
                'decr',
                async () =>
                    target.decr(
                        { key: 'root-decr', pathAndAmountMap: { '[0]': 1 } },
                        opts,
                    ),
                [-1],
            ],
            [
                'update',
                async () =>
                    target.update(
                        {
                            key: 'root-update',
                            pathAndValueMap: { '[0]': 'zero' },
                        },
                        opts,
                    ),
                ['zero'],
            ],
            [
                'add',
                async () =>
                    target.add(
                        {
                            key: 'root-add',
                            pathAndValueMap: { '[0]': 'zero' },
                        },
                        opts,
                    ),
                [['zero']],
            ],
        ];

        it.each(rootArrayOperations)(
            '%s initializes a fresh root array for [0]',
            async (_method, run, expected) => {
                expect((await run()).res).toEqual(expected);
            },
        );

        it('removes a root array index', async () => {
            await target.set({ key: 'root-remove', value: ['zero'] }, opts);
            const result = await target.remove(
                { key: 'root-remove', paths: ['[0]'] },
                opts,
            );
            expect(result.res).toEqual([]);
        });

        it('supports indexes, mixed paths, repeated indexes, and quoted keys', async () => {
            await target.set(
                {
                    key: 'path-shapes',
                    value: {
                        a: [{ count: 1, items: [] }],
                        some: { path: [{}, {}] },
                        nested: [[0, 1]],
                        'a.b': [{ 'c.d': {} }],
                        "quote'and\\slash": {},
                    },
                },
                opts,
            );

            await target.incr(
                { key: 'path-shapes', pathAndAmountMap: { 'a[0].count': 2 } },
                opts,
            );
            await target.decr(
                { key: 'path-shapes', pathAndAmountMap: { 'a[0].count': 1 } },
                opts,
            );
            await target.add(
                { key: 'path-shapes', pathAndValueMap: { 'a[0].items': 'x' } },
                opts,
            );
            await target.update(
                {
                    key: 'path-shapes',
                    pathAndValueMap: {
                        'some.path[1].to.value': 'mixed',
                        'nested[0][1]': 'repeated',
                        '["a.b"][0]["c.d"].value': 'dotted',
                        "['quote\\'and\\\\slash'].value": 'escaped',
                    },
                },
                opts,
            );
            const removed = await target.remove(
                { key: 'path-shapes', paths: ['a[0].items[0]'] },
                opts,
            );

            expect(removed.res).toEqual({
                a: [{ count: 2, items: [] }],
                some: { path: [{}, { to: { value: 'mixed' } }] },
                nested: [[0, 'repeated']],
                'a.b': [{ 'c.d': { value: 'dotted' } }],
                "quote'and\\slash": { value: 'escaped' },
            });
        });

        it(
            'keeps distinct aliases for colliding attribute names in one operation',
            async () => {
                const result = await target.update(
                    {
                        key: 'alias-collision',
                        pathAndValueMap: { 'a-b': 1, ab: 2 },
                    },
                    opts,
                );
                expect(result.res).toEqual({ 'a-b': 1, ab: 2 });
            },
        );

        it('keeps legacy empty dot chunks while parsing array paths', async () => {
            const result = await target.update(
                {
                    key: 'empty-dot-chunks',
                    pathAndValueMap: { '.a..b.': 1 },
                },
                opts,
            );
            expect(result.res).toEqual({ a: { b: 1 } });
        });

        it('rejects paths with conflicting map and list parents in one operation', async () => {
            await expect(
                target.update(
                    {
                        key: 'conflicting-parent',
                        pathAndValueMap: { 'a.b': 1, 'a[0]': 2 },
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('does not create indexed ancestors or sparse arrays', async () => {
            await target.set({ key: 'indexed-ancestor', value: [{}] }, opts);
            await expect(
                target.update(
                    {
                        key: 'indexed-ancestor',
                        pathAndValueMap: { '[4].x': 1 },
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
            expect(
                (await target.get({ key: 'indexed-ancestor' }, opts)).res,
            ).toEqual([{}]);
        });

        it.each([
            '[',
            'a[',
            'a[0',
            'a[]',
            'a[-1]',
            'a[1.5]',
            'a["unterminated]',
            "a['unterminated]",
            'a["x"',
            'a[0]tail',
        ])('rejects malformed path %s', async (path) => {
            await expect(
                target.update(
                    { key: 'bad-path', pathAndValueMap: { [path]: 1 } },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it.each(['__proto__', 'constructor', 'prototype'])(
            'rejects unsafe quoted path key %s in every path method',
            async (unsafeKey) => {
                const path = `["${unsafeKey}"]`;
                await expect(
                    target.incr(
                        { key: 'unsafe-incr', pathAndAmountMap: { [path]: 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                await expect(
                    target.decr(
                        { key: 'unsafe-decr', pathAndAmountMap: { [path]: 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                await expect(
                    target.update(
                        { key: 'unsafe-update', pathAndValueMap: { [path]: 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                await expect(
                    target.add(
                        { key: 'unsafe-add', pathAndValueMap: { [path]: 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                await expect(
                    target.remove(
                        { key: 'unsafe-remove', paths: [path] },
                        opts,
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );
    });

    describe('failed path writes', () => {
        it('leaves the value unchanged when one path can’t apply and another needs a new parent', async () => {
            const key = 'failed-write-mixed';
            await target.set({ key, value: { n: 5 } }, opts);
            await expect(
                target.update(
                    { key, pathAndValueMap: { 'x.y': 1, 'n.m': 2 } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'invalid_path',
                message: expect.stringContaining('`n.m`'),
            });
            await expect(
                target.update(
                    { key, pathAndValueMap: { 'x.y': 1, 'n.m': 2 } },
                    opts,
                ),
            ).rejects.toMatchObject({
                message: expect.not.stringContaining('x.y'),
            });
            expect((await target.get({ key }, opts)).res).toEqual({ n: 5 });
        });

        const freshness = ['fresh', 'expired'] as const;
        const badPaths = ['a[0].b', '[5].b'] as const;
        const methods = ['update', 'incr', 'add'] as const;
        const failedWriteCases = freshness.flatMap((f) =>
            badPaths.flatMap((p) => methods.map((m) => [f, p, m] as const)),
        );

        it.each(failedWriteCases)(
            '%s key: %s via %s writes nothing',
            async (state, badPath, method) => {
                const key = `failed-write-${state}-${badPath}-${method}`.replace(
                    /[^\w-]/g,
                    '_',
                );
                if (state === 'expired') {
                    await target.set(
                        {
                            key,
                            value: { z: 1 },
                            expireAt: Math.floor(Date.now() / 1000) - 10,
                        },
                        opts,
                    );
                }
                const run =
                    method === 'incr'
                        ? target.incr(
                              { key, pathAndAmountMap: { [badPath]: 1 } },
                              opts,
                          )
                        : method === 'add'
                          ? target.add(
                                { key, pathAndValueMap: { [badPath]: 1 } },
                                opts,
                            )
                          : target.update(
                                { key, pathAndValueMap: { [badPath]: 1 } },
                                opts,
                            );
                await expect(run).rejects.toMatchObject({
                    statusCode: 400,
                    code: 'invalid_path',
                });
                expect((await target.get({ key }, opts)).res).toBeNull();
                const raw = await server.clients.dynamo.get(
                    PUTER_KV_STORE_TABLE_NAME,
                    {
                        namespace: kvNamespace(
                            actor.user.uuid!,
                            KV_GLOBAL_APP_KEY,
                        ),
                        key,
                    },
                );
                expect(raw.Item).toBeUndefined();
            },
        );

        it('refuses a non-number before building a parent another path needs', async () => {
            const key = 'failed-write-type-mismatch';
            await target.set({ key, value: { n: 'text' } }, opts);
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
                    return real(...(args as Parameters<typeof real>));
                });
            try {
                await expect(
                    target.incr(
                        { key, pathAndAmountMap: { 'x.y': 1, n: 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    code: 'value_not_a_number',
                });
            } finally {
                update.mockRestore();
            }
            expect((await target.get({ key }, opts)).res).toEqual({
                n: 'text',
            });
        });

        it('bills the read that plans missing parents', async () => {
            const key = 'failed-write-bills-read';
            await target.set({ key, value: { marker: true } }, opts);
            const { usage } = await target.update(
                { key, pathAndValueMap: { 'a.b': 1 } },
                opts,
            );
            expect(usage.read).toBeGreaterThan(0);
        });

        it('keeps a write whose parents exist to one update and no read', async () => {
            const key = 'failed-write-no-read-needed';
            await target.set({ key, value: { marker: true } }, opts);
            const getSpy = vi.spyOn(server.clients.dynamo, 'get');
            const updateSpy = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await target.update(
                    { key, pathAndValueMap: { marker: 2 } },
                    opts,
                );
                expect(updateSpy).toHaveBeenCalledTimes(1);
                expect(getSpy).not.toHaveBeenCalled();
            } finally {
                getSpy.mockRestore();
                updateSpy.mockRestore();
            }
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

    describe('value shape', () => {
        const bigArray = Array(130_000).fill(0);

        it.each(['set', 'batchPut', 'update', 'add'] as const)(
            '%s stores an array too long to spread into one call',
            async (method) => {
                const key = `big-array-${method}`;
                if (method === 'set') {
                    await target.set({ key, value: bigArray }, opts);
                } else if (method === 'batchPut') {
                    await target.batchPut(
                        { items: [{ key, value: bigArray }] },
                        opts,
                    );
                } else if (method === 'update') {
                    await target.update(
                        { key, pathAndValueMap: { list: bigArray } },
                        opts,
                    );
                } else {
                    await target.add(
                        { key, pathAndValueMap: { '': bigArray } },
                        opts,
                    );
                }
                const result = await target.get({ key }, opts);
                const stored =
                    method === 'update'
                        ? (result.res as { list: unknown[] }).list
                        : (result.res as unknown[]);
                expect(stored.length).toBe(130_000);
            },
        );

        const nest = (d: number): unknown => (d === 0 ? 1 : { a: nest(d - 1) });

        it('set accepts a value nested 32 levels deep counting itself', async () => {
            const result = await target.set(
                { key: 'nest-32', value: nest(31) },
                opts,
            );
            expect(result.res).toBe(true);
        });

        it('set rejects a value nested deeper than 32 levels before writing', async () => {
            const put = vi.spyOn(server.clients.dynamo, 'put');
            try {
                await expect(
                    target.set({ key: 'nest-33', value: nest(32) }, opts),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                expect(put).not.toHaveBeenCalled();
            } finally {
                put.mockRestore();
            }
        });

        it('rejects a value nested thousands of levels deep with bad_request, not a crash', async () => {
            // Built in a loop: deep enough that a recursive walk overflows the stack.
            let deep: unknown = 1;
            for (let i = 0; i < 10_000; i++) deep = { a: deep };
            for (const write of [
                () => target.set({ key: 'nest-huge', value: deep }, opts),
                () =>
                    target.update(
                        { key: 'nest-huge', pathAndValueMap: { a: deep } },
                        opts,
                    ),
            ]) {
                await expect(write()).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
            }
        });

        it('update rejects a value that would sit past 32 levels at its path', async () => {
            const key = 'nest-update-too-deep';
            const path = Array.from({ length: 30 }, (_, i) => `a${i}`).join(
                '.',
            );
            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await expect(
                    target.update(
                        { key, pathAndValueMap: { [path]: { a: { b: 1 } } } },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                expect(update).not.toHaveBeenCalled();
            } finally {
                update.mockRestore();
            }
            expect((await target.get({ key }, opts)).res).toBeNull();
        });

        it('update accepts a value that reaches exactly 32 levels at its path', async () => {
            const path = Array.from({ length: 30 }, (_, i) => `a${i}`).join(
                '.',
            );
            const result = await target.update(
                { key: 'nest-update-ok', pathAndValueMap: { [path]: 1 } },
                opts,
            );
            expect(result.res).toBeTruthy();
        });

        it('add rejects an element that would sit past 32 levels', async () => {
            const path = Array.from({ length: 31 }, (_, i) => `a${i}`).join(
                '.',
            );
            await expect(
                target.add(
                    { key: 'nest-add-too-deep', pathAndValueMap: { [path]: 'x' } },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
        });

        describe('nesting refused by the store', () => {
            const nestingErr = () =>
                Object.assign(
                    new Error(
                        'Nesting Levels have exceeded supported limits: Attributes in the item have nested levels beyond supported limit',
                    ),
                    { name: 'ValidationException' },
                );
            const plainMessage = expect.not.stringMatching(
                /document path|UpdateExpression|ValidationException|Nesting Levels|attribute name|#value|#p\d/i,
            );

            it("set turns the store's nesting refusal into a plain bad_request", async () => {
                const put = vi
                    .spyOn(server.clients.dynamo, 'put')
                    .mockRejectedValueOnce(nestingErr());
                try {
                    await expect(
                        target.set(
                            { key: 'nest-classify-set', value: { a: 1 } },
                            opts,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        legacyCode: 'bad_request',
                        message: plainMessage,
                    });
                } finally {
                    put.mockRestore();
                }
            });

            it("batchPut turns the store's nesting refusal into a plain bad_request", async () => {
                const batchPut = vi
                    .spyOn(server.clients.dynamo, 'batchPut')
                    .mockRejectedValueOnce(nestingErr());
                try {
                    await expect(
                        target.batchPut(
                            {
                                items: [
                                    { key: 'nest-classify-batch', value: { a: 1 } },
                                ],
                            },
                            opts,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        legacyCode: 'bad_request',
                        message: plainMessage,
                    });
                } finally {
                    batchPut.mockRestore();
                }
            });

            it("update turns the store's nesting refusal into a plain bad_request without building paths", async () => {
                const key = 'nest-classify-update';
                await target.set({ key, value: { marker: true } }, opts);
                const real = server.clients.dynamo.update.bind(
                    server.clients.dynamo,
                );
                const update = vi
                    .spyOn(server.clients.dynamo, 'update')
                    .mockImplementation((...args) => {
                        const expression = String(args[2]);
                        if (expression.includes(':value'))
                            return Promise.reject(nestingErr());
                        return real(...(args as Parameters<typeof real>));
                    });
                try {
                    await expect(
                        target.update(
                            { key, pathAndValueMap: { 'a.b': 1 } },
                            opts,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        legacyCode: 'bad_request',
                        message: plainMessage,
                    });
                    expect(update).toHaveBeenCalledTimes(1);
                } finally {
                    update.mockRestore();
                }
            });
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

        it('refuses update and add on a private entry before any write', async () => {
            await target.set(
                { key: 'secret-doc', value: { a: {} }, disableSharing: true },
                { actor, appUuid: 'app-other' },
            );
            const update = vi.spyOn(server.clients.dynamo, 'update');
            try {
                await expect(
                    target.update(
                        { key: 'secret-doc', pathAndValueMap: { 'a.b': 1 } },
                        crossOpts,
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
                await expect(
                    target.add(
                        { key: 'secret-doc', pathAndValueMap: { 'a.c': 1 } },
                        crossOpts,
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
                expect(update).not.toHaveBeenCalled();
            } finally {
                update.mockRestore();
            }
        });

        it('treats an expired private entry as missing', async () => {
            const past = Math.floor(Date.now() / 1000) - 10;
            await target.set(
                {
                    key: 'expired-secret',
                    value: 'v',
                    disableSharing: true,
                    expireAt: past,
                },
                { actor, appUuid: 'app-other' },
            );
            const result = await target.incr(
                { key: 'expired-secret', pathAndAmountMap: { '': 1 } },
                crossOpts,
            );
            expect(result.res).toBe(1);
        });

        it('re-checks a stale expired-private read before letting a cross-app write through', async () => {
            // The row is genuinely live and private.
            await target.set(
                { key: 'racy-secret', value: 'v', disableSharing: true },
                { actor, appUuid: 'app-other' },
            );
            const real = server.clients.dynamo.get.bind(server.clients.dynamo);
            const get = vi
                .spyOn(server.clients.dynamo, 'get')
                .mockImplementation(async (...args) => {
                    const [, , consistentRead] = args as [
                        string,
                        Record<string, unknown>,
                        boolean?,
                    ];
                    const response = await real(...args);
                    if (!consistentRead && response.Item) {
                        // Simulate a stale eventually-consistent read: it
                        // still sees the old (now-past) TTL.
                        return {
                            ...response,
                            Item: {
                                ...response.Item,
                                ttl: Math.floor(Date.now() / 1000) - 10,
                            },
                        };
                    }
                    return response;
                });
            try {
                await expect(
                    target.incr(
                        { key: 'racy-secret', pathAndAmountMap: { '': 1 } },
                        crossOpts,
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
            } finally {
                get.mockRestore();
            }
        });

        it('re-checks a stale expired-private read before letting a cross-app batch write through', async () => {
            const namespace = kvNamespace(actor.user.uuid!, 'app-other');
            const now = Math.floor(Date.now() / 1000);
            const batchGet = vi
                .spyOn(server.clients.dynamo, 'batchGet')
                .mockImplementation(async (_params, consistentRead) => ({
                    Responses: {
                        [PUTER_KV_STORE_TABLE_NAME]: [
                            {
                                namespace,
                                key: 'racy-secret-batch',
                                value: 's',
                                noShare: true,
                                // Only the eventually-consistent read is stale.
                                ...(consistentRead ? {} : { ttl: now - 10 }),
                            },
                        ],
                    },
                    ConsumedCapacity: [],
                }));
            try {
                await expect(
                    target.batchPut(
                        {
                            items: [
                                { key: 'ok', value: 1 },
                                { key: 'racy-secret-batch', value: 2 },
                            ],
                        },
                        crossOpts,
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
            } finally {
                batchGet.mockRestore();
            }
        });
    });

    describe('take', () => {
        it('returns the value to exactly one caller, null after', async () => {
            await target.set({ key: 'claim-me', value: { by: 'me' } }, opts);

            const first = await target.take({ key: 'claim-me' }, opts);
            expect(first.res).toEqual({ by: 'me' });

            // The delete IS the claim — a second taker finds nothing, which
            // is what lets racing flushers send a queued item exactly once.
            const second = await target.take({ key: 'claim-me' }, opts);
            expect(second.res).toBeNull();
            const { res } = await target.get({ key: 'claim-me' }, opts);
            expect(res).toBeNull();
        });
    });

    const namespaceOf = (a: Actor) =>
        kvNamespace(a.user.uuid!, KV_GLOBAL_APP_KEY);

    describe('writes to an expired row that has not been swept', () => {
        const past = () => Math.floor(Date.now() / 1000) - 10;

        it('incr starts from zero on an expired counter and drops its TTL', async () => {
            await target.set(
                { key: 'expiredCounter', value: 5, expireAt: past() },
                opts,
            );
            const result = await target.incr(
                { key: 'expiredCounter', pathAndAmountMap: { '': 1 } },
                opts,
            );
            expect(result.res).toBe(1);
            const got = await target.get({ key: 'expiredCounter' }, opts);
            expect(got.res).toBe(1);
            const listed = await target.list({ as: 'entries' }, opts);
            expect(listed.res).toContainEqual({
                key: 'expiredCounter',
                value: 1,
            });
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'expiredCounter' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
        });

        it('incr starts from zero on an expired value that holds text', async () => {
            await target.set(
                { key: 'expiredText', value: 'hello', expireAt: past() },
                opts,
            );
            const result = await target.incr(
                { key: 'expiredText', pathAndAmountMap: { '': 1 } },
                opts,
            );
            expect(result.res).toBe(1);
        });

        it('incr starts a fresh object on an expired record', async () => {
            await target.set(
                { key: 'expiredRecord', value: 'stale', expireAt: past() },
                opts,
            );
            const result = await target.incr(
                { key: 'expiredRecord', pathAndAmountMap: { hits: 1 } },
                opts,
            );
            expect(result.res).toMatchObject({ hits: 1 });
        });

        it('decr starts from zero on an expired counter', async () => {
            await target.set(
                { key: 'expiredDecr', value: 5, expireAt: past() },
                opts,
            );
            const result = await target.decr(
                { key: 'expiredDecr', pathAndAmountMap: { '': 1 } },
                opts,
            );
            expect(result.res).toBe(-1);
        });

        it('add starts a fresh array on an expired key', async () => {
            await target.set(
                { key: 'expiredList', value: ['x'], expireAt: past() },
                opts,
            );
            const result = await target.add(
                { key: 'expiredList', pathAndValueMap: { '': ['y'] } },
                opts,
            );
            expect(result.res).toEqual(['y']);
        });

        it('update builds from empty on an expired key', async () => {
            await target.set(
                {
                    key: 'expiredUpdate',
                    value: { a: 1, b: 2 },
                    expireAt: past(),
                },
                opts,
            );
            const result = await target.update(
                { key: 'expiredUpdate', pathAndValueMap: { a: 5 } },
                opts,
            );
            expect(result.res).toEqual({ a: 5 });
            const got = await target.get({ key: 'expiredUpdate' }, opts);
            expect(got.res).toEqual({ a: 5 });
        });

        it('remove on an expired key resolves null', async () => {
            await target.set(
                { key: 'expiredRemove', value: { a: 1 }, expireAt: past() },
                opts,
            );
            const result = await target.remove(
                { key: 'expiredRemove', paths: ['a'] },
                opts,
            );
            expect(result.res).toBeNull();
        });

        it('expire on an expired key makes an empty marker instead of reviving the value', async () => {
            await target.set(
                { key: 'expireAgain', value: 'old', expireAt: past() },
                opts,
            );
            await target.expire({ key: 'expireAgain', ttl: 60 }, opts);
            const got = await target.get({ key: 'expireAgain' }, opts);
            expect(got.res).toBeNull();
            const listed = await target.list({ as: 'entries' }, opts);
            expect(listed.res).toContainEqual({
                key: 'expireAgain',
                value: null,
            });
        });

        it('expireAt on an expired key makes an empty marker instead of reviving the value', async () => {
            await target.set(
                { key: 'expireAtAgain', value: 'old', expireAt: past() },
                opts,
            );
            const future = Math.floor(Date.now() / 1000) + 60;
            await target.expireAt(
                { key: 'expireAtAgain', timestamp: future },
                opts,
            );
            const got = await target.get({ key: 'expireAtAgain' }, opts);
            expect(got.res).toBeNull();
        });

        it('an internal incr stamps a fresh TTL on an expired counter', async () => {
            await target.set(
                { key: 'expiredWithTtl', value: 5, expireAt: past() },
                opts,
            );
            const future = Math.floor(Date.now() / 1000) + 3600;
            await target.incr(
                {
                    key: 'expiredWithTtl',
                    pathAndAmountMap: { '': 1 },
                    expireAt: future,
                },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'expiredWithTtl' },
            );
            expect(raw.Item?.ttl).toBe(future);
        });

        it('counts every concurrent incr on an expired counter', async () => {
            await target.set(
                { key: 'expiredConcurrent', value: 100, expireAt: past() },
                opts,
            );
            const results = await Promise.all(
                Array.from({ length: 5 }, () =>
                    target.incr(
                        {
                            key: 'expiredConcurrent',
                            pathAndAmountMap: { '': 1 },
                        },
                        opts,
                    ),
                ),
            );
            const sorted = results
                .map((r) => r.res as number)
                .sort((a, b) => a - b);
            expect(sorted).toEqual([1, 2, 3, 4, 5]);
            const got = await target.get({ key: 'expiredConcurrent' }, opts);
            expect(got.res).toBe(5);
        });

        it('does not drop a row another writer revived during the reset', async () => {
            const key = 'revivedDuringReset';
            await target.set({ key, value: 5, expireAt: past() }, opts);

            const real = server.clients.dynamo.del.bind(server.clients.dynamo);
            const del = vi
                .spyOn(server.clients.dynamo, 'del')
                .mockImplementation(async (...args: Parameters<typeof real>) => {
                    await target.set({ key, value: 10 }, opts);
                    return real(...args);
                });
            try {
                const result = await target.incr(
                    { key, pathAndAmountMap: { '': 1 } },
                    opts,
                );
                expect(result.res).toBe(11);
            } finally {
                del.mockRestore();
            }
        });

        it('keeps a single write for a live row', async () => {
            await target.set({ key: 'liveRow', value: 1 }, opts);
            const update = vi.spyOn(server.clients.dynamo, 'update');
            const del = vi.spyOn(server.clients.dynamo, 'del');
            try {
                await target.incr(
                    { key: 'liveRow', pathAndAmountMap: { '': 1 } },
                    opts,
                );
                expect(update).toHaveBeenCalledTimes(1);
                expect(del).not.toHaveBeenCalled();
            } finally {
                update.mockRestore();
                del.mockRestore();
            }
        });

        it('bills the refused attempt and the reset', async () => {
            await target.set({ key: 'liveBill', value: 1 }, opts);
            const liveResult = await target.incr(
                { key: 'liveBill', pathAndAmountMap: { '': 1 } },
                opts,
            );

            await target.set(
                { key: 'expiredBill', value: 1, expireAt: past() },
                opts,
            );
            const expiredResult = await target.incr(
                { key: 'expiredBill', pathAndAmountMap: { '': 1 } },
                opts,
            );

            expect(expiredResult.usage.write).toBeGreaterThan(
                liveResult.usage.write,
            );
        });

        it('gives up after MAX_LIVE_WRITE_ATTEMPTS and throws a retryable 503', async () => {
            await target.set({ key: 'exhausted', value: 1 }, opts);
            const refused = Object.assign(
                new Error('conditional check failed'),
                { name: 'ConditionalCheckFailedException' },
            );
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockRejectedValue(refused);
            try {
                await expect(
                    target.incr(
                        { key: 'exhausted', pathAndAmountMap: { '': 1 } },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 503,
                    legacyCode: 'response_timeout',
                    // A caller-triggered refusal, not a server fault — must
                    // not page.
                    noAlarm: true,
                });
            } finally {
                update.mockRestore();
            }
        });

        it('recovers when a row expires between createPaths steps', async () => {
            const key = 'expiresBetweenCreatePaths';
            const real = server.clients.dynamo.update.bind(
                server.clients.dynamo,
            );
            let injectedOnce = false;
            const update = vi
                .spyOn(server.clients.dynamo, 'update')
                .mockImplementation(async (...args) => {
                    const expression = args[2] as string;
                    // Just before createPaths' root write runs, simulate
                    // another writer expiring the row in the gap.
                    if (
                        !injectedOnce &&
                        expression ===
                            'SET #value = if_not_exists(#value, :nestedMap)'
                    ) {
                        injectedOnce = true;
                        await target.set(
                            {
                                key,
                                value: 'raced-in',
                                expireAt: Math.floor(Date.now() / 1000) - 10,
                            },
                            opts,
                        );
                    }
                    return real(...(args as Parameters<typeof real>));
                });
            try {
                const result = await target.incr(
                    { key, pathAndAmountMap: { 'a.b.c': 2 } },
                    opts,
                );
                expect(result.res).toMatchObject({ a: { b: { c: 2 } } });
            } finally {
                update.mockRestore();
            }
        });
    });

    describe('ttl storage', () => {
        it('set with a null expireAt stores no TTL, so list shows the key', async () => {
            await target.set(
                { key: 'nullTtl', value: 'v', expireAt: null },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'nullTtl' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).toContain('nullTtl');
        });

        it('set with an expireAt of 0 stores no TTL', async () => {
            await target.set(
                { key: 'zeroTtl', value: 'v', expireAt: 0 },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'zeroTtl' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
        });

        it('set with a past expireAt stores an expired key', async () => {
            const past = Math.floor(Date.now() / 1000) - 100;
            await target.set(
                { key: 'pastTtl', value: 'v', expireAt: past },
                opts,
            );
            const got = await target.get({ key: 'pastTtl' }, opts);
            expect(got.res).toBeNull();
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).not.toContain('pastTtl');
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'pastTtl' },
            );
            expect(raw.Item?.ttl as number).toBeGreaterThan(0);
        });

        it('batchPut with a null expireAt stores no TTL', async () => {
            await target.batchPut(
                {
                    items: [
                        { key: 'bpNullTtl', value: 'v', expireAt: null },
                    ],
                },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'bpNullTtl' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
        });

        it('get and list agree on legacy rows whose ttl is null or 0', async () => {
            const namespace = namespaceOf(actor);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyNull',
                value: 'a',
                ttl: null,
            });
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyZero',
                value: 'b',
                ttl: 0,
            });

            const gotNull = await target.get({ key: 'legacyNull' }, opts);
            const gotZero = await target.get({ key: 'legacyZero' }, opts);
            expect(gotNull.res).toBe('a');
            expect(gotZero.res).toBe('b');

            const listed = await target.list(
                { as: 'entries', pattern: 'legacy', includeTotal: true },
                opts,
            );
            expect(listed.res).toMatchObject({
                items: expect.arrayContaining([
                    { key: 'legacyNull', value: 'a' },
                    { key: 'legacyZero', value: 'b' },
                ]),
                total: 2,
            });
        });

        it('update with a null ttl removes the TTL', async () => {
            const future = Math.floor(Date.now() / 1000) + 3600;
            await target.set(
                {
                    key: 'updateRemoveTtl',
                    value: { a: 1 },
                    expireAt: future,
                },
                opts,
            );
            await target.update(
                {
                    key: 'updateRemoveTtl',
                    pathAndValueMap: { a: 2 },
                    ttl: null,
                },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'updateRemoveTtl' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
            const got = await target.get({ key: 'updateRemoveTtl' }, opts);
            expect(got.res).toEqual({ a: 2 });
        });

        it('expireAt 0 expires the key', async () => {
            await target.set({ key: 'expireAtZero', value: 'v' }, opts);
            await target.expireAt(
                { key: 'expireAtZero', timestamp: 0 },
                opts,
            );
            const got = await target.get({ key: 'expireAtZero' }, opts);
            expect(got.res).toBeNull();
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).not.toContain('expireAtZero');
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'expireAtZero' },
            );
            expect(raw.Item?.ttl as number).toBeGreaterThan(0);
        });

        it('a legacy row with a future string ttl is readable by get and list', async () => {
            const namespace = namespaceOf(actor);
            const future = String(Math.floor(Date.now() / 1000) + 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringFuture',
                value: 'a',
                ttl: future,
            });
            const got = await target.get({ key: 'legacyStringFuture' }, opts);
            expect(got.res).toBe('a');
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).toContain('legacyStringFuture');
        });

        it('a legacy row with a past numeric-string ttl reads null in get and list', async () => {
            const namespace = namespaceOf(actor);
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringPast',
                value: 'b',
                ttl: past,
            });
            const got = await target.get({ key: 'legacyStringPast' }, opts);
            expect(got.res).toBeNull();
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).not.toContain('legacyStringPast');
        });

        it('a legacy row with a non-numeric string ttl is readable by get and list', async () => {
            const namespace = namespaceOf(actor);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringGarbage',
                value: 'c',
                ttl: 'not-a-number',
            });
            const got = await target.get({ key: 'legacyStringGarbage' }, opts);
            expect(got.res).toBe('c');
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).toContain('legacyStringGarbage');
        });

        it('incr on a legacy expired string-ttl row starts from zero, and get agrees', async () => {
            const namespace = namespaceOf(actor);
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringIncr',
                value: 5,
                ttl: past,
            });
            const result = await target.incr(
                { key: 'legacyStringIncr', pathAndAmountMap: { '': 1 } },
                opts,
            );
            expect(result.res).toBe(1);
            const got = await target.get({ key: 'legacyStringIncr' }, opts);
            expect(got.res).toBe(1);
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace, key: 'legacyStringIncr' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
        });

        it('incr on a legacy future string-ttl row keeps its value and stores the expiry as a number', async () => {
            const namespace = namespaceOf(actor);
            const future = String(Math.floor(Date.now() / 1000) + 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringIncrFuture',
                value: 5,
                ttl: future,
            });
            const result = await target.incr(
                {
                    key: 'legacyStringIncrFuture',
                    pathAndAmountMap: { '': 1 },
                },
                opts,
            );
            expect(result.res).toBe(6);
            const got = await target.get(
                { key: 'legacyStringIncrFuture' },
                opts,
            );
            expect(got.res).toBe(6);
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace, key: 'legacyStringIncrFuture' },
            );
            expect(raw.Item?.ttl).toBe(Number(future));
            expect(typeof raw.Item?.ttl).toBe('number');
        });

        it('incr on a legacy row whose ttl is true starts from zero', async () => {
            const namespace = namespaceOf(actor);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyBooleanIncr',
                value: 5,
                ttl: true,
            });
            const result = await target.incr(
                { key: 'legacyBooleanIncr', pathAndAmountMap: { '': 1 } },
                opts,
            );
            expect(result.res).toBe(1);
            const got = await target.get({ key: 'legacyBooleanIncr' }, opts);
            expect(got.res).toBe(1);
        });

        it('update on a legacy expired string-ttl row doesn’t bring back its old fields', async () => {
            const namespace = namespaceOf(actor);
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringUpdate',
                value: { a: 1, b: 2 },
                ttl: past,
            });
            const result = await target.update(
                {
                    key: 'legacyStringUpdate',
                    pathAndValueMap: { a: 5 },
                    ttl: 60,
                },
                opts,
            );
            expect(result.res).toEqual({ a: 5 });
            const got = await target.get({ key: 'legacyStringUpdate' }, opts);
            expect(got.res).toEqual({ a: 5 });
        });

        it('expire on a legacy expired string-ttl row makes an empty marker', async () => {
            const namespace = namespaceOf(actor);
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringExpire',
                value: 'old',
                ttl: past,
            });
            await target.expire(
                { key: 'legacyStringExpire', ttl: 60 },
                opts,
            );
            const got = await target.get({ key: 'legacyStringExpire' }, opts);
            expect(got.res).toBeNull();
        });

        it('remove on a legacy expired string-ttl row resolves null', async () => {
            const namespace = namespaceOf(actor);
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyStringRemove',
                value: { a: 1 },
                ttl: past,
            });
            const result = await target.remove(
                { key: 'legacyStringRemove', paths: ['a'] },
                opts,
            );
            expect(result.res).toBeNull();
        });

        it('a write to a legacy row with a non-numeric ttl keeps it readable and drops the ttl', async () => {
            const namespace = namespaceOf(actor);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key: 'legacyGarbageWrite',
                value: { a: 1 },
                ttl: 'not-a-number',
            });
            const result = await target.update(
                { key: 'legacyGarbageWrite', pathAndValueMap: { b: 2 } },
                opts,
            );
            expect(result.res).toEqual({ a: 1, b: 2 });
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace, key: 'legacyGarbageWrite' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
        });

        it('does not delete a legacy row whose ttl changed after it was read', async () => {
            const key = 'legacyTtlRace';
            const namespace = namespaceOf(actor);
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key,
                value: 5,
                ttl: past,
            });
            const real = server.clients.dynamo.del.bind(
                server.clients.dynamo,
            );
            const del = vi
                .spyOn(server.clients.dynamo, 'del')
                .mockImplementation(
                    async (...args: Parameters<typeof real>) => {
                        const condition = args[2]?.condition?.expression;
                        if (condition?.includes(':legacyTtl')) {
                            await target.set({ key, value: 10 }, opts);
                        }
                        return real(...args);
                    },
                );
            try {
                const result = await target.incr(
                    { key, pathAndAmountMap: { '': 1 } },
                    opts,
                );
                expect(result.res).toBe(11);
            } finally {
                del.mockRestore();
            }
            const got = await target.get({ key }, opts);
            expect(got.res).toBe(11);
        });

        it('includeTotal agrees with the listed items once a write has settled a legacy expired row', async () => {
            const namespace = namespaceOf(actor);
            const pattern = 'legacyTotalAgree';
            const key = `${pattern}Key`;
            const past = String(Math.floor(Date.now() / 1000) - 3600);
            await server.clients.dynamo.put(PUTER_KV_STORE_TABLE_NAME, {
                namespace,
                key,
                value: 5,
                ttl: past,
            });
            await target.incr({ key, pathAndAmountMap: { '': 1 } }, opts);
            const listed = await target.list(
                { as: 'keys', pattern, includeTotal: true },
                opts,
            );
            expect(listed.res).toMatchObject({ items: [key], total: 1 });
        });

        it.each([
            ['null', null],
            ['0', 0],
            ['an empty string', ''],
            ['false', false],
        ])(
            'an internal incr with a %s expireAt stores no TTL',
            async (_label, expireAt) => {
                const key = `internalIncrNoTtl${String(expireAt)}`;
                const result = await target.incr(
                    {
                        key,
                        pathAndAmountMap: { '': 1 },
                        expireAt: expireAt as unknown as number,
                    },
                    opts,
                );
                expect(result.res).toBe(1);
                const got = await target.get({ key }, opts);
                expect(got.res).toBe(1);
                const raw = await server.clients.dynamo.get(
                    PUTER_KV_STORE_TABLE_NAME,
                    { namespace: namespaceOf(actor), key },
                );
                expect(raw.Item?.ttl).toBeUndefined();
            },
        );

        it.each([
            ['text', 'soon'],
            ['Infinity', Infinity],
        ])(
            'an internal incr rejects %s as expireAt',
            async (_label, expireAt) => {
                await expect(
                    target.incr(
                        {
                            key: 'internalIncrBadExpireAt',
                            pathAndAmountMap: { '': 1 },
                            expireAt: expireAt as unknown as number,
                        },
                        opts,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
            },
        );

        it.each([
            ['expireAt', Number.NaN],
            ['expireAt', 'soon'],
            ['expire', Number.NaN],
            ['expire', undefined],
        ] as const)(
            '%s rejects %s and keeps the TTL',
            async (method, badValue) => {
                const key = `keepsTtl-${method}-${String(badValue)}`;
                const future = Math.floor(Date.now() / 1000) + 3600;
                await target.set(
                    { key, value: 'v', expireAt: future },
                    opts,
                );
                const run =
                    method === 'expireAt'
                        ? target.expireAt(
                              {
                                  key,
                                  timestamp: badValue as unknown as number,
                              },
                              opts,
                          )
                        : target.expire(
                              { key, ttl: badValue as unknown as number },
                              opts,
                          );
                await expect(run).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                });
                const raw = await server.clients.dynamo.get(
                    PUTER_KV_STORE_TABLE_NAME,
                    { namespace: namespaceOf(actor), key },
                );
                expect(raw.Item?.ttl).toBe(future);
            },
        );

        it.each([
            ['an empty string', ''],
            ['false', false],
        ])('update with %s as ttl keeps the stored TTL', async (_label, ttl) => {
            const key = `updateKeepsTtl${_label}`.replace(/[^\w-]/g, '_');
            const future = Math.floor(Date.now() / 1000) + 3600;
            await target.set(
                { key, value: { a: 1 }, expireAt: future },
                opts,
            );
            await target.update(
                { key, pathAndValueMap: { a: 2 }, ttl: ttl as unknown as number },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key },
            );
            expect(raw.Item?.ttl).toBe(future);
            const got = await target.get({ key }, opts);
            expect(got.res).toEqual({ a: 2 });
        });

        it.each([
            ['true', true],
            ['an array', [5]],
            ['text', 'soon'],
            ['Infinity', Infinity],
        ])('update rejects %s as ttl with ttl_invalid', async (_label, ttl) => {
            await expect(
                target.update(
                    {
                        key: 'updateBadTtl',
                        pathAndValueMap: { a: 1 },
                        ttl: ttl as unknown as number,
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400, code: 'ttl_invalid' });
        });

        it('update reads a numeric-string ttl as seconds', async () => {
            const key = 'updateNumericStringTtl';
            const before = Math.floor(Date.now() / 1000);
            await target.update(
                {
                    key,
                    pathAndValueMap: { a: 1 },
                    ttl: '60' as unknown as number,
                },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key },
            );
            expect(typeof raw.Item?.ttl).toBe('number');
            expect(raw.Item?.ttl as number).toBeGreaterThanOrEqual(
                before + 59,
            );
            expect(raw.Item?.ttl as number).toBeLessThanOrEqual(before + 65);
        });

        it('set with a numeric string expireAt stores a number TTL', async () => {
            const future = Math.floor(Date.now() / 1000) + 3600;
            await target.set(
                {
                    key: 'numericStringTtl',
                    value: 'v',
                    expireAt: String(future) as unknown as number,
                },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'numericStringTtl' },
            );
            expect(raw.Item?.ttl).toBe(future);
            expect(typeof raw.Item?.ttl).toBe('number');
        });

        it('set rejects a non-numeric expireAt', async () => {
            await expect(
                target.set(
                    {
                        key: 'badTtl',
                        value: 'v',
                        expireAt: 'abc' as unknown as number,
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        });

        it('set treats an empty string expireAt as no expiry', async () => {
            await target.set(
                { key: 'emptyStringTtl', value: 'v', expireAt: '' as unknown as number },
                opts,
            );
            const raw = await server.clients.dynamo.get(
                PUTER_KV_STORE_TABLE_NAME,
                { namespace: namespaceOf(actor), key: 'emptyStringTtl' },
            );
            expect(raw.Item?.ttl).toBeUndefined();
        });

        it('batchPut rejects a non-numeric expireAt', async () => {
            await expect(
                target.batchPut(
                    {
                        items: [
                            {
                                key: 'bpBadTtl',
                                value: 'v',
                                expireAt: 'abc' as unknown as number,
                            },
                        ],
                    },
                    opts,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
        });

        it.each([
            ['true', true],
            ['an array', [5]],
            ["the string 'Infinity'", 'Infinity'],
        ])('set rejects %s as expireAt', async (_label, expireAt) => {
            await expect(
                target.set(
                    {
                        key: 'badTtlType',
                        value: 'v',
                        expireAt: expireAt as unknown as number,
                    },
                    opts,
                ),
            ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        });
    });

    describe('expire on a missing key', () => {
        it('creates a null marker that list shows and get reads as null', async () => {
            await target.expire({ key: 'freshMarker', ttl: 60 }, opts);
            const got = await target.get({ key: 'freshMarker' }, opts);
            expect(got.res).toBeNull();
            const listed = await target.list({ as: 'entries' }, opts);
            expect(listed.res).toContainEqual({
                key: 'freshMarker',
                value: null,
            });
        });

        it('a marker whose time has already passed never shows up', async () => {
            await target.expire({ key: 'pastMarker', ttl: -10 }, opts);
            const got = await target.get({ key: 'pastMarker' }, opts);
            expect(got.res).toBeNull();
            const listed = await target.list({ as: 'keys' }, opts);
            expect(listed.res).not.toContain('pastMarker');
        });
    });
});
