/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { describe, expect, it } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import {
    FILTER_EVALUATIONS_PER_EVENT,
    MATCH_PATTERN_MAX_LENGTH,
    MATCH_PATTERN_MAX_SEGMENTS,
    compileMatch,
    evaluateWithCap,
    relativeTo,
} from './matcher.js';

const CASES: Array<{ pattern: string; matches: string[]; misses: string[] }> = [
    {
        pattern: 'triggerFile',
        matches: ['triggerFile'],
        misses: ['triggerFile2', 'sub/triggerFile', 'TriggerFile'],
    },
    {
        pattern: '*.png',
        matches: ['a.png', '.png'],
        misses: ['a.pngx', 'sub/a.png', 'a.jpg'],
    },
    {
        pattern: '**/*.png',
        matches: ['a.png', 'sub/a.png', 'sub/deep/deeper/a.png'],
        misses: ['a.jpg', 'sub/a.jpg'],
    },
    {
        pattern: 'sub/**/notes.md',
        matches: ['sub/notes.md', 'sub/a/notes.md', 'sub/a/b/c/notes.md'],
        misses: ['notes.md', 'other/notes.md', 'sub/notes.md.bak'],
    },
    {
        pattern: 'sub/**',
        matches: ['sub/a', 'sub/a/b'],
        misses: ['sub', 'other/a'],
    },
    {
        pattern: '**',
        matches: ['a', 'a/b/c', ''],
        misses: [],
    },
    {
        pattern: 'report-?.csv',
        matches: ['report-1.csv', 'report-a.csv'],
        misses: ['report-12.csv', 'report-.csv', 'report-/.csv'],
    },
    {
        pattern: 'a+b(c).txt',
        matches: ['a+b(c).txt'],
        misses: ['axbxcx.txt'],
    },
    {
        pattern: 'in*/**/out*.log',
        matches: ['inbox/out.log', 'in/a/b/out-1.log'],
        misses: ['inbox/out.txt', 'box/out.log'],
    },
];

describe('compileMatch', () => {
    it.each(CASES)('applies $pattern', ({ pattern, matches, misses }) => {
        const compiled = compileMatch(pattern);
        expect(matches.filter((value) => !compiled.test(value))).toEqual([]);
        expect(misses.filter((value) => compiled.test(value))).toEqual([]);
    });

    it('keeps the source pattern for storage', () => {
        expect(compileMatch('**/*.png').pattern).toBe('**/*.png');
    });

    it('collapses repeated globstars', () => {
        const compiled = compileMatch('a/**/**/**/b');
        expect(compiled.test('a/b')).toBe(true);
        expect(compiled.test('a/x/y/b')).toBe(true);
        expect(compiled.test('a/x/y/c')).toBe(false);
    });

    it('lets a kv pattern cross the key delimiter', () => {
        const compiled = compileMatch('user:12*', { separator: null });
        expect(compiled.test('user:120')).toBe(true);
        expect(compiled.test('user:12:cart')).toBe(true);
        expect(compiled.test('user:99')).toBe(false);
    });

    const rejections: Array<{ name: string; pattern: string }> = [
        { name: 'empty', pattern: '' },
        {
            name: 'over the character bound',
            pattern: 'a'.repeat(MATCH_PATTERN_MAX_LENGTH + 1),
        },
        {
            name: 'over the segment bound',
            pattern: Array(MATCH_PATTERN_MAX_SEGMENTS + 1)
                .fill('a')
                .join('/'),
        },
        { name: 'with two stars in one segment', pattern: '*report*.pdf' },
        { name: 'with a doubled star inside a segment', pattern: 'a**b' },
        { name: 'with two globstars', pattern: '**/build/**' },
    ];

    it.each(rejections)('rejects a pattern $name', ({ pattern }) => {
        let thrown: unknown;
        try {
            compileMatch(pattern);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(HttpError);
        expect((thrown as HttpError).legacyCode).toBe(
            'invalid_subject_pattern',
        );
    });

    it('accepts a pattern exactly on the bounds', () => {
        expect(() =>
            compileMatch('a'.repeat(MATCH_PATTERN_MAX_LENGTH)),
        ).not.toThrow();
        expect(() =>
            compileMatch(Array(MATCH_PATTERN_MAX_SEGMENTS).fill('a').join('/')),
        ).not.toThrow();
        expect(() =>
            compileMatch('?'.repeat(MATCH_PATTERN_MAX_LENGTH)),
        ).not.toThrow();
    });

    it('treats a doubled star with no delimiter as two stars', () => {
        expect(() => compileMatch('**', { separator: null })).toThrow(
            HttpError,
        );
        expect(() => compileMatch('a**', { separator: null })).toThrow(
            HttpError,
        );
    });

    it('stays cheap on the worst shape the bounds allow', () => {
        // One globstar, then a star in every remaining segment, against a
        // deep path of long segments that misses only at the very end.
        const pattern = `**/${Array(MATCH_PATTERN_MAX_SEGMENTS - 2)
            .fill('*a')
            .join('/')}/z`;
        const path = Array(60).fill('a'.repeat(200)).join('/');
        const compiled = compileMatch(pattern);
        const started = performance.now();
        expect(compiled.test(path)).toBe(false);
        expect(performance.now() - started).toBeLessThan(50);
    });
});

describe('relativeTo', () => {
    it('relativizes a descendant', () => {
        expect(relativeTo('/alice/Documents', '/alice/Documents/a/b.png')).toBe(
            'a/b.png',
        );
    });

    it('gives the empty string for the anchor itself', () => {
        expect(relativeTo('/alice/Documents', '/alice/Documents')).toBe('');
    });

    it('rejects a sibling that merely shares a prefix', () => {
        expect(relativeTo('/alice/Doc', '/alice/Documents/a')).toBeNull();
    });

    it('handles a root anchor', () => {
        expect(relativeTo('/', '/alice')).toBe('alice');
    });
});

describe('evaluateWithCap', () => {
    const isEven = (n: number) => n % 2 === 0;

    it('evaluates everything under the cap', () => {
        const result = evaluateWithCap([1, 2, 3, 4], isEven);
        expect(result).toEqual({
            matched: [2, 4],
            evaluated: 4,
            stoppedEarly: false,
        });
    });

    it('stops at the cap and says so', () => {
        const candidates = Array.from(
            { length: FILTER_EVALUATIONS_PER_EVENT + 1 },
            (_, i) => i,
        );
        const result = evaluateWithCap(candidates, isEven);
        expect(result.evaluated).toBe(FILTER_EVALUATIONS_PER_EVENT);
        expect(result.stoppedEarly).toBe(true);
        expect(result.matched).toHaveLength(FILTER_EVALUATIONS_PER_EVENT / 2);
    });

    it('does not evaluate past the cap', () => {
        let calls = 0;
        evaluateWithCap(
            Array.from({ length: 10 }, (_, i) => i),
            () => {
                calls++;
                return true;
            },
            3,
        );
        expect(calls).toBe(3);
    });

    it('reports no gap when the count lands exactly on the cap', () => {
        const result = evaluateWithCap([1, 2, 3], () => true, 3);
        expect(result.stoppedEarly).toBe(false);
    });
});
