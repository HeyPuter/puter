import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { LockService } from './LockService';

describe('LockService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            lock: LockService,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const lockService = testKernel.services!.get('lock') as LockService;

    it('should be instantiated', () => {
        expect(lockService).toBeInstanceOf(LockService);
    });

    it('should acquire and release a lock', async () => {
        let executed = false;
        await lockService.lock('test-lock', async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });

    it('should execute callback within lock', async () => {
        const result = await lockService.lock('test-lock-2', async () => {
            return 'success';
        });
        expect(result).toBe('success');
    });

    it('should handle multiple sequential locks', async () => {
        const results: number[] = [];
        
        await lockService.lock('seq-lock', async () => {
            results.push(1);
        });
        
        await lockService.lock('seq-lock', async () => {
            results.push(2);
        });
        
        expect(results).toEqual([1, 2]);
    });

    it('should handle locks with options', async () => {
        let executed = false;
        await lockService.lock('opt-lock', { timeout: 5000 }, async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });

    it('should support array of lock names', async () => {
        let executed = false;
        await lockService.lock(['lock-a', 'lock-b'], async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });

    it('should maintain lock state', async () => {
        await lockService.lock('state-lock', async () => {
            expect(lockService.locks['state-lock']).toBeDefined();
        });
        // Lock should still exist after release
        expect(lockService.locks['state-lock']).toBeDefined();
    });

    it('should handle errors within lock callback', async () => {
        await expect(
            lockService.lock('error-lock', async () => {
                throw new Error('Test error');
            })
        ).rejects.toThrow('Test error');
    });
});

