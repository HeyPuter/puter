// This test checks everything in WorkerDriver up to the cloudflare level. 
// Full deployments are not tested as this would require Cloudflare Workerd,
//  however the interactions with the Puter API are
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { INTERNAL_ADMISSION_BYPASS } from './WorkerDriver.js';
import type { WorkerDriver } from './WorkerDriver.js';

describe('WorkerDriver', () => {
    let server: PuterServer;
    let target: WorkerDriver;

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.drivers.workers as unknown as WorkerDriver;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

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

    // Real `user` rows — `apps.owner_user_id` is a foreign key, so app-scoping
    // tests can't get away with synthetic ids.
    const makeUser = async (label: string) =>
        await server.stores.user.create({
            username: `wk-${label}`,
            uuid: `wk-uuid-${label}`,
            password: null,
            email: null,
        });

    const actorFor = (
        user: { id: number; uuid: string; username: string },
        app?: { uid: string; id: number },
    ): Actor => ({
        user: {
            uuid: user.uuid,
            id: user.id,
            username: user.username,
            email: `${user.username}@test.com`,
            email_confirmed: true,
        },
        app,
    });

    describe('actor scoping', () => {
        it('rejects calls without an actor in context', async () => {
            await expect(
                runWithContext({}, () =>
                    target.create({
                        appId: 'test',
                        workerName: 'test',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('rejects calls with an actor missing user.id', async () => {
            const noIdActor = { user: { uuid: 'uuid' } } as Actor;
            await expect(
                inCtx(
                    () =>
                        target.create({
                            appId: 'test',
                            workerName: 'test',
                            filePath: '/test.js',
                        }),
                    noIdActor,
                ),
            ).rejects.toMatchObject({ statusCode: 401 });
        });
    });

    describe('create', () => {
        it('rejects when workerName is missing', async () => {
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test',
                        workerName: '',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects when filePath is missing', async () => {
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test',
                        workerName: 'myworker',
                        filePath: '',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects invalid worker names (special characters)', async () => {
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test',
                        workerName: 'invalid name!',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects worker names with dots', async () => {
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test',
                        workerName: 'my.worker',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('allows valid worker names with underscores and dashes', async () => {
            // This will fail at the CF config check (503) rather than the
            // name validation (400), proving the name was accepted.
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test-app',
                        workerName: 'my-worker_01',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 503 });
        });

        it('lowercases the worker name', async () => {
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test-app',
                        workerName: 'MyWorker',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 503 });
        });

        it('returns 503 when Cloudflare Workers is not configured', async () => {
            await expect(
                inCtx(() =>
                    target.create({
                        appId: 'test-app',
                        workerName: 'validname',
                        filePath: '/test.js',
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 503 });
        });

        it('rejects reserved worker names', async () => {
            const serverWithReserved = await setupTestServer({
                reserved_words: ['admin', 'api'],
            });
            const driverWithReserved = serverWithReserved.drivers
                .workers as unknown as WorkerDriver;
            try {
                await expect(
                    runWithContext({ actor }, () =>
                        driverWithReserved.create({
                            appId: 'test',
                            workerName: 'admin',
                            filePath: '/test.js',
                        }),
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
            } finally {
                await serverWithReserved.shutdown();
            }
        });
    });

    // An app may bind a worker to itself or to an app it created for the same
    // user (the sandbox case), and to nothing else. Deploys die at the CF
    // config check (503) in tests, so 503 here means "the binding was
    // authorized" the same way it means "the name was accepted" above.
    describe('app-scoped worker binding', () => {
        let seq = 0;

        const seedApps = async () => {
            const tag = `wkbind${seq++}`;
            const owner = await makeUser(tag);
            const mkApp = async (label: string, appOwner?: number) =>
                await server.stores.app.create(
                    {
                        name: `${label}-${tag}`,
                        title: `${label}-${tag}`,
                        index_url: `https://${label}-${tag}.example.com/`,
                    },
                    { ownerUserId: owner.id, appOwner },
                );

            const builder = await mkApp('builder');
            const generated = await mkApp('generated', builder.id);
            const unrelated = await mkApp('unrelated');

            const builderActor = actorFor(owner, {
                uid: builder.uid,
                id: builder.id,
            });

            return { owner, tag, builder, generated, unrelated, builderActor };
        };

        const deploy = (appId: string, name: string) =>
            target.create({ appId, workerName: name, filePath: '/test.js' });

        it('lets an app bind a worker to an app it created', async () => {
            const { generated, builderActor } = await seedApps();
            await expect(
                inCtx(() => deploy(generated.uid, 'wk-sandboxed'), builderActor),
            ).rejects.toMatchObject({ statusCode: 503 });
        });

        it('lets an app bind a worker to itself', async () => {
            const { builder, builderActor } = await seedApps();
            await expect(
                inCtx(() => deploy(builder.uid, 'wk-self'), builderActor),
            ).rejects.toMatchObject({ statusCode: 503 });
        });

        it('rejects an app binding a worker to an app it did not create', async () => {
            const { unrelated, builderActor } = await seedApps();
            await expect(
                inCtx(() => deploy(unrelated.uid, 'wk-unrelated'), builderActor),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects an app binding a worker to an unknown app', async () => {
            const { builderActor } = await seedApps();
            await expect(
                inCtx(() => deploy('app-does-not-exist', 'wk-ghost'), builderActor),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects a child app owned by a different user', async () => {
            const { builder, builderActor, tag } = await seedApps();
            // `app_owner` matches the caller, but the row belongs to someone
            // else — both halves have to line up.
            const stranger = await makeUser(`${tag}-stranger`);
            const otherUsersChild = await server.stores.app.create(
                {
                    name: `other-child-${tag}`,
                    title: `other-child-${tag}`,
                    index_url: `https://other-child-${tag}.example.com/`,
                },
                { ownerUserId: stranger.id, appOwner: builder.id },
            );
            await expect(
                inCtx(
                    () => deploy(otherUsersChild.uid, 'wk-otheruser'),
                    builderActor,
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('lets a user-token actor bind a worker to any app it names', async () => {
            const { unrelated, owner } = await seedApps();
            await expect(
                inCtx(() => deploy(unrelated.uid, 'wk-root'), actorFor(owner)),
            ).rejects.toMatchObject({ statusCode: 503 });
        });
    });

    describe('destroy', () => {
        let seq = 0;

        // A user with a builder app, a generated app it created, and a worker
        // row bound to whichever of them the test names.
        const seedWorker = async (bindTo: 'builder' | 'generated' | null) => {
            const tag = `wkdel${seq++}`;
            const owner = await makeUser(tag);
            const builder = await server.stores.app.create(
                {
                    name: `builder-${tag}`,
                    title: `builder-${tag}`,
                    index_url: `https://builder-${tag}.example.com/`,
                },
                { ownerUserId: owner.id },
            );
            const generated = await server.stores.app.create(
                {
                    name: `generated-${tag}`,
                    title: `generated-${tag}`,
                    index_url: `https://generated-${tag}.example.com/`,
                },
                { ownerUserId: owner.id, appOwner: builder.id },
            );
            const appOwner =
                bindTo === 'builder'
                    ? builder.id
                    : bindTo === 'generated'
                      ? generated.id
                      : null;
            const name = tag;
            await server.stores.subdomain.create({
                userId: owner.id,
                subdomain: `workers.puter.${name}`,
                rootDirId: null,
                associatedAppId: null,
                appOwner,
            });
            return { tag, owner, builder, generated, name };
        };

        it('rejects when workerName is missing', async () => {
            await expect(
                inCtx(() => target.destroy({ workerName: '' })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('returns 404 for a worker that does not exist', async () => {
            await expect(
                inCtx(() => target.destroy({ workerName: 'validname' })),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('lets an app destroy a worker bound to an app it created', async () => {
            const { owner, builder, name } = await seedWorker('generated');
            // 503 (not 403) means the ownership chain was accepted and the
            // call reached the deploy backend.
            await expect(
                inCtx(
                    () => target.destroy({ workerName: name }),
                    actorFor(owner, { uid: builder.uid, id: builder.id }),
                ),
            ).rejects.toMatchObject({ statusCode: 503 });
        });

        it('rejects an app destroying a worker bound to an app it does not own', async () => {
            const { tag, owner, name } = await seedWorker('generated');
            const outsider = await server.stores.app.create(
                {
                    name: `outsider-${tag}`,
                    title: `outsider-${tag}`,
                    index_url: `https://outsider-${tag}.example.com/`,
                },
                { ownerUserId: owner.id },
            );
            await expect(
                inCtx(
                    () => target.destroy({ workerName: name }),
                    actorFor(owner, { uid: outsider.uid, id: outsider.id }),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it("rejects destroying another user's worker", async () => {
            const { tag, name } = await seedWorker(null);
            const intruder = await makeUser(`${tag}-intruder`);
            await expect(
                inCtx(
                    () => target.destroy({ workerName: name }),
                    actorFor(intruder),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    describe('getFilePaths', () => {
        it('returns an empty array when the user has no workers', async () => {
            const res = await inCtx(() => target.getFilePaths({}));
            expect(res).toEqual([]);
        });

        it('returns an empty array when querying a non-existent worker name', async () => {
            const res = await inCtx(() =>
                target.getFilePaths({ workerName: 'nonexistent' }),
            );
            expect(res).toEqual([]);
        });

        it('shows an app its own workers and the ones it sandboxed, but not another app’s', async () => {
            const tag = `wklist${Math.random().toString(36).slice(2, 8)}`;
            const owner = await makeUser(tag);
            const mkApp = async (label: string, appOwner?: number) =>
                await server.stores.app.create(
                    {
                        name: `${label}-${tag}`,
                        title: `${label}-${tag}`,
                        index_url: `https://${label}-${tag}.example.com/`,
                    },
                    { ownerUserId: owner.id, appOwner },
                );
            const builder = await mkApp('builder');
            const generated = await mkApp('generated', builder.id);
            const unrelated = await mkApp('unrelated');

            const seed = async (name: string, appOwner: number | null) =>
                await server.stores.subdomain.create({
                    userId: owner.id,
                    subdomain: `workers.puter.${name}`,
                    rootDirId: null,
                    associatedAppId: null,
                    appOwner,
                });
            await seed(`${tag}-own`, builder.id);
            await seed(`${tag}-sandboxed`, generated.id);
            await seed(`${tag}-other`, unrelated.id);
            await seed(`${tag}-userscoped`, null);

            const seen = (
                (await inCtx(
                    () => target.getFilePaths({}),
                    actorFor(owner, { uid: builder.uid, id: builder.id }),
                )) as Array<{ name: string }>
            ).map((r) => r.name);

            expect(seen).toContain(`${tag}-own`);
            expect(seen).toContain(`${tag}-sandboxed`);
            expect(seen).not.toContain(`${tag}-other`);
            expect(seen).not.toContain(`${tag}-userscoped`);
        });

        it('shows a user-token actor every worker in the account', async () => {
            const tag = `wkall${Math.random().toString(36).slice(2, 8)}`;
            const owner = await makeUser(tag);
            const app = await server.stores.app.create(
                {
                    name: `app-${tag}`,
                    title: `app-${tag}`,
                    index_url: `https://app-${tag}.example.com/`,
                },
                { ownerUserId: owner.id },
            );
            for (const [name, appOwner] of [
                [`${tag}-bound`, app.id],
                [`${tag}-loose`, null],
            ] as Array<[string, number | null]>) {
                await server.stores.subdomain.create({
                    userId: owner.id,
                    subdomain: `workers.puter.${name}`,
                    rootDirId: null,
                    associatedAppId: null,
                    appOwner,
                });
            }

            const seen = (
                (await inCtx(
                    () => target.getFilePaths({}),
                    actorFor(owner),
                )) as Array<{ name: string }>
            ).map((r) => r.name);

            expect(seen).toEqual(
                expect.arrayContaining([`${tag}-bound`, `${tag}-loose`]),
            );
        });
    });

    describe('getFilePaths pagination', () => {
        let nextUserId = 90_000;
        const seedWorkers = async (count: number) => {
            const userId = nextUserId++;
            const workerActor = makeActor({
                user: {
                    uuid: `wk-user-${userId}`,
                    id: userId,
                    username: `wk-user-${userId}`,
                    email: `wk-${userId}@test.com`,
                    email_confirmed: true,
                },
                app: undefined,
            });
            const names: string[] = [];
            for (let i = 0; i < count; i++) {
                const name = `wk${userId}n${i}`;
                names.push(name);
                await server.stores.subdomain.create({
                    userId,
                    subdomain: `workers.puter.${name}`,
                    rootDirId: null,
                    associatedAppId: null,
                    appOwner: null,
                });
            }
            return { workerActor, names };
        };

        it('keeps the bare array response when no pagination params are given', async () => {
            const { workerActor, names } = await seedWorkers(3);
            const res = (await inCtx(
                () => target.getFilePaths({}),
                workerActor,
            )) as Array<{ name: string }>;
            expect(Array.isArray(res)).toBe(true);
            expect(res.map((r) => r.name)).toEqual(names);
        });

        it('returns the envelope and pages with cursors when limit is given', async () => {
            const { workerActor, names } = await seedWorkers(5);
            const seen: string[] = [];
            let cursor: string | null | undefined = null;
            do {
                const page = (await inCtx(
                    () => target.getFilePaths({ limit: 2, cursor }),
                    workerActor,
                )) as { items: Array<{ name: string }>; cursor?: string };
                seen.push(...page.items.map((r) => r.name));
                cursor = page.cursor;
            } while (cursor);
            expect(seen).toEqual(names);
        });

        it('supports offset paging and totals', async () => {
            const { workerActor, names } = await seedWorkers(4);
            const page = (await inCtx(
                () =>
                    target.getFilePaths({
                        limit: 10,
                        offset: 1,
                        includeTotal: true,
                    }),
                workerActor,
            )) as { items: Array<{ name: string }>; total?: number };
            expect(page.items.map((r) => r.name)).toEqual(names.slice(1));
            expect(page.total).toBe(names.length);
        });

        it('rejects cursor combined with offset', async () => {
            const { workerActor } = await seedWorkers(2);
            const first = (await inCtx(
                () => target.getFilePaths({ limit: 1, cursor: null }),
                workerActor,
            )) as { cursor?: string };
            expect(first.cursor).toBeDefined();
            await expect(
                inCtx(
                    () =>
                        target.getFilePaths({
                            offset: 1,
                            cursor: first.cursor,
                        }),
                    workerActor,
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('getLoggingUrl', () => {
        it('returns null when loggingUrl is not configured', async () => {
            const res = await inCtx(() => target.getLoggingUrl());
            expect(res).toBeNull();
        });

        it('returns the configured loggingUrl', async () => {
            const serverWithLogging = await setupTestServer({
                workers: { loggingUrl: 'https://logs.test/view' },
            });
            const driverWithLogging = serverWithLogging.drivers
                .workers as unknown as WorkerDriver;
            try {
                const res = await runWithContext({ actor }, () =>
                    driverWithLogging.getLoggingUrl(),
                );
                expect(res).toBe('https://logs.test/view');
            } finally {
                await serverWithLogging.shutdown();
            }
        });
    });

    describe('getReportedCosts', () => {
        it('returns an empty array (workers have no cost reporting)', () => {
            const rows = target.getReportedCosts();
            expect(rows).toEqual([]);
        });
    });

    describe('admission bypass', () => {
        const unverified = (): Actor =>
            makeActor({
                user: {
                    uuid: 'unverified-uuid',
                    id: 1,
                    username: 'unverified',
                    email: 'unverified@test.com',
                    email_confirmed: false,
                },
            });

        it('rejects an unverified account without the bypass', async () => {
            const strictServer = await setupTestServer({
                strict_email_verification_required: true,
            });
            const strictDriver = strictServer.drivers
                .workers as unknown as WorkerDriver;
            try {
                await expect(
                    runWithContext({ actor: unverified() }, () =>
                        strictDriver.create({
                            appId: 'test-app',
                            workerName: 'existing',
                            filePath: '/test.js',
                        }),
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    message: 'Account email is not verified',
                });
            } finally {
                await strictServer.shutdown();
            }
        });

        it('lets the bypass past the verified-email gate', async () => {
            const strictServer = await setupTestServer({
                strict_email_verification_required: true,
            });
            const strictDriver = strictServer.drivers
                .workers as unknown as WorkerDriver;
            try {
                // Cloudflare is unconfigured in tests, so getting as far as the
                // 503 proves the email gate no longer stopped the call.
                await expect(
                    runWithContext({ actor: unverified() }, () =>
                        strictDriver.create({
                            appId: 'test-app',
                            workerName: 'existing',
                            filePath: '/test.js',
                            [INTERNAL_ADMISSION_BYPASS]: true,
                        }),
                    ),
                ).rejects.toMatchObject({ statusCode: 503 });
            } finally {
                await strictServer.shutdown();
            }
        });

        it('skips the per-user worker limit', async () => {
            // The limit is checked after the Cloudflare-config gate, so the
            // driver needs credentials to reach it. Set them on the running
            // server rather than booting a configured one: a server that boots
            // with an account id also demands a built worker preamble, which
            // is not built for backend tests.
            const store = server.stores.subdomain;
            const originalList = store.listByUserIdAndPrefix.bind(store);
            const driverConfig = (
                target as unknown as { config: Record<string, unknown> }
            ).config;
            const originalWorkersConfig = driverConfig.workers;
            driverConfig.workers = {
                XAUTHKEY: 'test-key',
                ACCOUNTID: 'test-account',
            };
            let listCalls = 0;
            store.listByUserIdAndPrefix = (async () => {
                listCalls++;
                return Array.from({ length: 100 }, (_, i) => ({
                    subdomain: `workers.puter.w${i}`,
                })) as never;
            }) as typeof store.listByUserIdAndPrefix;

            try {
                await expect(
                    inCtx(() =>
                        target.create({
                            appId: 'test-app',
                            workerName: 'atcap',
                            filePath: '/test.js',
                        }),
                    ),
                ).rejects.toMatchObject({ statusCode: 403 });
                expect(listCalls).toBe(1);

                // With the bypass the limit is never even counted; the call
                // fails later, on the missing source file.
                await expect(
                    inCtx(() =>
                        target.create({
                            appId: 'test-app',
                            workerName: 'atcap',
                            filePath: '/test.js',
                            [INTERNAL_ADMISSION_BYPASS]: true,
                        }),
                    ),
                ).rejects.not.toMatchObject({ statusCode: 403 });
                expect(listCalls).toBe(1);
            } finally {
                store.listByUserIdAndPrefix = originalList;
                driverConfig.workers = originalWorkersConfig;
            }
        });

        it('cannot be forged through caller-supplied args', async () => {
            const strictServer = await setupTestServer({
                strict_email_verification_required: true,
            });
            const strictDriver = strictServer.drivers
                .workers as unknown as WorkerDriver;
            // Driver args reach the method as parsed JSON from the request
            // body, so parse these the same way a call would.
            const forgeries = [
                '{"skipAdmission":true}',
                '{"skipAdmissionChecks":true}',
                '{"INTERNAL_ADMISSION_BYPASS":true}',
                '{"Symbol(workers.internalAdmissionBypass)":true}',
                '{"__proto__":{"skipAdmission":true}}',
            ];
            try {
                for (const body of forgeries) {
                    const forged = JSON.parse(body) as Record<string, unknown>;
                    expect(Object.getOwnPropertySymbols(forged)).toHaveLength(0);
                    await expect(
                        runWithContext({ actor: unverified() }, () =>
                            strictDriver.create({
                                ...forged,
                                appId: 'test-app',
                                workerName: 'existing',
                                filePath: '/test.js',
                            } as Parameters<WorkerDriver['create']>[0]),
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        message: 'Account email is not verified',
                    });
                }
            } finally {
                await strictServer.shutdown();
            }
        });
    });
});
