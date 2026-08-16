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
import { buildCostsOverride, isFreeModel, usdPerMToken } from './pricing.js';

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
