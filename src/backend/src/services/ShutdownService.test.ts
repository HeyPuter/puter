import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { ShutdownService } from './ShutdownService';

describe('ShutdownService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            shutdown: ShutdownService,
        },
        initLevelString: 'construct',
    });

    const shutdownService = testKernel.services!.get('shutdown') as ShutdownService;

    // Mock the logger for the service
    shutdownService.log = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };

    it('should be instantiated', () => {
        expect(shutdownService).toBeInstanceOf(ShutdownService);
    });

    it('should have shutdown method', () => {
        expect(typeof shutdownService.shutdown).toBe('function');
    });

    it('should call process.exit when shutdown is called', () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => {}) as any);

        shutdownService.shutdown({ reason: 'test shutdown', code: 0 });

        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(stdoutSpy).toHaveBeenCalled();

        exitSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it('should use default exit code when not provided', () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => {}) as any);

        shutdownService.shutdown({ reason: 'test' });

        expect(exitSpy).toHaveBeenCalledWith(0);

        exitSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it('should use custom exit code when provided', () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => {}) as any);

        shutdownService.shutdown({ reason: 'error', code: 1 });

        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it('should work without any parameters', () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => {}) as any);

        shutdownService.shutdown();

        expect(exitSpy).toHaveBeenCalledWith(0);

        exitSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});

