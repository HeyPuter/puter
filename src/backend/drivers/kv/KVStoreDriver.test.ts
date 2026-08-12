import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { Actor, makeActor as buildActor } from '../../core/actor.ts';
import { runWithContext } from '../../core/context.ts';
import { PuterServer } from '../../server.ts';
import {
    APP_DATA_KV_METHOD_OPS,
    appDataPermission,
} from '../../services/permission/appDataScopes.ts';
import { createTestUser, setupTestServer } from '../../testUtil.ts';
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
        await server?.shutdown();
    });

    // Each test runs against a unique actor namespace so state from one test
    // never leaks into another. Mirrors the pattern used by SystemKVStore.test.
    let actor: Actor;
    const makeActor = (overrides: Partial<Actor> = {}): Actor =>
        buildActor({
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
                await target.set({
                    key: 123 as unknown as string,
                    value: 'numeric',
                });
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
                await target.set({
                    key: 'gone',
                    value: 'soon',
                    expireAt: past,
                });
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
            const res = await inCtx(() => target.del({ key: 'never-existed' }));
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

        it.each([['incr' as const], ['decr' as const]])(
            '%s rejects a missing key',
            async (op) => {
                await expect(
                    inCtx(() =>
                        target[op]({
                            key: undefined,
                            pathAndAmountMap: { n: 1 },
                        }),
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            },
        );

        it.each([['incr' as const], ['decr' as const]])(
            '%s rejects a missing pathAndAmountMap',
            async (op) => {
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
            },
        );

        it.each([['incr' as const], ['decr' as const]])(
            '%s rejects a non-object pathAndAmountMap',
            async (op) => {
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
            },
        );

        // A path walking the prototype chain is a client error, not an
        // opaque 500 out of the document client.
        it.each([['incr' as const], ['decr' as const]])(
            '%s rejects a prototype-walking path as a 400',
            async (op) => {
                await expect(
                    inCtx(() =>
                        target[op]({
                            key: 'proto-test',
                            pathAndAmountMap: { 'constructor.prototype.x': 1 },
                        }),
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                expect(({} as Record<string, unknown>).x).toBeUndefined();
            },
        );
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
                inCtx(() => target.add({ key: '', pathAndValueMap: { x: 1 } })),
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
                inCtx(() => target.remove({ key: undefined, paths: ['x'] })),
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
            const appA = buildActor({
                user: { uuid: baseUser },
                app: { uid: 'app-A', id: 100 },
            });
            const appB = buildActor({
                user: { uuid: baseUser },
                app: { uid: 'app-B', id: 200 },
            });

            await inCtx(() => target.set({ key: 'k', value: 'A' }), appA);
            const fromB = await inCtx(() => target.get({ key: 'k' }), appB);
            expect(fromB).toBeNull();

            const fromA = await inCtx(() => target.get({ key: 'k' }), appA);
            expect(fromA).toBe('A');
        });

        it('refuses a foreign optConfig.appUuid rather than silently scrubbing it', async () => {
            // The override used to be dropped for an app actor, which returned
            // the app's *own* value — a success answering a different question
            // than the caller asked. Cross-app access is now a real capability,
            // so an override the caller cannot justify fails closed instead: an
            // unknown target app is a 404, and a real target with no grant is a
            // 403 (covered under cross-app access).
            const baseUser = `user-${Math.random().toString(36).slice(2)}`;
            const appActor = buildActor({
                user: { uuid: baseUser },
                app: { uid: 'real-app', id: 1 },
            });
            await inCtx(
                () => target.set({ key: 'k', value: 'real' }),
                appActor,
            );

            await expect(
                inCtx(
                    () =>
                        target.get({
                            key: 'k',
                            optConfig: { appUuid: 'spoof-app' },
                        }),
                    appActor,
                ),
            ).rejects.toMatchObject({ statusCode: 404 });

            // The app's own entry is untouched and still reachable with no
            // override — the refusal is about the override, not the namespace.
            expect(await inCtx(() => target.get({ key: 'k' }), appActor)).toBe(
                'real',
            );
        });

        it('uses optConfig.appUuid for a user-only (root) actor', async () => {
            // User-only actor is allowed to scope reads/writes to a target
            // app namespace via optConfig.appUuid. Verify by reading the same
            // entry via a real app-actor for that app.
            const baseUser = `user-${Math.random().toString(36).slice(2)}`;
            const userOnly = buildActor({ user: { uuid: baseUser } });
            const asApp = buildActor({
                user: { uuid: baseUser },
                app: { uid: 'target-app', id: 1 },
            });

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

    // -- Cross-app access (app-data:<uid>:kv:<op>) ---------------------
    //
    // An app may reach another app's KV namespace under the same user once the
    // user has granted it. These tests use real user and app rows, because the
    // grant lands in `user_to_app_permissions` and the driver resolves the
    // target app row for its existence and sharing checks.
    describe('cross-app access', () => {
        const permissions = () => server.services.permission;

        const makeOwner = async (): Promise<Actor> => {
            const username = `kvx${Math.random().toString(36).slice(2, 10)}`;
            const created = await createTestUser(server, {
                username,
                password: 'kv-cross-app-password',
            });
            const row = await server.stores.user.getByUsername(
                created.username,
            );
            return buildActor({
                user: {
                    id: row!.id,
                    uuid: row!.uuid,
                    username: row!.username,
                    email: row!.email ?? null,
                },
            });
        };

        const makeRealApp = async (
            ownerUserId: number,
            fields: Record<string, unknown> = {},
        ): Promise<{ id: number; uid: string }> => {
            const name = `kvx-${Math.random().toString(36).slice(2)}`;
            return (await server.stores.app.create(
                {
                    name,
                    title: 'KV cross-app test',
                    index_url: `https://${name}.test/`,
                    ...fields,
                },
                { ownerUserId },
            )) as { id: number; uid: string };
        };

        const asApp = (owner: Actor, app: { id: number; uid: string }): Actor =>
            buildActor({
                user: owner.user,
                app: { uid: app.uid, id: app.id },
            });

        /** An access token that `app` minted, as AuthService builds one. */
        const asTokenOf = (owner: Actor, actorForApp: Actor): Actor =>
            buildActor({
                user: owner.user,
                accessToken: {
                    uid: `tok-${Math.random().toString(36).slice(2)}`,
                    issuer: actorForApp,
                    authorized: null,
                },
            });

        const grant = (
            owner: Actor,
            granteeAppUid: string,
            permission: string,
        ) =>
            runWithContext({ actor: owner }, () =>
                permissions().grantUserAppPermission(
                    owner,
                    granteeAppUid,
                    permission,
                ),
            );

        /**
         * The common fixture: an owner, a calendar app asking for access, a
         * contacts app holding the data, and one seeded entry in contacts'
         * namespace written by contacts itself.
         */
        const setup = async (targetFields: Record<string, unknown> = {}) => {
            const owner = await makeOwner();
            const calendar = await makeRealApp(owner.user.id!);
            const contacts = await makeRealApp(owner.user.id!, targetFields);
            const calendarActor = asApp(owner, calendar);
            const contactsActor = asApp(owner, contacts);
            await inCtx(
                () => target.set({ key: 'entry', value: 'contacts-value' }),
                contactsActor,
            );
            return { owner, calendar, contacts, calendarActor, contactsActor };
        };

        const crossApp = <T>(
            actorForCall: Actor,
            targetAppUid: string,
            fn: (optConfig: { appUuid: string }) => T | Promise<T>,
        ) => inCtx(() => fn({ appUuid: targetAppUid }), actorForCall);

        it("reads another app's entry with a matching grant", async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'get'),
            );

            // Also the positive control for the `not.toHaveBeenCalled()`
            // assertions below: it proves the spy is attached to the same
            // service instance the driver consults, so those negatives mean
            // "no check happened" rather than "the spy saw nothing".
            const spy = vi.spyOn(permissions(), 'check');
            try {
                const res = await crossApp(
                    calendarActor,
                    contacts.uid,
                    (optConfig) => target.get({ key: 'entry', optConfig }),
                );
                expect(res).toBe('contacts-value');
                expect(spy).toHaveBeenCalledWith(
                    expect.anything(),
                    appDataPermission(contacts.uid, 'kv', 'get'),
                );
            } finally {
                spy.mockRestore();
            }
        });

        it('refuses without a grant', async () => {
            const { contacts, calendarActor } = await setup();
            await expect(
                crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('404s when the target uid names no app', async () => {
            const { calendarActor } = await setup();
            await expect(
                crossApp(calendarActor, 'app-does-not-exist', (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('refuses when the target app has opted out of sharing', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup({
                metadata: JSON.stringify({ share_app_data: false }),
            });
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'get'),
            );
            await expect(
                crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('keeps read and write distinct', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'read'),
            );
            expect(
                await crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).toBe('contacts-value');
            await expect(
                crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.set({
                        key: 'entry',
                        value: 'overwritten',
                        optConfig,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it("writes into the target's namespace, where the target app sees it", async () => {
            const { owner, calendar, contacts, calendarActor, contactsActor } =
                await setup();
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'write'),
            );
            await crossApp(calendarActor, contacts.uid, (optConfig) =>
                target.set({
                    key: 'invite',
                    value: 'from-calendar',
                    optConfig,
                }),
            );
            // Read back as contacts itself — proves the write landed in the
            // target namespace rather than the caller's own.
            expect(
                await inCtx(() => target.get({ key: 'invite' }), contactsActor),
            ).toBe('from-calendar');
        });

        it('keeps delete orthogonal to write', async () => {
            const write = await setup();
            await grant(
                write.owner,
                write.calendar.uid,
                appDataPermission(write.contacts.uid, 'kv', 'write'),
            );
            await expect(
                crossApp(write.calendarActor, write.contacts.uid, (optConfig) =>
                    target.del({ key: 'entry', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });

            const del = await setup();
            await grant(
                del.owner,
                del.calendar.uid,
                appDataPermission(del.contacts.uid, 'kv', 'delete'),
            );
            await expect(
                crossApp(del.calendarActor, del.contacts.uid, (optConfig) =>
                    target.set({ key: 'entry', value: 'nope', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('permits every delete op with the delete class', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'delete'),
            );
            const uid = contacts.uid;
            await crossApp(calendarActor, uid, (optConfig) =>
                target.expire({ key: 'entry', ttl: 60, optConfig }),
            );
            await crossApp(calendarActor, uid, (optConfig) =>
                target.expireAt({
                    key: 'entry',
                    timestamp: 4_000_000_000,
                    optConfig,
                }),
            );
            await crossApp(calendarActor, uid, (optConfig) =>
                target.del({ key: 'entry', optConfig }),
            );
            // `remove` needs an object value to strip a path from.
            await crossApp(calendarActor, uid, (optConfig) =>
                target.remove({ key: 'entry', paths: ['x'], optConfig }),
            );
        });

        it('refuses flush at any scope, without consulting permissions', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            // App-wide grant: the widest scope that exists.
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));
            const spy = vi.spyOn(permissions(), 'check');
            try {
                await expect(
                    crossApp(calendarActor, contacts.uid, (optConfig) =>
                        target.flush({ optConfig }),
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it('requires the delete class for an expiry on a write', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'write'),
            );
            const uid = contacts.uid;

            // An expiry deletes the entry once it lapses, so `write` alone is
            // not enough — on set, on update's ttl, or per item in batchPut.
            await expect(
                crossApp(calendarActor, uid, (optConfig) =>
                    target.set({
                        key: 'entry',
                        value: 'v',
                        expireAt: 4_000_000_000,
                        optConfig,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
            await expect(
                crossApp(calendarActor, uid, (optConfig) =>
                    target.update({
                        key: 'doc',
                        pathAndValueMap: { a: 1 },
                        ttl: 60,
                        optConfig,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
            await expect(
                crossApp(calendarActor, uid, (optConfig) =>
                    target.batchPut({
                        items: [
                            { key: 'a', value: 1 },
                            { key: 'b', value: 2, expireAt: 4_000_000_000 },
                        ],
                        optConfig,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });

            // The same write with no expiry is fine.
            await crossApp(calendarActor, uid, (optConfig) =>
                target.set({ key: 'entry', value: 'v', optConfig }),
            );
        });

        it('allows an expiry once the delete class is granted too', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'write'),
            );
            await grant(
                owner,
                calendar.uid,
                appDataPermission(contacts.uid, 'kv', 'delete'),
            );
            await crossApp(calendarActor, contacts.uid, (optConfig) =>
                target.set({
                    key: 'entry',
                    value: 'v',
                    expireAt: 4_000_000_000,
                    optConfig,
                }),
            );
        });

        // -- Compatibility -------------------------------------------------

        it('does not consult permissions for an own-namespace call', async () => {
            const { contactsActor } = await setup();
            const spy = vi.spyOn(permissions(), 'check');
            try {
                expect(
                    await inCtx(
                        () => target.get({ key: 'entry' }),
                        contactsActor,
                    ),
                ).toBe('contacts-value');
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it('does not consult permissions when an app names itself', async () => {
            const { contacts, contactsActor } = await setup();
            const spy = vi.spyOn(permissions(), 'check');
            try {
                expect(
                    await crossApp(contactsActor, contacts.uid, (optConfig) =>
                        target.get({ key: 'entry', optConfig }),
                    ),
                ).toBe('contacts-value');
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it('still honours appUuid for a user-only actor with no grant', async () => {
            const { owner, contacts } = await setup();
            // The user owns the data in every one of their app namespaces, so
            // this path is deliberately ungated — tightening it would break
            // existing dashboard and API-token callers.
            const spy = vi.spyOn(permissions(), 'check');
            try {
                expect(
                    await crossApp(owner, contacts.uid, (optConfig) =>
                        target.get({ key: 'entry', optConfig }),
                    ),
                ).toBe('contacts-value');
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        // -- Per-key privacy ----------------------------------------------

        it('hides an entry the owning app marked private', async () => {
            const { owner, calendar, contacts, calendarActor, contactsActor } =
                await setup();
            await inCtx(
                () =>
                    target.set({
                        key: 'token',
                        value: 'oauth-secret',
                        optConfig: { disableSharing: true },
                    }),
                contactsActor,
            );
            // The widest possible grant still does not reach it.
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));

            // Absent, not refused: the flag must not confirm what is stored.
            expect(
                await crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'token', optConfig }),
                ),
            ).toBeNull();
            // Its unflagged neighbour is still visible.
            expect(
                await crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).toBe('contacts-value');
            // And the owning app sees its own entry normally.
            expect(
                await inCtx(() => target.get({ key: 'token' }), contactsActor),
            ).toBe('oauth-secret');
        });

        it('omits private entries from a cross-app list but not the owner’s', async () => {
            const { owner, calendar, contacts, calendarActor, contactsActor } =
                await setup();
            await inCtx(
                () =>
                    target.set({
                        key: 'token',
                        value: 'oauth-secret',
                        optConfig: { disableSharing: true },
                    }),
                contactsActor,
            );
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));

            const seen = (await crossApp(
                calendarActor,
                contacts.uid,
                (optConfig) => target.list({ as: 'keys', optConfig }),
            )) as string[];
            expect(seen).toContain('entry');
            expect(seen).not.toContain('token');

            const own = (await inCtx(
                () => target.list({ as: 'keys' }),
                contactsActor,
            )) as string[];
            expect(own).toContain('token');
        });

        it('refuses cross-app writes and deletes against a private entry', async () => {
            const { owner, calendar, contacts, calendarActor, contactsActor } =
                await setup();
            await inCtx(
                () =>
                    target.set({
                        key: 'token',
                        value: 'oauth-secret',
                        optConfig: { disableSharing: true },
                    }),
                contactsActor,
            );
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));

            // A write must refuse rather than behave as absent — treating it as
            // missing would overwrite the value the flag exists to protect.
            await expect(
                crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.set({ key: 'token', value: 'clobbered', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
            await expect(
                crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.del({ key: 'token', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });

            // Still intact for its owner.
            expect(
                await inCtx(() => target.get({ key: 'token' }), contactsActor),
            ).toBe('oauth-secret');
        });

        it('gates a token an app minted, not just the app itself', async () => {
            const { owner, contacts, calendarActor } = await setup();
            // An access-token actor carries no `app` of its own — the app is on
            // `accessToken.issuer`. Reading `actor.app` here would take the
            // ungated user-token branch and hand the token the whole namespace.
            const token = asTokenOf(owner, calendarActor);
            await expect(
                crossApp(token, contacts.uid, (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('resolves a token to its minting app, not to a bare user', async () => {
            const { owner, contacts, calendarActor } = await setup();
            const token = asTokenOf(owner, calendarActor);
            const spy = vi.spyOn(permissions(), 'check');
            try {
                await expect(
                    crossApp(token, contacts.uid, (optConfig) =>
                        target.get({ key: 'entry', optConfig }),
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
                // The ungated user-token branch never consults permissions at
                // all, so the call itself is the evidence the token was read as
                // app-scoped.
                expect(spy).toHaveBeenCalledWith(
                    expect.anything(),
                    appDataPermission(contacts.uid, 'kv', 'get'),
                );
            } finally {
                spy.mockRestore();
            }
        });

        it('reads through a token that carries the scope itself', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            const permission = appDataPermission(contacts.uid, 'kv', 'read');
            await grant(owner, calendar.uid, permission);

            // A scoped token does not inherit its issuer's grants — it needs
            // the row too. Both halves have to line up for the read to land.
            const token = asTokenOf(owner, calendarActor);
            await server.clients.db.write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `permission`) VALUES (?, ?)',
                [token.accessToken!.uid, permission],
            );

            expect(
                await crossApp(token, contacts.uid, (optConfig) =>
                    target.get({ key: 'entry', optConfig }),
                ),
            ).toBe('contacts-value');
        });

        it("files a token's own writes under the minting app's namespace", async () => {
            const owner = await makeOwner();
            const calendar = await makeRealApp(owner.user.id!);
            const calendarActor = asApp(owner, calendar);
            const token = asTokenOf(owner, calendarActor);

            await inCtx(() => target.set({ key: 'own', value: 'v' }), token);
            // Not the shared global namespace: the gate reads the token as
            // app-scoped, so the store has to file it the same way.
            expect(
                await inCtx(() => target.get({ key: 'own' }), calendarActor),
            ).toBe('v');
        });

        it('honours disableSharing on a batch write', async () => {
            const { owner, calendar, contacts, calendarActor, contactsActor } =
                await setup();
            await inCtx(
                () =>
                    target.batchPut({
                        items: [
                            { key: 'b1', value: 'v1' },
                            { key: 'b2', value: 'v2' },
                        ],
                        optConfig: { disableSharing: true },
                    }),
                contactsActor,
            );
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));

            // Silently dropping the flag here would hand a granted app entries
            // the owner asked to keep to itself.
            expect(
                await crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: ['b1', 'b2'], optConfig }),
                ),
            ).toEqual([null, null]);
            expect(
                await inCtx(
                    () => target.get({ key: ['b1', 'b2'] }),
                    contactsActor,
                ),
            ).toEqual(['v1', 'v2']);
        });

        it('refuses disableSharing on a cross-app write', async () => {
            const { owner, calendar, contacts, calendarActor } = await setup();
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));
            // Otherwise one app could hide data inside another app's namespace.
            await expect(
                crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.set({
                        key: 'sneaky',
                        value: 'v',
                        optConfig: { ...optConfig, disableSharing: true },
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('lets the owning app clear the flag by rewriting the entry', async () => {
            const { owner, calendar, contacts, calendarActor, contactsActor } =
                await setup();
            await inCtx(
                () =>
                    target.set({
                        key: 'token',
                        value: 'secret',
                        optConfig: { disableSharing: true },
                    }),
                contactsActor,
            );
            await grant(owner, calendar.uid, appDataPermission(contacts.uid));
            expect(
                await crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'token', optConfig }),
                ),
            ).toBeNull();

            // `put` replaces the item, so a write without the flag re-shares it.
            await inCtx(
                () => target.set({ key: 'token', value: 'now-public' }),
                contactsActor,
            );
            expect(
                await crossApp(calendarActor, contacts.uid, (optConfig) =>
                    target.get({ key: 'token', optConfig }),
                ),
            ).toBe('now-public');
        });

        it('maps every public driver method to an op', () => {
            // A method added without a mapping resolves to `undefined` and fails
            // closed at the call site — correct, but silently unreachable across
            // apps. This fails instead, so the omission is a decision.
            const methods = Object.getOwnPropertyNames(
                Object.getPrototypeOf(target) as object,
            ).filter(
                (name) =>
                    name !== 'constructor' &&
                    name !== 'getReportedCosts' &&
                    typeof (target as unknown as Record<string, unknown>)[
                        name
                    ] === 'function',
            );
            expect(methods.length).toBeGreaterThan(0);
            for (const name of methods) {
                expect(APP_DATA_KV_METHOD_OPS).toHaveProperty(name);
            }
        });
    });

    // ── Budget enforcement ───────────────────────────────────────────

    describe('budget enforcement', () => {
        // Spend the actor's whole monthly allowance, so the next call is the
        // first one it can't afford.
        const exhaust = async (spender: Actor) => {
            const sub =
                await server.services.metering.getActorSubscription(spender);
            await server.services.metering.incrementUsage(
                spender,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );
        };

        it('refuses reads and writes once the allowance is spent', async () => {
            await inCtx(() => target.set({ key: 'k', value: 'v' }));
            await exhaust(actor);

            await expect(
                inCtx(() => target.get({ key: 'k' })),
            ).rejects.toMatchObject({
                statusCode: 402,
                legacyCode: 'insufficient_funds',
            });
            await expect(
                inCtx(() => target.set({ key: 'k2', value: 'v' })),
            ).rejects.toMatchObject({ statusCode: 402 });
            // `list` hands back the values unless asked otherwise, which is a
            // read like any other.
            await expect(inCtx(() => target.list({}))).rejects.toMatchObject({
                statusCode: 402,
            });
            await expect(
                inCtx(() => target.list({ as: 'values' })),
            ).rejects.toMatchObject({ statusCode: 402 });
        });

        it('still lets the account see which keys it has, so it can pick what to clear', async () => {
            await inCtx(async () => {
                await target.set({ key: 'keep', value: 'v' });
                await target.set({ key: 'drop', value: 'v' });
            });
            await exhaust(actor);

            const keys = await inCtx(() => target.list({ as: 'keys' }));
            expect(keys).toEqual(expect.arrayContaining(['keep', 'drop']));

            await expect(
                inCtx(() => target.del({ key: 'drop' })),
            ).resolves.toBe(true);
            expect(await inCtx(() => target.list({ as: 'keys' }))).toEqual([
                'keep',
            ]);
        });

        it('still lets the account get rid of what it stored', async () => {
            await inCtx(async () => {
                await target.set({ key: 'k', value: 'v' });
                await target.set({ key: 'obj', value: { a: 1, b: 2 } });
            });
            await exhaust(actor);

            await expect(inCtx(() => target.del({ key: 'k' }))).resolves.toBe(
                true,
            );
            await expect(
                inCtx(() => target.remove({ key: 'obj', paths: ['a'] })),
            ).resolves.not.toThrow();
            await expect(inCtx(() => target.flush({}))).resolves.toBe(true);
        });

        it('exempts a worker session', async () => {
            const worker = makeActor({
                session: { uid: 'worker-session', kind: 'worker' },
            });
            await exhaust(worker);

            await expect(
                inCtx(() => target.set({ key: 'k', value: 'v' }), worker),
            ).resolves.toBe(true);
            await expect(
                inCtx(() => target.get({ key: 'k' }), worker),
            ).resolves.toBe('v');
        });
    });
});
