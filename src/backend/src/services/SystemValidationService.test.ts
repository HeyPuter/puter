import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { SystemValidationService } from './SystemValidationService';

describe('SystemValidationService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'system-validation': SystemValidationService,
        },
        initLevelString: 'init',
    });

    const systemValidationService = testKernel.services!.get('system-validation') as any;

    it('should be instantiated', () => {
        expect(systemValidationService).toBeInstanceOf(SystemValidationService);
    });

    it('should have mark_invalid method', () => {
        expect(systemValidationService.mark_invalid).toBeDefined();
        expect(typeof systemValidationService.mark_invalid).toBe('function');
    });

    it('should handle mark_invalid in dev environment', async () => {
        // Set up dev environment
        const originalEnv = systemValidationService.global_config?.env;
        if (systemValidationService.global_config) {
            systemValidationService.global_config.env = 'dev';
        }

        // Mock the error service
        const mockReport = vi.fn();
        systemValidationService.errors = {
            report: mockReport,
        };

        try {
            await systemValidationService.mark_invalid('test message', new Error('test error'));

            // Verify error was reported
            expect(mockReport).toHaveBeenCalledWith('INVALID SYSTEM STATE', expect.objectContaining({
                message: 'test message',
                trace: true,
                alarm: true,
            }));
        } finally {
            // Restore original environment
            if (systemValidationService.global_config) {
                systemValidationService.global_config.env = originalEnv;
            }
        }
    });

    it('should create source error if not provided', async () => {
        const originalEnv = systemValidationService.global_config?.env;
        if (systemValidationService.global_config) {
            systemValidationService.global_config.env = 'dev';
        }

        const mockReport = vi.fn();
        systemValidationService.errors = {
            report: mockReport,
        };

        try {
            await systemValidationService.mark_invalid('test without source');

            expect(mockReport).toHaveBeenCalledWith('INVALID SYSTEM STATE', expect.objectContaining({
                source: expect.any(Error),
            }));
        } finally {
            if (systemValidationService.global_config) {
                systemValidationService.global_config.env = originalEnv;
            }
        }
    });

    it('should report with correct parameters', async () => {
        const originalEnv = systemValidationService.global_config?.env;
        if (systemValidationService.global_config) {
            systemValidationService.global_config.env = 'dev';
        }

        const mockReport = vi.fn();
        systemValidationService.errors = {
            report: mockReport,
        };

        try {
            const testError = new Error('specific error');
            await systemValidationService.mark_invalid('specific message', testError);

            expect(mockReport).toHaveBeenCalledWith('INVALID SYSTEM STATE', {
                source: testError,
                message: 'specific message',
                trace: true,
                alarm: true,
            });
        } finally {
            if (systemValidationService.global_config) {
                systemValidationService.global_config.env = originalEnv;
            }
        }
    });
});
