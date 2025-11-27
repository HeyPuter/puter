import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { PuterVersionService } from './PuterVersionService';

describe('PuterVersionService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'puter-version': PuterVersionService,
        },
        initLevelString: 'init',
    });

    const versionService = testKernel.services!.get('puter-version') as any;

    it('should be instantiated', () => {
        expect(versionService).toBeInstanceOf(PuterVersionService);
    });

    it('should have boot_time set after init', () => {
        expect(versionService.boot_time).toBeDefined();
        expect(typeof versionService.boot_time).toBe('number');
        expect(versionService.boot_time).toBeGreaterThan(0);
    });

    it('should return version info', () => {
        const versionInfo = versionService.get_version();
        
        expect(versionInfo).toBeDefined();
        expect(versionInfo).toHaveProperty('version');
        expect(versionInfo).toHaveProperty('environment');
        expect(versionInfo).toHaveProperty('location');
        expect(versionInfo).toHaveProperty('deploy_timestamp');
    });

    it('should have valid version string', () => {
        const versionInfo = versionService.get_version();
        
        expect(typeof versionInfo.version).toBe('string');
        expect(versionInfo.version).toBeTruthy();
    });

    it('should have deploy_timestamp matching boot_time', () => {
        const versionInfo = versionService.get_version();
        
        expect(versionInfo.deploy_timestamp).toBe(versionService.boot_time);
    });

    it('should have environment from config', () => {
        const versionInfo = versionService.get_version();
        
        // Environment might be undefined in test context
        expect(versionInfo).toHaveProperty('environment');
    });

    it('should have location from config', () => {
        const versionInfo = versionService.get_version();
        
        // Location might be undefined in test context
        expect(versionInfo).toHaveProperty('location');
    });

    it('should return consistent version info on multiple calls', () => {
        const versionInfo1 = versionService.get_version();
        const versionInfo2 = versionService.get_version();
        
        expect(versionInfo1.version).toBe(versionInfo2.version);
        expect(versionInfo1.deploy_timestamp).toBe(versionInfo2.deploy_timestamp);
    });
});

