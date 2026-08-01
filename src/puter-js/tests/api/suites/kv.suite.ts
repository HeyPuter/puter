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

    'incr rejects a path that walks the prototype chain': async (t) => {
        await t.assert.rejects(
            () =>
                t.puter.kv.incr('kv-suite-proto', {
                    'constructor.prototype.polluted': 1,
                }),
            'a prototype-walking path should be rejected',
        );
        await t.assert.rejects(
            () =>
                t.puter.kv.incr('kv-suite-proto', {
                    '__proto__.polluted.deep': 1,
                }),
            'a __proto__ path should be rejected',
        );
        t.assert.equal(
            ({} as Record<string, unknown>).polluted,
            undefined,
            'nothing should have landed on Object.prototype',
        );
    },

    'set rejects a value carrying a reserved object key': async (t) => {
        // A JSON body can carry `__proto__` as a real own property; an object
        // literal in source cannot.
        const value = JSON.parse('{"__proto__":{"polluted":true}}');
        await t.assert.rejects(
            () => t.puter.kv.set('kv-suite-proto-value', value),
            'a value with a __proto__ key should be rejected',
        );
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

    'list with stream and no limit still pages the whole store': async (t) => {
        await t.puter.kv.set('kv-suite-stream-nolimit', 'present');
        const seen: string[] = [];
        for await (const page of t.puter.kv.list({
            pattern: 'kv-suite-stream-nolimit',
            stream: true,
        }) as AsyncIterable<{ items: string[] }>) {
            seen.push(...page.items);
        }
        t.assert.deepEqual(seen, ['kv-suite-stream-nolimit']);
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

    // -- argument shapes --

    'set accepts the single-item object form': async (t) => {
        t.assert.equal(
            await t.puter.kv.set({ key: 'kv-suite-obj-form', value: 'from object' }),
            true,
        );
        t.assert.equal(await t.puter.kv.get('kv-suite-obj-form'), 'from object');
    },

    'set accepts the batch object form': async (t) => {
        await t.puter.kv.set({
            items: [
                { key: 'kv-suite-batch-obj-1', value: 'one' },
                { key: 'kv-suite-batch-obj-2', value: 'two' },
            ],
        });
        t.assert.equal(await t.puter.kv.get('kv-suite-batch-obj-1'), 'one');
        t.assert.equal(await t.puter.kv.get('kv-suite-batch-obj-2'), 'two');
    },

    'set with an expireAt in the past leaves the key unreadable': async (t) => {
        await t.puter.kv.set(
            'kv-suite-set-expired',
            'stale',
            Math.floor(Date.now() / 1000) - 60,
        );
        t.assert.equal(await t.puter.kv.get('kv-suite-set-expired'), null);
    },

    'set tolerates the legacy trailing callback slots': async (t) => {
        // The callbacks sit after the (skipped) expireAt slot; they must not
        // be mistaken for the value or the expiry.
        const stored = await (
            t.puter.kv.set as (
                k: string,
                v: unknown,
                e: undefined,
                s: () => void,
                err: () => void,
            ) => Promise<boolean>
        )('kv-suite-set-cb', 'callback value', undefined, () => {}, () => {});
        t.assert.equal(stored, true);
        t.assert.equal(await t.puter.kv.get('kv-suite-set-cb'), 'callback value');
    },

    'set of an empty batch rejects with items_required': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.kv.set([]),
            'an empty batch should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'items_required');
        t.assert.equal((err as { message?: string })?.message, 'Items are required');
    },

    'set of a batch item without a key rejects with invalid_item': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.kv.set([{ value: 'orphan' } as never]),
            'a batch item without a key should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'invalid_item');
    },

    'set of a batch item with an empty key rejects with key_undefined': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.kv.set([{ key: '', value: 'nameless' }]),
            'an empty batch key should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'key_undefined');
    },

    'set rejects an oversized value client-side': async (t) => {
        const err = await t.assert.rejects(
            () =>
                t.puter.kv.set(
                    'kv-suite-oversized-value',
                    'v'.repeat(t.puter.kv.MAX_VALUE_SIZE + 1),
                ),
            'a value over the cap should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'value_too_large');
        t.assert.equal(
            (err as { message?: string })?.message,
            `Value size cannot be larger than ${t.puter.kv.MAX_VALUE_SIZE}`,
        );
    },

    'set rejects an oversized key with key_too_large': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.kv.set('k'.repeat(t.puter.kv.MAX_KEY_SIZE + 1), 'x'),
            'an oversized key should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'key_too_large');
    },

    'get and del accept the object form': async (t) => {
        await t.puter.kv.set('kv-suite-obj-access', 'accessible');
        t.assert.equal(
            await t.puter.kv.get({ key: 'kv-suite-obj-access' }),
            'accessible',
        );
        t.assert.equal(await t.puter.kv.del({ key: 'kv-suite-obj-access' }), true);
        t.assert.equal(await t.puter.kv.get('kv-suite-obj-access'), null);
    },

    'del rejects an oversized key client-side': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.kv.del('d'.repeat(t.puter.kv.MAX_KEY_SIZE + 1)),
            'an oversized key should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'key_too_large');
    },

    'incr accepts the options-object form': async (t) => {
        const value = await t.puter.kv.incr({
            key: 'kv-suite-incr-object',
            pathAndAmountMap: { '': 7 },
        } as never);
        t.assert.equal(value, 7);
    },

    'incr and decr with no arguments reject with arguments_required': async (t) => {
        const incrError = await t.assert.rejects(
            () => (t.puter.kv.incr as () => Promise<number>)(),
            'incr with no arguments should be rejected',
        );
        t.assert.equal((incrError as { code?: string })?.code, 'arguments_required');
        const decrError = await t.assert.rejects(
            () => (t.puter.kv.decr as () => Promise<number>)(),
            'decr with no arguments should be rejected',
        );
        t.assert.equal((decrError as { code?: string })?.code, 'arguments_required');
    },

    'add without a value appends one at the root': async (t) => {
        await t.puter.kv.set('kv-suite-add-default', ['first']);
        t.assert.deepEqual(
            await (t.puter.kv.add as (k: string) => Promise<unknown>)(
                'kv-suite-add-default',
            ),
            ['first', 1],
        );
    },

    'add with a scalar adds it at the root': async (t) => {
        await t.puter.kv.set('kv-suite-add-scalar', ['first']);
        t.assert.deepEqual(await t.puter.kv.add('kv-suite-add-scalar', 'second'), [
            'first',
            'second',
        ]);
    },

    'add accepts the options-object form': async (t) => {
        await t.puter.kv.set('kv-suite-add-object', { tags: ['a'] });
        const updated = await t.puter.kv.add({
            key: 'kv-suite-add-object',
            pathAndValueMap: { tags: ['b'] },
        } as never);
        t.assert.deepEqual((updated as { tags: string[] }).tags, ['a', 'b']);
    },

    'add with no arguments rejects with arguments_required': async (t) => {
        const err = await t.assert.rejects(
            () => (t.puter.kv.add as () => Promise<unknown>)(),
            'add with no arguments should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'arguments_required');
    },

    'remove validates its paths client-side': async (t) => {
        await t.puter.kv.set('kv-suite-remove-guard', { a: 1, b: 2, c: 3 });

        const noPaths = await t.assert.rejects(
            () => (t.puter.kv.remove as (k: string) => Promise<unknown>)(
                'kv-suite-remove-guard',
            ),
            'remove with no paths should be rejected',
        );
        t.assert.equal((noPaths as { code?: string })?.code, 'arguments_required');
        t.assert.equal(
            (noPaths as { message?: string })?.message,
            'At least one path is required',
        );

        const arrayPaths = await t.assert.rejects(
            () => t.puter.kv.remove('kv-suite-remove-guard', ['a'] as never),
            'an array of paths should be rejected',
        );
        t.assert.equal((arrayPaths as { code?: string })?.code, 'paths_invalid');
        t.assert.equal(
            (arrayPaths as { message?: string })?.message,
            'Paths must be provided as separate arguments',
        );

        const nonStringPath = await t.assert.rejects(
            () => t.puter.kv.remove('kv-suite-remove-guard', 7 as never),
            'a non-string path should be rejected',
        );
        t.assert.equal((nonStringPath as { code?: string })?.code, 'paths_invalid');

        const missingKey = await t.assert.rejects(
            () =>
                (t.puter.kv.remove as (k: unknown, p: string) => Promise<unknown>)(
                    undefined,
                    'a',
                ),
            'remove without a key should be rejected',
        );
        t.assert.equal((missingKey as { code?: string })?.code, 'key_undefined');
    },

    'remove deletes several paths in one call': async (t) => {
        await t.puter.kv.set('kv-suite-remove-many', { a: 1, b: 2, c: 3 });
        const updated = await t.puter.kv.remove('kv-suite-remove-many', 'a', 'c');
        t.assert.deepEqual(updated, { b: 2 });
    },

    'update validates the path map and ttl client-side': async (t) => {
        await t.puter.kv.set('kv-suite-update-guard', { n: 1 });

        const missingMap = await t.assert.rejects(
            () =>
                (t.puter.kv.update as (k: string) => Promise<unknown>)(
                    'kv-suite-update-guard',
                ),
            'update without a path map should be rejected',
        );
        t.assert.equal((missingMap as { code?: string })?.code, 'path_map_invalid');

        const arrayMap = await t.assert.rejects(
            () => t.puter.kv.update('kv-suite-update-guard', ['n'] as never),
            'an array path map should be rejected',
        );
        t.assert.equal((arrayMap as { code?: string })?.code, 'path_map_invalid');

        const emptyMap = await t.assert.rejects(
            () => t.puter.kv.update('kv-suite-update-guard', {}),
            'an empty path map should be rejected',
        );
        t.assert.equal((emptyMap as { code?: string })?.code, 'path_map_invalid');
        t.assert.equal(
            (emptyMap as { message?: string })?.message,
            'pathAndValueMap cannot be empty',
        );

        const badTtl = await t.assert.rejects(
            () =>
                t.puter.kv.update({
                    key: 'kv-suite-update-guard',
                    pathAndValueMap: { n: 2 },
                    ttl: 'soon',
                } as never),
            'a non-numeric ttl should be rejected',
        );
        t.assert.equal((badTtl as { code?: string })?.code, 'ttl_invalid');
        t.assert.equal(
            (badTtl as { message?: string })?.message,
            'ttl must be a number',
        );
    },

    'update accepts the options-object form': async (t) => {
        await t.puter.kv.set('kv-suite-update-object', { colour: 'red' });
        const updated = await t.puter.kv.update({
            key: 'kv-suite-update-object',
            pathAndValueMap: { colour: 'green' },
        });
        t.assert.equal((updated as { colour: string }).colour, 'green');
    },

    'update of a missing key rejects with key_undefined when no key is given': async (
        t,
    ) => {
        const err = await t.assert.rejects(
            () =>
                (
                    t.puter.kv.update as (
                        k: unknown,
                        m: Record<string, unknown>,
                    ) => Promise<unknown>
                )(undefined, { n: 1 }),
            'update without a key should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'key_undefined');
    },

    'list treats a bare wildcard as no pattern at all': async (t) => {
        await t.puter.kv.set('kv-suite-wildcard-a', 1);
        const all = (await t.puter.kv.list('*')) as string[];
        t.assert.ok(
            all.includes('kv-suite-wildcard-a'),
            'a bare wildcard should list every key',
        );
    },

    'list(true) returns pairs for every key': async (t) => {
        await t.puter.kv.set('kv-suite-pairs-all', 'paired');
        const pairs = (await t.puter.kv.list(true)) as Array<{
            key: string;
            value: unknown;
        }>;
        const found = pairs.find((p) => p.key === 'kv-suite-pairs-all');
        t.assert.equal(found?.value, 'paired');
    },

    'destructured methods keep their binding': async (t) => {
        const { set, get, del } = t.puter.kv;
        await set('kv-suite-destructured', 'still bound');
        t.assert.equal(await get('kv-suite-destructured'), 'still bound');
        t.assert.equal(await del('kv-suite-destructured'), true);
    },

    'clear and flush are the same bound function': async (t) => {
        t.assert.equal(t.puter.kv.clear === t.puter.kv.flush, true);
    },

    'flush accepts the object form and a positional callback': async (t) => {
        await t.puter.kv.set('kv-suite-flush-obj', 1);
        t.assert.equal(
            await t.puter.kv.flush({ success: () => {}, error: () => {} } as never),
            true,
        );
        t.assert.equal(await t.puter.kv.get('kv-suite-flush-obj'), null);

        await t.puter.kv.set('kv-suite-flush-cb', 1);
        t.assert.equal(
            await (t.puter.kv.flush as (s: () => void) => Promise<boolean>)(() => {}),
            true,
        );
        t.assert.equal(await t.puter.kv.get('kv-suite-flush-cb'), null);
    },

    // The GUI reads a fixed set of keys while it boots; the first of those
    // reads fetches all of them in one batched driver call and later reads
    // inside the window are served from it.
    'get of a GUI boot key is served from the batched read': async (t) => {
        await t.puter.kv.set('menubar_style', 'system');
        t.assert.equal(await t.puter.kv.get('menubar_style'), 'system');
        t.assert.equal(await t.puter.kv.get('menubar_style'), 'system');
        t.assert.equal(
            await t.puter.kv.get('has_seen_welcome_window'),
            null,
            'an unset boot key comes back empty from the same batch',
        );
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
