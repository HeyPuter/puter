import { describe, expect, test } from 'vitest';

import {
    REFERRAL_CODE_LENGTH,
    REFERRAL_CODE_MAX_LENGTH,
    generateReferralCode,
    normalizeReferralCode,
} from './referralCode.js';

describe('normalizeReferralCode', () => {
    test.for([
        ['already canonical', 'ABCD1234', 'ABCD1234'],
        ['lower case', 'abcd1234', 'ABCD1234'],
        ['mixed case', 'AbCd1234', 'ABCD1234'],
        ['surrounding whitespace', '  abcd1234\n', 'ABCD1234'],
        ['shortest accepted', 'ab12', 'AB12'],
        ['longest accepted', 'a'.repeat(16), 'A'.repeat(16)],
    ] as const)('%s → %s', ([, input, expected]) => {
        expect(normalizeReferralCode(input)).toBe(expected);
    });

    test.for([
        ['too short', 'abc'],
        ['longer than the column', 'a'.repeat(REFERRAL_CODE_MAX_LENGTH + 1)],
        ['inner whitespace', 'ab cd'],
        ['a dot', 'ab.cd'],
        ['a colon', 'abuse:referral:x'],
        ['a hyphen', 'ab-cd'],
        ['non-ASCII', 'абвг1234'],
        ['empty', ''],
        ['only whitespace', '   '],
    ] as const)('%s is rejected', ([, input]) => {
        expect(normalizeReferralCode(input)).toBeNull();
    });

    test('non-strings are rejected', () => {
        expect(normalizeReferralCode(undefined)).toBeNull();
        expect(normalizeReferralCode(null)).toBeNull();
        expect(normalizeReferralCode(12345678)).toBeNull();
        expect(normalizeReferralCode({ code: 'abcd1234' })).toBeNull();
    });
});

describe('generateReferralCode', () => {
    test('mints canonical codes of the expected length', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateReferralCode();
            expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
            expect(normalizeReferralCode(code)).toBe(code);
        }
    });

    test('leaves out the characters that read as each other', () => {
        // 200 8-char codes is 1,600 draws; a 32-letter alphabet would show any
        // included letter long before that.
        const drawn = new Set(
            Array.from({ length: 200 }, () => generateReferralCode()).join(''),
        );
        for (const ambiguous of ['I', 'L', 'O', 'U']) {
            expect(drawn.has(ambiguous)).toBe(false);
        }
    });

    test('is not derivable — successive codes differ', () => {
        const codes = new Set(
            Array.from({ length: 500 }, () => generateReferralCode()),
        );
        expect(codes.size).toBe(500);
    });
});
