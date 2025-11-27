import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { ContextInitService } from './ContextInitService';

describe('ContextInitService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'context-init': ContextInitService,
        },
        initLevelString: 'init',
    });

    const contextInitService = testKernel.services!.get('context-init') as any;

    it('should be instantiated', () => {
        expect(contextInitService).toBeInstanceOf(ContextInitService);
    });

    it('should have middleware instance', () => {
        expect(contextInitService.mw).toBeDefined();
        expect(contextInitService.mw.value_initializers_).toBeDefined();
        expect(Array.isArray(contextInitService.mw.value_initializers_)).toBe(true);
    });

    it('should register a value initializer', () => {
        const initialLength = contextInitService.mw.value_initializers_.length;
        
        contextInitService.register_value('test-key', 'test-value');
        
        expect(contextInitService.mw.value_initializers_.length).toBe(initialLength + 1);
    });

    it('should store key-value pair in initializer', () => {
        const service = testKernel.services!.get('context-init') as any;
        
        service.register_value('stored-key', 'stored-value');
        
        const lastInitializer = service.mw.value_initializers_[service.mw.value_initializers_.length - 1];
        expect(lastInitializer.key).toBe('stored-key');
        expect(lastInitializer.value).toBe('stored-value');
    });

    it('should register async factory', () => {
        const service = testKernel.services!.get('context-init') as any;
        const initialLength = service.mw.value_initializers_.length;
        
        const factory = async () => 'async-value';
        service.register_async_factory('async-key', factory);
        
        expect(service.mw.value_initializers_.length).toBe(initialLength + 1);
    });

    it('should store async factory in initializer', () => {
        const service = testKernel.services!.get('context-init') as any;
        
        const factory = async () => 'factory-result';
        service.register_async_factory('factory-key', factory);
        
        const lastInitializer = service.mw.value_initializers_[service.mw.value_initializers_.length - 1];
        expect(lastInitializer.key).toBe('factory-key');
        expect(lastInitializer.async_factory).toBe(factory);
    });

    it('should handle multiple value registrations', () => {
        const service = testKernel.services!.get('context-init') as any;
        
        service.register_value('key1', 'value1');
        service.register_value('key2', 'value2');
        service.register_value('key3', 'value3');
        
        const keys = service.mw.value_initializers_.map((init: any) => init.key);
        expect(keys).toContain('key1');
        expect(keys).toContain('key2');
        expect(keys).toContain('key3');
    });

    it('should have install method on middleware', () => {
        expect(contextInitService.mw.install).toBeDefined();
        expect(typeof contextInitService.mw.install).toBe('function');
    });

    it('should have run method on middleware', () => {
        expect(contextInitService.mw.run).toBeDefined();
        expect(typeof contextInitService.mw.run).toBe('function');
    });
});

