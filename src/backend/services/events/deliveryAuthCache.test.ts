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
import { DeliveryAuthCache } from './deliveryAuthCache.js';

const key = (
    subId: string,
    generation: string,
    nodeUid = 'node-1',
): { subId: string; generation: string; nodeUid: string } => ({
    subId,
    generation,
    nodeUid,
});

afterEach(() => {
    vi.useRealTimers();
});

describe('DeliveryAuthCache', () => {
    it('answers what it was told, and nothing it was not', () => {
        const cache = new DeliveryAuthCache();
        cache.write(key('sub-1', 'g1'), true);

        expect(cache.read(key('sub-1', 'g1'))).toBe(true);
        expect(cache.read(key('sub-2', 'g1'))).toBeNull();
    });

    it('keeps a denial as firmly as an approval', () => {
        const cache = new DeliveryAuthCache();
        cache.write(key('sub-1', 'g1'), false);

        expect(cache.read(key('sub-1', 'g1'))).toBe(false);
    });

    it('has no answer once the permission generation moves', () => {
        const cache = new DeliveryAuthCache();
        cache.write(key('sub-1', 'g1'), true);

        expect(cache.read(key('sub-1', 'g2'))).toBeNull();
    });

    it('decides per node, because the check is about the node', () => {
        const cache = new DeliveryAuthCache();
        cache.write(key('sub-1', 'g1', 'allowed'), true);
        cache.write(key('sub-1', 'g1', 'closed'), false);

        expect(cache.read(key('sub-1', 'g1', 'allowed'))).toBe(true);
        expect(cache.read(key('sub-1', 'g1', 'closed'))).toBe(false);
        expect(cache.read(key('sub-1', 'g1', 'unseen'))).toBeNull();
    });

    it('stops trusting an answer nothing has refreshed', () => {
        vi.useFakeTimers();
        const cache = new DeliveryAuthCache(100, 1_000);
        cache.write(key('sub-1', 'g1'), true);

        vi.advanceTimersByTime(999);
        expect(cache.read(key('sub-1', 'g1'))).toBe(true);

        vi.advanceTimersByTime(2);
        expect(cache.read(key('sub-1', 'g1'))).toBeNull();
    });

    it('drops the least recently used rather than growing', () => {
        const cache = new DeliveryAuthCache(2);
        cache.write(key('sub-1', 'g1'), true);
        cache.write(key('sub-2', 'g1'), true);
        // Touching the oldest is what makes it the youngest.
        cache.read(key('sub-1', 'g1'));
        cache.write(key('sub-3', 'g1'), true);

        expect(cache.size).toBe(2);
        expect(cache.read(key('sub-1', 'g1'))).toBe(true);
        expect(cache.read(key('sub-2', 'g1'))).toBeNull();
        expect(cache.read(key('sub-3', 'g1'))).toBe(true);
    });

    it('forgets every answer about one subscription', () => {
        const cache = new DeliveryAuthCache();
        cache.write(key('sub-1', 'g1', 'a'), true);
        cache.write(key('sub-1', 'g2', 'b'), true);
        cache.write(key('sub-2', 'g1', 'a'), true);

        cache.forget('sub-1');

        expect(cache.read(key('sub-1', 'g1', 'a'))).toBeNull();
        expect(cache.read(key('sub-1', 'g2', 'b'))).toBeNull();
        expect(cache.read(key('sub-2', 'g1', 'a'))).toBe(true);
    });
});
