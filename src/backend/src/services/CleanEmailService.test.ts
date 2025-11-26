import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { CleanEmailService } from './CleanEmailService.js';

describe('CleanEmailService', () => {
    it('should clean email addresses correctly', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'clean-email': CleanEmailService,
            },
        });

        const cleanEmailService = testKernel.services!.get('clean-email') as CleanEmailService;

        const cases = [
            {
                email: 'bob.ross+happy-clouds@googlemail.com',
                expected: 'bobross@gmail.com',
            },
            {
                email: 'under.rated+email-service@yahoo.com',
                expected: 'under.rated+email-service@yahoo.com',
            },
            {
                email: 'the-absolute+best@protonmail.com',
                expected: 'the-absolute@protonmail.com',
            },
        ];

        for ( const { email, expected } of cases ) {
            const cleaned = cleanEmailService.clean(email);
            expect(cleaned).toBe(expected);
        }
    });
});
