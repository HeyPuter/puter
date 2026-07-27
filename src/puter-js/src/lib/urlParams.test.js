import { describe, expect, it } from 'vitest';
import { normalizeURLParams } from './urlParams.js';

describe('normalizeURLParams', () => {
    it('accepts a plain object and stringifies scalars', () => {
        expect(normalizeURLParams({ doc: 'readme', line: 10, draft: true }).params)
            .toEqual({ doc: 'readme', line: '10', draft: 'true' });
    });

    it('accepts a query string, with or without the leading "?"', () => {
        expect(normalizeURLParams('a=b&c=d').params).toEqual({ a: 'b', c: 'd' });
        expect(normalizeURLParams('?a=b').params).toEqual({ a: 'b' });
    });

    it('accepts URLSearchParams', () => {
        expect(normalizeURLParams(new URLSearchParams('a=b')).params).toEqual({ a: 'b' });
    });

    it('accepts a null-prototype object', () => {
        expect(normalizeURLParams(Object.assign(Object.create(null), { a: 'b' })).params).toEqual({ a: 'b' });
    });

    it('treats no argument as clearing the query string', () => {
        expect(normalizeURLParams().params).toEqual({});
        expect(normalizeURLParams(null).params).toEqual({});
        expect(normalizeURLParams({}).params).toEqual({});
    });

    it('drops null and undefined values so optional state can be spread', () => {
        expect(normalizeURLParams({ a: 'b', c: null, d: undefined }).params).toEqual({ a: 'b' });
    });

    it('keeps empty-string and zero values', () => {
        expect(normalizeURLParams({ a: '', b: 0, c: false }).params).toEqual({ a: '', b: '0', c: 'false' });
    });

    describe('rejects shapes that would silently clear the URL', () => {
        // Each of these has no own enumerable keys, so serializing it
        // would produce {} — indistinguishable from "clear the query
        // string" — instead of the params the caller meant to set.
        class Config {
            constructor () {
                this.a = 'b';
            }
            get computed () {
                return 'c';
            }
        }

        it.each([
            ['a Map', new Map([['a', 'b']])],
            ['a Set', new Set(['a'])],
            ['an array', ['a']],
            ['a number', 5],
        ])('%s', (_name, input) => {
            expect(normalizeURLParams(input)).toMatchObject({ code: 'params_invalid' });
        });

        it('a class instance', () => {
            // Own enumerable data would survive, but the prototype's
            // wouldn't — reject rather than half-apply it.
            expect(normalizeURLParams(new Config())).toMatchObject({ code: 'params_invalid' });
        });
    });

    it('rejects a non-scalar value, naming the key', () => {
        const result = normalizeURLParams({ good: 'x', bad: { nested: true } });
        expect(result).toMatchObject({ code: 'value_invalid' });
        expect(result.message).toContain('bad');
    });
});
