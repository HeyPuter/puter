import { describe, expect, it } from 'vitest';
import { sanitizePhone } from './phone';

describe('sanitizePhone', () => {
    it('normalizes a valid E.164 number unchanged', () => {
        expect(sanitizePhone('+14155550123')).toBe('+14155550123');
    });

    it('normalizes messy but valid input to E.164', () => {
        expect(sanitizePhone('+1 (415) 555-0123')).toBe('+14155550123');
        expect(sanitizePhone('  +44 20 7946 0958 ')).toBe('+442079460958');
    });

    it('parses local format using the default country', () => {
        expect(sanitizePhone('(415) 555-0123', 'US')).toBe('+14155550123');
    });

    it('rejects local format with no default country (ambiguous)', () => {
        expect(sanitizePhone('4155550123')).toBeNull();
    });

    it('rejects invalid / too-short / non-numeric input', () => {
        expect(sanitizePhone('+1 555')).toBeNull();
        expect(sanitizePhone('not a phone')).toBeNull();
        expect(sanitizePhone('')).toBeNull();
        expect(sanitizePhone('   ')).toBeNull();
    });

    it('rejects non-string input', () => {
        expect(sanitizePhone(undefined)).toBeNull();
        expect(sanitizePhone(null)).toBeNull();
        expect(sanitizePhone(14155550123)).toBeNull();
    });
});
