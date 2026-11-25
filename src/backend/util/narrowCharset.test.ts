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
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';
import { fitsCharset } from './narrowCharset.js';

describe('fitsCharset', () => {
    it('accepts only 7-bit values for ascii', () => {
        expect(fitsCharset('', 'ascii')).toBe(true);
        expect(fitsCharset('plain_name-01\x7f', 'ascii')).toBe(true);
        for (const value of ['m\u00e1genta', 'a\u0080', 'a\u00ff', '\u7528\u6237'])
            expect(fitsCharset(value, 'ascii')).toBe(false);
    });

    it('accepts U+00A0 to U+00FF for latin1 and nothing above or between', () => {
        expect(fitsCharset('jos\u00e9@example.com\u00a0\u00ff', 'latin1')).toBe(
            true,
        );
        // The C1 range and everything past U+00FF, cp1252 extras included.
        for (const value of [
            'a\u0080',
            'a\u009f',
            'a\u0100',
            'a\u20ac',
            '\u7528\u6237',
            'a\u{1F600}',
        ])
            expect(fitsCharset(value, 'latin1')).toBe(false);
    });
});
