import { suite } from '../harness/types.ts';

export default suite('kv', {
    'set then get round-trips a string': async (t) => {
        t.assert.equal(await t.puter.kv.set('kv-suite-str', 'value'), true);
        t.assert.equal(await t.puter.kv.get('kv-suite-str'), 'value');
    },

    'set then get round-trips an object': async (t) => {
        await t.puter.kv.set('kv-suite-obj', { nested: { n: 1 } });
        t.assert.deepEqual(await t.puter.kv.get('kv-suite-obj'), {
            nested: { n: 1 },
        });
    },

    'set overwrites an existing value': async (t) => {
        await t.puter.kv.set('kv-suite-overwrite', 'first');
        await t.puter.kv.set('kv-suite-overwrite', 'second');
        t.assert.equal(await t.puter.kv.get('kv-suite-overwrite'), 'second');
    },

    'get of a missing key returns null': async (t) => {
        t.assert.equal(await t.puter.kv.get('kv-suite-missing'), null);
    },

    'batch set stores every item': async (t) => {
        await t.puter.kv.set([
            { key: 'kv-suite-batch-1', value: 'one' },
            { key: 'kv-suite-batch-2', value: 'two' },
            { key: 'kv-suite-batch-3', value: { three: 3 } },
        ]);
        t.assert.equal(await t.puter.kv.get('kv-suite-batch-1'), 'one');
        t.assert.equal(await t.puter.kv.get('kv-suite-batch-2'), 'two');
        t.assert.deepEqual(await t.puter.kv.get('kv-suite-batch-3'), {
            three: 3,
        });
    },

    'del removes a key': async (t) => {
        await t.puter.kv.set('kv-suite-del', 'x');
        t.assert.equal(await t.puter.kv.del('kv-suite-del'), true);
        t.assert.equal(await t.puter.kv.get('kv-suite-del'), null);
    },

    'del of a missing key still resolves': async (t) => {
        const res = await t.puter.kv.del('kv-suite-del-missing');
        t.assert.ok(res, 'del of a missing key should resolve truthy');
    },

    'incr counts up': async (t) => {
        t.assert.equal(await t.puter.kv.incr('kv-suite-counter'), 1);
        t.assert.equal(await t.puter.kv.incr('kv-suite-counter'), 2);
    },

    'incr by an amount adds that amount': async (t) => {
        await t.puter.kv.incr('kv-suite-incr-amount', 5);
        t.assert.equal(await t.puter.kv.incr('kv-suite-incr-amount', 10), 15);
    },

    'decr counts down': async (t) => {
        await t.puter.kv.incr('kv-suite-decr', 10);
        t.assert.equal(await t.puter.kv.decr('kv-suite-decr'), 9);
    },

    'update patches paths inside an object value': async (t) => {
        await t.puter.kv.set('kv-suite-update', {
            profile: { color: 'red', size: 'm' },
        });
        await t.puter.kv.update('kv-suite-update', { 'profile.color': 'blue' });
        const value = await t.puter.kv.get('kv-suite-update');
        t.assert.equal(value.profile.color, 'blue');
        t.assert.equal(value.profile.size, 'm');
    },

    'remove deletes paths inside an object value': async (t) => {
        await t.puter.kv.set('kv-suite-remove', { keep: 1, drop: 2 });
        await t.puter.kv.remove('kv-suite-remove', 'drop');
        const value = await t.puter.kv.get('kv-suite-remove');
        t.assert.equal(value.keep, 1);
        t.assert.equal(value.drop, undefined);
    },

    'expireAt in the past makes the key unreadable': async (t) => {
        await t.puter.kv.set('kv-suite-expired', 'stale');
        await t.puter.kv.expireAt(
            'kv-suite-expired',
            Math.floor(Date.now() / 1000) - 60,
        );
        t.assert.equal(await t.puter.kv.get('kv-suite-expired'), null);
    },

    'expire with a future ttl keeps the key readable': async (t) => {
        await t.puter.kv.set('kv-suite-expire-future', 'fresh');
        await t.puter.kv.expire('kv-suite-expire-future', 3600);
        t.assert.equal(await t.puter.kv.get('kv-suite-expire-future'), 'fresh');
    },

    'list returns keys matching a prefix pattern': async (t) => {
        await t.puter.kv.set('kv-suite-list-a', 1);
        await t.puter.kv.set('kv-suite-list-b', 2);
        await t.puter.kv.set('kv-suite-unrelated', 3);
        const keys = await t.puter.kv.list('kv-suite-list-*');
        t.assert.deepEqual(
            [...keys].sort(),
            ['kv-suite-list-a', 'kv-suite-list-b'],
        );
    },

    'list with returnValues returns key-value pairs': async (t) => {
        await t.puter.kv.set('kv-suite-pairs-x', 'val-x');
        const pairs = await t.puter.kv.list('kv-suite-pairs-*', true);
        t.assert.equal(pairs.length, 1);
        t.assert.equal(pairs[0].key, 'kv-suite-pairs-x');
        t.assert.equal(pairs[0].value, 'val-x');
    },

    'set rejects an oversized key client-side': async (t) => {
        const bigKey = 'k'.repeat(1025);
        await t.assert.rejects(
            () => t.puter.kv.set(bigKey, 'x'),
            'a >1KB key should be rejected',
        );
    },

    'set rejects an undefined key client-side': async (t) => {
        await t.assert.rejects(
            () =>
                (t.puter.kv.set as (k: unknown, v: unknown) => Promise<unknown>)(
                    undefined,
                    'x',
                ),
            'an undefined key should be rejected',
        );
    },
});
