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
import { reconcileAppOrder, serializeAppOrder } from './appOrder.js';

const names = apps => apps.map(a => a.name);
const mk = (...ns) => ns.map(n => ({ name: n }));

describe('reconcileAppOrder', () => {
    it('returns a copy in the original order when there is no saved order', () => {
        const apps = mk('a', 'b', 'c');
        const out = reconcileAppOrder(apps, null);
        expect(names(out)).toEqual(['a', 'b', 'c']);
        expect(out).not.toBe(apps);
    });

    it('treats an empty saved order the same as none', () => {
        expect(names(reconcileAppOrder(mk('a', 'b'), []))).toEqual(['a', 'b']);
    });

    it('applies a full saved order', () => {
        const out = reconcileAppOrder(mk('a', 'b', 'c'), ['c', 'a', 'b']);
        expect(names(out)).toEqual(['c', 'a', 'b']);
    });

    it('appends apps missing from the saved order, preserving their order', () => {
        // 'd' and 'e' were installed after the order was saved.
        const out = reconcileAppOrder(mk('a', 'b', 'c', 'd', 'e'), ['c', 'a']);
        expect(names(out)).toEqual(['c', 'a', 'b', 'd', 'e']);
    });

    it('ignores saved names that no longer correspond to an app', () => {
        // 'x' was uninstalled; it must not resurrect or shift anything.
        const out = reconcileAppOrder(mk('a', 'b'), ['x', 'b', 'a']);
        expect(names(out)).toEqual(['b', 'a']);
    });

    it('is stable against a duplicated saved entry', () => {
        const out = reconcileAppOrder(mk('a', 'b', 'c'), ['b', 'b', 'a']);
        expect(names(out)).toEqual(['b', 'a', 'c']);
    });

    it('does not mutate the input array', () => {
        const apps = mk('a', 'b', 'c');
        reconcileAppOrder(apps, ['c', 'b', 'a']);
        expect(names(apps)).toEqual(['a', 'b', 'c']);
    });

    it('handles non-array inputs defensively', () => {
        expect(reconcileAppOrder(null, ['a'])).toEqual([]);
        expect(names(reconcileAppOrder(mk('a'), 'nonsense'))).toEqual(['a']);
    });
});

describe('serializeAppOrder', () => {
    it('extracts names in order', () => {
        expect(serializeAppOrder(mk('a', 'b', 'c'))).toEqual(['a', 'b', 'c']);
    });

    it('drops entries without a usable name', () => {
        const apps = [{ name: 'a' }, { name: '' }, {}, null, { name: 'b' }];
        expect(serializeAppOrder(apps)).toEqual(['a', 'b']);
    });

    it('round-trips with reconcileAppOrder', () => {
        const apps = mk('a', 'b', 'c', 'd');
        const reordered = reconcileAppOrder(apps, ['d', 'c', 'b', 'a']);
        const saved = serializeAppOrder(reordered);
        expect(names(reconcileAppOrder(apps, saved))).toEqual(['d', 'c', 'b', 'a']);
    });
});
