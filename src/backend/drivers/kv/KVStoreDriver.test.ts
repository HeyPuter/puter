import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { Actor } from '../../core/actor.ts';
import { runWithContext } from '../../core/context.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import { KV_COSTS } from './costs.ts';
import type { KVStoreDriver } from './KVStoreDriver.ts';

describe('KVStoreDriver', () => {
    let server: PuterServer;
    let target: KVStoreDriver;

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.drivers.kvStore;
    });

    afterAll(async () => {
        await server.shutdown();
    });

    // Each test runs against a unique actor namespace so state from one test
    // never leaks into another. Mirrors the pattern used by SystemKVStore.test.
    let actor: Actor;
    const makeActor = (overrides: Partial<Actor> = {}): Actor => ({
        user: {
            uuid: `test-user-${Math.random().toString(36).slice(2)}`,
            id: 1,
            username: 'test-user',
            email: 'test@test.com',
            email_confirmed: true,
        },
        app: { uid: 'test-app', id: 1 },
        ...overrides,
    });
    beforeEach(() => {
        actor = makeActor();
    });
    const inCtx = <T>(fn: () => T | Promise<T>, withActor: Actor = actor) =>
        runWithContext({ actor: withActor }, fn);

    describe('get', () => {
        it('returns the value previously stored under the same key', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 'k', value: 'v' });
                return target.get({ key: 'k' });
            });
            expect(res).toBe('v');
        });

        it('returns null for a missing key', async () => {
            const res = await inCtx(() => target.get({ key: 'absent' }));
            expect(res).toBeNull();
        });

        it('returns an array of values when called with an array of keys', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 'a', value: 1 });
                await target.set({ key: 'b', value: 2 });
                return target.get({ key: ['a', 'b', 'missing'] });
            });
            expect(res).toEqual([1, 2, null]);
        });

        it('returns [] for an empty array of keys without hitting the store', async () => {
            const res = await inCtx(() => target.get({ key: [] }));
            expect(res).toEqual([]);
        });

        it('coerces a non-string key to a string before lookup', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 123 as unknown as string, value: 'numeric' });
                return target.get({ key: '123' });
            });
            expect(res).toBe('numeric');
        });

        it('rejects when key is undefined', async () => {
            await expect(
                inCtx(() => target.get({ key: undefined })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when key is null', async () => {
            await expect(
                inCtx(() => target.get({ key: null })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when any key in an array is empty', async () => {
            await expect(
                inCtx(() => target.get({ key: ['ok', ''] })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('set', () => {
        it('returns true on success', async () => {
            const res = await inCtx(() => target.set({ key: 'k', value: 'v' }));
            expect(res).toBe(true);
        });

        it('overwrites a previously-set value', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 'k', value: 'first' });
                await target.set({ key: 'k', value: 'second' });
                return target.get({ key: 'k' });
            });
            expect(res).toBe('second');
        });

        it('stores complex object values', async () => {
            const value = { nested: { count: 1 }, items: [1, 2, 3] };
            const res = await inCtx(async () => {
                await target.set({ key: 'obj', value });
                return target.get({ key: 'obj' });
            });
            expect(res).toEqual(value);
        });

        it('stores null as a real value (distinct from missing)', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 'nullable', value: null });
                return target.get({ key: 'nullable' });
            });
            expect(res).toBeNull();
        });

        it('honours expireAt — past timestamps make the value invisible', async () => {
            const past = Math.floor(Date.now() / 1000) - 10;
            const res = await inCtx(async () => {
                await target.set({ key: 'gone', value: 'soon', expireAt: past });
                return target.get({ key: 'gone' });
            });
            expect(res).toBeNull();
        });

        it('rejects an empty key', async () => {
            await expect(
                inCtx(() => target.set({ key: '', value: 'v' })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a missing key', async () => {
            await expect(
                inCtx(() => target.set({ key: undefined, value: 'v' })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when value is undefined', async () => {
            await expect(
                inCtx(() => target.set({ key: 'k', value: undefined })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('batchPut', () => {
        it('writes multiple items and they read back', async () => {
            const res = await inCtx(async () => {
                await target.batchPut({
                    items: [
                        { key: 'bp1', value: 'v1' },
                        { key: 'bp2', value: 'v2' },
                        { key: 'bp3', value: { nested: true } },
                    ],
                });
                return target.get({ key: ['bp1', 'bp2', 'bp3'] });
            });
            expect(res).toEqual(['v1', 'v2', { nested: true }]);
        });

        it('coerces non-string keys', async () => {
            const res = await inCtx(async () => {
                await target.batchPut({
                    items: [
                        { key: 1 as unknown as string, value: 'one' },
                        { key: 2 as unknown as string, value: 'two' },
                    ],
                });
                return target.get({ key: ['1', '2'] });
            });
            expect(res).toEqual(['one', 'two']);
        });

        it('rejects a missing items array', async () => {
            await expect(
                inCtx(() =>
                    target.batchPut({
                        items: undefined as unknown as [],
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an empty items array', async () => {
            await expect(
                inCtx(() => target.batchPut({ items: [] })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when any item has an empty key', async () => {
            await expect(
                inCtx(() =>
                    target.batchPut({
                        items: [
                            { key: 'ok', value: 1 },
                            { key: '', value: 2 },
                        ],
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('del', () => {
        it('removes a previously-set key', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 'gone', value: 'bye' });
                await target.del({ key: 'gone' });
                return target.get({ key: 'gone' });
            });
            expect(res).toBeNull();
        });

        it('returns true even when the key never existed', async () => {
            const res = await inCtx(() =>
                target.del({ key: 'never-existed' }),
            );
            expect(res).toBe(true);
        });

        it('rejects a missing key', async () => {
            await expect(
                inCtx(() => target.del({ key: undefined })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an empty key', async () => {
            await expect(
                inCtx(() => target.del({ key: '' })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('list', () => {
        const seed = () =>
            target.batchPut({
                items: [
                    { key: 'fruit:apple', value: 'red' },
                    { key: 'fruit:banana', value: 'yellow' },
                    { key: 'veg:carrot', value: 'orange' },
                ],
            });

        it('returns key/value entries by default', async () => {
            const res = (await inCtx(async () => {
                await seed();
                return target.list({});
            })) as { key: string; value: unknown }[];
            expect(res).toEqual(
                expect.arrayContaining([
                    { key: 'fruit:apple', value: 'red' },
                    { key: 'fruit:banana', value: 'yellow' },
                    { key: 'veg:carrot', value: 'orange' },
                ]),
            );
        });

        it('returns just keys when as=keys', async () => {
            const res = (await inCtx(async () => {
                await seed();
                return target.list({ as: 'keys' });
            })) as string[];
            expect(res).toEqual(
                expect.arrayContaining([
                    'fruit:apple',
                    'fruit:banana',
                    'veg:carrot',
                ]),
            );
        });

        it('returns just values when as=values', async () => {
            const res = (await inCtx(async () => {
                await seed();
                return target.list({ as: 'values' });
            })) as unknown[];
            expect(res).toEqual(
                expect.arrayContaining(['red', 'yellow', 'orange']),
            );
        });

        it('filters by wildcard prefix pattern', async () => {
            const res = (await inCtx(async () => {
                await seed();
                return target.list({ as: 'keys', pattern: 'fruit:*' });
            })) as string[];
            expect(res).toEqual(
                expect.arrayContaining(['fruit:apple', 'fruit:banana']),
            );
            expect(res).not.toContain('veg:carrot');
        });

        it('returns a paginated envelope with cursor when limit is supplied', async () => {
            const res = (await inCtx(async () => {
                await seed();
                return target.list({ limit: 1 });
            })) as { items: unknown[]; cursor?: string };
            expect(res.items.length).toBe(1);
            expect(typeof res.cursor).toBe('string');
        });

        it('paginates across pages using the returned cursor', async () => {
            const collected = await inCtx(async () => {
                await seed();
                const page1 = (await target.list({ limit: 2 })) as {
                    items: { key: string }[];
                    cursor?: string;
                };
                const page2 = (await target.list({
                    limit: 2,
                    cursor: page1.cursor,
                })) as { items: { key: string }[]; cursor?: string };
                return [...page1.items, ...page2.items].map((e) => e.key);
            });
            expect(collected.sort()).toEqual([
                'fruit:apple',
                'fruit:banana',
                'veg:carrot',
            ]);
        });

        it('rejects an unsupported as value', async () => {
            await expect(
                inCtx(() =>
                    target.list({
                        as: 'bogus' as 'keys',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('flush', () => {
        it('removes every key in the actor namespace', async () => {
            const res = (await inCtx(async () => {
                await target.batchPut({
                    items: [
                        { key: 'f1', value: 1 },
                        { key: 'f2', value: 2 },
                    ],
                });
                await target.flush({});
                return target.list({ as: 'keys' });
            })) as string[];
            expect(res).toEqual([]);
        });

        it('only flushes the calling actor namespace', async () => {
            const otherActor = makeActor();
            await inCtx(() => target.set({ key: 'mine', value: 1 }));
            await inCtx(
                () => target.set({ key: 'theirs', value: 2 }),
                otherActor,
            );
            await inCtx(() => target.flush({}));

            const mine = await inCtx(() => target.get({ key: 'mine' }));
            const theirs = await inCtx(
                () => target.get({ key: 'theirs' }),
                otherActor,
            );
            expect(mine).toBeNull();
            expect(theirs).toBe(2);
        });
    });

    describe('incr / decr', () => {
        it('increments a top-level numeric counter from zero', async () => {
            const res = await inCtx(() =>
                target.incr({ key: 'c', pathAndAmountMap: { hits: 1 } }),
            );
            expect(res).toMatchObject({ hits: 1 });
        });

        it('accumulates across calls', async () => {
            const res = await inCtx(async () => {
                await target.incr({ key: 'c', pathAndAmountMap: { hits: 2 } });
                return target.incr({ key: 'c', pathAndAmountMap: { hits: 3 } });
            });
            expect(res).toMatchObject({ hits: 5 });
        });

        it('decr subtracts via the same machinery', async () => {
            const res = await inCtx(async () => {
                await target.incr({ key: 'c', pathAndAmountMap: { hits: 10 } });
                return target.decr({ key: 'c', pathAndAmountMap: { hits: 3 } });
            });
            expect(res).toMatchObject({ hits: 7 });
        });

        it('coerces non-string keys', async () => {
            const res = await inCtx(() =>
                target.incr({
                    key: 7 as unknown as string,
                    pathAndAmountMap: { n: 1 },
                }),
            );
            expect(res).toMatchObject({ n: 1 });
        });

        it.each([
            ['incr' as const],
            ['decr' as const],
        ])('%s rejects a missing key', async (op) => {
            await expect(
                inCtx(() =>
                    target[op]({
                        key: undefined,
                        pathAndAmountMap: { n: 1 },
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it.each([
            ['incr' as const],
            ['decr' as const],
        ])('%s rejects a missing pathAndAmountMap', async (op) => {
            await expect(
                inCtx(() =>
                    target[op]({
                        key: 'k',
                        pathAndAmountMap: undefined as unknown as Record<
                            string,
                            number
                        >,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it.each([
            ['incr' as const],
            ['decr' as const],
        ])('%s rejects a non-object pathAndAmountMap', async (op) => {
            await expect(
                inCtx(() =>
                    target[op]({
                        key: 'k',
                        pathAndAmountMap: 'nope' as unknown as Record<
                            string,
                            number
                        >,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('expireAt / expire', () => {
        it('expireAt makes a key invisible once the timestamp has passed', async () => {
            const past = Math.floor(Date.now() / 1000) - 5;
            const res = await inCtx(async () => {
                await target.set({ key: 'fade', value: 'soon' });
                await target.expireAt({ key: 'fade', timestamp: past });
                return target.get({ key: 'fade' });
            });
            expect(res).toBeNull();
        });

        it('expire computes the TTL relative to now (negative TTL = expired)', async () => {
            const res = await inCtx(async () => {
                await target.set({ key: 'fade2', value: 'soon' });
                await target.expire({ key: 'fade2', ttl: -10 });
                return target.get({ key: 'fade2' });
            });
            expect(res).toBeNull();
        });

        it('expireAt rejects a non-number timestamp', async () => {
            await expect(
                inCtx(() =>
                    target.expireAt({
                        key: 'k',
                        timestamp: 'soon' as unknown as number,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('expire rejects a non-number ttl', async () => {
            await expect(
                inCtx(() =>
                    target.expire({
                        key: 'k',
                        ttl: 'soon' as unknown as number,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it.each([
            ['expireAt' as const, { timestamp: 0 }],
            ['expire' as const, { ttl: 0 }],
        ])('%s rejects an empty key', async (op, args) => {
            await expect(
                inCtx(() =>
                    (target[op] as (a: unknown) => Promise<unknown>)({
                        key: '',
                        ...args,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('update', () => {
        it('sets a top-level path on a fresh key', async () => {
            const res = await inCtx(() =>
                target.update({
                    key: 'doc',
                    pathAndValueMap: { name: 'puter' },
                }),
            );
            expect(res).toMatchObject({ name: 'puter' });
        });

        it('writes nested paths and creates intermediate maps', async () => {
            const res = await inCtx(() =>
                target.update({
                    key: 'doc',
                    pathAndValueMap: { 'profile.email': 'a@b.com' },
                }),
            );
            expect(res).toMatchObject({ profile: { email: 'a@b.com' } });
        });

        it('preserves untouched fields when updating a single path', async () => {
            const res = await inCtx(async () => {
                await target.update({
                    key: 'doc',
                    pathAndValueMap: { name: 'first', age: 1 },
                });
                return target.update({
                    key: 'doc',
                    pathAndValueMap: { age: 2 },
                });
            });
            expect(res).toMatchObject({ name: 'first', age: 2 });
        });

        it('applies a TTL when ttl is supplied', async () => {
            const res = await inCtx(async () => {
                await target.update({
                    key: 'doc',
                    pathAndValueMap: { name: 'temp' },
                    ttl: -10,
                });
                return target.get({ key: 'doc' });
            });
            expect(res).toBeNull();
        });

        it('rejects a missing key', async () => {
            await expect(
                inCtx(() =>
                    target.update({
                        key: undefined,
                        pathAndValueMap: { x: 1 },
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a missing pathAndValueMap', async () => {
            await expect(
                inCtx(() =>
                    target.update({
                        key: 'k',
                        pathAndValueMap: undefined as unknown as Record<
                            string,
                            unknown
                        >,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a non-object pathAndValueMap', async () => {
            await expect(
                inCtx(() =>
                    target.update({
                        key: 'k',
                        pathAndValueMap: 'bogus' as unknown as Record<
                            string,
                            unknown
                        >,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('add', () => {
        it('appends a single element to an empty path, creating a new list', async () => {
            const res = await inCtx(() =>
                target.add({
                    key: 'list',
                    pathAndValueMap: { items: 'a' },
                }),
            );
            expect(res).toMatchObject({ items: ['a'] });
        });

        it('appends an array to an existing list', async () => {
            const res = await inCtx(async () => {
                await target.add({
                    key: 'list',
                    pathAndValueMap: { items: ['a'] },
                });
                return target.add({
                    key: 'list',
                    pathAndValueMap: { items: ['b', 'c'] },
                });
            });
            expect(res).toMatchObject({ items: ['a', 'b', 'c'] });
        });

        it('rejects a missing pathAndValueMap', async () => {
            await expect(
                inCtx(() =>
                    target.add({
                        key: 'k',
                        pathAndValueMap: undefined as unknown as Record<
                            string,
                            unknown
                        >,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an empty key', async () => {
            await expect(
                inCtx(() =>
                    target.add({ key: '', pathAndValueMap: { x: 1 } }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('remove', () => {
        it('removes a path that exists', async () => {
            const res = await inCtx(async () => {
                await target.update({
                    key: 'doc',
                    pathAndValueMap: { keep: 1, drop: 2 },
                });
                return target.remove({ key: 'doc', paths: ['drop'] });
            });
            expect(res).toMatchObject({ keep: 1 });
            expect(res).not.toHaveProperty('drop');
        });

        it('rejects a missing paths array', async () => {
            await expect(
                inCtx(() =>
                    target.remove({
                        key: 'k',
                        paths: undefined as unknown as string[],
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an empty paths array', async () => {
            await expect(
                inCtx(() => target.remove({ key: 'k', paths: [] })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a missing key', async () => {
            await expect(
                inCtx(() =>
                    target.remove({ key: undefined, paths: ['x'] }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('actor scoping', () => {
        it('isolates values between actors with different user uuids', async () => {
            const otherActor = makeActor();
            await inCtx(() => target.set({ key: 'shared', value: 'mine' }));
            const otherSees = await inCtx(
                () => target.get({ key: 'shared' }),
                otherActor,
            );
            expect(otherSees).toBeNull();
        });

        it('isolates values between two app actors with the same user but different apps', async () => {
            const baseUser = `user-${Math.random().toString(36).slice(2)}`;
            const appA: Actor = {
                user: { uuid: baseUser },
                app: { uid: 'app-A', id: 100 },
            };
            const appB: Actor = {
                user: { uuid: baseUser },
                app: { uid: 'app-B', id: 200 },
            };

            await inCtx(() => target.set({ key: 'k', value: 'A' }), appA);
            const fromB = await inCtx(() => target.get({ key: 'k' }), appB);
            expect(fromB).toBeNull();

            const fromA = await inCtx(() => target.get({ key: 'k' }), appA);
            expect(fromA).toBe('A');
        });

        it('ignores optConfig.appUuid when the actor already has an app uid', async () => {
            // App-actor sets a value, then tries to read with an appUuid override
            // pointing somewhere else — driver must scrub the override.
            const baseUser = `user-${Math.random().toString(36).slice(2)}`;
            const appActor: Actor = {
                user: { uuid: baseUser },
                app: { uid: 'real-app', id: 1 },
            };
            await inCtx(
                () => target.set({ key: 'k', value: 'real' }),
                appActor,
            );
            const res = await inCtx(
                () =>
                    target.get({
                        key: 'k',
                        optConfig: { appUuid: 'spoof-app' },
                    }),
                appActor,
            );
            expect(res).toBe('real');
        });

        it('uses optConfig.appUuid for a user-only (root) actor', async () => {
            // User-only actor is allowed to scope reads/writes to a target
            // app namespace via optConfig.appUuid. Verify by reading the same
            // entry via a real app-actor for that app.
            const baseUser = `user-${Math.random().toString(36).slice(2)}`;
            const userOnly: Actor = { user: { uuid: baseUser } };
            const asApp: Actor = {
                user: { uuid: baseUser },
                app: { uid: 'target-app', id: 1 },
            };

            await inCtx(
                () =>
                    target.set({
                        key: 'k',
                        value: 'set-by-root',
                        optConfig: { appUuid: 'target-app' },
                    }),
                userOnly,
            );
            const res = await inCtx(() => target.get({ key: 'k' }), asApp);
            expect(res).toBe('set-by-root');
        });
    });

    describe('getReportedCosts', () => {
        it('reports a row per KV usage type with the configured rate', () => {
            const rows = target.getReportedCosts();
            expect(rows).toEqual(
                expect.arrayContaining([
                    {
                        usageType: 'kv:read',
                        ucentsPerUnit: KV_COSTS['kv:read'],
                        unit: 'capacity-unit',
                        source: 'driver:kvStore',
                    },
                    {
                        usageType: 'kv:write',
                        ucentsPerUnit: KV_COSTS['kv:write'],
                        unit: 'capacity-unit',
                        source: 'driver:kvStore',
                    },
                ]),
            );
            expect(rows.length).toBe(Object.keys(KV_COSTS).length);
        });
    });
});
