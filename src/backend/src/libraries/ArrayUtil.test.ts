import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import ArrayUtil from './ArrayUtil.js';

describe('ArrayUtil', () => {
    it('should remove marked items correctly', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                arrayUtil: ArrayUtil,
            },
        });

        const arrayUtil = testKernel.services?.get('arrayUtil');

        // inner indices
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [2, 5];
            arrayUtil.remove_marked_items(marked_map, subject);
            expect(subject.join('')).toBe('abdegh');
        }
        // left edge
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [0];
            arrayUtil.remove_marked_items(marked_map, subject);
            expect(subject.join('')).toBe('bcdefgh');
        }
        // right edge
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [7];
            arrayUtil.remove_marked_items(marked_map, subject);
            expect(subject.join('')).toBe('abcdefg');
        }
        // both edges
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [0, 7];
            arrayUtil.remove_marked_items(marked_map, subject);
            expect(subject.join('')).toBe('bcdefg');
        }
    });
});
