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
import { fsCreateKindFor } from './fsCreateKind.js';

describe('fsCreateKindFor', () => {
    it.each([
        ['.mail', 'dir'],
        ['.config', 'dir'],
        ['Documents', 'dir'],
        ['notes.txt', 'file'],
        ['.env.local', 'file'],
        ['archive.tar.gz', 'file'],
        // Known wart: a dot inside a directory-shaped name still reads as a
        // file, matching the backend heuristic exactly.
        ['my.folder', 'file'],
    ])('%s -> %s', (basename, expected) => {
        expect(fsCreateKindFor(basename)).toBe(expected);
    });
});
