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
    it('matches the same name in another case or normalization form', () => {
        expect(entryNamesMatch('/u/Docs/Notes.txt', '/u/docs/notes.TXT')).toBe(
            true,
        );
        expect(entryNamesMatch('/u/Ünïcode', '/u/ünÏCODE')).toBe(true);
        const nfc = 'café.txt';
        expect(entryNamesMatch(nfc, nfc.normalize('NFD'))).toBe(true);
        expect(entryNamesMatch(nfc.normalize('NFD'), nfc)).toBe(true);
    });

    it('tells apart names a database collation may fold together', () => {
        for (const [a, b] of [
            ['😀.txt', '😁.txt'],
            ['📁 Work', '📂 Work'],
            ['résumé.pdf', 'resume.pdf'],
            ['❤️.txt', '❤.txt'],
            ['あ.txt', 'ア.txt'],
            ['Ａ.txt', 'A.txt'],
            ['straße', 'strasse'],
        ]) {
            expect(entryNamesMatch(a!, b!)).toBe(false);
        }
    });
});
