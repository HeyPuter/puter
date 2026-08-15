/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { describe, expect, it } from 'vitest';
import { GEMINI_MODELS } from '../providers/gemini/models.js';
import type { IChatModel } from '../types.js';
import {
    compareModelPreference,
    isIdentityKey,
    normalizeModelKey,
} from './modelRouting.js';

// `#buildModelMap` mutates the catalogs providers hand back, and
// `GeminiChatProvider.models()` returns the module-level `GEMINI_MODELS` by
// reference — clone so these fixtures can't be perturbed by another suite.
const geminiModel = (id: string, provider = 'gemini'): IChatModel => {
    const found = GEMINI_MODELS.find((m) => m.id === id);
    if (!found) throw new Error(`no such gemini model: ${id}`);
    return { ...structuredClone(found), provider };
};

// Mirrors how the reseller providers coerce a catalog entry: `<gateway>:` on
// the id, `input_cost_key: 'prompt'`, and prices as microcents per token.
const resoldModel = (
    provider: string,
    catalogId: string,
    promptCost: number,
): IChatModel =>
    ({
        id: `${provider}:${catalogId}`,
        name: `${catalogId} (${provider})`,
        aliases: [catalogId, catalogId.split('/').slice(1).join('/')],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt',
        output_cost_key: 'completion',
        costs: { tokens: 1_000_000, prompt: promptCost, completion: 100 },
        provider,
    }) as IChatModel;

const winner = (...models: IChatModel[]) =>
    [...models].sort(compareModelPreference)[0];

describe('compareModelPreference', () => {
    it('serves the vendor directly even when a reseller quotes a lower price', () => {
        // Google lists gemini-2.5-flash input at 30 microcents/token; the
        // gateway advertises a floor price across its upstream routes and
        // undercuts it. Price must not decide who serves the request.
        const direct = geminiModel('gemini-2.5-flash');
        const resold = resoldModel('infron', 'google/gemini-2.5-flash', 15);

        expect(direct.costs.prompt_tokens).toBeGreaterThan(
            resold.costs.prompt as number,
        );
        expect(winner(resold, direct).provider).toBe('gemini');
        expect(winner(direct, resold).provider).toBe('gemini');
    });

    it('ranks every reseller behind the vendor, not just one of them', () => {
        const direct = geminiModel('gemini-3.1-pro-preview');
        const bucket = [
            resoldModel('openrouter', 'google/gemini-3.1-pro-preview', 90),
            resoldModel('infron', 'google/gemini-3.1-pro-preview', 80),
            resoldModel('together-ai', 'google/gemini-3.1-pro-preview', 70),
            resoldModel('neuralwatt', 'google/gemini-3.1-pro-preview', 60),
            direct,
        ];

        expect(
            bucket.sort(compareModelPreference).map((m) => m.provider),
        ).toEqual([
            'gemini',
            'neuralwatt',
            'infron',
            'openrouter',
            'together-ai',
        ]);
    });

    it('keeps together-ai strictly behind the other resellers', () => {
        // A flat direct/reseller split would let these tie and re-order by
        // price; together-ai stays last regardless of how cheap it quotes.
        const together = resoldModel('together-ai', 'meta/llama-4', 1);
        const openrouter = resoldModel('openrouter', 'meta/llama-4', 500);

        expect(winner(together, openrouter).provider).toBe('openrouter');
    });

    it('puts openrouter then together-ai at the very bottom of the chain', () => {
        // Both quote well under the other resellers — price must not lift
        // either of them out of the last two slots.
        const bucket = [
            resoldModel('together-ai', 'meta/llama-4', 1),
            resoldModel('openrouter', 'meta/llama-4', 2),
            resoldModel('neuralwatt', 'meta/llama-4', 400),
            resoldModel('infron', 'meta/llama-4', 500),
        ];

        expect(
            bucket.sort(compareModelPreference).map((m) => m.provider),
        ).toEqual(['neuralwatt', 'infron', 'openrouter', 'together-ai']);
    });

    it('still orders two direct providers by cheapest input cost', () => {
        const cheap = geminiModel('gemini-2.5-flash-lite');
        const pricey = geminiModel('gemini-2.5-pro');

        expect(cheap.costs.prompt_tokens).toBeLessThan(
            pricey.costs.prompt_tokens as number,
        );
        expect(winner(pricey, cheap).id).toBe('gemini-2.5-flash-lite');
    });

    it('breaks price ties on the shorter id', () => {
        const short = { ...geminiModel('gemini-2.5-flash'), id: 'gemini-x' };
        const long = {
            ...geminiModel('gemini-2.5-flash'),
            id: 'some-vendor/gemini-x-2025-preview',
            provider: 'azure-openai',
        };

        expect(winner(long, short).id).toBe('gemini-x');
    });

    it('leaves a reseller serving models no vendor provider carries', () => {
        // The image-preview models are absent from GEMINI_MODELS, so the
        // gateway is the only route and must stay the winner.
        expect(
            GEMINI_MODELS.some(
                (m) => m.id === 'gemini-2.5-flash-image-preview',
            ),
        ).toBe(false);

        const onlyRoute = resoldModel(
            'infron',
            'google/gemini-2.5-flash-image-preview',
            20,
        );
        expect(winner(onlyRoute).provider).toBe('infron');
    });
});

describe('isIdentityKey', () => {
    it('accepts the machine ids a catalog uses to name a model', () => {
        for (const key of [
            'claude-sonnet-4',
            'anthropic/claude-sonnet-4',
            'openrouter:anthropic/claude-sonnet-4',
            'gpt-4o',
        ]) {
            expect(isIdentityKey(key)).toBe(true);
        }
    });

    it('rejects display names, so a shared label cannot merge two providers', () => {
        // Gateways carry these alongside the machine ids. Merging on one
        // would be merging two providers on a human-readable string.
        for (const key of [
            normalizeModelKey('Google: Gemini 2.5 Flash'),
            normalizeModelKey('Anthropic: Claude Sonnet 4'),
            normalizeModelKey('Meta Llama 3.1 8B Instruct Turbo'),
        ]) {
            expect(isIdentityKey(key)).toBe(false);
        }
    });

    it('rejects the empty key catalogs produce for ids carrying no vendor org', () => {
        // `'gpt-4o'.split('/').slice(1).join('/')` is '' — pooling models
        // under that key would put unrelated models in one bucket.
        expect(isIdentityKey('')).toBe(false);
    });
});
