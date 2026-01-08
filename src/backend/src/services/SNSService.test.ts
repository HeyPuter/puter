import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { SNSService } from './SNSService.js';

describe('SNSService', () => {
    it('should have empty test (test case commented out)', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'sns': SNSService,
            },
        });

        const snsService = testKernel.services!.get('sns') as SNSService;

        // The original test case doesn't work because the specified signing cert
        // from SNS is no longer served. The test was commented out in the _test method.
        // This test just ensures the service can be constructed and tested.
        expect(snsService).toBeInstanceOf(SNSService);
    });
});

