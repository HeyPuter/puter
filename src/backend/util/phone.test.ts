import { describe, expect, it } from 'vitest';
import { parsePhone } from './phone';

const e164 = (input: unknown, defaultCountry?: string) =>
    parsePhone(input, defaultCountry)?.e164 ?? null;

describe('parsePhone E.164 form', () => {
    it('normalizes a valid E.164 number unchanged', () => {
        expect(e164('+14155550123')).toBe('+14155550123');
    });

    it('normalizes messy but valid input to E.164', () => {
        expect(e164('+1 (415) 555-0123')).toBe('+14155550123');
        expect(e164('  +44 20 7946 0958 ')).toBe('+442079460958');
    });

    it('parses local format using the default country', () => {
        expect(e164('(415) 555-0123', 'US')).toBe('+14155550123');
    });

    it('rejects local format with no default country (ambiguous)', () => {
        expect(e164('4155550123')).toBeNull();
    });

    it('rejects invalid / too-short / non-numeric input', () => {
        expect(e164('+1 555')).toBeNull();
        expect(e164('not a phone')).toBeNull();
        expect(e164('')).toBeNull();
        expect(e164('   ')).toBeNull();
    });

    it('rejects non-string input', () => {
        expect(e164(undefined)).toBeNull();
        expect(e164(null)).toBeNull();
        expect(e164(14155550123)).toBeNull();
    });
});

describe('parsePhone', () => {
    it('returns E.164 + ISO country for a valid number', () => {
        expect(parsePhone('+14155550123')).toEqual({
            e164: '+14155550123',
            country: 'US',
        });
        expect(parsePhone('+442079460958')).toEqual({
            e164: '+442079460958',
            country: 'GB',
        });
    });

    it('infers country from the default region for local format', () => {
        expect(parsePhone('(415) 555-0123', 'US')).toEqual({
            e164: '+14155550123',
            country: 'US',
        });
    });

    it('returns null for invalid input', () => {
        expect(parsePhone('not a phone')).toBeNull();
        expect(parsePhone('')).toBeNull();
        expect(parsePhone(undefined)).toBeNull();
    });
});
