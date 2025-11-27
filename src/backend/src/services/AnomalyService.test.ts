import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { AnomalyService, DENY_SERVICE_INSTRUCTION } from './AnomalyService';

describe('AnomalyService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'anomaly': AnomalyService,
        },
        initLevelString: 'init',
    });

    const anomalyService = testKernel.services!.get('anomaly') as any;

    it('should be instantiated', () => {
        expect(anomalyService).toBeInstanceOf(AnomalyService);
    });

    it('should have types object', () => {
        expect(anomalyService.types).toBeDefined();
        expect(typeof anomalyService.types).toBe('object');
    });

    it('should register a type with handler', () => {
        const handler = vi.fn();
        anomalyService.register('test-type', { handler });
        
        expect(anomalyService.types['test-type']).toBeDefined();
        expect(anomalyService.types['test-type'].handler).toBe(handler);
    });

    it('should register a type with threshold', () => {
        anomalyService.register('threshold-type', { high: 100 });
        
        expect(anomalyService.types['threshold-type']).toBeDefined();
        expect(anomalyService.types['threshold-type'].handler).toBeDefined();
        expect(typeof anomalyService.types['threshold-type'].handler).toBe('function');
    });

    it('should call handler when noting anomaly', async () => {
        const handler = vi.fn().mockReturnValue('result');
        anomalyService.register('callable-type', { handler });
        
        const data = { test: 'data' };
        const result = await anomalyService.note('callable-type', data);
        
        expect(handler).toHaveBeenCalledWith(data);
        expect(result).toBe('result');
    });

    it('should return undefined for unregistered type', async () => {
        const result = await anomalyService.note('non-existent-type', {});
        
        expect(result).toBeUndefined();
    });

    it('should trigger threshold handler when value exceeds high', async () => {
        anomalyService.register('high-threshold', { high: 50 });
        
        const result = await anomalyService.note('high-threshold', { value: 75 });
        
        expect(result).toBeDefined();
        expect(result).toBeInstanceOf(Set);
        expect(result.has(DENY_SERVICE_INSTRUCTION)).toBe(true);
    });

    it('should not trigger threshold handler when value is below high', async () => {
        anomalyService.register('low-threshold', { high: 100 });
        
        const result = await anomalyService.note('low-threshold', { value: 50 });
        
        expect(result).toBeUndefined();
    });

    it('should handle multiple type registrations', () => {
        anomalyService.register('type1', { handler: () => {} });
        anomalyService.register('type2', { high: 100 });
        anomalyService.register('type3', { handler: () => {} });
        
        expect(anomalyService.types['type1']).toBeDefined();
        expect(anomalyService.types['type2']).toBeDefined();
        expect(anomalyService.types['type3']).toBeDefined();
    });

    it('should store config in type instance', () => {
        const config = { high: 200, custom: 'value' };
        anomalyService.register('config-type', config);
        
        expect(anomalyService.types['config-type'].config).toBe(config);
    });

    it('should handle exact threshold value', async () => {
        anomalyService.register('exact-threshold', { high: 100 });
        
        const result = await anomalyService.note('exact-threshold', { value: 100 });
        
        // Threshold uses > not >=, so equal should not trigger
        expect(result).toBeUndefined();
    });

    it('should handle value just over threshold', async () => {
        anomalyService.register('just-over', { high: 100 });
        
        const result = await anomalyService.note('just-over', { value: 100.1 });
        
        expect(result).toBeDefined();
        expect(result).toBeInstanceOf(Set);
        expect(result.has(DENY_SERVICE_INSTRUCTION)).toBe(true);
    });

    it('should allow custom handler to return any value', async () => {
        const customResult = { custom: 'result', data: [1, 2, 3] };
        anomalyService.register('custom-return', { 
            handler: () => customResult 
        });
        
        const result = await anomalyService.note('custom-return', {});
        
        expect(result).toBe(customResult);
    });
});

describe('DENY_SERVICE_INSTRUCTION', () => {
    it('should be a symbol', () => {
        expect(typeof DENY_SERVICE_INSTRUCTION).toBe('symbol');
    });

    it('should be unique', () => {
        const anotherSymbol = Symbol('DENY_SERVICE_INSTRUCTION');
        expect(DENY_SERVICE_INSTRUCTION).not.toBe(anotherSymbol);
    });
});

