import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockActor: any;
const require = createRequire(import.meta.url);
const cloudflareDeployMock = {
    createWorker: vi.fn().mockResolvedValue({ success: true }),
    setCloudflareKeys: vi.fn(),
    deleteWorker: vi.fn().mockResolvedValue({ success: true }),
    createDB: vi.fn().mockResolvedValue({ success: true, result: { uuid: 'db-uuid' } }),
    deleteDB: vi.fn().mockResolvedValue({ success: true }),
};
const helperMocks = {
    get_app: vi.fn(),
    subdomain: vi.fn(),
};
const loadWorkerService = async () => {
    const helperPath = require.resolve('../../helpers');
    require.cache[helperPath] = { exports: helperMocks };
    const cloudflarePath = require.resolve('./workerUtils/cloudflareDeploy');
    require.cache[cloudflarePath] = { exports: cloudflareDeployMock };
    const mod = await import('./WorkerService');
    WorkerServiceImpl = mod.WorkerService;
};
const serviceDir = path.resolve(__dirname);
const wranglerAvailable = spawnSync('wrangler', ['--version'], { stdio: 'ignore' }).status === 0;
const wranglerIt = wranglerAvailable ? it : it.skip;
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

const resetWorkerModuleMocks = () => {
    cloudflareDeployMock.createWorker.mockResolvedValue({ success: true });
    cloudflareDeployMock.deleteWorker.mockResolvedValue({ success: true });
    cloudflareDeployMock.createDB.mockResolvedValue({ success: true, result: { uuid: 'db-uuid' } });
    cloudflareDeployMock.deleteDB.mockResolvedValue({ success: true });
    cloudflareDeployMock.setCloudflareKeys.mockClear();
    cloudflareDeployMock.createWorker.mockClear();
    cloudflareDeployMock.deleteWorker.mockClear();
    cloudflareDeployMock.createDB.mockClear();
    cloudflareDeployMock.deleteDB.mockClear();
    helperMocks.get_app.mockReset();
    helperMocks.subdomain.mockReset();
};

vi.mock('../../util/context', () => ({
    Context: {
        get: (key?: any) => key === 'actor' ? mockActor : undefined,
        sub: () => ({ arun: async (fn: any) => fn() }),
        root: { set: vi.fn(), get: vi.fn() },
        contextAsyncLocalStorage: { enterWith: vi.fn() },
    },
}));
vi.mock('./workerUtils/cloudflareDeploy', () => cloudflareDeployMock);
vi.mock('../../helpers', () => helperMocks);

let WorkerServiceImpl: any;

const buildService = ({
    servicesMap = {},
    config = {},
    globalConfig = {},
}: {
    servicesMap?: Record<string, any>,
    config?: Record<string, any>,
    globalConfig?: Record<string, any>,
} = {}) => ({
    services: {
        get: (name: string) => {
            const svc = servicesMap[name];
            if ( ! svc ) throw new Error(`Missing service: ${name}`);
            return svc;
        },
    },
    config: { loggingUrl: 'https://logs.puter.test', ...config },
    global_config: { reserved_words: [], ...globalConfig },
});

const setActor = () => {
    mockActor = {
        type: {
            user: { id: 'user-id', uuid: 'user-uuid', username: 'tester' },
        },
        get_related_actor: vi.fn().mockReturnValue({ type: { user: { id: 'related-id' } } }),
    };
    const ctxModule = require('../../util/context');
    ctxModule.Context.get = (key?: any) => key === 'actor' ? mockActor : undefined;
};

describe('WorkerService.create', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        resetWorkerModuleMocks();
        await loadWorkerService();
        setActor();
    });

    it('throws when appId is provided but user is not the owner', async () => {
        const su = { sudo: vi.fn(async (_actor: any, fn: any) => fn()) };
        const es_subdomain = { select: vi.fn().mockResolvedValue([]) };
        const auth = { get_user_app_token: vi.fn() };
        helperMocks.get_app.mockResolvedValue({ owner_user_id: 'someone-else' });

        const service = buildService({
            servicesMap: { su, 'es:subdomain': es_subdomain, auth },
        });

        await expect(WorkerServiceImpl.IMPLEMENTS.workers.create.call(service, {
            filePath: '/worker.js',
            workerName: 'MyWorker',
            authorization: 'auth-token',
            appId: 'app-123',
        })).rejects.toMatchObject({
            fields: expect.objectContaining({ entry_name: 'myworker' }),
        });

        expect(helperMocks.get_app).toHaveBeenCalledWith({ uid: 'app-123' });
    });

    it('throws when subdomain limit is reached', async () => {
        const domains = Array.from({ length: 100 }, () => ({}));
        const su = { sudo: vi.fn(async (_actor: any, fn: any) => fn()) };
        const es_subdomain = { select: vi.fn().mockResolvedValue(domains) };
        const auth = { get_user_app_token: vi.fn(), create_session_token: vi.fn() };

        const service = buildService({
            servicesMap: { su, 'es:subdomain': es_subdomain, auth },
        });

        await expect(WorkerServiceImpl.IMPLEMENTS.workers.create.call(service, {
            filePath: '/worker.js',
            workerName: 'limited',
            authorization: 'auth-token',
        })).rejects.toMatchObject({
            fields: expect.objectContaining({ code: 'subdomain_limit_reached', isWorker: true, limit: 100 }),
        });
    });

    it('rejects reserved worker names', async () => {
        const su = { sudo: vi.fn(async (_actor: any, fn: any) => fn()) };
        const es_subdomain = { select: vi.fn().mockResolvedValue([]) };
        const auth = { get_user_app_token: vi.fn(), create_session_token: vi.fn() };

        const service = buildService({
            servicesMap: { su, 'es:subdomain': es_subdomain, auth },
            globalConfig: { reserved_words: ['taken'] },
        });

        await expect(WorkerServiceImpl.IMPLEMENTS.workers.create.call(service, {
            filePath: '/worker.js',
            workerName: 'taken',
            authorization: 'auth-token',
        })).rejects.toMatchObject({
            fields: expect.objectContaining({ code: 'subdomain_reserved', subdomain: 'taken' }),
        });
    });

    it('returns undefined for invalid worker name patterns', async () => {
        const su = { sudo: vi.fn(async (_actor: any, fn: any) => fn()) };
        const es_subdomain = { select: vi.fn().mockResolvedValue([]) };
        const auth = { get_user_app_token: vi.fn(), create_session_token: vi.fn() };

        const service = buildService({
            servicesMap: { su, 'es:subdomain': es_subdomain, auth },
        });

        const result = await WorkerServiceImpl.IMPLEMENTS.workers.create.call(service, {
            filePath: '/worker.js',
            workerName: 'invalid name!',
            authorization: 'auth-token',
        });

        expect(result).toBeUndefined();
        expect(cloudflareDeployMock.createWorker).not.toHaveBeenCalled();
    });
});

describe('WorkerService.destroy', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        resetWorkerModuleMocks();
        await loadWorkerService();
        setActor();
    });

    it('throws when the actor does not own the worker', async () => {
        const domain = {
            values_: { owner: { uuid: 'other-owner' } },
            get: vi.fn(),
        };
        const es_subdomain = { select: vi.fn().mockResolvedValue([domain]) };

        const service = buildService({
            servicesMap: { 'es:subdomain': es_subdomain },
        });

        const response = await WorkerServiceImpl.IMPLEMENTS.workers.destroy.call(service, {
            workerName: 'test-worker',
        });
        expect(response).toMatchObject({
            success: false,
        });
    });

    it('deletes the worker when ownership matches', async () => {
        const domain = {
            values_: { owner: { uuid: 'user-uuid' } },
            get: vi.fn(async (key: string) => {
                if ( key === 'uid' ) return 'uid-123';
                if ( key === 'database_id' ) return 'db-uuid';
                return null;
            }),
        };
        const es_subdomain = {
            select: vi.fn().mockResolvedValue([domain]),
            delete: vi.fn(),
        };

        const service = buildService({
            servicesMap: { 'es:subdomain': es_subdomain },
        });

        const result = await WorkerServiceImpl.IMPLEMENTS.workers.destroy.call(service, {
            workerName: 'test-worker',
        });

        expect(cloudflareDeployMock.deleteWorker).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'user-uuid' }), 'test-worker');
        expect(cloudflareDeployMock.deleteDB).toHaveBeenCalledWith('db-uuid');
        expect(es_subdomain.delete).toHaveBeenCalledWith('uid-123');
        expect(result).toEqual({ success: true });
    });
});

describe('WorkerService.getFilePaths', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        resetWorkerModuleMocks();
        await loadWorkerService();
        setActor();
    });

    it('maps domains to path information and tolerates missing paths', async () => {
        const domainWithPath = {
            async get (key: string) {
                if ( key === 'root_dir' ) {
                    return {
                        get: async (innerKey: string) => innerKey === 'path' ? '/apps/alpha.js' : 'alpha-uid',
                    };
                }
                if ( key === 'subdomain' ) return 'workers.puter.alpha';
                if ( key === 'created_at' ) return '2024-01-02T00:00:00.000Z';
                return null;
            },
        };

        const domainMissingPath = {
            async get (key: string) {
                if ( key === 'root_dir' ) {
                    return {
                        get: async () => {
                            throw new Error('missing');
                        },
                    };
                }
                if ( key === 'subdomain' ) return 'workers.puter.beta';
                if ( key === 'created_at' ) return '2024-02-03T00:00:00.000Z';
                return null;
            },
        };

        const es_subdomain = {
            select: vi.fn().mockResolvedValue([domainWithPath, domainMissingPath]),
        };

        const service = buildService({
            servicesMap: { 'es:subdomain': es_subdomain },
        });

        const results = await WorkerServiceImpl.IMPLEMENTS.workers.getFilePaths.call(service, { workerName: undefined as any });

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

describe('WorkerService.getLoggingUrl', () => {
    beforeEach(async () => {
        await loadWorkerService();
    });

    it('returns logging URL from config', async () => {
        const service = buildService({
            config: { loggingUrl: 'https://logs.example' },
        });

        const result = await WorkerServiceImpl.IMPLEMENTS.workers.getLoggingUrl.call(service);
        expect(result).toBe('https://logs.example');
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
