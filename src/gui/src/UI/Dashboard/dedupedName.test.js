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

describe('dedupedName', () => {
    it('keeps the name when nothing collides', () => {
        expect(dedupedName('New Folder', [])).toBe('New Folder');
        expect(dedupedName('New Folder', ['Documents', 'Photos'])).toBe('New Folder');
    });

    it('starts the suffix at (1), matching the backend', () => {
        expect(dedupedName('New Folder', ['New Folder'])).toBe('New Folder (1)');
    });

    it('skips suffixes that are already taken', () => {
        const taken = ['New Folder', 'New Folder (1)', 'New Folder (2)'];
        expect(dedupedName('New Folder', taken)).toBe('New Folder (3)');
    });

    it('fills the first gap in the suffix sequence', () => {
        const taken = ['New Folder', 'New Folder (2)'];
        expect(dedupedName('New Folder', taken)).toBe('New Folder (1)');
    });

    it('compares case-insensitively', () => {
        expect(dedupedName('New Folder', ['new folder'])).toBe('New Folder (1)');
    });

    it('keeps the extension after the suffix', () => {
        expect(dedupedName('notes.txt', ['notes.txt'])).toBe('notes (1).txt');
    });

    it('treats a dotfile as having no extension', () => {
        expect(dedupedName('.env', ['.env'])).toBe('.env (1)');
    });

    it('ignores non-string entries', () => {
        expect(dedupedName('New Folder', [null, undefined, 'New Folder'])).toBe('New Folder (1)');
    });
});
