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
import type { IChatModel } from '../types.js';
import {
    buildCostsOverride,
    isFreeModel,
    isOutputCostKey,
    longContextMultipliers,
    trackedInputTokens,
    trackedOutputTokens,
    usageDetailsFromUsage,
    usdPerMToken,
} from './pricing.js';

const model = (costs: Record<string, number>): IChatModel =>
    ({
        id: 'test-model',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs,
        max_tokens: 1024,
    }) as IChatModel;

describe('usdPerMToken', () => {
    it('always emits a cached_tokens row, defaulting to zero', () => {
        expect(usdPerMToken(1, 2)).toEqual({
            tokens: 1_000_000,
            prompt_tokens: 100,
            completion_tokens: 200,
            cached_tokens: 0,
        });
        expect(usdPerMToken(1, 2, 0.5).cached_tokens).toBe(50);
    });
});

describe('isFreeModel', () => {
    it('treats a table of nothing but zeroes as free', () => {
        expect(
            isFreeModel(
                model({
                    tokens: 1_000_000,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                }),
            ),
        ).toBe(true);
    });

    it('treats a model priced on any axis as paid', () => {
        expect(
            isFreeModel(model({ prompt_tokens: 0, completion_tokens: 200 })),
        ).toBe(false);
        expect(isFreeModel(model({ request: 1 }))).toBe(false);
    });

    it('treats a model with no cost data as unknown, not free', () => {
        expect(isFreeModel(model({}))).toBe(false);
        expect(isFreeModel(model({ tokens: 1_000_000 }))).toBe(false);
    });
});

describe('buildCostsOverride', () => {
    it('multiplies each usage key by its own declared rate', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 90, completion_tokens: 50, cached_tokens: 10 },
            model({ prompt_tokens: 110, completion_tokens: 440, cached_tokens: 55 }),
        );

        expect(overrides).toEqual({
            prompt_tokens: 90 * 110,
            completion_tokens: 50 * 440,
            cached_tokens: 10 * 55,
        });
    });

    it('prices an undeclared key at the input rate rather than giving it away', () => {
        // A model whose catalogue entry omits cached_tokens: the cached count
        // has already been subtracted out of prompt_tokens, so pricing it at
        // zero bills it nowhere at all.
        const overrides = buildCostsOverride(
            { prompt_tokens: 173, completion_tokens: 12, cached_tokens: 2816 },
            model({ prompt_tokens: 110, completion_tokens: 440 }),
        );

        expect(overrides.cached_tokens).toBe(2816 * 110);
        expect(overrides.cached_tokens).toBeGreaterThan(0);
    });

    it('prices an undeclared output-denominated key at the output rate', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 30 },
            model({ prompt_tokens: 8, completion_tokens: 30 }),
        );

        expect(overrides.thinking_tokens).toBe(30 * 30);
    });

    it('honours an explicitly declared zero rate', () => {
        // An explicit zero is a pricing decision — usually "already billed
        // inside another row" — and must not be overridden by the fallback.
        const overrides = buildCostsOverride(
            { prompt_tokens: 10, cached_tokens: 99 },
            model({ prompt_tokens: 8, completion_tokens: 30, cached_tokens: 0 }),
        );

        expect(overrides.cached_tokens).toBe(0);
    });

    it('falls back to zero only when the model prices nothing at all', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 10, cached_tokens: 5 },
            model({}),
        );

        expect(overrides).toEqual({ prompt_tokens: 0, cached_tokens: 0 });
    });

    it('skips the tokens scale descriptor', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 10, tokens: 1_000_000 },
            model({ prompt_tokens: 8, completion_tokens: 30 }),
        );

        expect(overrides).toEqual({ prompt_tokens: 80 });
    });

    it('never emits a non-finite value for a model with a broken cost table', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 10, completion_tokens: 20, cached_tokens: 30 },
            model({
                prompt_tokens: Number.NaN,
                completion_tokens: Number.POSITIVE_INFINITY,
            }),
        );

        for (const value of Object.values(overrides)) {
            expect(Number.isFinite(value)).toBe(true);
        }
    });

    it('resolves rates through the model default keys when none are declared', () => {
        const overrides = buildCostsOverride(
            { input_tokens: 10, output_tokens: 20, cached_tokens: 5 },
            {
                id: 'defaults',
                costs_currency: 'usd-cents',
                costs: { input_tokens: 3, output_tokens: 9 },
                max_tokens: 1024,
            } as IChatModel,
        );

        expect(overrides).toEqual({
            input_tokens: 30,
            output_tokens: 180,
            cached_tokens: 15,
        });
    });
});

describe('isOutputCostKey', () => {
    it('treats any key ending in _output_tokens as output-side, prefixed or not', () => {
        expect(isOutputCostKey('fast_output_tokens', 'output_tokens')).toBe(true);
        expect(isOutputCostKey('advisor_output_tokens', 'output_tokens')).toBe(true);
    });

    it('does not mistake the plain output key itself for a prefixed one', () => {
        // Sanity: the suffix rule and the exact-match rule agree, they don't
        // double-count or disagree on the base case.
        expect(isOutputCostKey('output_tokens', 'output_tokens')).toBe(true);
    });

    it('leaves a prefixed input key on the input side', () => {
        expect(isOutputCostKey('fast_input_tokens', 'output_tokens')).toBe(false);
        expect(isOutputCostKey('advisor_input_tokens', 'output_tokens')).toBe(false);
    });
});

describe('trackedInputTokens / trackedOutputTokens skip per-call and advisor keys', () => {
    const m = model({ input_tokens: 1, output_tokens: 1 });

    it('excludes a _requests count from both totals', () => {
        const usage = { input_tokens: 10, output_tokens: 5, web_search_requests: 2 };
        expect(trackedInputTokens(usage, m)).toBe(10);
        expect(trackedOutputTokens(usage, m)).toBe(5);
    });

    it('excludes a _calls count from both totals', () => {
        const usage = { input_tokens: 10, output_tokens: 5, web_search_calls: 3 };
        expect(trackedInputTokens(usage, m)).toBe(10);
        expect(trackedOutputTokens(usage, m)).toBe(5);
    });

    it('excludes advisor-prefixed tokens from the executor totals', () => {
        const usage = {
            input_tokens: 10,
            output_tokens: 5,
            advisor_input_tokens: 100,
            advisor_output_tokens: 50,
        };
        expect(trackedInputTokens(usage, m)).toBe(10);
        expect(trackedOutputTokens(usage, m)).toBe(5);
    });
});

describe('usageDetailsFromUsage', () => {
    it('sums every non-output key into inputTokens and every output-denominated key into outputTokens', () => {
        const details = usageDetailsFromUsage(
            {
                prompt_tokens: 10,
                cached_tokens: 5,
                completion_tokens: 20,
                thinking_tokens: 7,
            },
            model({ prompt_tokens: 1, completion_tokens: 1, cached_tokens: 1 }),
        );

        expect(details).toEqual({
            inputTokens: 15,
            outputTokens: 27,
        });
    });

    it('ignores the tokens scale descriptor and usd_cents', () => {
        const details = usageDetailsFromUsage(
            { prompt_tokens: 10, completion_tokens: 5, tokens: 1_000_000, usd_cents: 3 },
            model({ prompt_tokens: 1, completion_tokens: 1 }),
        );

        expect(details).toEqual({ inputTokens: 10, outputTokens: 5 });
    });
});

describe('long-context pricing', () => {
    const longContext = (costs: Record<string, number>): IChatModel => ({
        ...model(costs),
        long_context_pricing: {
            threshold: 272_000,
            input_multiplier: 2,
            output_multiplier: 1.5,
        },
    });
    const rates = {
        prompt_tokens: 200,
        cached_tokens: 20,
        cache_write_tokens: 250,
        completion_tokens: 1000,
    };

    it('bills a request at or under the threshold at standard rates', () => {
        const overrides = buildCostsOverride(
            {
                prompt_tokens: 222_000,
                cached_tokens: 50_000,
                completion_tokens: 10,
            },
            longContext(rates),
        );

        expect(overrides).toEqual({
            prompt_tokens: 222_000 * 200,
            cached_tokens: 50_000 * 20,
            completion_tokens: 10 * 1000,
        });
    });

    it('raises every rate for the whole request once input passes the threshold', () => {
        // 230K uncached + 50K cached + 20K cache writes = 300K input. No
        // single key crosses 272K; their sum does.
        const overrides = buildCostsOverride(
            {
                prompt_tokens: 230_000,
                cached_tokens: 50_000,
                cache_write_tokens: 20_000,
                completion_tokens: 10_000,
            },
            longContext(rates),
        );

        expect(overrides).toEqual({
            prompt_tokens: 230_000 * 200 * 2,
            cached_tokens: 50_000 * 20 * 2,
            cache_write_tokens: 20_000 * 250 * 2,
            completion_tokens: 10_000 * 1000 * 1.5,
        });
    });

    it('raises the fallback rate of an unpriced key too', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 300_000, thinking_tokens: 10 },
            longContext({ prompt_tokens: 200, completion_tokens: 1000 }),
        );

        expect(overrides.thinking_tokens).toBe(10 * 1000 * 1.5);
    });

    it('keeps per-call tool fees flat on a long prompt', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 300_000, web_search_requests: 2, web_search_calls: 3 },
            longContext({
                ...rates,
                web_search_requests: 1_000_000,
                web_search_calls: 1_000_000,
            }),
        );
        expect(overrides.prompt_tokens).toBe(300_000 * 200 * 2);
        expect(overrides.web_search_requests).toBe(2_000_000);
        expect(overrides.web_search_calls).toBe(3_000_000);
    });

    it('leaves a model without long-context pricing at standard rates', () => {
        const overrides = buildCostsOverride(
            { prompt_tokens: 900_000, completion_tokens: 10 },
            model(rates),
        );

        expect(overrides).toEqual({
            prompt_tokens: 900_000 * 200,
            completion_tokens: 10 * 1000,
        });
    });

    it('applies the multipliers strictly above the threshold', () => {
        const m = longContext(rates);
        expect(longContextMultipliers(m, 272_000)).toEqual({
            input: 1,
            output: 1,
        });
        expect(longContextMultipliers(m, 272_001)).toEqual({
            input: 2,
            output: 1.5,
        });
    });
});
