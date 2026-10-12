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
import type { IChatModel } from '../../types.js';
import { buildCostsOverride, costsForRequest } from '../../utils/pricing.js';
import { mapOpenRouterPricing } from './pricing.js';
import fixture from './fixtures/pricing.json';

const catalogModel = (): IChatModel => {
    const pricing = mapOpenRouterPricing(fixture);
    return {
        id: 'fixture',
        max_tokens: 1000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt',
        output_cost_key: 'completion',
        costs: pricing.costs,
        pricingOverrides: pricing.overrides,
    };
};

const monday = new Date('2026-10-12T12:00:00Z');

describe('OpenRouter conditional catalog pricing', () => {
    it('converts USD per token and per request without rounding fractional microcents away', () => {
        expect(
            mapOpenRouterPricing({
                prompt: '0.0000000014',
                request: '0.01',
                completion: '0',
            }).costs,
        ).toEqual({ prompt: 0.14, request: 1_000_000, completion: 0 });
    });

    it.each([100000, 100001, 200000, 200001])(
        'applies strict tier boundaries at %s tokens and inherits missing keys',
        (tokens) => {
            const costs = costsForRequest(catalogModel(), tokens, monday);
            expect(costs.prompt).toBe(
                tokens > 200000 ? 600 : tokens > 100000 ? 400 : 200,
            );
            expect(costs.completion).toBe(tokens > 100000 ? 1500 : 1000);
            expect(costs.input_cache_read).toBe(tokens > 100000 ? 40 : 20);
        },
    );

    it.each([
        ['2026-10-12T16:29:00Z', 1000],
        ['2026-10-12T16:30:00Z', 2000],
        ['2026-10-13T00:29:00Z', 2000],
        ['2026-10-13T00:30:00Z', 1000],
        ['2026-10-11T20:00:00Z', 1000],
    ])(
        'matches wraparound UTC windows and weekdays at %s',
        (date, expected) => {
            expect(
                costsForRequest(catalogModel(), 1000, new Date(date))
                    .completion,
            ).toBe(expected);
        },
    );

    it('uses total prompt tokens including cached tokens for billing thresholds', () => {
        const model = catalogModel();
        model.pricingOverrides = model.pricingOverrides?.slice(0, 2);
        expect(
            buildCostsOverride(
                { prompt: 80000, input_cache_read: 30000, completion: 10 },
                model,
            ),
        ).toEqual({
            prompt: 80000 * 400,
            input_cache_read: 30000 * 40,
            completion: 10 * 1500,
        });
    });

    it.each([
        { min_prompt_tokens: 1, unsupported_condition: true, prompt: '0' },
        { utc_start: 1630, prompt: '0' },
        { utc_start: 2460, utc_end: 30, prompt: '0' },
        { utc_days: ['not-a-day'], prompt: '0' },
        { min_prompt_tokens: -1, prompt: '0' },
        { min_prompt_tokens: null, prompt: '0' },
    ])(
        'skips unsupported or malformed conditions without applying their rates',
        (override) => {
            expect(
                mapOpenRouterPricing({ ...fixture, overrides: [override] })
                    .overrides,
            ).toEqual([]);
        },
    );

    it('keeps absent, placeholder and invalid base prices unknown', () => {
        expect(
            mapOpenRouterPricing({
                prompt: '',
                completion: -1,
                input_cache_read: null,
                request: 'TBD',
            }).costs,
        ).toEqual({});
    });
});

it('does not include fixed request counts in a prompt threshold', () => {
    const model = catalogModel();
    model.pricingOverrides = model.pricingOverrides?.slice(0, 2);
    expect(
        buildCostsOverride({ prompt: 100000, request: 1 }, model).prompt,
    ).toBe(100000 * 200);
});

it('rejects ambiguous conditional rates so a refresh can retain last-good prices', () => {
    expect(() =>
        mapOpenRouterPricing({
            prompt: '0.000002',
            overrides: [{ min_prompt_tokens: 10, prompt: '' }],
        }),
    ).toThrow('Invalid OpenRouter conditional price');
});

it('supports full-day equal endpoints and weekday-only predicates', () => {
    const pricing = mapOpenRouterPricing({
        prompt: '0.000002',
        overrides: [
            { utc_start: 0, utc_end: 0, prompt: '0.000004' },
            { utc_days: ['monday'], prompt: '0.000006' },
        ],
    });
    const model = {
        ...catalogModel(),
        costs: pricing.costs,
        pricingOverrides: pricing.overrides,
    };
    expect(costsForRequest(model, 1, monday).prompt).toBe(600);
    expect(
        costsForRequest(model, 1, new Date('2026-10-13T00:00:00Z')).prompt,
    ).toBe(400);
});
