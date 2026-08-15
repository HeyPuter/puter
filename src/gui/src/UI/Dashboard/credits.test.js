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
    formatCredits,
    formatDollarsFromMicrocents,
    usageIsCredits,
} from './credits.js';

describe('usageIsCredits', () => {
    it('trusts only the explicit unit flag', () => {
        expect(usageIsCredits({ unit: 'credits' })).toBe(true);
        expect(usageIsCredits({})).toBe(false);
        expect(usageIsCredits(undefined)).toBe(false);
        expect(usageIsCredits({ unit: 'dollars' })).toBe(false);
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

    it('tolerates missing input', () => {
        expect(formatCredits(undefined)).toBe('0');
        expect(formatCredits(NaN)).toBe('0');
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

    it('renders the raw-amount dollar string for unscaled deployments', () => {
        expect(formatDollarsFromMicrocents(37_000_000)).toBe('$0.37');
        expect(formatDollarsFromMicrocents(undefined)).toBe('$0.00');
    });
});
