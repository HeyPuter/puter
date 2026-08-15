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
import { appTileLink } from './appLink.js';

describe('appTileLink', () => {
    it('builds the /app/<name> landing against the given origin', () => {
        expect(appTileLink({ appName: 'editor' }, 'https://puter.com'))
            .toBe('https://puter.com/app/editor');
    });

    it('falls back to a root-relative link with no origin', () => {
        expect(appTileLink({ appName: 'editor' })).toBe('/app/editor');
    });

    it('encodes names that are not URL-safe', () => {
        expect(appTileLink({ appName: 'my app/v2' }, 'https://puter.com'))
            .toBe('https://puter.com/app/my%20app%2Fv2');
    });

    it('prefers an external tile\'s own site address', () => {
        expect(appTileLink({ appName: 'app-123', targetLink: 'https://example.com/' }, 'https://puter.com'))
            .toBe('https://example.com/');
    });

    it('has no link for a tile that names no app — a folder', () => {
        expect(appTileLink({}, 'https://puter.com')).toBe('');
        expect(appTileLink(undefined, 'https://puter.com')).toBe('');
    });
});
