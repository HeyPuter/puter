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
import { randomCode } from './randomCode';

describe('randomCode', () => {
    it('draws `length` characters from the alphabet only', () => {
        const code = randomCode(64, 'ab');
        expect(code).toHaveLength(64);
        expect(code).toMatch(/^[ab]+$/);
    });

    it('uses the whole alphabet', () => {
        const seen = new Set(randomCode(2_000, 'xyz'));
        expect([...seen].sort()).toEqual(['x', 'y', 'z']);
    });

    it('returns an empty string for zero length', () => {
        expect(randomCode(0, 'abc')).toBe('');
    });
});
