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
import { formatAbsoluteTime, formatRelativeTime } from './formatTime.js';

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
    it('describes the recent past in words', () => {
        expect(formatRelativeTime(NOW, NOW)).toBe('now');
        expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('now');
        expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe('5 minutes ago');
        expect(formatRelativeTime(NOW - 1 * MIN, NOW)).toBe('1 minute ago');
        expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3 hours ago');
        expect(formatRelativeTime(NOW - DAY, NOW)).toBe('yesterday');
        expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe('3 days ago');
    });

    it('counts days by the calendar, not by 24-hour spans', () => {
        const at = (d, h, m = 0) => new Date(2026, 7, d, h, m).getTime();
        expect(formatRelativeTime(at(27, 0, 45), at(27, 23, 30))).toBe('23 hours ago');
        expect(formatRelativeTime(at(24, 23), at(26, 9))).toBe('2 days ago');
        expect(formatRelativeTime(at(26, 20), at(27, 19))).toBe('yesterday');
    });

    it('falls back to a short date past a week', () => {
        expect(formatRelativeTime(NOW - 10 * DAY, NOW)).toBe('Aug 17');
        expect(formatRelativeTime(NOW - 400 * DAY, NOW)).toBe('Jul 23, 2025');
    });

    it('never reports the future', () => {
        expect(formatRelativeTime(NOW + HOUR, NOW)).toBe('now');
    });

    it('localises', () => {
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'fr')).toBe('il y a 5 minutes');
    });

    it("reads Puter's language codes that aren't BCP 47 tags", () => {
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'br')).toBe('há 5 minutos');
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'ua')).toBe('5 хвилин тому');
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'zhtw')).toBe('5 分鐘前');
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'emoji')).toBe('5 minutes ago');
        expect(formatAbsoluteTime(NOW, 'zhtw')).toMatch(/^2026年8月\d+日/);
    });

    it('survives an unknown locale', () => {
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'not-a-locale-!!')).toBe('5 minutes ago');
        expect(formatRelativeTime(NOW - 10 * DAY, NOW, 'not-a-locale-!!')).toBe('Aug 17');
    });
});

describe('formatAbsoluteTime', () => {
    it('spells out the moment', () => {
        expect(formatAbsoluteTime(NOW, 'en')).toMatch(/Aug 27, 2026/);
    });
});
