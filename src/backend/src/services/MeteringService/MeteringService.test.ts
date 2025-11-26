import { describe, expect, it } from 'vitest';
import { testKernel } from '../../../test.setup.mjs';

describe('MeteringService', () => {

    it('should have some services', () => {
        expect(testKernel.services).not.toBeUndefined();
    });
});
