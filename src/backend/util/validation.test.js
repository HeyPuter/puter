/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';
import {
    validateArrayOfStrings,
    validateBool,
    validateJsonObject,
    validateString,
    validateUrl,
} from './validation.js';

/**
 * Every validator rejects with an HttpError carrying 400 + the stable
 * `bad_request` legacy code — that pair is API surface, so assert it rather
 * than just "it threw".
 */
const expectBadRequest = (fn, messageFragment) => {
    let thrown;
    try {
        fn();
    } catch (e) {
        thrown = e;
    }
    expect(thrown, 'expected a rejection').toBeDefined();
    expect(thrown.statusCode).toBe(400);
    expect(thrown.legacyCode).toBe('bad_request');
    if (messageFragment) expect(thrown.message).toContain(messageFragment);
    return thrown;
};

describe('validateString', () => {
    it('returns the value unchanged when it passes every constraint', () => {
        expect(
            validateString('hello', {
                key: 'title',
                maxLen: 10,
                regex: /^[a-z]+$/,
            }),
        ).toBe('hello');
    });

    it('rejects a missing value when required (the default)', () => {
        expectBadRequest(
            () => validateString(undefined, { key: 'title' }),
            'Missing `title`',
        );
        expectBadRequest(
            () => validateString(null, { key: 'title' }),
            'Missing `title`',
        );
    });

    it('passes a missing value straight through when not required', () => {
        expect(
            validateString(undefined, { key: 'title', required: false }),
        ).toBeUndefined();
        expect(
            validateString(null, { key: 'title', required: false }),
        ).toBeNull();
    });

    it('rejects non-string types even when they are stringifiable', () => {
        expectBadRequest(
            () => validateString(42, { key: 'title' }),
            '`title` must be a string',
        );
        expectBadRequest(
            () => validateString({}, { key: 'title' }),
            '`title` must be a string',
        );
    });

    it('rejects the empty string unless allowEmpty is set', () => {
        expectBadRequest(
            () => validateString('', { key: 'title' }),
            '`title` must not be empty',
        );
        expect(validateString('', { key: 'title', allowEmpty: true })).toBe('');
    });

    it('enforces maxLen at the boundary', () => {
        expect(validateString('abcde', { key: 'title', maxLen: 5 })).toBe(
            'abcde',
        );
        expectBadRequest(
            () => validateString('abcdef', { key: 'title', maxLen: 5 }),
            'at most 5 characters',
        );
    });

    it('rejects values that fail the supplied regex', () => {
        expectBadRequest(
            () => validateString('has space', { key: 'name', regex: /^\S+$/ }),
            '`name` has an invalid format',
        );
    });

    it('works with no options object at all', () => {
        expect(validateString('x')).toBe('x');
    });
});

describe('validateUrl', () => {
    it('accepts http and https URLs and returns the original string', () => {
        expect(validateUrl('https://example.com/a?b=1', { key: 'url' })).toBe(
            'https://example.com/a?b=1',
        );
        expect(validateUrl('http://example.com', { key: 'url' })).toBe(
            'http://example.com',
        );
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'vbscript:msgbox(1)',
    ])('rejects the XSS/SSRF-capable scheme %s', (value) => {
        expectBadRequest(
            () => validateUrl(value, { key: 'index_url' }),
            'must use one of the following protocols',
        );
    });

    it('honours an explicit protocol allow-list', () => {
        expect(
            validateUrl('ftp://example.com/x', {
                key: 'url',
                protocols: ['ftp:'],
            }),
        ).toBe('ftp://example.com/x');
        expectBadRequest(
            () =>
                validateUrl('https://example.com', {
                    key: 'url',
                    protocols: ['ftp:'],
                }),
            'must use one of the following protocols: ftp:',
        );
    });

    it('rejects unparseable URLs', () => {
        expectBadRequest(
            () => validateUrl('not a url', { key: 'url' }),
            '`url` must be a valid URL',
        );
    });

    it('rejects a missing value when required, passes it through otherwise', () => {
        expectBadRequest(
            () => validateUrl(undefined, { key: 'url' }),
            'Missing `url`',
        );
        expect(
            validateUrl(undefined, { key: 'url', required: false }),
        ).toBeUndefined();
    });

    it('applies the string constraints before parsing (type and length)', () => {
        expectBadRequest(
            () => validateUrl(123, { key: 'url' }),
            '`url` must be a string',
        );
        expectBadRequest(
            () =>
                validateUrl(`https://example.com/${'a'.repeat(50)}`, {
                    key: 'url',
                    maxLen: 20,
                }),
            'at most 20 characters',
        );
    });
});

describe('validateBool', () => {
    it('coerces truthy/falsy values to booleans', () => {
        expect(validateBool(true, { key: 'flag' })).toBe(true);
        expect(validateBool(1, { key: 'flag' })).toBe(true);
        expect(validateBool('false', { key: 'flag' })).toBe(true);
        expect(validateBool(0, { key: 'flag' })).toBe(false);
        expect(validateBool('', { key: 'flag' })).toBe(false);
    });

    it('is optional by default and passes null/undefined through', () => {
        expect(validateBool(undefined, { key: 'flag' })).toBeUndefined();
        expect(validateBool(null, { key: 'flag' })).toBeNull();
        expect(validateBool(undefined)).toBeUndefined();
    });

    it('rejects a missing value when required', () => {
        expectBadRequest(
            () => validateBool(undefined, { key: 'flag', required: true }),
            'Missing `flag`',
        );
    });
});

describe('validateJsonObject', () => {
    it('returns plain objects untouched', () => {
        const value = { a: 1 };
        expect(validateJsonObject(value, { key: 'metadata' })).toBe(value);
    });

    it('parses a JSON string into an object', () => {
        expect(validateJsonObject('{"a":1}', { key: 'metadata' })).toEqual({
            a: 1,
        });
    });

    it('rejects a string that is not valid JSON', () => {
        expectBadRequest(
            () => validateJsonObject('{oops', { key: 'metadata' }),
            '`metadata` must be valid JSON',
        );
    });

    it('rejects arrays and JSON scalars — objects only', () => {
        expectBadRequest(
            () => validateJsonObject([1, 2], { key: 'metadata' }),
            '`metadata` must be an object',
        );
        expectBadRequest(
            () => validateJsonObject('[1,2]', { key: 'metadata' }),
            '`metadata` must be an object',
        );
        expectBadRequest(
            () => validateJsonObject('7', { key: 'metadata' }),
            '`metadata` must be an object',
        );
        expectBadRequest(
            () => validateJsonObject(7, { key: 'metadata' }),
            '`metadata` must be an object',
        );
    });

    it('is optional by default but enforces presence when required', () => {
        expect(
            validateJsonObject(undefined, { key: 'metadata' }),
        ).toBeUndefined();
        expect(validateJsonObject(undefined)).toBeUndefined();
        expectBadRequest(
            () => validateJsonObject(null, { key: 'metadata', required: true }),
            'Missing `metadata`',
        );
    });
});

describe('validateArrayOfStrings', () => {
    it('returns the array when every element is a string', () => {
        const value = ['a', 'b'];
        expect(validateArrayOfStrings(value, { key: 'types' })).toBe(value);
        expect(validateArrayOfStrings([], { key: 'types' })).toEqual([]);
    });

    it('rejects a non-array', () => {
        expectBadRequest(
            () => validateArrayOfStrings('a,b', { key: 'types' }),
            '`types` must be an array',
        );
    });

    it('names the offending index when an element is not a string', () => {
        expectBadRequest(
            () => validateArrayOfStrings(['a', 2, 'c'], { key: 'types' }),
            '`types[1]` must be a string',
        );
    });

    it('is optional by default but enforces presence when required', () => {
        expect(
            validateArrayOfStrings(undefined, { key: 'types' }),
        ).toBeUndefined();
        expect(validateArrayOfStrings(undefined)).toBeUndefined();
        expectBadRequest(
            () =>
                validateArrayOfStrings(null, { key: 'types', required: true }),
            'Missing `types`',
        );
    });
});
