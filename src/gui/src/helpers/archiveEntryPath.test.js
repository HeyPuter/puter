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
import { archiveEntryPath } from './archiveEntryPath.js';

describe('archiveEntryPath', () => {
    it('keeps nested entries as-is', () => {
        expect(archiveEntryPath('readme.txt')).toBe('readme.txt');
        expect(archiveEntryPath('docs/guide/intro.md')).toBe('docs/guide/intro.md');
        expect(archiveEntryPath('docs/guide/')).toBe('docs/guide/');
    });

    it('drops leading slashes and `.` segments', () => {
        expect(archiveEntryPath('./docs/intro.md')).toBe('docs/intro.md');
        expect(archiveEntryPath('/docs/intro.md')).toBe('docs/intro.md');
        expect(archiveEntryPath('//docs//./intro.md')).toBe('docs/intro.md');
        expect(archiveEntryPath('./docs/')).toBe('docs/');
    });

    it('rejects entries with a `..` segment', () => {
        expect(archiveEntryPath('../evil.txt')).toBe(null);
        expect(archiveEntryPath('../../../../templates/a.html')).toBe(null);
        expect(archiveEntryPath('docs/../../evil.txt')).toBe(null);
        expect(archiveEntryPath('docs/../readme.txt')).toBe(null);
        expect(archiveEntryPath('/../evil.txt')).toBe(null);
        expect(archiveEntryPath('docs/..')).toBe(null);
    });

    it('keeps names that only contain dots', () => {
        expect(archiveEntryPath('..hidden')).toBe('..hidden');
        expect(archiveEntryPath('docs/...')).toBe('docs/...');
        expect(archiveEntryPath('.env')).toBe('.env');
    });

    it('rejects entries that name the extract folder itself', () => {
        expect(archiveEntryPath('')).toBe(null);
        expect(archiveEntryPath('/')).toBe(null);
        expect(archiveEntryPath('./')).toBe(null);
        expect(archiveEntryPath(undefined)).toBe(null);
    });
});
