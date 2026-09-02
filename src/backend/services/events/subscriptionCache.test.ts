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
        // Captured as a lookup would, right after the generation that matters.
        const epoch = cache.generationOf(1);
        cache.bump(1, 2); // stale — must not undo generation 5's invalidation

        cache.write(1, epoch, true);

        expect(cache.read(1)).toBe(true);
    });

    it('still advances when a bump names no generation', () => {
        const cache = new SubscriptionCache();
        cache.write(1, 0, true);

        cache.bump(1);

        expect(cache.read(1)).toBeNull();
        expect(cache.generationOf(1)).toBe(1);
    });

    it('does not let a number-less bump block a real one that follows it', () => {
        // A number-less invalidation (`invalidateUser`'s bare call, or any
        // other local reason to forget) must not plant a value a following
        // *real* generation — a local subscribe's first-ever bump, often a
        // small number — could compare behind and be ignored for. Mirrors a
        // stale "nothing subscribed" answer surviving a subscribe that
        // landed moments later.
        const cache = new SubscriptionCache();
        cache.write(1, cache.generationOf(1), false); // cached stale "false"
        cache.bump(1); // e.g. a number-less invalidation
        cache.write(1, cache.generationOf(1), false); // re-checked, still "false"

        cache.bump(1, 1); // a real local publish landing shortly after

        expect(cache.read(1)).toBeNull(); // forced to look again, not stuck
    });
});

describe('cross-region generation mismatch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('self-heals on a TTL even when a lower foreign generation is ignored', () => {
        // A generation counter is region-local: a peer's bump can carry a
        // number behind what this process already recorded for its own
        // local traffic, purely because it was counted by a different
        // counter. `bump()` treats that as already-applied and does not
        // clear the cached answer — the TTL is what stops it surviving
        // forever regardless.
        const cache = new SubscriptionCache(10_000, 2_000);
        cache.bump(1, 5); // a real local publish
        cache.write(1, cache.generationOf(1), false); // cached under it

        cache.bump(1, 1); // a peer's bump, numbered behind this process's own
        expect(cache.read(1)).toBe(false); // not yet invalidated by number

        vi.advanceTimersByTime(2_001);
        expect(cache.read(1)).toBeNull(); // but stale past the TTL
    });

    it('keeps answering within the TTL without a bump at all', () => {
        const cache = new SubscriptionCache(10_000, 2_000);
        cache.write(1, 0, true);

        vi.advanceTimersByTime(1_000);

        expect(cache.read(1)).toBe(true);
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
