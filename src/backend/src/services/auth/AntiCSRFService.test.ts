import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { AntiCSRFService } from './AntiCSRFService.js';

describe('AntiCSRFService', () => {
    it('should handle token generation, expiration, and consumption correctly', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'anti-csrf': AntiCSRFService,
            },
        });

        const antiCSRFService = testKernel.services!.get('anti-csrf') as AntiCSRFService;

        // Do this several times, like a user would
        for ( let i = 0 ; i < 30 ; i++ ) {
            // Generate 30 tokens
            const tokens = [];
            for ( let j = 0 ; j < 30 ; j++ ) {
                tokens.push(antiCSRFService.create_token('session'));
            }
            // Only the last 10 should be valid
            const results_for_stale_tokens = [];
            for ( let j = 0 ; j < 20 ; j++ ) {
                const result = antiCSRFService.consume_token('session', tokens[j]);
                results_for_stale_tokens.push(result);
            }
            expect(results_for_stale_tokens.every(v => v === false)).toBe(true);
            // The last 10 should be valid
            const results_for_valid_tokens = [];
            for ( let j = 20 ; j < 30 ; j++ ) {
                const result = antiCSRFService.consume_token('session', tokens[j]);
                results_for_valid_tokens.push(result);
            }
            expect(results_for_valid_tokens.every(v => v === true)).toBe(true);
            // A completely arbitrary token should not be valid
            expect(antiCSRFService.consume_token('session', 'arbitrary')).toBe(false);
        }
    });
});

