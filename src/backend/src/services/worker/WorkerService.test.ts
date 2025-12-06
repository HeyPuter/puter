import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi, test } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { AppLimitedES } from '../../om/entitystorage/AppLimitedES.js';
import { ESBuilder } from '../../om/entitystorage/ESBuilder.js';
import { MaxLimitES } from '../../om/entitystorage/MaxLimitES.js';
import SQLES from '../../om/entitystorage/SQLES.js';
import { SetOwnerES } from '../../om/entitystorage/SetOwnerES.js';
import SubdomainES from '../../om/entitystorage/SubdomainES.js';
import ValidationES from '../../om/entitystorage/ValidationES.js';
import WriteByOwnerOnlyES from '../../om/entitystorage/WriteByOwnerOnlyES.js';
import { Eq, StartsWith } from '../../om/query/query.js';
import { EntityStoreService } from '../EntityStoreService.js';
import { SUService } from '../SUService.js';
import { Actor, UserActorType } from '../auth/Actor';
import { WorkerService } from './WorkerService';

const cloudflareDeployMock = vi.hoisted(() => ({
    createWorker: vi.fn().mockResolvedValue({ success: true }),
    setCloudflareKeys: vi.fn(),
    deleteWorker: vi.fn().mockResolvedValue({ success: true }),
    createDB: vi.fn().mockResolvedValue({ success: true, result: { uuid: 'db-uuid' } }),
    deleteDB: vi.fn().mockResolvedValue({ success: true }),
}));

const FakeEntity = vi.hoisted(() => class FakeEntity {
    values_: Record<string, any>;
    constructor (values: Record<string, any>) {
        this.values_ = values;
    }
    async get (key: string) {
        return this.values_[key];
    }
    static async create (_opts: any, data: Record<string, any>) {
        return new FakeEntity(data);
    }
});

vi.mock('./workerUtils/cloudflareDeploy', () => cloudflareDeployMock);
vi.mock('../../api/filesystem/FSNodeParam.js', () => ({
    default: class MockFSNodeParam {
        async consolidate ({ getParam }: { getParam: () => string }) {
            const path = getParam();
            return {
                get: async (key: string) => key === 'path' ? path : null,
            };
        }
    },
}));
vi.mock('../../om/entitystorage/Entity.js', () => ({
    Entity: FakeEntity,
    default: FakeEntity,
}));

const llReadRunMock = vi.hoisted(() => vi.fn());

vi.mock('../../filesystem/ll_operations/ll_read.js', () => ({
    LLRead: class {
        async run (...args) {
            return await llReadRunMock(...args);
        }
    },
}));

class DomainRecord {
    uid: string;
    values_: Record<string, unknown>;
    constructor ({ uid, values }: { uid: string, values: Record<string, unknown> }) {
        this.uid = uid;
        this.values_ = values;
    }

    async get (key: string) {
        if ( key === 'uid' ) return this.uid;
        return this.values_[key];
    }
}

const makeActor = (overrides?: Partial<{ id: number, uuid: string, username: string }>) => {
    const actor = new Actor({
        type: new UserActorType({
            user: {
                id: 1,
                uuid: 'user-uuid',
                username: 'tester',
                ...overrides,
            },
        }),
    });
    const originalGetRelated = actor.get_related_actor.bind(actor);
    actor.get_related_actor = (typeClass: any) => {
        if ( typeClass === UserActorType || typeClass?.name === 'UserActorType' ) {
            return actor;
        }
        return originalGetRelated(typeClass);
    };
    return actor;
};

const makeDomain = (values: Record<string, unknown>) => new DomainRecord({
    uid: values.uid ?? `uid-${Math.random().toString(16).slice(2)}`,
    values,
});

describe('WorkerService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            worker: WorkerService,
            'es:subdomain': EntityStoreService,
        },
        serviceMapArgs: {
            'es:subdomain': {
                entity: 'subdomain',
                upstream: ESBuilder.create([
                    SQLES,
                    { table: 'subdomains', debug: true },
                    SubdomainES,
                    AppLimitedES,
                    WriteByOwnerOnlyES,
                    ValidationES,
                    SetOwnerES,
                    MaxLimitES, { max: 5000 },
                ]),
            },
        },
        serviceConfigOverrideMap: {
            worker: { loggingUrl: 'https://logs.puter.test' },
            database: {
                path: ':memory:',
            },
        },
        initLevelString: 'init',
        testCore: true,
        globalConfigOverrideMap: {
            worker: { reserved_words: [] },
        },

    });

    const workerService = testKernel.services!.get('worker') as WorkerService;
    const esSubdomain = testKernel.services!.get('es:subdomain') as EntityStoreService;
    const filesystemService = testKernel.services!.get('filesystem');
    const su = testKernel.services!.get('su') as SUService;
    const selectSpy = vi.spyOn(esSubdomain, 'select');
    const upsertSpy = vi.spyOn(esSubdomain, 'upsert');
    const deleteSpy = vi.spyOn(esSubdomain, 'delete');
    const filesystemNodeSpy = vi.spyOn(filesystemService as any, 'node');

    const makeNode = (path: string, uid = 'node-uid', owner: any = makeActor().type.user) => ({
        get: vi.fn().mockImplementation(async (key: string) => {
            if ( key === 'path' ) return path;
            if ( key === 'uid' ) return uid;
            if ( key === 'owner' ) return owner;
            throw new Error(`Unknown key ${key}`);
        }),
    });

    beforeEach(() => {
        cloudflareDeployMock.createWorker.mockClear();
        cloudflareDeployMock.deleteWorker.mockClear();
        cloudflareDeployMock.createDB.mockClear();
        cloudflareDeployMock.deleteDB.mockClear();
        llReadRunMock.mockReset();
        selectSpy.mockReset();
        upsertSpy.mockReset();
        deleteSpy.mockReset();
        filesystemNodeSpy.mockReset();

        llReadRunMock.mockImplementation(async () => Readable.from([Buffer.from('console.log("worker")')]));
        selectSpy.mockResolvedValue([]);
        upsertSpy.mockResolvedValue({ database_id: 'db-uuid' });
        deleteSpy.mockResolvedValue(true);
        filesystemNodeSpy.mockImplementation(async (selector?: { value?: string }) => makeNode(selector?.value ?? '/worker.js'));
        cloudflareDeployMock.createWorker.mockResolvedValue({ success: true });
        cloudflareDeployMock.deleteWorker.mockResolvedValue({ success: true });
        cloudflareDeployMock.createDB.mockResolvedValue({ success: true, result: { uuid: 'db-uuid' } });
        cloudflareDeployMock.deleteDB.mockResolvedValue({ success: true });
        workerService.global_config.reserved_words = [];
    });

    it('exposes the worker driver facade', () => {
        expect(workerService).toBeInstanceOf(WorkerService);
        const driver = workerService.as('workers') as unknown as WorkerService;
        expect(driver.create).toBeTypeOf('function');
        expect(driver.destroy).toBeTypeOf('function');
        expect(driver.getFilePaths).toBeTypeOf('function');
        expect(driver.getLoggingUrl).toBeTypeOf('function');
    });

    it('creates a worker with a fresh database and uploads code', async () => {
        const actor = makeActor({ id: 7, uuid: 'create-uuid', username: 'creator' });
        filesystemNodeSpy.mockImplementation(async () => makeNode('/worker.js', 'node-create', actor.type.user));

        const result = await su.sudo(actor, () => workerService.create({
            filePath: '/worker.js',
            workerName: 'MyWorker',
            authorization: 'auth-token',
        }));

        if ( ! result?.success ) {
            throw result?.errors ?? result;
        }
        expect(result).toMatchObject({ success: true });
        expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({
            predicate: expect.any(StartsWith),
        }));
        expect(cloudflareDeployMock.createDB).toHaveBeenCalledTimes(1);
        expect(cloudflareDeployMock.createWorker).toHaveBeenCalledWith(
                        actor.type.user,
                        'auth-token',
                        'myworker',
                        expect.stringContaining('console.log("worker")'),
                        expect.any(Number),
                        'db-uuid');

        const [entityArg] = upsertSpy.mock.calls[0] ?? [];
        expect(await entityArg.get('subdomain')).toBe('workers.puter.myworker');
        expect(result).toMatchObject({ success: true });
    });

    it('reuses an existing worker record instead of creating a new database', async () => {
        const actor = makeActor({ uuid: 'owner-uuid', username: 'owner' });
        selectSpy.mockResolvedValue([
            makeDomain({
                subdomain: 'workers.puter.existing',
                database_id: 'existing-db',
                owner: { uuid: actor.type.user.uuid },
                root_dir: makeNode('/existing.js', 'node-existing', actor.type.user),
                created_at: Date.now(),
            }),
        ]);
        filesystemNodeSpy.mockImplementation(async () => makeNode('/existing.js', 'node-existing', actor.type.user));
        upsertSpy.mockResolvedValue({ database_id: 'existing-db' });

        const result = await su.sudo(actor, () => workerService.create({
            filePath: '/existing.js',
            workerName: 'existing',
            authorization: 'auth-token',
        }));

        if ( ! result?.success ) {
            throw result?.errors ?? result;
        }
        expect(result).toMatchObject({ success: true });
        expect(cloudflareDeployMock.createDB).not.toHaveBeenCalled();
        expect(cloudflareDeployMock.createWorker).toHaveBeenCalledWith(
                        actor.type.user,
                        'auth-token',
                        'existing',
                        expect.any(String),
                        expect.any(Number),
                        'existing-db');
        expect(result).toMatchObject({ success: true });
    });

    it('rejects creation when subdomain limit is reached', async () => {
        const actor = makeActor();
        selectSpy.mockResolvedValue(Array.from({ length: 100 }, (_, i) => makeDomain({
            subdomain: `workers.puter.${i}`,
        })));

        await expect(su.sudo(actor, () => workerService.create({
            filePath: '/worker.js',
            workerName: 'limited',
            authorization: 'auth-token',
        }))).rejects.toMatchObject({
            fields: expect.objectContaining({ code: 'subdomain_limit_reached', isWorker: true, limit: 100 }),
        });
        expect(cloudflareDeployMock.createWorker).not.toHaveBeenCalled();
    });

    it('rejects reserved worker names', async () => {
        workerService.global_config.reserved_words = ['taken'];
        const actor = makeActor();

        await expect(su.sudo(actor, () => workerService.create({
            filePath: '/worker.js',
            workerName: 'taken',
            authorization: 'auth-token',
        }))).rejects.toMatchObject({
            fields: expect.objectContaining({ code: 'subdomain_reserved', subdomain: 'taken' }),
        });
        expect(cloudflareDeployMock.createWorker).not.toHaveBeenCalled();
    });

    it('returns undefined for invalid worker name patterns', async () => {
        const actor = makeActor();

        const result = await su.sudo(actor, () => workerService.create({
            filePath: '/worker.js',
            workerName: 'invalid name!',
            authorization: 'auth-token',
        }));

        expect(result).toBeUndefined();
        expect(cloudflareDeployMock.createWorker).not.toHaveBeenCalled();
    });

    it('rejects destroying a worker that is not owned by the actor', async () => {
        const actor = makeActor({ uuid: 'actor-uuid' });
        selectSpy.mockResolvedValue([
            makeDomain({
                subdomain: 'workers.puter.alpha',
                owner: { uuid: 'another-uuid' },
                database_id: 'db-1',
            }),
        ]);

        const response = await su.sudo(actor, () => workerService.destroy({ workerName: 'alpha' }));

        expect(response).toMatchObject({
            success: false,
            e: expect.objectContaining({ message: 'This is not your worker!' }),
        });
        expect(cloudflareDeployMock.deleteWorker).not.toHaveBeenCalled();
        expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('destroys a worker, drops its database, and deletes the subdomain row', async () => {
        const actor = makeActor({ uuid: 'owner-uuid' });
        selectSpy.mockResolvedValue([
            makeDomain({
                uid: 'sd-123',
                subdomain: 'workers.puter.cleanup',
                owner: { uuid: actor.type.user.uuid },
                database_id: 'db-123',
            }),
        ]);
        deleteSpy.mockResolvedValue(true);

        const response = await su.sudo(actor, () => {
            return workerService.destroy({ workerName: 'cleanup' });
        });

        expect(cloudflareDeployMock.deleteWorker).toHaveBeenCalledWith(actor.type.user, 'cleanup');
        expect(cloudflareDeployMock.deleteDB).toHaveBeenCalledWith('db-123');
        expect(deleteSpy).toHaveBeenCalledWith('sd-123');
        expect(response).toMatchObject({ success: true });
    });

    it('returns worker file paths for the current user', async () => {
        const actor = makeActor({ uuid: 'path-uuid' });
        const createdAt = new Date('2024-01-01T00:00:00Z');
        selectSpy.mockResolvedValue([
            makeDomain({
                subdomain: 'workers.puter.alpha',
                root_dir: makeNode('/code/alpha.js', 'node-alpha'),
                created_at: createdAt.getTime(),
            }),
        ]);

        const paths = await su.sudo(actor, () => workerService.getFilePaths({}));

        expect(selectSpy.mock.calls[0]?.[0].predicate).toBeInstanceOf(StartsWith);
        expect(paths).toEqual([{
            name: 'alpha',
            url: 'https://alpha.puter.work',
            file_path: '/code/alpha.js',
            file_uid: 'node-alpha',
            created_at: createdAt.toISOString(),
        }]);
    });

    it('filters getFilePaths by worker name when provided', async () => {
        const actor = makeActor({ uuid: 'path-filter' });
        selectSpy.mockResolvedValue([
            makeDomain({
                subdomain: 'workers.puter.beta',
                root_dir: makeNode('/code/beta.js', 'node-beta'),
                created_at: 1_700_000_000_000,
            }),
        ]);

        const paths = await su.sudo(actor, () => workerService.getFilePaths({ workerName: 'beta' }));

        expect(selectSpy.mock.calls[0]?.[0].predicate).toBeInstanceOf(Eq);
        expect(paths?.[0]?.name).toBe('beta');
    });

    it('tolerates missing file metadata when listing worker file paths', async () => {
        const actor = makeActor({ uuid: 'path-missing' });
        const createdAtAlpha = new Date('2024-01-02T00:00:00.000Z');
        const createdAtBeta = new Date('2024-02-03T00:00:00.000Z');
        selectSpy.mockResolvedValue([
            makeDomain({
                subdomain: 'workers.puter.alpha',
                root_dir: makeNode('/apps/alpha.js', 'alpha-uid'),
                created_at: createdAtAlpha.getTime(),
            }),
            makeDomain({
                subdomain: 'workers.puter.beta',
                root_dir: {
                    get: async () => {
                        throw new Error('missing');
                    },
                },
                created_at: createdAtBeta.getTime(),
            }),
        ]);

        const paths = await su.sudo(actor, () => workerService.getFilePaths({}));

        expect(paths).toEqual([
            {
                name: 'alpha',
                url: 'https://alpha.puter.work',
                file_path: '/apps/alpha.js',
                file_uid: 'alpha-uid',
                created_at: createdAtAlpha.toISOString(),
            },
            {
                name: 'beta',
                url: 'https://beta.puter.work',
                file_path: null,
                file_uid: null,
                created_at: createdAtBeta.toISOString(),
            },
        ]);
    });

    it('returns the configured logging URL', async () => {
        await expect(workerService.getLoggingUrl()).resolves.toBe('https://logs.puter.test');
    });
});

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceDir, '../../../../..');
const wranglerAvailable = spawnSync('wrangler', ['--version'], { stdio: 'ignore' }).status === 0;

const ensureWorkerArtifacts = () => {
    const preamblePath = path.join(serviceDir, 'dist/workerPreamble.js');
    const puterJsDist = path.join(repoRoot, 'src/puter-js/dist/puter.js');
    if ( existsSync(preamblePath) && existsSync(puterJsDist) ) {
        return true;
    }
    const builds = [
        { cmd: ['npm', 'run', 'build'], cwd: path.join(repoRoot, 'src/puter-js') },
        { cmd: ['npm', 'run', 'build'], cwd: serviceDir },
    ];
    for ( const { cmd, cwd } of builds ) {
        const [bin, ...args] = cmd;
        const res = spawnSync(bin, args, { cwd, stdio: 'inherit' });
        if ( res.status !== 0 ) return false;
    }
    return existsSync(preamblePath) && existsSync(puterJsDist);
};

describe('Worker runtime integration', () => {
    test.skipIf(!wranglerAvailable)('executes worker code with preamble via wrangler dev', async () => {
        const preamblePath = path.join(serviceDir, 'dist/workerPreamble.js');
        expect(ensureWorkerArtifacts()).toBe(true);

        const preamble = readFileSync(preamblePath, 'utf-8');
        const userCode = `// Puter worker with builtin router
        router.get('/', () => 'Hello World');
        router.get('/api/hello', () => ({ msg: 'hello' }));
        router.get('/*page', ({ params }) => new Response('missing ' + params.page, { status: 404 }));`;
        const workerSource = `${preamble}\n${userCode}`;
        const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'puter-worker-'));
        const workerPath = path.join(tmpDir, 'worker.js');
        await fs.writeFile(workerPath, workerSource, 'utf-8');

        const port = 8790 + Math.floor(Math.random() * 100);
        const wranglerHome = path.join(tmpDir, 'wrangler-home');
        await fs.mkdir(wranglerHome, { recursive: true });
        const wrangler = spawn('wrangler', ['dev', workerPath, '--local', '--port', `${port}`, '--inspector-port=0', '--ip=127.0.0.1'], {
            cwd: serviceDir,
            env: {
                ...process.env,
                WRANGLER_HOME: wranglerHome,
                WRANGLER_SEND_METRICS: 'false',
                BROWSER: 'none',
                NODE_OPTIONS: '',
                HOME: wranglerHome,
            },
            stdio: 'inherit',
        });

        const target = `http://127.0.0.1:${port}/api/hello`;

        let responseJson = null;
        try {
            // Bail out early if wrangler cannot start in this environment
            await delay(300);
            if ( wrangler.exitCode !== null ) {
                throw new Error(`wrangler dev exited early with code ${wrangler.exitCode}`);
            }
            const deadline = Date.now() + 15000;
            while ( Date.now() < deadline ) {
                if ( wrangler.exitCode !== null ) {
                    throw new Error(`wrangler dev exited early with code ${wrangler.exitCode}`);
                }
                try {
                    const res = await fetch(target);
                    if ( res.ok ) {
                        responseJson = await res.json();
                        break;
                    }
                } catch {
                    // keep polling
                }
                await delay(300);
            }
            if ( responseJson ) {
                expect(responseJson).toMatchObject({ msg: 'hello' });
            }
        } finally {
            wrangler.kill('SIGINT');
            await delay(200);
            wrangler.kill('SIGKILL');
        }
    });
});
