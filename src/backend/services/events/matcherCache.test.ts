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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileMatch } from './matcher.js';
import { MatcherCache } from './matcherCache.js';

/** Counts compiles, so a test can tell a hit from a miss. */
const compiler = () => {
    const compiled: string[] = [];
    return {
        compiled,
        compile: (pattern: string) => {
            compiled.push(pattern);
            return compileMatch(pattern);
        },
    };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('MatcherCache', () => {
    it('compiles a pattern once and answers from memory after', () => {
        const cache = new MatcherCache();
        const { compiled, compile } = compiler();

        const first = cache.get('sub-1', '*.txt', compile);
        const second = cache.get('sub-1', '*.txt', compile);

        expect(second).toBe(first);
        expect(compiled).toEqual(['*.txt']);
        expect(first.test('notes.txt')).toBe(true);
    });

    it('recompiles a subscription whose pattern moved', () => {
        const cache = new MatcherCache();
        const { compiled, compile } = compiler();

        cache.get('sub-1', '*.txt', compile);
        const moved = cache.get('sub-1', 'docs/*.txt', compile);

        expect(compiled).toEqual(['*.txt', 'docs/*.txt']);
        expect(moved.test('docs/notes.txt')).toBe(true);
        expect(cache.size).toBe(1);
    });

    it('drops the least recently used rather than growing', () => {
        const cache = new MatcherCache(2);
        const { compiled, compile } = compiler();
        cache.get('sub-1', 'a', compile);
        cache.get('sub-2', 'b', compile);
        // Touching the oldest is what makes it the youngest.
        cache.get('sub-1', 'a', compile);
        cache.get('sub-3', 'c', compile);

        expect(cache.size).toBe(2);
        compiled.length = 0;
        cache.get('sub-1', 'a', compile);
        cache.get('sub-2', 'b', compile);
        expect(compiled).toEqual(['b']);
    });

    it('lets go of a subscription nothing here was told had ended', () => {
        vi.useFakeTimers();
        const cache = new MatcherCache(100, 1_000);
        const { compiled, compile } = compiler();
        cache.get('sub-1', 'a', compile);

        vi.advanceTimersByTime(999);
        cache.get('sub-1', 'a', compile);
        expect(compiled).toEqual(['a']);

        vi.advanceTimersByTime(1_001);
        cache.get('sub-1', 'a', compile);
        expect(compiled).toEqual(['a', 'a']);
    });

    it('forgets one subscription and leaves the rest', () => {
        const cache = new MatcherCache();
        const { compiled, compile } = compiler();
        cache.get('sub-1', 'a', compile);
        cache.get('sub-2', 'b', compile);

        cache.forget('sub-1');

        expect(cache.size).toBe(1);
        cache.get('sub-2', 'b', compile);
        expect(compiled).toEqual(['a', 'b']);
    });
});
