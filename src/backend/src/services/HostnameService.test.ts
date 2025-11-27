import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { HostnameService } from './HostnameService';

describe('HostnameService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            hostname: HostnameService,
        },
        initLevelString: 'init',
    });

    const hostnameService = testKernel.services!.get('hostname') as HostnameService;

    it('should be instantiated', () => {
        expect(hostnameService).toBeInstanceOf(HostnameService);
    });

    it('should have entries object', () => {
        expect(hostnameService.entries).toBeDefined();
        expect(typeof hostnameService.entries).toBe('object');
    });

    it('should have entries as empty object by default', () => {
        expect(hostnameService.entries).toBeDefined();
        expect(typeof hostnameService.entries).toBe('object');
    });

    it('should have get_broadcast_addresses method', () => {
        expect(typeof hostnameService.get_broadcast_addresses).toBe('function');
    });

    it('should allow manual entry registration', () => {
        hostnameService.entries['manual.test.com'] = { scope: 'test' };
        expect(hostnameService.entries['manual.test.com']).toBeDefined();
        expect(hostnameService.entries['manual.test.com'].scope).toBe('test');
    });

    it('should maintain multiple entries', () => {
        hostnameService.entries['first.test.com'] = { scope: 'web' };
        hostnameService.entries['second.test.com'] = { scope: 'api' };
        
        expect(hostnameService.entries['first.test.com'].scope).toBe('web');
        expect(hostnameService.entries['second.test.com'].scope).toBe('api');
    });
});

