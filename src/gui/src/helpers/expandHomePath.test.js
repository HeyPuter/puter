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

import { describe, it, expect } from 'vitest';
import { expand_home_path } from './expandHomePath.js';

describe('expand_home_path', () => {
    it('resolves a tilde path under the home path', () => {
        expect(expand_home_path('~/Documents/report.docx', '/alice'))
            .toBe('/alice/Documents/report.docx');
        expect(expand_home_path('~', '/alice')).toBe('/alice');
    });

    it('reads a bare relative path as home-relative', () => {
        expect(expand_home_path('Documents/report.docx', '/alice'))
            .toBe('/alice/Documents/report.docx');
        expect(expand_home_path('report.docx', '/alice'))
            .toBe('/alice/report.docx');
    });

    it('leaves an absolute path alone, including another user\'s', () => {
        expect(expand_home_path('/alice/Desktop/notes.txt', '/alice'))
            .toBe('/alice/Desktop/notes.txt');
        expect(expand_home_path('/bob/Public/shared.txt', '/alice'))
            .toBe('/bob/Public/shared.txt');
    });

    it('does not double the separator on a trailing-slash home path', () => {
        expect(expand_home_path('~/notes.txt', '/alice/')).toBe('/alice/notes.txt');
        expect(expand_home_path('notes.txt', '/alice/')).toBe('/alice/notes.txt');
        expect(expand_home_path('~', '/alice/')).toBe('/alice');
    });

    it('passes the path through when there is nothing to expand against', () => {
        // The home path isn't known until the user is signed in, and the path
        // itself arrives from a URL — neither is guaranteed to be a string.
        expect(expand_home_path('~/notes.txt', undefined)).toBe('~/notes.txt');
        expect(expand_home_path('~/notes.txt', '')).toBe('~/notes.txt');
        expect(expand_home_path('', '/alice')).toBe('');
        expect(expand_home_path(undefined, '/alice')).toBe(undefined);
        expect(expand_home_path(null, '/alice')).toBe(null);
    });
});
