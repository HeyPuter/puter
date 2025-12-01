import { describe, expect, it, test } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { COST_MAPS } from '../../services/MeteringService/costMaps';
import { SUService } from '../../services/SUService';
import { AIChatService } from './AIChatService';
import { ClaudeService } from './ClaudeService';

describe('ClaudeService ', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'claude': ClaudeService,
            'ai-chat': AIChatService,
        },
        initLevelString: 'init',
        testCore: true,
        serviceConfigOverrideMap: {
            'database': {
                path: ':memory:',
            },
            'claude': {
                apiKey: process.env.PUTER_CLAUDE_API_KEY,
            },
        },
    });

    const target = testKernel.services!.get('claude') as ClaudeService;
    const su = testKernel.services!.get('su') as SUService;

    it('should have all models mapped in cost maps', async () => {
        const models = await target.models();

        for ( const model of models ) {
            const entry = Object.entries(COST_MAPS).find(([key, _value]) => key.startsWith('claude') && key.includes(model.id));
            expect(entry, `Model ${model.id} is missing in cost maps`).toBeDefined();
        }
    });

    test.skipIf(!process.env.PUTER_CLAUDE_API_KEY)('should return flat response from claude if token provided', async () => {

        const response = await su.sudo(async () => await target.complete({
            messages: [
                { role: 'user', content: 'Only reply: "hi"' },
            ],
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 15,
        }));

        expect(response.message.id).toBeDefined();
        expect(response.message.content.length).toBeGreaterThan(0);
        expect(response.message.content[0].text).include('hi');
        expect(response.message.model).toEqual('claude-haiku-4-5-20251001');
        expect(response.message.usage).toBeDefined();
        expect(response.message.usage.output_tokens).toBeLessThan(15);
        expect(response.finish_reason).toBe('stop');
    });

});
