import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestServer } from '../../testUtil.ts';
import type { SystemKVStore } from './SystemKVStore.ts';
import { PuterServer } from '../../server.ts';
import type { Actor } from '../../core/actor.ts';

describe('SystemKVStore', () => {
    let server: PuterServer;
    let target: SystemKVStore;

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.stores.kv;
    });

    afterAll(async () => {
        await server.shutdown();
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
            await expect(
                target.list({ limit: 0 }, opts),
            ).rejects.toMatchObject({ statusCode: 400 });
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
});
