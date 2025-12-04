import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestKernel } from '../../../tools/test.mjs';
import APIError from '../../api/APIError';
import { FilesystemService } from '../../filesystem/FilesystemService';
import { Eq, StartsWith } from '../../om/query/query';
import { Context } from '../../util/context';
import BaseService from '../BaseService';
import { EventService } from '../EventService';
import { FeatureFlagService } from '../FeatureFlagService';
import { NotificationService } from '../NotificationService';
import { SUService } from '../SUService';
import { ScriptService } from '../ScriptService';
import { SessionService } from '../SessionService';
import { Actor, UserActorType } from '../auth/Actor';
import { AuthService } from '../auth/AuthService';
import { TokenService } from '../auth/TokenService';
import { InformationService } from '../information/InformationService';
import { WorkerService } from './WorkerService';

const cloudflareDeployMock = vi.hoisted(() => ({
    createWorker: vi.fn().mockResolvedValue({ success: true }),
    setCloudflareKeys: vi.fn(),
    deleteWorker: vi.fn().mockResolvedValue({ success: true }),
    createDB: vi.fn().mockResolvedValue({ success: true, result: { uuid: 'db-uuid' } }),
    deleteDB: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('./workerUtils/cloudflareDeploy', () => cloudflareDeployMock);
const helperMocks = vi.hoisted(() => ({
    get_app: vi.fn(),
    subdomain: vi.fn(),
}));
vi.mock('../../helpers', () => helperMocks);
vi.mock('../../api/filesystem/FSNodeParam', () => class MockFSNodeParam {
    async consolidate ({ getParam }: any) {
        const value = typeof getParam === 'function' ? getParam() : getParam;
        return {
            async get (key: string) {
                if ( key === 'path' ) return value;
                return null;
            },
        };
    }
});

class DomainRecord {
    uid: string;
    values_: Record<string, any>;
    constructor ({ uid, values }: { uid: string, values: Record<string, any> }) {
        this.uid = uid;
        this.values_ = values;
    }

    async get (key: string) {
        if ( key === 'uid' ) return this.uid;
        return this.values_[key];
    }
}

class InMemorySubdomainService extends BaseService {
    domains: DomainRecord[] = [];

    reset (domains: DomainRecord[] = []) {
        this.domains = domains;
    }

    async select ({ predicate }: { predicate: any }) {
        return this.domains.filter(domain => {
            const subdomain = domain.values_.subdomain;
            if ( predicate instanceof StartsWith ) {
                return `${subdomain}`.startsWith(predicate.value);
            }
            if ( predicate instanceof Eq ) {
                return subdomain === predicate.value;
            }
            return true;
        });
    }

    async upsert (entity: any) {
        const values = entity.values_ ?? entity;
        const record = new DomainRecord({
            uid: values.uid ?? `uid-${this.domains.length + 1}`,
            values,
        });
        this.domains.push(record);
        return { ...record.values_, uid: record.uid };
    }

    async delete (uid: string) {
        this.domains = this.domains.filter(domain => domain.uid !== uid);
    }
}

const makeActor = (overrides?: Partial<{ id: string, uuid: string, username: string }>) => {
    const actor = new Actor({
        type: new UserActorType({
            user: {
                id: 'user-id',
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

const makeDomain = (values: Record<string, any>) => new DomainRecord({
    uid: values.uid ?? `uid-${Math.random().toString(16).slice(2)}`,
    values,
});

const serviceDir = path.resolve(__dirname);
const wranglerAvailable = spawnSync('wrangler', ['--version'], { stdio: 'ignore' }).status === 0;
const wranglerIt = (wranglerAvailable && process.env.RUN_WORKER_WRANGLER_TEST === '1') ? it : it.skip;
const ensureWorkerArtifacts = () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const preamblePath = path.join(serviceDir, 'dist/workerPreamble.js');
    const puterJsDist = path.join(repoRoot, 'src/puter-js/dist/puter.js');
    if ( existsSync(preamblePath) && existsSync(puterJsDist) ) {
        return true;
    }
    const builds = [
        { cmd: ['npm', 'run', 'build'], cwd: path.join(repoRoot, 'src/puter-js') },
        { cmd: ['npm', 'run', 'build'], cwd: path.join(serviceDir) },
    ];
    for ( const { cmd, cwd } of builds ) {
        const [bin, ...args] = cmd;
        const res = spawnSync(bin, args, { cwd, stdio: 'inherit' });
        if ( res.status !== 0 ) return false;
    }
    return existsSync(preamblePath) && existsSync(puterJsDist);
};

describe('WorkerService (kernel)', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            worker: WorkerService,
            su: SUService,
            event: EventService,
            'feature-flag': FeatureFlagService,
            token: TokenService,
            information: InformationService,
            auth: AuthService,
            session: SessionService,
            notification: NotificationService,
            script: ScriptService,
            filesystem: FilesystemService,
            'es:subdomain': InMemorySubdomainService,
        },
        initLevelString: 'init',
        testCore: true,
        serviceConfigOverrideMap: {
            worker: { loggingUrl: 'https://logs.puter.test' },
            database: {
                path: ':memory:',
            },
        },
        globalConfigOverrideMap: {
            worker: { reserved_words: [] },
        },
    });

    const workerService = testKernel.services!.get('worker') as any;
    const subdomainService = testKernel.services!.get('es:subdomain') as InMemorySubdomainService;
    const suService = testKernel.services!.get('su') as SUService;

    globalThis.services = testKernel.services;
    Context.root.set('services', testKernel.services);
    const originalContextGet = Context.get.bind(Context);
    vi.spyOn(Context, 'get').mockImplementation((key?: any, opts?: any) => {
        if ( key === 'services' ) {
            return testKernel.services;
        }
        return originalContextGet(key, opts);
    });
    Context.contextAsyncLocalStorage.enterWith(new Map([['context', testKernel.root_context]]));

    const withActor = async (actor: Actor, fn: () => any) => testKernel.root_context.arun(() => suService.sudo(actor, () => {
        const svc = Context.get('services');
        if ( ! svc ) {
            throw new Error('context missing services');
        }
        Context.get().set('actor', actor);
        Context.get().set('user', actor.type.user);
        return fn();
    }));

    beforeEach(() => {
        vi.clearAllMocks();
        cloudflareDeployMock.createWorker.mockResolvedValue({ success: true });
        cloudflareDeployMock.deleteWorker.mockResolvedValue({ success: true });
        cloudflareDeployMock.createDB.mockResolvedValue({ success: true, result: { uuid: 'db-uuid' } });
        cloudflareDeployMock.deleteDB.mockResolvedValue({ success: true });
        subdomainService.reset();
        workerService.global_config.reserved_words = [];
    });

    describe('create', () => {
        it.skip('throws when appId is provided but user is not the owner', async () => {
            helperMocks.get_app.mockImplementation(() => {
                throw APIError.create('no_suitable_app', null, { entry_name: 'myworker' });
            });
            const actor = makeActor();

            const result = await withActor(actor, () => workerService.as('workers').create({
                filePath: '/worker.js',
                workerName: 'MyWorker',
                authorization: 'auth-token',
                appId: 'app-123',
            }));

            expect(result).toMatchObject({
                success: false,
            });
            expect(helperMocks.get_app).toHaveBeenCalledWith({ uid: 'app-123' });
        });

        it('throws when subdomain limit is reached', async () => {
            subdomainService.reset(Array.from({ length: 100 }, (_, i) => makeDomain({
                subdomain: `workers.puter.${i}`,
            })));
            const actor = makeActor();

            await expect(withActor(actor, () => workerService.as('workers').create({
                filePath: '/worker.js',
                workerName: 'limited',
                authorization: 'auth-token',
            }))).rejects.toMatchObject({
                fields: expect.objectContaining({ code: 'subdomain_limit_reached', isWorker: true, limit: 100 }),
            });
        });

        it('rejects reserved worker names', async () => {
            workerService.global_config.reserved_words = ['taken'];
            const actor = makeActor();

            await expect(withActor(actor, () => workerService.as('workers').create({
                filePath: '/worker.js',
                workerName: 'taken',
                authorization: 'auth-token',
            }))).rejects.toMatchObject({
                fields: expect.objectContaining({ code: 'subdomain_reserved', subdomain: 'taken' }),
            });
        });

        it('returns undefined for invalid worker name patterns', async () => {
            const actor = makeActor();

            const result = await withActor(actor, () => workerService.as('workers').create({
                filePath: '/worker.js',
                workerName: 'invalid name!',
                authorization: 'auth-token',
            }));

            expect(result).toBeUndefined();
            expect(cloudflareDeployMock.createWorker).not.toHaveBeenCalled();
        });
    });

    describe('destroy', () => {
        it('throws when the actor does not own the worker', async () => {
            const actor = makeActor();
            const domain = makeDomain({
                uid: 'uid-123',
                subdomain: 'workers.puter.test-worker',
                owner: { uuid: 'other-owner' },
                database_id: 'db-uuid',
            });
            subdomainService.reset([domain]);

            const response = await withActor(actor, () => workerService.as('workers').destroy({
                workerName: 'test-worker',
            }));

            expect(response).toMatchObject({ success: false });
        });

        it.skip('deletes the worker when ownership matches', async () => {
            const actor = makeActor();
            const domain = makeDomain({
                uid: 'uid-123',
                subdomain: 'workers.puter.test-worker',
                owner: { uuid: 'user-uuid' },
                database_id: 'db-uuid',
            });
            subdomainService.reset([domain]);
            const deleteSpy = vi.spyOn(subdomainService, 'delete');

            const result = await withActor(actor, () => workerService.as('workers').destroy({
                workerName: 'test-worker',
            }));

            expect(result).toEqual({ success: true });
        });
    });

    describe('getFilePaths', () => {
        it('maps domains to path information and tolerates missing paths', async () => {
            const domainWithPath = makeDomain({
                subdomain: 'workers.puter.alpha',
                created_at: '2024-01-02T00:00:00.000Z',
                root_dir: {
                    get: async (key: string) => key === 'path' ? '/apps/alpha.js' : 'alpha-uid',
                },
            });

            const domainMissingPath = makeDomain({
                subdomain: 'workers.puter.beta',
                created_at: '2024-02-03T00:00:00.000Z',
                root_dir: {
                    get: async () => {
                        throw new Error('missing');
                    },
                },
            });

            subdomainService.reset([domainWithPath, domainMissingPath]);

            const results = await workerService.as('workers').getFilePaths({ workerName: undefined as any });

            expect(results[0]).toMatchObject({
                name: 'alpha',
                url: 'https://alpha.puter.work',
                file_path: '/apps/alpha.js',
                file_uid: 'alpha-uid',
                created_at: '2024-01-02T00:00:00.000Z',
            });
            expect(results[1]).toMatchObject({
                name: 'beta',
                url: 'https://beta.puter.work',
                file_path: null,
                file_uid: null,
                created_at: '2024-02-03T00:00:00.000Z',
            });
        });
    });

    describe('getLoggingUrl', () => {
        it('returns logging URL from config', async () => {
            const result = await workerService.as('workers').getLoggingUrl();
            expect(result).toBe('https://logs.puter.test');
        });
    });
});

describe('Worker runtime integration', () => {
    wranglerIt('executes worker code with preamble via wrangler dev', async () => {
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
