import { beforeAll, describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { RegistryService } from './RegistryService';

describe('RegistryService', async () => {
    // Initialize globalThis.kv for testing
    beforeAll(() => {
        if (!globalThis.kv) {
            globalThis.kv = new Map();
            globalThis.kv.set = function(key, value) {
                return Map.prototype.set.call(this, key, value);
            };
            globalThis.kv.get = function(key) {
                return Map.prototype.get.call(this, key);
            };
            globalThis.kv.exists = function(key) {
                return this.has(key);
            };
            globalThis.kv.del = function(key) {
                return this.delete(key);
            };
            globalThis.kv.keys = function(pattern) {
                const prefix = pattern.replace('*', '');
                return Array.from(this.keys()).filter(k => k.startsWith(prefix));
            };
        }
    });

    const testKernel = await createTestKernel({
        serviceMap: {
            registry: RegistryService,
        },
        initLevelString: 'init',
    });

    const registryService = testKernel.services!.get('registry') as RegistryService;

    it('should be instantiated', () => {
        expect(registryService).toBeInstanceOf(RegistryService);
    });

    it('should register a collection', () => {
        const collection = registryService.register_collection('test-collection');
        expect(collection).toBeDefined();
    });

    it('should retrieve registered collection', () => {
        registryService.register_collection('retrieve-collection');
        const collection = registryService.get('retrieve-collection');
        expect(collection).toBeDefined();
    });

    it('should throw error when registering duplicate collection', () => {
        registryService.register_collection('duplicate-collection');
        expect(() => {
            registryService.register_collection('duplicate-collection');
        }).toThrow('collection duplicate-collection already exists');
    });

    it('should throw error when getting non-existent collection', () => {
        expect(() => {
            registryService.get('non-existent-collection');
        }).toThrow('collection non-existent-collection does not exist');
    });

    it('should allow setting values in collection', () => {
        const collection = registryService.register_collection('value-collection');
        collection.set('key1', 'value1');
        expect(collection.get('key1')).toBe('value1');
    });

    it('should allow checking existence in collection', () => {
        const collection = registryService.register_collection('exists-collection');
        collection.set('existing-key', 'value');
        expect(collection.exists('existing-key')).toBe(true);
        expect(collection.exists('non-existing-key')).toBe(false);
    });

    it('should allow deleting from collection', () => {
        const collection = registryService.register_collection('delete-collection');
        collection.set('delete-key', 'value');
        expect(collection.exists('delete-key')).toBe(true);
        collection.del('delete-key');
        expect(collection.exists('delete-key')).toBe(false);
    });

    it('should support multiple independent collections', () => {
        const collection1 = registryService.register_collection('coll1');
        const collection2 = registryService.register_collection('coll2');
        
        collection1.set('key', 'value1');
        collection2.set('key', 'value2');
        
        expect(collection1.get('key')).toBe('value1');
        expect(collection2.get('key')).toBe('value2');
    });
});

