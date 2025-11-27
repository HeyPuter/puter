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

        // Mock dev-console service
        const mockTurnOn = vi.fn();
        const mockAddWidget = vi.fn();
        const mockDevConsole = {
            turn_on_the_warning_lights: mockTurnOn,
            add_widget: mockAddWidget,
        };
        
        const originalGet = testKernel.services.get.bind(testKernel.services);
        testKernel.services.get = vi.fn((name: string) => {
            if (name === 'dev-console') return mockDevConsole;
            return originalGet(name);
        }) as any;

        try {
            await systemValidationService.mark_invalid('test message', new Error('test error'));

            // Verify error was reported
            expect(mockReport).toHaveBeenCalledWith('INVALID SYSTEM STATE', expect.objectContaining({
                message: 'test message',
                trace: true,
                alarm: true,
            }));

            // Verify dev console was called
            expect(mockTurnOn).toHaveBeenCalled();
            expect(mockAddWidget).toHaveBeenCalled();
        } finally {
            // Restore original environment
            if (systemValidationService.global_config) {
                systemValidationService.global_config.env = originalEnv;
            }
            testKernel.services.get = originalGet as any;
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

        const mockDevConsole = {
            turn_on_the_warning_lights: vi.fn(),
            add_widget: vi.fn(),
        };
        
        const originalGet = testKernel.services.get.bind(testKernel.services);
        testKernel.services.get = vi.fn((name: string) => {
            if (name === 'dev-console') return mockDevConsole;
            return originalGet(name);
        }) as any;

        try {
            await systemValidationService.mark_invalid('test without source');

            expect(mockReport).toHaveBeenCalledWith('INVALID SYSTEM STATE', expect.objectContaining({
                source: expect.any(Error),
            }));
        } finally {
            if (systemValidationService.global_config) {
                systemValidationService.global_config.env = originalEnv;
            }
            testKernel.services.get = originalGet as any;
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

        const mockDevConsole = {
            turn_on_the_warning_lights: vi.fn(),
            add_widget: vi.fn(),
        };
        
        const originalGet = testKernel.services.get.bind(testKernel.services);
        testKernel.services.get = vi.fn((name: string) => {
            if (name === 'dev-console') return mockDevConsole;
            return originalGet(name);
        }) as any;

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
            testKernel.services.get = originalGet as any;
        }
    });
});

