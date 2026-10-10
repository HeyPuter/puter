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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoundedTtlMap } from './boundedTtlMap.ts';

describe('BoundedTtlMap', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('stores and returns values, including falsy ones', () => {
        const map = new BoundedTtlMap<string, boolean | null>({
            maxEntries: 10,
        });
        map.set('a', null).set('b', false);
        expect(map.get('a')).toBeNull();
        expect(map.has('a')).toBe(true);
        expect(map.get('b')).toBe(false);
        expect(map.get('missing')).toBeUndefined();
        expect(map.has('missing')).toBe(false);
    });

    it('expires entries after the TTL', () => {
        const map = new BoundedTtlMap<string, number>({
            maxEntries: 10,
            ttlMs: 1000,
        });
        map.set('a', 1);
        vi.advanceTimersByTime(999);
        expect(map.get('a')).toBe(1);
        vi.advanceTimersByTime(1);
        expect(map.get('a')).toBeUndefined();
        expect(map.size).toBe(0);
    });

    it('keeps entries without a TTL until evicted', () => {
        const map = new BoundedTtlMap<string, number>({ maxEntries: 10 });
        map.set('a', 1);
        vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
        expect(map.get('a')).toBe(1);
    });

    it('evicts the least recently used entry once full', () => {
        const map = new BoundedTtlMap<string, number>({ maxEntries: 3 });
        map.set('a', 1).set('b', 2).set('c', 3);
        // Reading `a` makes `b` the least recently used.
        expect(map.get('a')).toBe(1);
        map.set('d', 4);
        expect(map.size).toBe(3);
        expect(map.has('b')).toBe(false);
        expect([map.get('a'), map.get('c'), map.get('d')]).toEqual([1, 3, 4]);
    });

    it('overwriting a key does not evict another', () => {
        const map = new BoundedTtlMap<string, number>({ maxEntries: 2 });
        map.set('a', 1).set('b', 2).set('a', 3);
        expect(map.size).toBe(2);
        expect(map.get('a')).toBe(3);
        expect(map.get('b')).toBe(2);
    });

    it('supports delete and clear', () => {
        const map = new BoundedTtlMap<string, number>({ maxEntries: 5 });
        map.set('a', 1).set('b', 2);
        expect(map.delete('a')).toBe(true);
        expect(map.has('a')).toBe(false);
        map.clear();
        expect(map.size).toBe(0);
    });

    describe('shouldEmit', () => {
        it('is true once per window per key', () => {
            const map = new BoundedTtlMap<string, true>({
                maxEntries: 10,
                ttlMs: 60_000,
            });
            expect(map.shouldEmit('k')).toBe(true);
            expect(map.shouldEmit('k')).toBe(false);
            expect(map.shouldEmit('other')).toBe(true);
            vi.advanceTimersByTime(60_000);
            expect(map.shouldEmit('k')).toBe(true);
            expect(map.shouldEmit('k')).toBe(false);
        });

        it('is always true with a zero TTL', () => {
            const map = new BoundedTtlMap<string, true>({
                maxEntries: 10,
                ttlMs: 0,
            });
            expect(map.shouldEmit('k')).toBe(true);
            expect(map.shouldEmit('k')).toBe(true);
        });

        it('stays bounded under a flood of distinct keys', () => {
            const map = new BoundedTtlMap<string, true>({
                maxEntries: 100,
                ttlMs: 60_000,
            });
            for (let i = 0; i < 10_000; i++) map.shouldEmit(`k${i}`);
            expect(map.size).toBe(100);
        });

        it('emits again after the key is deleted', () => {
            const map = new BoundedTtlMap<string, true>({
                maxEntries: 10,
                ttlMs: 60_000,
            });
            expect(map.shouldEmit('k')).toBe(true);
            map.delete('k');
            expect(map.shouldEmit('k')).toBe(true);
        });
    });
});
