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
import { drop_desktop_prefix, parse_url_paths } from './urlPaths.js';

describe('parse_url_paths', () => {
    it('splits a pathname into non-empty segments', () => {
        expect(parse_url_paths('/app/editor')).toEqual(['app', 'editor']);
        expect(parse_url_paths('/app/editor/')).toEqual(['app', 'editor']);
        expect(parse_url_paths('/')).toEqual([]);
        expect(parse_url_paths('')).toEqual([]);
    });
});

describe('drop_desktop_prefix', () => {
    it('drops a leading desktop segment so the rest reads as a root route', () => {
        expect(drop_desktop_prefix('/desktop/app/editor')).toBe('/app/editor');
        expect(drop_desktop_prefix('/DeskTop/app/editor')).toBe('/app/editor');
        expect(drop_desktop_prefix('/desktop')).toBe('/');
        expect(drop_desktop_prefix('/desktop/')).toBe('/');
    });

    it('only drops the prefix, not a later or lookalike segment', () => {
        expect(drop_desktop_prefix('/')).toBe('/');
        expect(drop_desktop_prefix('/app/desktop')).toBe('/app/desktop');
        expect(drop_desktop_prefix('/desktops/app/editor')).toBe('/desktops/app/editor');
        expect(drop_desktop_prefix('/desktop/desktop/app')).toBe('/desktop/app');
    });
});
