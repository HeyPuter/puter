/*
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
 */

import { describe, it, expect } from 'vitest';
import { dedupedName } from './dedupedName.js';

import { describe, expect, it } from 'vitest';
import { middleTruncate } from './middleTruncate.js';

// One unit per grapheme-ish code point is enough to pin the cut positions; an
// emoji counts double, as it renders about twice as wide.
const measure = (text) => Array.from(text).reduce((w, ch) => w + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);

const hasLoneSurrogate = (text) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe('middleTruncate', () => {
    it('leaves a name that fits alone', () => {
        expect(middleTruncate('notes.txt', 20, measure)).toBe('notes.txt');
    });

    it('keeps the extension and both ends of the name', () => {
        expect(middleTruncate('quarterly-report-final.pdf', 15, measure)).toBe('quart…final.pdf');
    });

    it('truncates a name without an extension', () => {
        expect(middleTruncate('abcdefghijklmnopqrstuvwxyz', 11, measure)).toBe('abcde…vwxyz');
    });

    it('falls back to the ellipsis and extension when nothing else fits', () => {
        expect(middleTruncate('abcdefghij.markdown', 9, measure)).toBe('….markdown');
        expect(middleTruncate('abcdefghij.markdown', 10, measure)).toBe('….markdown');
    });

    it('treats a long or spaced tail after the last dot as part of the name', () => {
        expect(middleTruncate('Report v1.2 final draft for board', 15, measure)).toBe('Report …r board');
        expect(middleTruncate('backup.20240101-full-archive', 15, measure)).toBe('backup.…archive');
    });

    it('never cuts an emoji in half', () => {
        const name = `x${'😀'.repeat(30)}.txt`;
        for ( let width = 6; width <= 60; width++ ) {
            const out = middleTruncate(name, width, measure);
            expect(hasLoneSurrogate(out)).toBe(false);
            expect(measure(out)).toBeLessThanOrEqual(Math.max(width, measure('….txt')));
        }
    });

    it('never splits a joined emoji sequence', () => {
        const family = '👨‍👩‍👧‍👦';
        const name = `a${family.repeat(12)}z.md`;
        for ( let width = 6; width <= 80; width++ ) {
            const out = middleTruncate(name, width, measure);
            expect(out).not.toMatch(/‍…|…‍/);
            expect(out.replace(/^a/, '').replace(/z?\.md$/, '').replace('…', '').split(family).join('')).toBe('');
        }
    });
});
