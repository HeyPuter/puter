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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    creditsFromMicrocents,
    creditsRate,
    formatCredits,
    formatCreditsFromMicrocents,
    formatDollarsFromMicrocents,
} from './credits.js';

describe('creditsRate', () => {
    it('reads the server-provided rate', () => {
        expect(creditsRate({ creditsPerDollar: 1000 })).toBe(1000);
    });

    it('is null when the server sends no usable rate — the client holds none', () => {
        expect(creditsRate({})).toBeNull();
        expect(creditsRate(undefined)).toBeNull();
        expect(creditsRate({ creditsPerDollar: 0 })).toBeNull();
        expect(creditsRate({ creditsPerDollar: -5 })).toBeNull();
        expect(creditsRate({ creditsPerDollar: 'many' })).toBeNull();
    });
});

describe('creditsFromMicrocents', () => {
    it('scales by whatever rate the server sent: $1 of usage = rate credits', () => {
        expect(creditsFromMicrocents(100_000_000, 100)).toBe(100);
        expect(creditsFromMicrocents(100_000_000, 1000)).toBe(1000);
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
    it('formats straight from server amounts at the server rate', () => {
        expect(formatCreditsFromMicrocents(37_000_000, 100)).toBe('37');
        expect(formatCreditsFromMicrocents(900_000_000, 100)).toBe('900');
        // A single cheap API call: a fraction of one credit, still visible.
        expect(formatCreditsFromMicrocents(2_000, 100)).toBe('<0.01');
    });
});

describe('formatDollarsFromMicrocents', () => {
    beforeEach(() => {
        globalThis.window = globalThis.window ?? {};
        globalThis.window.number_format = vi.fn(
            (n, { decimals, prefix }) => `${prefix}${n.toFixed(decimals)}`,
        );
    });

    afterEach(() => {
        delete globalThis.window.number_format;
    });

    it('renders the pre-credits dollar string for rate-less deployments', () => {
        expect(formatDollarsFromMicrocents(37_000_000)).toBe('$0.37');
        expect(formatDollarsFromMicrocents(undefined)).toBe('$0.00');
    });
});
