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
import {
    deliveryBackoffMs,
    doublingBackoffMs,
    EVENTS_RETRY_BASE_MS,
    EVENTS_RETRY_MAX_MS,
    parseRetryAfterMs,
} from './retryBackoff.js';

describe('deliveryBackoffMs', () => {
    it('doubles from the base per failure and stops at the ceiling', () => {
        expect(deliveryBackoffMs(0)).toBe(EVENTS_RETRY_BASE_MS);
        expect(deliveryBackoffMs(1)).toBe(EVENTS_RETRY_BASE_MS);
        expect(deliveryBackoffMs(3)).toBe(EVENTS_RETRY_BASE_MS * 4);
        expect(deliveryBackoffMs(50)).toBe(EVENTS_RETRY_MAX_MS);
    });
});

describe('doublingBackoffMs', () => {
    it('starts at the base, doubles per failure and stops at the ceiling', () => {
        const window = { baseMs: 60_000, maxMs: 6 * 60 * 60_000 };
        expect(doublingBackoffMs(0, window)).toBe(60_000);
        expect(doublingBackoffMs(1, window)).toBe(60_000);
        expect(doublingBackoffMs(4, window)).toBe(480_000);
        expect(doublingBackoffMs(30, window)).toBe(window.maxMs);
    });
});

describe('parseRetryAfterMs', () => {
    afterEach(() => vi.useRealTimers());

    it('reads whole and decimal seconds', () => {
        expect(parseRetryAfterMs('120')).toBe(120_000);
        expect(parseRetryAfterMs(' 1.5 ')).toBe(1_500);
        expect(parseRetryAfterMs('0')).toBe(0);
    });

    it('reads an HTTP date relative to now, a past one as 0', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT')).toBe(
            30_000,
        );
        expect(parseRetryAfterMs('Wed, 31 Dec 2025 23:59:00 GMT')).toBe(0);
    });

    it('returns null when absent or unreadable', () => {
        expect(parseRetryAfterMs(null)).toBeNull();
        expect(parseRetryAfterMs(undefined)).toBeNull();
        expect(parseRetryAfterMs('')).toBeNull();
        expect(parseRetryAfterMs('soon')).toBeNull();
    });
});
