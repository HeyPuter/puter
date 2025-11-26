import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { MeteringServiceWrapper } from './MeteringServiceWrapper.mjs';

describe('MeteringService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            metering: MeteringServiceWrapper,
        },
    });
    it('should have some services', () => {
        expect(testKernel.services).not.toBeUndefined();
        expect(testKernel.services!.get('metering')).toBeInstanceOf(MeteringServiceWrapper);
    });
});
