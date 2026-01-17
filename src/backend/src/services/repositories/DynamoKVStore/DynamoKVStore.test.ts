import { Actor } from '@heyputer/backend/src/services/auth/Actor.js';
import { SUService } from '@heyputer/backend/src/services/SUService';
import { createTestKernel } from '@heyputer/backend/tools/test.mjs';
import { describe, expect, it } from 'vitest';
import { DynamoKVStore } from './DynamoKVStore.js';
import { DynamoKVStoreWrapper, IDynamoKVStoreWrapper } from './DynamoKVStoreWrapper.js';
import { config } from '../../../loadTestConfig.js';

describe('DynamoKVStore', async () => {
    const TABLE_NAME = 'store-kv-v1';

    const makeActor = (userId: number | string, appUid?: string) => ({
        type: {
            user: { id: userId, uuid: String(userId) },
            ...(appUid ? { app: { uid: appUid } } : {}),
        },
    }) as Actor;

    const testKernel = await createTestKernel({
        serviceMap: {
            'puter-kvstore': DynamoKVStoreWrapper,
        },
        initLevelString: 'init',
        testCore: true,
        serviceConfigOverrideMap: {
            'services': {
                'puter-kvstore': { tableName: TABLE_NAME },
            },
        },
    });

    const testSubject = testKernel.services!.get('puter-kvstore') as IDynamoKVStoreWrapper;
    const kvStore = testSubject.kvStore!;
    const su = testKernel.services!.get('su') as SUService;

    it('should be instantiated', () => {
        expect(testSubject).toBeInstanceOf(DynamoKVStoreWrapper);
    });

    it('should contain a copy of the public methods of DynamoKVStore too', () => {
        const meteringMethods = Object.getOwnPropertyNames(DynamoKVStore.prototype)
            .filter((name) => name !== 'constructor');
        const wrapperMethods = testSubject as unknown as Record<string, unknown>;
        const missing = meteringMethods.filter((name) => typeof wrapperMethods[name] !== 'function');

        expect(missing).toEqual([]);
    });

    it('should have DynamoKVStore instantiated', async () => {
        expect(testSubject.kvStore).toBeInstanceOf(DynamoKVStore);
    });
    it('sets and retrieves values for the current actor context', async () => {
        const actor = makeActor(1);
        const key = 'greeting';
        const value = { hello: 'world' };

        await su.sudo(actor, () => kvStore.set({ key, value }));
        const stored = await su.sudo(actor, () => kvStore.get({ key }));

        expect(stored).toEqual(value);
    });

    it('scopes data to the app when provided', async () => {
        const userId = 2;
        const actorAppOne = makeActor(userId, 'app-one');
        const actorAppTwo = makeActor(userId, 'app-two');
        const key = 'scoped-key';

        await su.sudo(actorAppOne, () => kvStore.set({ key, value: 'one' }));
        await su.sudo(actorAppTwo, () => kvStore.set({ key, value: 'two' }));

        const fromOne = await su.sudo(actorAppOne, () => kvStore.get({ key }));
        const fromTwo = await su.sudo(actorAppTwo, () => kvStore.get({ key }));

        expect(fromOne).toBe('one');
        expect(fromTwo).toBe('two');
    });

    it('increments nested numeric paths and persists the aggregated totals', async () => {
        const actor = makeActor(3);
        const key = 'counter-key';

        const first = await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'total': 5, 'nested.count': 2 },
        }));
        const second = await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'total': 1, 'nested.count': 3 },
        }));

        expect(first).toMatchObject({ total: 5, nested: { count: 2 } });
        expect(second).toMatchObject({ total: 6, nested: { count: 5 } });

        const persisted = await su.sudo(actor, () => kvStore.get({ key }));
        expect(persisted).toMatchObject({ total: 6, nested: { count: 5 } });
    });

    it('decrements numeric paths via decr and keeps values in sync', async () => {
        const actor = makeActor(4);
        const key = 'decr-key';

        await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { total: 5, 'nested.count': 4 },
        }));
        const afterDecr = await su.sudo(actor, () => kvStore.decr({
            key,
            pathAndAmountMap: { total: 2, 'nested.count': 1 },
        }));

        expect(afterDecr).toMatchObject({ total: 3, nested: { count: 3 } });

        const persisted = await su.sudo(actor, () => kvStore.get({ key }));
        expect(persisted).toMatchObject({ total: 3, nested: { count: 3 } });
    });

    it('deletes keys with del', async () => {
        const actor = makeActor(5);
        const key = 'delete-me';
        await su.sudo(actor, () => {
            return kvStore.set({ key, value: 'bye' });
        });

        const res = await su.sudo(actor, () => kvStore.del({ key }));
        const value = await su.sudo(actor, () => kvStore.get({ key }));

        expect(res).toBe(true);
        expect(value).toBeNull();
    });

    it('lists entries, keys, and values while omitting expired rows', async () => {
        const actor = makeActor(6);
        await su.sudo(actor, () => kvStore.set({ key: 'k1', value: 'v1' }));
        await su.sudo(actor, () => kvStore.set({ key: 'expired', value: 'gone', expireAt: Math.floor(Date.now() / 1000) - 10 }));

        const entries = await su.sudo(actor, () => kvStore.list({ as: 'entries' }));
        const keys = await su.sudo(actor, () => kvStore.list({ as: 'keys' }));
        const values = await su.sudo(actor, () => kvStore.list({ as: 'values' }));

        expect(entries).toEqual([{ key: 'k1', value: 'v1' }]);
        expect(keys).toEqual(['k1']);
        expect(values).toEqual(['v1']);
    });

    it('rejects invalid list selector', async () => {
        const actor = makeActor(7);
        expect(su.sudo(actor, () => kvStore.list({ as: 'bad' as never })))
            .rejects;
    });

    it('supports paginated list results with cursors', async () => {
        const actor = makeActor(71);
        await su.sudo(actor, () => kvStore.set({ key: 'a', value: 1 }));
        await su.sudo(actor, () => kvStore.set({ key: 'b', value: 2 }));
        await su.sudo(actor, () => kvStore.set({ key: 'c', value: 3 }));

        const firstPage = await su.sudo(actor, () => kvStore.list({ as: 'keys', limit: 2 })) as { items: string[]; cursor?: string };
        expect(firstPage.items).toHaveLength(2);
        expect(firstPage.cursor).toBeTypeOf('string');

        const secondPage = await su.sudo(actor, () => kvStore.list({ as: 'keys', limit: 2, cursor: firstPage.cursor })) as { items: string[]; cursor?: string };
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.cursor).toBeUndefined();

        const allKeys = [...firstPage.items, ...secondPage.items].sort();
        expect(allKeys).toEqual(['a', 'b', 'c']);
    });

    it('supports prefix pattern semantics', async () => {
        const actor = makeActor(72);
        const allKeys = [
            'abc',
            'abc123',
            'abc123xyz',
            'ab',
            'key*literal',
            'key*literal-2',
            'k*y',
            'k*y-extra',
            'other',
        ];

        await Promise.all(allKeys.map((key, idx) => su.sudo(actor, () => kvStore.set({ key, value: idx }))));

        const expectedAbc = ['abc', 'abc123', 'abc123xyz'];
        const expectedKeyStar = ['key*literal', 'key*literal-2'];
        const expectedMiddleStar = ['k*y', 'k*y-extra'];

        const abcKeys = await su.sudo(actor, () => kvStore.list({ as: 'keys', pattern: 'abc' })) as string[];
        expect([...abcKeys].sort()).toEqual([...expectedAbc].sort());

        const abcWildcardKeys = await su.sudo(actor, () => kvStore.list({ as: 'keys', pattern: 'abc*' })) as string[];
        expect([...abcWildcardKeys].sort()).toEqual([...expectedAbc].sort());

        const keyStarKeys = await su.sudo(actor, () => kvStore.list({ as: 'keys', pattern: 'key**' })) as string[];
        expect([...keyStarKeys].sort()).toEqual([...expectedKeyStar].sort());

        const middleStarKeys = await su.sudo(actor, () => kvStore.list({ as: 'keys', pattern: 'k*y*' })) as string[];
        expect([...middleStarKeys].sort()).toEqual([...expectedMiddleStar].sort());

        const allList = await su.sudo(actor, () => kvStore.list({ as: 'keys', pattern: '*' })) as string[];
        expect([...allList].sort()).toEqual([...allKeys].sort());
    });

    it('returns ordered values for arrays and null for expired keys', async () => {
        const actor = makeActor(8);
        const now = Math.floor(Date.now() / 1000);

        await su.sudo(actor, () => kvStore.set({ key: 'a', value: 1 }));
        await su.sudo(actor, () => kvStore.set({ key: 'b', value: 2, expireAt: now - 5 }));
        await su.sudo(actor, () => kvStore.set({ key: 'c', value: 3 }));

        const results = await su.sudo(actor, () => kvStore.get({ key: ['c', 'b', 'a'] }));

        expect(results).toEqual([3, null, 1]);
    });

    it('flush clears all keys for the actor/app combination', async () => {
        const actor = makeActor(9, 'flush-app');
        await su.sudo(actor, () => kvStore.set({ key: 'one', value: 1 }));
        await su.sudo(actor, () => kvStore.set({ key: 'two', value: 2 }));

        const res = await su.sudo(actor, () => kvStore.flush());
        const remaining = await su.sudo(actor, () => kvStore.list({ as: 'entries' }));

        expect(res).toBe(true);
        expect(remaining).toEqual([]);
    });

    it('expireAt and expire set timestamps that cause reads to return null', async () => {
        const actor = makeActor(10);
        const keyAt = 'expire-at';
        const keyTtl = 'expire-ttl';

        await su.sudo(actor, () => kvStore.set({ key: keyAt, value: 'keep' }));
        await su.sudo(actor, () => kvStore.set({ key: keyTtl, value: 'keep' }));

        await su.sudo(actor, () => kvStore.expireAt({ key: keyAt, timestamp: Math.floor(Date.now() / 1000) - 1 }));
        await su.sudo(actor, () => kvStore.expire({ key: keyTtl, ttl: -1 }));

        const valAt = await su.sudo(actor, () => kvStore.get({ key: keyAt }));
        const valTtl = await su.sudo(actor, () => kvStore.get({ key: keyTtl }));

        expect(valAt).toBeNull();
        expect(valTtl).toBeNull();
    });

    it('updates nested paths and creates missing maps', async () => {
        const actor = makeActor(12);
        const key = 'update-key';

        const updated = await su.sudo(actor, () => kvStore.update({
            key,
            pathAndValueMap: {
                'profile.name': 'Ada',
                'profile.stats.score': 7,
                'active': true,
            },
        }));

        expect(updated).toMatchObject({
            profile: { name: 'Ada', stats: { score: 7 } },
            active: true,
        });

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect(stored).toMatchObject({
            profile: { name: 'Ada', stats: { score: 7 } },
            active: true,
        });
    });

    it('update can set ttl for the whole object', async () => {
        const actor = makeActor(13);
        const key = 'update-ttl';

        await su.sudo(actor, () => kvStore.update({
            key,
            pathAndValueMap: { 'count': 1 },
            ttl: -1,
        }));

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect(stored).toBeNull();
    });

    it('supports list index paths when updating', async () => {
        const actor = makeActor(17);
        const key = 'update-list-index';

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: { b: [1, 2] } },
        }));

        const updated = await su.sudo(actor, () => kvStore.update({
            key,
            pathAndValueMap: { 'a.b[1]': 5 },
        }));

        expect((updated as { a?: { b?: number[] } }).a?.b).toEqual([1, 5]);

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect((stored as { a?: { b?: number[] } }).a?.b).toEqual([1, 5]);
    });

    it('adds values to nested lists and creates missing maps', async () => {
        const actor = makeActor(15);
        const key = 'add-key';

        const first = await su.sudo(actor, () => kvStore.add({
            key,
            pathAndValueMap: {
                'a.b': 1,
            },
        }));

        expect(first).toMatchObject({ a: { b: [1] } });

        const second = await su.sudo(actor, () => kvStore.add({
            key,
            pathAndValueMap: {
                'a.b': 2,
                'a.c': ['x', 'y'],
            },
        }));

        expect(second).toMatchObject({ a: { b: [1, 2], c: ['x', 'y'] } });

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect(stored).toMatchObject({ a: { b: [1, 2], c: ['x', 'y'] } });
    });

    it('supports list index paths when appending', async () => {
        const actor = makeActor(18);
        const key = 'add-list-index';

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: { b: [[1], [2]] } },
        }));

        const updated = await su.sudo(actor, () => kvStore.add({
            key,
            pathAndValueMap: { 'a.b[1]': 3 },
        }));

        expect((updated as { a?: { b?: number[][] } }).a?.b).toEqual([[1], [2, 3]]);

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect((stored as { a?: { b?: number[][] } }).a?.b).toEqual([[1], [2, 3]]);
    });

    it('supports nested list indexing for add, update, remove, and incr', async () => {
        const actor = makeActor(21);
        const key = 'nested-list-index';

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: [1, { b: { c: [1] } }, 2] },
        }));

        const added = await su.sudo(actor, () => kvStore.add({
            key,
            pathAndValueMap: { 'a[1].b.c': 2 },
        }));
        expect((added as { a?: Array<unknown> }).a).toEqual([1, { b: { c: [1, 2] } }, 2]);

        const updated = await su.sudo(actor, () => kvStore.update({
            key,
            pathAndValueMap: { 'a[1].b.c': [9] },
        }));
        expect((updated as { a?: Array<unknown> }).a).toEqual([1, { b: { c: [9] } }, 2]);

        const removed = await su.sudo(actor, () => kvStore.remove({
            key,
            paths: ['a[1].b.c'],
        }));
        expect((removed as { a?: Array<unknown> }).a).toEqual([1, { b: {} }, 2]);

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: [1, { b: { c: 1 } }, 2] },
        }));
        const incrRes = await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'a[1].b.c': 3 },
        }));
        expect((incrRes as { a?: Array<unknown> }).a).toEqual([1, { b: { c: 4 } }, 2]);
    });

    it('removes nested values including indexed list paths', async () => {
        const actor = makeActor(19);
        const key = 'remove-list-index';

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: { b: [1, 2, 3], c: { d: 4 }, e: 'keep' } },
        }));

        const updated = await su.sudo(actor, () => kvStore.remove({
            key,
            paths: ['a.b[1]', 'a.c'],
        }));

        expect((updated as { a?: { b?: number[]; e?: string } }).a).toEqual({ b: [1, 3], e: 'keep' });

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect((stored as { a?: { b?: number[]; e?: string } }).a).toEqual({ b: [1, 3], e: 'keep' });
    });

    it('rejects overlapping parent/child paths in a single request', async () => {
        const actor = makeActor(20);
        const key = 'overlap-paths';

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: { b: { c: 1 } } },
        }));

        await expect(su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'a.b': 1, 'a.b.c': 1 },
        }))).rejects.toThrow(/paths overlap/i);

        await expect(su.sudo(actor, () => kvStore.add({
            key,
            pathAndValueMap: { 'a.b': 1, 'a.b.c': 2 },
        }))).rejects.toThrow(/paths overlap/i);

        await expect(su.sudo(actor, () => kvStore.update({
            key,
            pathAndValueMap: { 'a.b': 1, 'a.b.c': 2 },
        }))).rejects.toThrow(/paths overlap/i);

        await expect(su.sudo(actor, () => kvStore.remove({
            key,
            paths: ['a.b', 'a.b.c'],
        }))).resolves.not.toThrow();
    });

    it('incr initializes nested maps for missing keys', async () => {
        const actor = makeActor(14);
        const key = 'incr-missing';

        const first = await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'a.b.c': 2, 'x': 1 },
        }));

        expect(first).toMatchObject({ a: { b: { c: 2 } }, x: 1 });

        const second = await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'a.b.c': 3 },
        }));

        expect(second).toMatchObject({ a: { b: { c: 5 } }, x: 1 });
    });

    it('supports list index paths when incrementing', async () => {
        const actor = makeActor(16);
        const key = 'incr-list-index';

        await su.sudo(actor, () => kvStore.set({
            key,
            value: { a: { b: [1, 2] } },
        }));

        const updated = await su.sudo(actor, () => kvStore.incr({
            key,
            pathAndAmountMap: { 'a.b[1]': 3 },
        }));

        expect((updated as { a?: { b?: number[] } }).a?.b).toEqual([1, 5]);

        const stored = await su.sudo(actor, () => kvStore.get({ key }));
        expect((stored as { a?: { b?: number[] } }).a?.b).toEqual([1, 5]);
    });

    it('enforces key and value size limits', async () => {
        const actor = makeActor(11);
        const oversizedKey = 'a'.repeat((config.kv_max_key_size as number) + 1);
        const oversizedValue = 'b'.repeat((config.kv_max_value_size as number) + 1);

        await expect(su.sudo(actor, () => kvStore.set({ key: oversizedKey, value: 'x' })))
            .rejects
            .toThrow(/1024/i);

        await expect(su.sudo(actor, () => kvStore.set({ key: 'ok', value: oversizedValue })))
            .rejects
            .toThrow(/has exceeded the maximum allowed size/i);
    });
});
