import { describe, expect, it } from 'vitest';

import { estimateDataUrlSize } from './dataUrl.js';

// `estimateDataUrlSize` gates thumbnail uploads, so it must return decoded
// bytes — not `ceil(base64.length * 3 / 4)`, which over-counts by 1-2 bytes
// whenever the payload ends in `=` padding.
describe('estimateDataUrlSize', () => {
    it('returns 0 for empty input', () => {
        expect(estimateDataUrlSize('')).toBe(0);
    });

    it('sizes an unpadded payload', () => {
        // 'ABC' -> 'QUJD'
        expect(estimateDataUrlSize('data:text/plain;base64,QUJD')).toBe(3);
    });

    it('subtracts single `=` padding', () => {
        // 'AB' -> 'QUI='
        expect(estimateDataUrlSize('data:text/plain;base64,QUI=')).toBe(2);
    });

    it('subtracts double `==` padding', () => {
        // 'A' -> 'QQ=='
        expect(estimateDataUrlSize('data:text/plain;base64,QQ==')).toBe(1);
    });

    it('sizes raw base64 without a data URL prefix', () => {
        expect(estimateDataUrlSize('QUI=')).toBe(2);
    });
});
