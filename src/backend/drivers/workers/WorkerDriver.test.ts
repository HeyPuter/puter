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
                        appId: 'test',
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
                        appId: 'test',
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
                        appId: 'test',
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

    describe('destroy', () => {
        it('rejects when workerName is missing', async () => {
            await expect(
                inCtx(() => target.destroy({ workerName: '' })),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('returns 503 when Cloudflare Workers is not configured', async () => {
            await expect(
                inCtx(() => target.destroy({ workerName: 'validname' })),
            ).rejects.toMatchObject({ statusCode: 503 });
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
});
