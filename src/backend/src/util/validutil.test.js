import { describe, expect, it } from 'vitest';

const { valid_file_size, validate_fields } = require('./validutil');
const APIError = require('../api/APIError');

describe('valid_file_size', () => {
    it('returns ok for positive integer', () => {
        const result = valid_file_size(100);
        expect(result).toEqual({ ok: true, v: 100 });
    });

    it('returns ok for zero', () => {
        const result = valid_file_size(0);
        expect(result).toEqual({ ok: true, v: 0 });
    });

    it('converts string to number and validates', () => {
        const result = valid_file_size('42');
        expect(result).toEqual({ ok: true, v: 42 });
    });

    it('returns not ok for negative number', () => {
        const result = valid_file_size(-1);
        expect(result).toEqual({ ok: false, v: -1 });
    });

    it('returns not ok for floating point number', () => {
        const result = valid_file_size(3.14);
        expect(result).toEqual({ ok: false, v: 3.14 });
    });

    it('returns not ok for NaN', () => {
        const result = valid_file_size(NaN);
        expect(result.ok).toBe(false);
        expect(Number.isNaN(result.v)).toBe(true);
    });

    it('returns not ok for non-numeric string', () => {
        const result = valid_file_size('abc');
        expect(result.ok).toBe(false);
        expect(Number.isNaN(result.v)).toBe(true);
    });

    it('returns not ok for Infinity', () => {
        const result = valid_file_size(Infinity);
        expect(result).toEqual({ ok: false, v: Infinity });
    });
});

describe('validate_fields', () => {
    describe('missing fields', () => {
        it('throws fields_missing error when required field is undefined', () => {
            const fields = {
                name: { type: 'string' },
            };
            const values = {};

            expect(() => validate_fields(fields, values))
                .toThrow(APIError);
        });

        it('throws with correct keys for multiple missing fields', () => {
            const fields = {
                name: { type: 'string' },
                age: { type: 'number' },
            };
            const values = {};

            try {
                validate_fields(fields, values);
                expect.fail('Expected error to be thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(APIError);
                expect(e.fields.keys).toContain('name');
                expect(e.fields.keys).toContain('age');
            }
        });

        it('does not throw for optional undefined fields when they have no type check', () => {
            const fields = {
                name: { type: 'string' },
                nickname: { optional: true }, // No type defined
            };
            const values = { name: 'John' };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });

        // Note: Current implementation validates type even for optional undefined fields
        // This test documents that behavior - optional fields must still pass type validation
        it('throws for optional undefined fields if type validation is defined', () => {
            const fields = {
                name: { type: 'string' },
                nickname: { type: 'string', optional: true },
            };
            const values = { name: 'John' };

            // Current behavior: type validation runs on optional undefined fields
            expect(() => validate_fields(fields, values)).toThrow(APIError);
        });

        it('accepts optional fields when provided with correct type', () => {
            const fields = {
                name: { type: 'string' },
                nickname: { type: 'string', optional: true },
            };
            const values = { name: 'John', nickname: 'Johnny' };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });

        it('does not throw when all required fields are present', () => {
            const fields = {
                name: { type: 'string' },
                age: { type: 'number' },
            };
            const values = { name: 'John', age: 25 };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });
    });

    describe('invalid fields', () => {
        it('throws fields_invalid error when string field receives number', () => {
            const fields = {
                name: { type: 'string' },
            };
            const values = { name: 123 };

            expect(() => validate_fields(fields, values))
                .toThrow(APIError);
        });

        it('throws fields_invalid error when number field receives string', () => {
            const fields = {
                age: { type: 'number' },
            };
            const values = { age: '25' };

            expect(() => validate_fields(fields, values))
                .toThrow(APIError);
        });

        it('throws with correct error details for invalid fields', () => {
            const fields = {
                age: { type: 'number' },
            };
            const values = { age: 'not a number' };

            try {
                validate_fields(fields, values);
                expect.fail('Expected error to be thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(APIError);
                expect(e.fields.errors).toBeDefined();
                expect(e.fields.errors[0].key).toBe('age');
                expect(e.fields.errors[0].expected).toBe('number');
                expect(e.fields.errors[0].got).toBe('string');
            }
        });

        it('validates multiple fields and reports all invalid ones', () => {
            const fields = {
                name: { type: 'string' },
                age: { type: 'number' },
            };
            const values = { name: 42, age: 'twenty-five' };

            try {
                validate_fields(fields, values);
                expect.fail('Expected error to be thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(APIError);
                expect(e.fields.errors.length).toBe(2);
            }
        });
    });

    describe('valid inputs', () => {
        it('accepts valid string fields', () => {
            const fields = {
                name: { type: 'string' },
            };
            const values = { name: 'John' };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });

        it('accepts valid number fields', () => {
            const fields = {
                age: { type: 'number' },
            };
            const values = { age: 25 };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });

        it('accepts mixed valid string and number fields', () => {
            const fields = {
                name: { type: 'string' },
                age: { type: 'number' },
            };
            const values = { name: 'John', age: 25 };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });

        it('accepts empty string as valid string', () => {
            const fields = {
                name: { type: 'string' },
            };
            const values = { name: '' };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });

        it('accepts zero as valid number', () => {
            const fields = {
                count: { type: 'number' },
            };
            const values = { count: 0 };

            expect(() => validate_fields(fields, values)).not.toThrow();
        });
    });

    describe('priority of errors', () => {
        it('throws fields_missing before checking invalid fields', () => {
            const fields = {
                name: { type: 'string' },
                age: { type: 'number' },
            };
            // name is missing, age is invalid
            const values = { age: 'not a number' };

            try {
                validate_fields(fields, values);
                expect.fail('Expected error to be thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(APIError);
                // Should throw fields_missing, not fields_invalid
                expect(e.fields.keys).toBeDefined();
                expect(e.fields.keys).toContain('name');
            }
        });
    });
});

