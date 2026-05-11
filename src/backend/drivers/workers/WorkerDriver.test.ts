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
