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
import { resolveTypedPath } from './typedPath.js';

const places = { currentPath: '/alice/Documents', homePath: '/alice', sharedPath: 'puter://shared' };

describe('resolveTypedPath', () => {
    it('takes an absolute path as typed, without the trailing slash', () => {
        expect(resolveTypedPath('/bob/Public/', places)).toBe('/bob/Public');
        expect(resolveTypedPath('/', places)).toBe('/');
    });

    it('ignores the space around a pasted path', () => {
        expect(resolveTypedPath('  /alice/Pictures \n', places)).toBe('/alice/Pictures');
    });

    it('reads ~ as the home folder', () => {
        expect(resolveTypedPath('~', places)).toBe('/alice');
        expect(resolveTypedPath('~/Desktop', places)).toBe('/alice/Desktop');
    });

    it('starts a relative path from the folder on screen', () => {
        expect(resolveTypedPath('Work/2026', places)).toBe('/alice/Documents/Work/2026');
        expect(resolveTypedPath('../Videos', places)).toBe('/alice/Videos');
        expect(resolveTypedPath('/alice/./Documents/../Public', places)).toBe('/alice/Public');
    });

    it('starts a relative path from home in the Shared view', () => {
        expect(resolveTypedPath('Desktop', { ...places, currentPath: 'puter://shared' })).toBe('/alice/Desktop');
    });

    it('keeps the Shared view\'s path', () => {
        expect(resolveTypedPath('puter://shared/', places)).toBe('puter://shared');
    });

    it('leads nowhere when nothing was typed', () => {
        expect(resolveTypedPath('   ', places)).toBeUndefined();
    });

    it('a ~ inside a name is just a character', () => {
        expect(resolveTypedPath('~notes', places)).toBe('/alice/Documents/~notes');
    });
});
