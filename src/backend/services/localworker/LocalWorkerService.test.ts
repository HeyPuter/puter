import { beforeEach, describe, expect, it, vi } from 'vitest';

const instances: Array<{
    options: Record<string, unknown>;
    dispose: ReturnType<typeof vi.fn>;
    dispatchFetch: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('miniflare', () => ({
    Miniflare: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        options: Record<string, unknown>,
    ) {
        const dispose = vi.fn().mockResolvedValue(undefined);
        const dispatchFetch = vi
            .fn()
            .mockImplementation(
                async () => new Response(`ok:${String(options.script)}`),
            );
        const inst = { options, dispose, dispatchFetch };
        instances.push(inst);
        return inst;
    }),
}));

import { LocalWorkerService } from './LocalWorkerService.js';

function makeService() {
    const service = new LocalWorkerService({} as never);
    Object.assign(service as unknown as Record<string, unknown>, {
        config: { api_base_url: 'http://localhost:4100', port: 4100 },
        stores: {
            subdomain: {
                getBySubdomain: vi.fn().mockResolvedValue({
                    uuid: 'sub-uuid-1',
                    user_id: 1,
                    subdomain: 'workers.puter.demo',
                    root_dir_id: 10,
                    app_owner: null,
                }),
            },
            user: {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    uuid: 'user-uuid-1',
                    username: 'alice',
                    suspended: false,
                }),
            },
        },
        services: {},
        clients: {},
        drivers: {},
    });
    return service;
}

describe('LocalWorkerService', () => {
    beforeEach(() => {
        instances.length = 0;
        vi.clearAllMocks();
    });

    it('swaps in the new Miniflare instance before disposing the previous one', async () => {
        const service = makeService();
        await service.cfDeployLocal('swap-worker', 'tok1', 'script-v1');
        expect(instances).toHaveLength(1);
        const first = instances[0];
        expect(first.dispose).not.toHaveBeenCalled();

        await service.cfDeployLocal('swap-worker', 'tok2', 'script-v2');
        expect(instances).toHaveLength(2);
        expect(first.dispose).toHaveBeenCalledTimes(1);

        const res = await service.cfCallLocal(
            'swap-worker',
            new Request('http://swap-worker.workers.puter.localhost:4100/'),
        );
        expect(await res.text()).toBe('ok:script-v2');
        expect(instances[1].dispatchFetch).toHaveBeenCalledTimes(1);

        await service.cfDeleteLocal('swap-worker');
    });

    it('deduplicates concurrent cold-start cfCallLocal requests for the same worker', async () => {
        const service = makeService();
        let resolveReconstruct!: (val: [string, string, string]) => void;
        const reconstructPromise = new Promise<[string, string, string]>(
            (resolve) => {
                resolveReconstruct = resolve;
            },
        );
        const reconstructSpy = vi
            .spyOn(service, 'reconstructDeployArgs')
            .mockReturnValue(reconstructPromise as never);
        const deploySpy = vi.spyOn(service, 'cfDeployLocal');

        const req1 = service.cfCallLocal(
            'cold-worker',
            new Request('http://cold-worker.workers.puter.localhost:4100/a'),
        );
        const req2 = service.cfCallLocal(
            'cold-worker',
            new Request('http://cold-worker.workers.puter.localhost:4100/b'),
        );

        await new Promise((r) => setTimeout(r, 10));
        expect(reconstructSpy).toHaveBeenCalledTimes(1);

        resolveReconstruct(['cold-worker', 'tok', 'cold-script']);
        const [res1, res2] = await Promise.all([req1, req2]);

        expect(deploySpy).toHaveBeenCalledTimes(1);
        expect(await res1.text()).toBe('ok:cold-script');
        expect(await res2.text()).toBe('ok:cold-script');

        await service.cfDeleteLocal('cold-worker');
    });
});
