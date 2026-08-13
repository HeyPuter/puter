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
import {
    DEFAULT_CREDITS_PER_DOLLAR,
    creditsFromMicrocents,
    creditsRate,
    formatCredits,
    formatCreditsFromMicrocents,
} from './credits.js';

describe('creditsRate', () => {
    it('reads the server-provided rate', () => {
        expect(creditsRate({ creditsPerDollar: 1000 })).toBe(1000);
    });

    it('falls back for servers that predate the field', () => {
        expect(creditsRate({})).toBe(DEFAULT_CREDITS_PER_DOLLAR);
        expect(creditsRate(undefined)).toBe(DEFAULT_CREDITS_PER_DOLLAR);
        expect(creditsRate({ creditsPerDollar: 0 })).toBe(
            DEFAULT_CREDITS_PER_DOLLAR,
        );
        expect(creditsRate({ creditsPerDollar: -5 })).toBe(
            DEFAULT_CREDITS_PER_DOLLAR,
        );
    });
});

describe('creditsFromMicrocents', () => {
    it('scales by the rate: $1 of usage = rate credits', () => {
        expect(creditsFromMicrocents(100_000_000, 100)).toBe(100);
        expect(creditsFromMicrocents(100_000_000, 1000)).toBe(1000);
    });

    it('the free 50¢ allowance at the default rate is the 1,000-credit base', () => {
        expect(
            creditsFromMicrocents(50_000_000, DEFAULT_CREDITS_PER_DOLLAR),
        ).toBe(1000);
        // Basic's $9 allowance is 18x that base.
        expect(
            creditsFromMicrocents(900_000_000, DEFAULT_CREDITS_PER_DOLLAR),
        ).toBe(18_000);
    });

    it('tolerates missing input', () => {
        expect(creditsFromMicrocents(undefined, 100)).toBe(0);
        expect(creditsFromMicrocents(NaN, 100)).toBe(0);
    });
});

describe('formatCredits', () => {
    it('shows whole thousand-separated credits at size', () => {
        expect(formatCredits(9000)).toBe('9,000');
        expect(formatCredits(900)).toBe('900');
        expect(formatCredits(123.4)).toBe('123');
    });

    it('keeps decimals only while they carry the information', () => {
        expect(formatCredits(2.5)).toBe('2.5');
        expect(formatCredits(9)).toBe('9');
        expect(formatCredits(0.04)).toBe('0.04');
    });

    it('never rounds a real cost to zero', () => {
        expect(formatCredits(0.001)).toBe('<0.01');
        expect(formatCredits(0)).toBe('0');
    });
});

describe('formatCreditsFromMicrocents', () => {
    it('formats straight from server amounts', () => {
        // $0.37 spent of Basic's $9 allowance at the default rate.
        expect(formatCreditsFromMicrocents(37_000_000, 2000)).toBe('740');
        expect(formatCreditsFromMicrocents(900_000_000, 2000)).toBe('18,000');
        // A single cheap API call: a fraction of one credit, still visible.
        expect(formatCreditsFromMicrocents(2_000, 2000)).toBe('0.04');
    });
});
