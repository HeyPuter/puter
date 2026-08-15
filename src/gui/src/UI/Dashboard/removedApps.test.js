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
import { parseRemovedApps, serializeRemovedApps, REMOVED_APPS_MAX } from './removedApps.js';

describe('parseRemovedApps', () => {
    it('returns an empty set when nothing was saved', () => {
        expect(parseRemovedApps(null)).toEqual(new Set());
        expect(parseRemovedApps(undefined)).toEqual(new Set());
    });

    it('parses a JSON string of names', () => {
        expect(parseRemovedApps('["chess","camera"]')).toEqual(new Set(['chess', 'camera']));
    });

    it('accepts an already-deserialized array', () => {
        // Some kv backends hand back the parsed value rather than the string.
        expect(parseRemovedApps(['chess'])).toEqual(new Set(['chess']));
    });

    it('degrades corrupt JSON to an empty set instead of throwing', () => {
        expect(parseRemovedApps('{not json')).toEqual(new Set());
    });

    it('degrades non-array values to an empty set', () => {
        expect(parseRemovedApps('{"a":1}')).toEqual(new Set());
        expect(parseRemovedApps(42)).toEqual(new Set());
        expect(parseRemovedApps({})).toEqual(new Set());
    });

    it('drops non-string and empty entries', () => {
        expect(parseRemovedApps(['chess', '', null, 7, {}, 'camera']))
            .toEqual(new Set(['chess', 'camera']));
    });

    it('keeps only the newest names past the cap', () => {
        const list = Array.from({ length: REMOVED_APPS_MAX + 10 }, (_, i) => `app-${i}`);
        const parsed = parseRemovedApps(list);
        expect(parsed.size).toBe(REMOVED_APPS_MAX);
        // Oldest entries (the head) fall off; the newest survive.
        expect(parsed.has('app-0')).toBe(false);
        expect(parsed.has(`app-${REMOVED_APPS_MAX + 9}`)).toBe(true);
    });
});

describe('serializeRemovedApps', () => {
    it('serializes a set to an array of names', () => {
        expect(serializeRemovedApps(new Set(['chess', 'camera']))).toEqual(['chess', 'camera']);
    });

    it('drops unusable entries and duplicates', () => {
        expect(serializeRemovedApps(['chess', '', null, 'chess', 'camera']))
            .toEqual(['chess', 'camera']);
    });

    it('handles non-iterable input defensively', () => {
        expect(serializeRemovedApps(null)).toEqual([]);
        expect(serializeRemovedApps(undefined)).toEqual([]);
        expect(serializeRemovedApps(42)).toEqual([]);
    });

    it('rejects a raw string instead of shredding it into characters', () => {
        expect(serializeRemovedApps('chess')).toEqual([]);
    });

    it('applies the cap, shedding oldest first', () => {
        const names = Array.from({ length: REMOVED_APPS_MAX + 5 }, (_, i) => `app-${i}`);
        const out = serializeRemovedApps(names);
        expect(out.length).toBe(REMOVED_APPS_MAX);
        expect(out[0]).toBe('app-5');
        expect(out[out.length - 1]).toBe(`app-${REMOVED_APPS_MAX + 4}`);
    });

    it('round-trips with parseRemovedApps', () => {
        const set = new Set(['chess', 'camera', 'vault']);
        expect(parseRemovedApps(JSON.stringify(serializeRemovedApps(set)))).toEqual(set);
    });
});
