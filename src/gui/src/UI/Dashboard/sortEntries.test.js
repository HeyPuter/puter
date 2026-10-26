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
import { compareEntries, compareNames } from './sortEntries.js';

const sortNames = names => [...names].sort(compareNames);

describe('compareNames', () => {
    it('orders runs of digits by value', () => {
        expect(sortNames(['file10.txt', 'file2.txt', 'file1.txt'])).toEqual(['file1.txt', 'file2.txt', 'file10.txt']);
        expect(sortNames(['IMG_100', 'IMG_9', 'IMG_10'])).toEqual(['IMG_9', 'IMG_10', 'IMG_100']);
    });

    it('ignores case', () => {
        expect(sortNames(['beta', 'Alpha', 'gamma'])).toEqual(['Alpha', 'beta', 'gamma']);
    });

    it('still orders names that differ only in case', () => {
        expect(compareNames('a', 'A')).not.toBe(0);
        expect(Math.sign(compareNames('a', 'A'))).toBe(-Math.sign(compareNames('A', 'a')));
    });
});

describe('compareEntries', () => {
    it('breaks a tie in size or date by name', () => {
        const entries = [
            { name: 'zeta', size: 0, modified: 5 },
            { name: 'alpha', size: 0, modified: 5 },
            { name: 'dir10', size: 0, modified: 5 },
            { name: 'dir2', size: 0, modified: 5 },
        ];
        const expected = ['alpha', 'dir2', 'dir10', 'zeta'];
        expect([...entries].sort((a, b) => compareEntries(a, b, 'size')).map(e => e.name)).toEqual(expected);
        expect([...entries].sort((a, b) => compareEntries(a, b, 'modified')).map(e => e.name)).toEqual(expected);
    });

    it('orders by the column before the name', () => {
        const big = { name: 'a', size: 20, modified: 1 };
        const small = { name: 'b', size: 10, modified: 2 };
        expect(compareEntries(big, small, 'size')).toBeGreaterThan(0);
        expect(compareEntries(big, small, 'modified')).toBeLessThan(0);
        expect(compareEntries(big, small, 'name')).toBeLessThan(0);
    });

    it('reads a missing size or date as 0', () => {
        expect(compareEntries({ name: 'a' }, { name: 'b', size: 1 }, 'size')).toBeLessThan(0);
    });
});
