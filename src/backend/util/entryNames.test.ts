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
import { entryNamesMatch } from './entryNames.js';

describe('entryNamesMatch', () => {
    const cafe = 'café.txt';
    it.each([
        ['/u/Docs/Notes.txt', '/u/docs/notes.TXT'],
        ['/u/Ünïcode', '/u/ünÏCODE'],
        [cafe, cafe.normalize('NFD')],
        [cafe.normalize('NFD'), cafe],
        ['ΟΔΟΣ.txt', 'οδος.txt'],
        ['λόγος.txt', 'ΛΌΓΟΣ.TXT'],
        ['Straße.txt', 'STRASSE.txt'],
        ['İstanbul.txt', 'istanbul.txt'],
        ['İstanbul.txt'.normalize('NFD'), 'ISTANBUL.txt'],
        ['ａ.txt', 'Ａ.txt'],
    ])('matches %j and %j, the same name in another case or form', (a, b) => {
        expect(entryNamesMatch(a, b)).toBe(true);
    });

    it.each([
        ['😀.txt', '😁.txt'],
        ['📁 Work', '📂 Work'],
        ['résumé.pdf', 'resume.pdf'],
        ['café.txt', 'cafe.txt'],
        ['i\u0307.txt', 'i.txt'],
        ['❤️.txt', '❤.txt'],
        ['あ.txt', 'ア.txt'],
        ['Ａ.txt', 'A.txt'],
        ['ｱ.txt', 'ア.txt'],
    ])('tells %j from %j, names a database collation may fold together', (a, b) => {
        expect(entryNamesMatch(a, b)).toBe(false);
    });
});
