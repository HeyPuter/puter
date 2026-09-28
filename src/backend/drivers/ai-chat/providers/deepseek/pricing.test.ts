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

import { describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_MODELS } from './models.js';
import {
    DeepSeekPricing,
    isDeepSeekPeak,
    parseDeepSeekPrices,
} from './pricing.js';

const pricePage = (flashInput = '$0.15') => `
<table><tr><td>MODEL</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr>
<tr><td>PRICING</td><td>1M INPUT TOKENS<br>(CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
<tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
<tr><td>1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>${flashInput}</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.30</td><td>$1.32</td></tr>
<tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.60</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.20</td><td>$3.96</td></tr></table>
<p>Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.</p>`;

describe('DeepSeek pricing', () => {
    it('parses both models, periods, and cache rates from the official table shape', () => {
        const prices = parseDeepSeekPrices(pricePage());
        expect(prices['deepseek-flash'].offPeak).toEqual({
            prompt: 0.15,
            completion: 0.6,
            cached: 0.003,
        });
        expect(prices['deepseek-v4-pro'].peak).toEqual({
            prompt: 1.32,
            completion: 3.96,
            cached: 0.044,
        });
    });

    it('rejects incomplete tables and changed peak rules', () => {
        expect(() =>
            parseDeepSeekPrices(
                pricePage().replace('excluding Chinese public holidays', ''),
            ),
        ).toThrow();
        expect(() =>
            parseDeepSeekPrices(pricePage().replace('<td>$3.96</td>', '')),
        ).toThrow();
    });

    it.each([
        ['2026-09-28T00:59:00Z', false],
        ['2026-09-28T01:00:00Z', true],
        ['2026-09-28T04:00:00Z', false],
        ['2026-09-28T06:00:00Z', true],
        ['2026-09-28T10:00:00Z', false],
        ['2026-09-27T07:00:00Z', false],
        ['2026-10-01T07:00:00Z', false],
        ['2026-05-04T07:00:00Z', false],
        ['2027-09-28T07:00:00Z', false],
    ])('classifies %s peak=%s', (iso, expected) => {
        expect(isDeepSeekPeak(new Date(iso))).toBe(expected);
    });

    it('updates catalog rates at UTC peak boundaries even after model routing copies an entry', () => {
        const flash = {
            ...DEEPSEEK_MODELS.find((model) => model.id === 'deepseek-flash')!,
        };
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-09-28T05:59:59Z'));
            expect(flash.costs.prompt_tokens).toBe(15);
            vi.setSystemTime(new Date('2026-09-28T06:00:00Z'));
            expect(flash.costs.prompt_tokens).toBe(30);
            expect(flash.costs.cached_tokens).toBe(0.6);
        } finally {
            vi.useRealTimers();
        }
    });

    it('refreshes rates and keeps the last good schedule after a bad response', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce(new Response(pricePage('$0.18')))
            .mockResolvedValueOnce(new Response('<html>bad prices</html>'));
        const pricing = new DeepSeekPricing(fetchPage);
        const offPeak = new Date('2026-09-28T05:00:00Z');

        await pricing.refresh();
        expect(pricing.costs('deepseek-flash', offPeak).prompt).toBe(18);
        await expect(pricing.refresh()).rejects.toThrow();
        expect(pricing.costs('deepseek-flash', offPeak).prompt).toBe(18);
        expect(fetchPage).toHaveBeenCalledWith(
            'https://api-docs.deepseek.com/quick_start/pricing/',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('reports a failed automatic refresh without replacing rates', async () => {
        const reportError = vi.fn();
        const pricing = new DeepSeekPricing(
            vi.fn().mockRejectedValue(new Error('offline')),
            reportError,
        );
        await expect(pricing.refreshIfStale()).resolves.toBeUndefined();
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(
            pricing.costs('deepseek-flash', new Date('2026-09-28T05:00:00Z'))
                .prompt,
        ).toBe(15);
    });
});
