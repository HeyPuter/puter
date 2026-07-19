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
import { reconcileAppOrder, serializeAppOrder, mergeSavedOrder } from './appOrder.js';

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

describe('mergeSavedOrder', () => {
    it('returns the current order when nothing was saved before', () => {
        expect(mergeSavedOrder(['a', 'b'], null)).toEqual(['a', 'b']);
        expect(mergeSavedOrder(['a', 'b'], [])).toEqual(['a', 'b']);
    });

    it('keeps present names exactly in the current order', () => {
        expect(mergeSavedOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    });

    it('re-inserts a missing name after its surviving predecessor', () => {
        // 'm' sat between 'b' and 'c' in the saved order; it must return to
        // that slot, not be demoted to the tail.
        expect(mergeSavedOrder(['a', 'b', 'c'], ['a', 'b', 'm', 'c'])).toEqual(['a', 'b', 'm', 'c']);
    });

    it('keeps a missing name at the front when it led the saved order', () => {
        expect(mergeSavedOrder(['a', 'b'], ['m', 'a', 'b'])).toEqual(['m', 'a', 'b']);
    });

    it('keeps runs of missing names in their saved order', () => {
        expect(mergeSavedOrder(['a', 'b'], ['a', 'm1', 'm2', 'b'])).toEqual(['a', 'm1', 'm2', 'b']);
    });

    it('keeps a missing name at its rank when visible tiles are rearranged', () => {
        // 'm' was third; the user swapped 'a' and 'b'. 'm' stays third — it
        // neither follows 'b' to the front nor gets demoted.
        expect(mergeSavedOrder(['b', 'a', 'c'], ['a', 'b', 'm', 'c'])).toEqual(['b', 'a', 'm', 'c']);
    });

    it('preserves a truncated tail after a partial load and a drag', () => {
        // Saved order covers 6 apps; only the first 4 loaded (page 2 failed)
        // and the user dragged 'd' to the front. The unloaded tail must keep
        // its saved position after the surviving 'c', not vanish.
        const merged = mergeSavedOrder(['d', 'a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e', 'f']);
        expect(merged).toEqual(['d', 'a', 'b', 'c', 'e', 'f']);
        // Round-trip: when the full list loads again, 'e' and 'f' come back
        // in their saved slots.
        expect(names(reconcileAppOrder(mk('a', 'b', 'c', 'd', 'e', 'f'), merged)))
            .toEqual(['d', 'a', 'b', 'c', 'e', 'f']);
    });

    it('ignores unusable saved entries and duplicates', () => {
        expect(mergeSavedOrder(['a'], ['', null, 'a', 'a', 'm'])).toEqual(['a', 'm']);
    });

    it('does not mutate its inputs', () => {
        const current = ['a', 'b'];
        const previous = ['b', 'm', 'a'];
        mergeSavedOrder(current, previous);
        expect(current).toEqual(['a', 'b']);
        expect(previous).toEqual(['b', 'm', 'a']);
    });
});
