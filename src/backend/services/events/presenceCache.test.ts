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
import type { PresenceRow } from '../../stores/events/PresenceStore.js';
import { PresenceCache, remoteRegions } from './presenceCache.js';

/**
 * What the cache promises: an answer survives until presence moves, and one
 * window buys one repair. Both are what keep reads and corrective writes
 * proportional to session churn instead of to how busy a subscription is.
 */

const row = (regions: Record<string, number>, version = 1): PresenceRow => ({
    regions,
    version,
});

describe('the presence cache', () => {
    it('answers from memory until something bumps it', () => {
        const cache = new PresenceCache();
        cache.write(7, 'app-a', cache.generationOf(7), row({ west: 10 }));

        expect(cache.read(7, 'app-a')).toEqual(row({ west: 10 }));
        expect(cache.read(7, 'app-a')).toEqual(row({ west: 10 }));

        cache.bump(7);
        expect(cache.read(7, 'app-a')).toBeNull();
    });

    it('has no expiry — a settled row is never re-read on its own', () => {
        const cache = new PresenceCache();
        cache.write(7, 'app-a', cache.generationOf(7), row({ west: 10 }));

        const later = Date.now() + 60 * 60 * 1000;
        const realNow = Date.now;
        Date.now = () => later;
        try {
            expect(cache.read(7, 'app-a')).not.toBeNull();
        } finally {
            Date.now = realNow;
        }
    });

    it('drops an answer computed against a generation that has since moved', () => {
        const cache = new PresenceCache();
        const epoch = cache.generationOf(7);
        cache.bump(7);
        cache.write(7, 'app-a', epoch, row({ west: 10 }));

        expect(cache.read(7, 'app-a')).toBeNull();
    });

    it('bumps one user without touching another', () => {
        const cache = new PresenceCache();
        cache.write(7, 'app-a', cache.generationOf(7), row({ west: 10 }));
        cache.write(8, 'app-a', cache.generationOf(8), row({ east: 11 }));

        cache.bump(7);

        expect(cache.read(7, 'app-a')).toBeNull();
        expect(cache.read(8, 'app-a')).toEqual(row({ east: 11 }));
    });

    it('ignores a numbered bump it has already applied', () => {
        const cache = new PresenceCache();
        cache.bump(7, 5);
        cache.write(7, 'app-a', cache.generationOf(7), row({ west: 10 }));

        cache.bump(7, 4);
        expect(cache.read(7, 'app-a')).not.toBeNull();

        cache.bump(7, 6);
        expect(cache.read(7, 'app-a')).toBeNull();
    });

    it('advances on an unnumbered bump whatever number it last saw', () => {
        const cache = new PresenceCache();
        cache.bump(7, 9);
        cache.write(7, 'app-a', cache.generationOf(7), row({ west: 10 }));

        // A peer's counter cannot be compared against this region's own.
        cache.bump(7);
        expect(cache.read(7, 'app-a')).toBeNull();
    });

    it('gives one window one repair per region', () => {
        const cache = new PresenceCache();
        cache.write(7, 'app-a', cache.generationOf(7), row({ east: 10 }));

        expect(cache.claimRepair(7, 'app-a', 'east')).toBe(true);
        expect(cache.claimRepair(7, 'app-a', 'east')).toBe(false);
        expect(cache.claimRepair(7, 'app-a', 'east')).toBe(false);
        // A different region is its own claim.
        expect(cache.claimRepair(7, 'app-a', 'south')).toBe(true);
    });

    it('lets the next window repair again', () => {
        const cache = new PresenceCache();
        cache.write(7, 'app-a', cache.generationOf(7), row({ east: 10 }));
        expect(cache.claimRepair(7, 'app-a', 'east')).toBe(true);

        cache.bump(7);
        cache.write(7, 'app-a', cache.generationOf(7), row({ east: 10 }));

        expect(cache.claimRepair(7, 'app-a', 'east')).toBe(true);
    });

    it('refuses a repair for something it holds no row for', () => {
        const cache = new PresenceCache();
        expect(cache.claimRepair(7, 'app-a', 'east')).toBe(false);
    });

    it('stops naming a region the moment one is repaired away', () => {
        const cache = new PresenceCache();
        cache.write(
            7,
            'app-a',
            cache.generationOf(7),
            row({ east: 10, south: 11 }),
        );

        cache.forget(7, 'app-a', 'east');

        expect(cache.read(7, 'app-a')?.regions).toEqual({ south: 11 });
    });

    it('evicts least-recently-read once it is full', () => {
        const cache = new PresenceCache(2);
        cache.write(1, 'a', 0, row({ west: 1 }));
        cache.write(2, 'a', 0, row({ west: 2 }));
        cache.read(1, 'a');
        cache.write(3, 'a', 0, row({ west: 3 }));

        expect(cache.size).toBe(2);
        expect(cache.read(2, 'a')).toBeNull();
        expect(cache.read(1, 'a')).not.toBeNull();
    });
});

describe('candidate regions', () => {
    it('leaves out the region asking, which never consults presence about itself', () => {
        expect(remoteRegions(row({ west: 1, east: 2 }), 'west')).toEqual([
            'east',
        ]);
    });

    it('offers the most recently connected first', () => {
        expect(
            remoteRegions(row({ east: 10, south: 30, north: 20 }), 'west'),
        ).toEqual(['south', 'north', 'east']);
    });

    it('is empty for a row naming nobody else', () => {
        expect(remoteRegions(row({ west: 1 }), 'west')).toEqual([]);
        expect(remoteRegions(row({}), 'west')).toEqual([]);
    });
});
