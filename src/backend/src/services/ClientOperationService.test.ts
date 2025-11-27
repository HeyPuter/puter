import { describe, expect, it } from 'vitest';
import { ClientOperationService } from './ClientOperationService';

describe('ClientOperationService', async () => {
    // ClientOperationService doesn't extend BaseService, so we can't use init
    // We need to create it directly
    const services = { _instances: {} };
    const clientOperationService = new ClientOperationService({ services });

    it('should be instantiated', () => {
        expect(clientOperationService).toBeDefined();
        expect(clientOperationService.operations_).toBeDefined();
    });

    it('should have operations array', () => {
        expect(clientOperationService.operations_).toBeDefined();
        expect(Array.isArray(clientOperationService.operations_)).toBe(true);
    });

    it('should create operation with default parameters', async () => {
        const tracker = await clientOperationService.add_operation({});
        
        expect(tracker).toBeDefined();
        expect(tracker.name).toBe('untitled');
        expect(Array.isArray(tracker.tags)).toBe(true);
        expect(tracker.tags.length).toBe(0);
        expect(tracker.frame).toBe(null);
        expect(tracker.metadata).toBeDefined();
        expect(typeof tracker.metadata).toBe('object');
        expect(Array.isArray(tracker.objects)).toBe(true);
    });

    it('should create operation with name', async () => {
        const tracker = await clientOperationService.add_operation({
            name: 'test-operation',
        });
        
        expect(tracker.name).toBe('test-operation');
    });

    it('should create operation with tags', async () => {
        const tags = ['tag1', 'tag2', 'tag3'];
        const tracker = await clientOperationService.add_operation({
            tags,
        });
        
        expect(tracker.tags).toEqual(tags);
    });

    it('should create operation with frame', async () => {
        const frame = { type: 'test-frame' };
        const tracker = await clientOperationService.add_operation({
            frame,
        });
        
        expect(tracker.frame).toBe(frame);
    });

    it('should create operation with metadata', async () => {
        const metadata = { key1: 'value1', key2: 'value2' };
        const tracker = await clientOperationService.add_operation({
            metadata,
        });
        
        expect(tracker.metadata).toEqual(metadata);
    });

    it('should create operation with objects', async () => {
        const objects = [{ id: 1 }, { id: 2 }];
        const tracker = await clientOperationService.add_operation({
            objects,
        });
        
        expect(tracker.objects).toEqual(objects);
    });

    it('should create operation with all parameters', async () => {
        const params = {
            name: 'full-operation',
            tags: ['full', 'test'],
            frame: { type: 'frame' },
            metadata: { meta: 'data' },
            objects: [{ obj: 1 }],
        };
        
        const tracker = await clientOperationService.add_operation(params);
        
        expect(tracker.name).toBe(params.name);
        expect(tracker.tags).toEqual(params.tags);
        expect(tracker.frame).toBe(params.frame);
        expect(tracker.metadata).toEqual(params.metadata);
        expect(tracker.objects).toEqual(params.objects);
    });

    it('should create multiple operations', async () => {
        const tracker1 = await clientOperationService.add_operation({ name: 'op1' });
        const tracker2 = await clientOperationService.add_operation({ name: 'op2' });
        const tracker3 = await clientOperationService.add_operation({ name: 'op3' });
        
        expect(tracker1.name).toBe('op1');
        expect(tracker2.name).toBe('op2');
        expect(tracker3.name).toBe('op3');
    });

    it('should have ckey method', () => {
        expect(clientOperationService.ckey).toBeDefined();
        expect(typeof clientOperationService.ckey).toBe('function');
    });

    it('should generate context key with ckey', () => {
        const key = clientOperationService.ckey('test-key');
        
        expect(key).toBeDefined();
        expect(typeof key).toBe('string');
        expect(key).toContain('test-key');
    });

    it('should generate different keys for different inputs', () => {
        const key1 = clientOperationService.ckey('key1');
        const key2 = clientOperationService.ckey('key2');
        
        expect(key1).not.toBe(key2);
    });
});

