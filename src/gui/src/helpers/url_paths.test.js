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
import { parse_url_paths } from './url_paths.js';

describe('parse_url_paths', () => {
    it('splits a pathname into non-empty segments', () => {
        expect(parse_url_paths('/app/editor')).toEqual(['app', 'editor']);
        expect(parse_url_paths('/app/editor/')).toEqual(['app', 'editor']);
        expect(parse_url_paths('/')).toEqual([]);
        expect(parse_url_paths('')).toEqual([]);
    });

    it('drops a leading desktop segment so the rest reads as a root route', () => {
        expect(parse_url_paths('/desktop/app/editor')).toEqual([
            'app',
            'editor',
        ]);
        expect(parse_url_paths('/DeskTop/app/editor')).toEqual([
            'app',
            'editor',
        ]);
        expect(parse_url_paths('/desktop')).toEqual([]);
        expect(parse_url_paths('/desktop/')).toEqual([]);
    });

    it('only drops the prefix, not a later or lookalike segment', () => {
        expect(parse_url_paths('/app/desktop')).toEqual(['app', 'desktop']);
        expect(parse_url_paths('/desktops/app/editor')).toEqual([
            'desktops',
            'app',
            'editor',
        ]);
        expect(parse_url_paths('/desktop/desktop/app')).toEqual([
            'desktop',
            'app',
        ]);
    });
});
