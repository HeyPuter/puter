import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { TraceService } from './TraceService';

describe('TraceService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            trace: TraceService,
        },
        initLevelString: 'construct',
    });

    const traceService = testKernel.services!.get('trace') as TraceService;

    it('should be instantiated', () => {
        expect(traceService).toBeInstanceOf(TraceService);
    });

    it('should have a tracer', () => {
        expect(traceService.tracer).toBeDefined();
    });

    it('should create spans with spanify', async () => {
        const result = await traceService.spanify('test-span', async ({ span }) => {
            expect(span).toBeDefined();
            return 'test-result';
        });
        expect(result).toBe('test-result');
    });

    it('should execute callback within span', async () => {
        let executed = false;
        await traceService.spanify('exec-span', async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });

    it('should handle errors in spanify', async () => {
        await expect(
            traceService.spanify('error-span', async () => {
                throw new Error('Test span error');
            })
        ).rejects.toThrow('Test span error');
    });

    it('should support options in spanify', async () => {
        const result = await traceService.spanify('options-span', async ({ span }) => {
            return 'with-options';
        }, {
            attributes: { 'test.attribute': 'value' },
        });
        expect(result).toBe('with-options');
    });

    it('should return values from span callback', async () => {
        const obj = { value: 42 };
        const result = await traceService.spanify('return-span', async () => {
            return obj;
        });
        expect(result).toEqual(obj);
    });
});

