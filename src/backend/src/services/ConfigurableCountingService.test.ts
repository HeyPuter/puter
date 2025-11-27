import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import * as config from '../config';
import { ConfigurableCountingService } from './ConfigurableCountingService';

describe('ConfigurableCountingService', async () => {
    config.load_config({
        'services': {
            'database': {
                path: ':memory:',
            },
        },
    });

    const testKernel = await createTestKernel({
        serviceMap: {
            'counting': ConfigurableCountingService,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const countingService = testKernel.services!.get('counting') as ConfigurableCountingService;

    it('should be instantiated', () => {
        expect(countingService).toBeInstanceOf(ConfigurableCountingService);
    });

    it('should have counting types defined', () => {
        expect(ConfigurableCountingService.counting_types).toBeDefined();
        expect(ConfigurableCountingService.counting_types.gpt).toBeDefined();
        expect(ConfigurableCountingService.counting_types.dalle).toBeDefined();
    });

    it('should have sql columns defined', () => {
        expect(ConfigurableCountingService.sql_columns).toBeDefined();
        expect(ConfigurableCountingService.sql_columns.uint).toBeDefined();
        expect(ConfigurableCountingService.sql_columns.uint.length).toBe(3);
    });

    it('should validate GPT counting type structure', () => {
        const gptType = ConfigurableCountingService.counting_types.gpt;
        expect(gptType.category).toBeDefined();
        expect(gptType.values).toBeDefined();
        expect(gptType.category.length).toBeGreaterThan(0);
        expect(gptType.values.length).toBeGreaterThan(0);
    });

    it('should validate DALL-E counting type structure', () => {
        const dalleType = ConfigurableCountingService.counting_types.dalle;
        expect(dalleType.category).toBeDefined();
        expect(dalleType.category.length).toBeGreaterThan(0);
        expect(dalleType.category.some(c => c.name === 'model')).toBe(true);
        expect(dalleType.category.some(c => c.name === 'quality')).toBe(true);
        expect(dalleType.category.some(c => c.name === 'resolution')).toBe(true);
    });

    it('should have gpt token value definitions', () => {
        const gptType = ConfigurableCountingService.counting_types.gpt;
        expect(gptType.values.some(v => v.name === 'input_tokens')).toBe(true);
        expect(gptType.values.some(v => v.name === 'output_tokens')).toBe(true);
        expect(gptType.values.every(v => v.type === 'uint')).toBe(true);
    });

    it('should have available sql columns for uint type', () => {
        const columns = ConfigurableCountingService.sql_columns.uint;
        expect(columns).toBeDefined();
        expect(Array.isArray(columns)).toBe(true);
        expect(columns.length).toBe(3);
        expect(columns.every(col => typeof col === 'string')).toBe(true);
    });

    it('should have model category for gpt', () => {
        const gptType = ConfigurableCountingService.counting_types.gpt;
        const modelCategory = gptType.category.find(c => c.name === 'model');
        expect(modelCategory).toBeDefined();
        expect(modelCategory!.type).toBe('string');
    });
});

