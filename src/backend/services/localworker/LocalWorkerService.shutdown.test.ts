import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

const { disposals } = vi.hoisted(() => ({
    disposals: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock('miniflare', () => ({
    Miniflare: class {
        dispose = vi.fn(async () => {});
        constructor() {
            disposals.push(this.dispose);
        }
    },
}));

describe('LocalWorkerService shutdown disposal', () => {
    let server: PuterServer;
    beforeAll(async () => {
        server = await setupTestServer({
            api_base_url: 'http://api.puter.localhost',
        } as never);
    });
    afterAll(async () => {
        await server.shutdown();
    });
    afterEach(() => {
        vi.useRealTimers();
        disposals.length = 0;
    });

    it('awaits every disposal even if one fails', async () => {
        const service = server.services.localworkerservice;
        await service.cfDeployLocal('first', 'auth', 'export default {}');
        await service.cfDeployLocal('second', 'auth', 'export default {}');
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        disposals[0].mockRejectedValueOnce(new Error('dispose failed'));
        disposals[1].mockImplementationOnce(async () => {
            await held;
        });
        let finished = false;
        const draining = Promise.resolve(service.onServerShutdown()).then(
            () => {
                finished = true;
            },
        );
        try {
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(
                disposals.every((dispose) => dispose.mock.calls.length === 1),
            ).toBe(true);
            expect(finished).toBe(false);
        } finally {
            release();
            await draining;
        }
    });

    it('bounds disposal of a hung worker to five seconds', async () => {
        const service = server.services.localworkerservice;
        await service.cfDeployLocal('hung', 'auth', 'export default {}');
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        disposals[0].mockImplementationOnce(async () => {
            await held;
        });
        vi.useFakeTimers();
        try {
            let finished = false;
            const draining = Promise.resolve(service.onServerShutdown()).then(
                () => {
                    finished = true;
                },
            );
            await vi.advanceTimersByTimeAsync(4_999);
            expect(finished).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await draining;
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            release();
            vi.useRealTimers();
        }
    });
});
