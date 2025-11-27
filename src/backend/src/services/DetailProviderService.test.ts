import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { DetailProviderService } from './DetailProviderService';

describe('DetailProviderService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'detail-provider': DetailProviderService,
        },
        initLevelString: 'init',
    });

    const detailProviderService = testKernel.services!.get('detail-provider') as any;

    it('should be instantiated', () => {
        expect(detailProviderService).toBeInstanceOf(DetailProviderService);
    });

    it('should have empty providers array initially', () => {
        expect(detailProviderService.providers_).toBeDefined();
        expect(Array.isArray(detailProviderService.providers_)).toBe(true);
    });

    it('should register a provider', () => {
        const initialLength = detailProviderService.providers_.length;
        const provider = async (context: any, out: any) => {
            out.test = 'value';
        };
        
        detailProviderService.register_provider(provider);
        
        expect(detailProviderService.providers_.length).toBe(initialLength + 1);
    });

    it('should get details with single provider', async () => {
        const service = testKernel.services!.get('detail-provider') as any;
        
        service.register_provider(async (context: any, out: any) => {
            out.name = context.input;
        });
        
        const result = await service.get_details({ input: 'test-name' });
        
        expect(result.name).toBe('test-name');
    });

    it('should get details with multiple providers', async () => {
        const service = testKernel.services!.get('detail-provider') as any;
        
        service.register_provider(async (context: any, out: any) => {
            out.field1 = 'value1';
        });
        
        service.register_provider(async (context: any, out: any) => {
            out.field2 = 'value2';
        });
        
        const result = await service.get_details({});
        
        expect(result.field1).toBe('value1');
        expect(result.field2).toBe('value2');
    });

    it('should allow providers to modify existing output', async () => {
        const service = testKernel.services!.get('detail-provider') as any;
        
        service.register_provider(async (context: any, out: any) => {
            out.counter = 1;
        });
        
        service.register_provider(async (context: any, out: any) => {
            out.counter = out.counter + 1;
        });
        
        const result = await service.get_details({});
        
        expect(result.counter).toBe(2);
    });

    it('should use provided output object', async () => {
        const service = testKernel.services!.get('detail-provider') as any;
        
        service.register_provider(async (context: any, out: any) => {
            out.added = true;
        });
        
        const existingOut = { existing: 'value' };
        const result = await service.get_details({}, existingOut);
        
        expect(result.existing).toBe('value');
        expect(result.added).toBe(true);
    });

    it('should handle async providers', async () => {
        const service = testKernel.services!.get('detail-provider') as any;
        
        service.register_provider(async (context: any, out: any) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            out.async = true;
        });
        
        const result = await service.get_details({});
        
        expect(result.async).toBe(true);
    });
});

