import { describe, it, expect } from 'vitest';
const { boolify } = require('./hl_types');

describe('hl_types', () => {
    it('boolify falsy values', () => {
        expect(boolify(undefined)).toBe(false);
        expect(boolify(0)).toBe(false);
        expect(boolify('')).toBe(false);
        expect(boolify(null)).toBe(false);
    });
    it('boolify truthy values', () => {
        expect(boolify(true)).toBe(true);
        expect(boolify(1)).toBe(true);
        expect(boolify('1')).toBe(true);
        expect(boolify({})).toBe(true);
    });
});
