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
import { SubscriptionCache } from './subscriptionCache.js';

describe('answers', () => {
    it('says nothing until it has been told something', () => {
        expect(new SubscriptionCache().read(1)).toBeNull();
    });

    it('holds an answer written under the current generation', () => {
        const cache = new SubscriptionCache();
        cache.write(1, cache.generationOf(1), false);
        expect(cache.read(1)).toBe(false);
    });
});

describe('invalidation', () => {
    it('drops the answer on a bump', () => {
        const cache = new SubscriptionCache();
        cache.write(1, 0, false);

        cache.bump(1, 1);

        expect(cache.read(1)).toBeNull();
    });

    it('leaves other users alone', () => {
        const cache = new SubscriptionCache();
        cache.write(1, 0, true);
        cache.write(2, 0, false);

        cache.bump(1, 1);

        expect(cache.read(2)).toBe(false);
    });

    it('discards a read that a bump overtook while it was in flight', () => {
        const cache = new SubscriptionCache();
        const generation = cache.generationOf(1);

        cache.bump(1, 1);
        cache.write(1, generation, false);

        expect(cache.read(1)).toBeNull();
    });

    it('cannot be walked backwards by a bump that arrives late', () => {
        const cache = new SubscriptionCache();
        cache.bump(1, 5);
        cache.bump(1, 2);

        cache.write(1, 5, true);

        expect(cache.read(1)).toBe(true);
    });

    it('still advances when a bump names no generation', () => {
        const cache = new SubscriptionCache();
        cache.write(1, 0, true);

        cache.bump(1);

        expect(cache.read(1)).toBeNull();
        expect(cache.generationOf(1)).toBe(1);
    });
});

describe('bounds', () => {
    it('never grows past its limit', () => {
        const cache = new SubscriptionCache(3);
        for (let userId = 1; userId <= 50; userId++)
            cache.write(userId, 0, true);

        expect(cache.size).toBe(3);
    });

    it('evicts the least recently read, not the least recently written', () => {
        const cache = new SubscriptionCache(2);
        cache.write(1, 0, true);
        cache.write(2, 0, true);

        cache.read(1);
        cache.write(3, 0, true);

        expect(cache.read(1)).toBe(true);
        expect(cache.read(2)).toBeNull();
    });
});
