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
import { catalogPrice } from './catalogPrice.js';

describe('catalogPrice', () => {
    it('reads numbers and numeric strings', () => {
        expect(catalogPrice(0.25)).toBe(0.25);
        expect(catalogPrice('0.25')).toBe(0.25);
        expect(catalogPrice(' 3e-7 ')).toBe(3e-7);
        expect(catalogPrice(0)).toBe(0);
    });

    it('leaves absent, negative and placeholder prices unpriced', () => {
        for (const value of [undefined, null, '', ' ', -1, '-1', 'free', NaN]) {
            expect(catalogPrice(value)).toBeUndefined();
        }
    });

    it('converts units with the multiplier', () => {
        expect(catalogPrice('0.0000000014', 100_000_000)).toBeCloseTo(0.14);
        expect(catalogPrice(0, 100)).toBe(0);
    });

    it('leaves overflowing and underflowing conversions unknown', () => {
        expect(catalogPrice(1e308, 100)).toBeUndefined();
        expect(catalogPrice(1e-320, 1e-10)).toBeUndefined();
    });
});
