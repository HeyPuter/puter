import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../../../tools/test.mjs';
import * as config from '../../../config';
import { Actor } from '../../auth/Actor';
import { MeteringServiceWrapper } from '../../MeteringService/MeteringServiceWrapper.mjs';
import { DBKVServiceWrapper } from './index.mjs';

describe('DBKVStore', async () => {

    config.load_config({
        'services': {
            'database': {
                path: ':memory:',
            },
        },
    });

    const testKernel = await createTestKernel({
        serviceMap: {
            meteringService: MeteringServiceWrapper,
            'puter-kvstore': DBKVServiceWrapper,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const kvServiceWrapper = testKernel.services!.get('puter-kvstore') as DBKVServiceWrapper;
    const kvStore = kvServiceWrapper.kvStore;
    const su = testKernel.services!.get('su');

    const makeActor = (userId: number | string, appUid?: string) => ({
        type: {
            user: { id: userId, uuid: String(userId) },
            ...(appUid ? { app: { uid: appUid } } : {}),
        },
    }) as unknown as Actor;

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
        await su.sudo(actor, () => kvStore.set({ key, value: 'bye' }));

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

    it('enforces key and value size limits', async () => {
        const actor = makeActor(11);
        const oversizedKey = 'a'.repeat((config.kv_max_key_size as number) + 1);
        const oversizedValue = 'b'.repeat((config.kv_max_value_size as number) + 1);

        await expect(su.sudo(actor, () => kvStore.set({ key: oversizedKey, value: 'x' })))
            .rejects
            .toThrow(/key is too large/i);

        await expect(su.sudo(actor, () => kvStore.set({ key: 'ok', value: oversizedValue })))
            .rejects
            .toThrow(/value is too large/i);
    });
});
