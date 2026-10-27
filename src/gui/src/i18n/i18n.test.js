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

globalThis.window = globalThis.window ?? globalThis;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
await import('./i18n.js');

describe('i18n %% replacements', () => {
    it('inserts a value literally, even one that looks like a replacement pattern', () => {
        expect(window.i18n('moving_file', ["R&D $& $' Co"], false)).toBe("Moving R&D $& $' Co");
        expect(window.i18n('moving_file', ['a$&b'])).toBe('Moving a$&amp;b');
    });
});
