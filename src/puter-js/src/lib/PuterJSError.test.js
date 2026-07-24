import { describe, expect, it } from 'vitest';
import { PuterJSError } from './PuterJSError.js';

describe('PuterJSError', () => {
    it('is a real Error carrying message and code', () => {
        const err = new PuterJSError('Key cannot be undefined', 'key_undefined');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(PuterJSError);
        expect(err.name).toBe('PuterJSError');
        expect(err.message).toBe('Key cannot be undefined');
        expect(err.code).toBe('key_undefined');
        expect(typeof err.stack).toBe('string');
    });

    it('serializes and destructures like the legacy plain { message, code }', () => {
        const err = new PuterJSError('bad request', 'invalid_request');
        const { message, code } = err;
        expect({ message, code }).toEqual({ message: 'bad request', code: 'invalid_request' });
        expect(JSON.parse(JSON.stringify(err))).toEqual({
            message: 'bad request',
            code: 'invalid_request',
        });
    });

    it('attaches extra fields for backward-compatible shapes', () => {
        const err = new PuterJSError('Name is required', 'invalid_request', {
            success: false,
            error: { code: 'invalid_request', message: 'Name is required' },
        });
        // Both the new top-level access and the legacy nested access work.
        expect(err.code).toBe('invalid_request');
        expect(err.success).toBe(false);
        expect(err.error).toEqual({ code: 'invalid_request', message: 'Name is required' });
    });

    it('omits code when none is given', () => {
        const err = new PuterJSError('something happened');
        expect('code' in err).toBe(false);
        expect(JSON.parse(JSON.stringify(err))).toEqual({ message: 'something happened' });
    });

    describe('from()', () => {
        it('passes an existing PuterJSError through untouched', () => {
            const original = new PuterJSError('x', 'y');
            expect(PuterJSError.from(original)).toBe(original);
        });

        it('normalizes a plain { message, code } object, keeping extra fields', () => {
            const err = PuterJSError.from({ message: 'nope', code: 'denied', detail: 42 });
            expect(err).toBeInstanceOf(PuterJSError);
            expect(err.message).toBe('nope');
            expect(err.code).toBe('denied');
            expect(err.detail).toBe(42);
        });

        it('wraps a bare string', () => {
            const err = PuterJSError.from('boom');
            expect(err.message).toBe('boom');
            expect('code' in err).toBe(false);
        });

        it('falls back to a generic message for shapeless values', () => {
            expect(PuterJSError.from(undefined).message).toBe('Unknown error');
            expect(PuterJSError.from({}).message).toBe('Unknown error');
        });
    });
});
