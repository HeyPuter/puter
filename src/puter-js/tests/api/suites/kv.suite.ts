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

    'list with includeTotal reports the total for the pattern': async (t) => {
        for (const k of [
            'kv-suite-tot-a',
            'kv-suite-tot-b',
            'kv-suite-tot-c',
        ]) {
            await t.puter.kv.set(k, 1);
        }
        const page = (await t.puter.kv.list({
            pattern: 'kv-suite-tot-*',
            limit: 1,
            includeTotal: true,
        })) as { items: string[]; total?: number };
        t.assert.equal(page.items.length, 1);
        t.assert.equal(page.total, 3);
    },

    'list with offset skips ahead': async (t) => {
        for (const k of [
            'kv-suite-off-a',
            'kv-suite-off-b',
            'kv-suite-off-c',
        ]) {
            await t.puter.kv.set(k, 1);
        }
        const page = (await t.puter.kv.list({
            pattern: 'kv-suite-off-*',
            limit: 10,
            offset: 1,
        })) as { items: string[] };
        t.assert.deepEqual(page.items, ['kv-suite-off-b', 'kv-suite-off-c']);
    },

    'list with fetchUntilFull fills the page': async (t) => {
        for (const k of [
            'kv-suite-fill-a',
            'kv-suite-fill-b',
            'kv-suite-fill-c',
        ]) {
            await t.puter.kv.set(k, 1);
        }
        const page = (await t.puter.kv.list({
            pattern: 'kv-suite-fill-*',
            limit: 3,
            fetchUntilFull: true,
        })) as { items: string[] };
        t.assert.equal(page.items.length, 3);
    },

    'list returns keys matching a prefix pattern': async (t) => {
        await t.puter.kv.set('kv-suite-list-a', 1);
        await t.puter.kv.set('kv-suite-list-b', 2);
        await t.puter.kv.set('kv-suite-unrelated', 3);
        const keys = await t.puter.kv.list('kv-suite-list-*');
        t.assert.deepEqual([...keys].sort(), [
            'kv-suite-list-a',
            'kv-suite-list-b',
        ]);
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
                (
                    t.puter.kv.set as (
                        k: unknown,
                        v: unknown,
                    ) => Promise<unknown>
                )(undefined, 'x'),
            'an undefined key should be rejected',
        );
    },

    'MAX_KEY_SIZE and MAX_VALUE_SIZE expose the documented limits': async (
        t,
    ) => {
        t.assert.equal(t.puter.kv.MAX_KEY_SIZE, 1024);
        t.assert.equal(t.puter.kv.MAX_VALUE_SIZE, 399 * 1024);
    },

    'incr on a fresh key starts from zero': async (t) => {
        t.assert.equal(await t.puter.kv.incr('kv-suite-incr-fresh', 3), 3);
    },

    'decr can drive a value negative': async (t) => {
        t.assert.equal(await t.puter.kv.decr('kv-suite-decr-neg', 5), -5);
    },

    'add appends values into an array at a path': async (t) => {
        await t.puter.kv.set('kv-suite-add', { tags: ['alpha'] });
        const updated = await t.puter.kv.add('kv-suite-add', {
            tags: ['beta', 'gamma'],
        });
        t.assert.deepEqual(updated.tags, ['alpha', 'beta', 'gamma']);
    },

    'update with a ttl keeps the value readable before it expires': async (
        t,
    ) => {
        await t.puter.kv.set('kv-suite-update-ttl', { n: 1 });
        await t.puter.kv.update('kv-suite-update-ttl', { n: 2 }, 3600);
        const value = await t.puter.kv.get('kv-suite-update-ttl');
        t.assert.equal(value.n, 2);
    },

    'list without a pattern returns every key for the app': async (t) => {
        await t.puter.kv.set('kv-suite-all-1', 1);
        await t.puter.kv.set('kv-suite-all-2', 2);
        const keys = (await t.puter.kv.list()) as string[];
        t.assert.ok(keys.includes('kv-suite-all-1'));
        t.assert.ok(keys.includes('kv-suite-all-2'));
    },

    'list returns keys in lexicographic order': async (t) => {
        await t.puter.kv.set('kv-suite-sorted-c', 1);
        await t.puter.kv.set('kv-suite-sorted-a', 1);
        await t.puter.kv.set('kv-suite-sorted-b', 1);
        const keys = (await t.puter.kv.list('kv-suite-sorted-*')) as string[];
        t.assert.deepEqual(keys, [
            'kv-suite-sorted-a',
            'kv-suite-sorted-b',
            'kv-suite-sorted-c',
        ]);
    },

    'list with a limit and cursor paginates through matches': async (t) => {
        for (let i = 1; i <= 3; i++) {
            await t.puter.kv.set(`kv-suite-page-${i}`, `v${i}`);
        }
        const seen: string[] = [];
        let cursor: string | undefined;
        let guard = 0;
        do {
            const page = (await t.puter.kv.list({
                pattern: 'kv-suite-page-*',
                returnValues: true,
                limit: 2,
                cursor,
            })) as { items: Array<{ key: string }>; cursor?: string };
            for (const item of page.items) seen.push(item.key);
            cursor = page.cursor;
        } while (cursor && ++guard < 10);
        t.assert.deepEqual(seen.sort(), [
            'kv-suite-page-1',
            'kv-suite-page-2',
            'kv-suite-page-3',
        ]);
    },

    'list with stream iterates pages via for await': async (t) => {
        for (let i = 1; i <= 3; i++) {
            await t.puter.kv.set(`kv-suite-stream-${i}`, `v${i}`);
        }
        const seen: string[] = [];
        let pages = 0;
        for await (const page of t.puter.kv.list({
            pattern: 'kv-suite-stream-*',
            limit: 2,
            stream: true,
        }) as AsyncIterable<{ items: string[]; cursor?: string }>) {
            pages++;
            t.assert.ok(page.items.length <= 2, 'stream pages respect limit');
            seen.push(...page.items);
        }
        t.assert.ok(pages >= 2, 'stream should yield multiple pages');
        t.assert.deepEqual(seen.sort(), [
            'kv-suite-stream-1',
            'kv-suite-stream-2',
            'kv-suite-stream-3',
        ]);
    },

    'list with stream rejects offset client-side': async (t) => {
        let err: { code?: string } | undefined;
        try {
            t.puter.kv.list({ stream: true, offset: 1 } as never);
        } catch (e) {
            err = e as { code?: string };
        }
        t.assert.equal(err?.code, 'invalid_request');
    },

    'clear is an alias of flush and empties the store': async (t) => {
        await t.puter.kv.set('kv-suite-clear-a', 1);
        await t.puter.kv.clear();
        t.assert.equal(await t.puter.kv.get('kv-suite-clear-a'), null);
    },

    'flush removes every key for the app': async (t) => {
        await t.puter.kv.set('kv-suite-flush-a', 1);
        await t.puter.kv.set('kv-suite-flush-b', 2);
        await t.puter.kv.flush();
        t.assert.equal(await t.puter.kv.get('kv-suite-flush-a'), null);
        t.assert.equal(await t.puter.kv.get('kv-suite-flush-b'), null);
        const keys = (await t.puter.kv.list()) as string[];
        t.assert.equal(
            keys.some((k) => k.startsWith('kv-suite-')),
            false,
            'flush should clear every key the suite created',
        );
    },
});
