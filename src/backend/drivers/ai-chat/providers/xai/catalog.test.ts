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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChatModel } from '../../types.js';
import {
    buildCostsOverride,
    costsForRequest,
    isFreeModel,
} from '../../utils/pricing.js';
import { fetchXaiCatalog, XAI_CHAT_MODELS } from './catalog.js';
import catalogFixture from './fixtures/language-models.json';
import { XAI_MODELS } from './models.js';

const { axiosGetMock } = vi.hoisted(() => ({ axiosGetMock: vi.fn() }));
vi.mock('axios', () => ({ default: { get: axiosGetMock } }));

type RawModel = Record<string, unknown>;

const fixtureModels = (): RawModel[] =>
    structuredClone(catalogFixture.models) as RawModel[];

/** The live catalog with `patch` applied to one entry. */
const withEntry = (id: string, patch: RawModel): RawModel[] =>
    fixtureModels().map((m) => (m.id === id ? { ...m, ...patch } : m));

/** A prompt rate with the matching image rate, as xAI publishes them. */
const textRate = (price: unknown): RawModel => ({
    prompt_text_token_price: price,
    prompt_image_token_price: price,
});

const serve = (models: unknown) =>
    axiosGetMock.mockResolvedValueOnce({ data: { models } });

const load = async (models: unknown, previous?: IChatModel[]) => {
    serve(models);
    return fetchXaiCatalog('test-key', new AbortController().signal, previous);
};

const find = (models: IChatModel[], id: string) =>
    models.find((m) => m.id === id)!;

const curated = (id: string) => find(XAI_CHAT_MODELS, id);

const usage = (prompt: number) => ({
    prompt_tokens: prompt - 1000,
    cached_tokens: 1000,
    completion_tokens: 100,
});

beforeEach(() => {
    axiosGetMock.mockReset();
});

describe('XAI_CHAT_MODELS (curated fallback)', () => {
    it('turns every multiplier tier into an explicit tier starting at the threshold', () => {
        for (const source of XAI_MODELS) {
            const model = curated(source.id);
            expect(model.long_context_pricing).toBeUndefined();
            expect(model.pricingOverrides).toEqual([
                {
                    minPromptTokens: 200_000,
                    minPromptTokensInclusive: true,
                    costs: {
                        prompt_tokens: source.costs.prompt_tokens * 2,
                        completion_tokens: source.costs.completion_tokens * 2,
                        cached_tokens: source.costs.cached_tokens * 2,
                    },
                },
            ]);
            const { long_context_pricing: _tier, ...rest } = source;
            const { pricingOverrides: _overrides, ...converted } = model;
            expect(converted).toEqual(rest);
        }
    });

    it('leaves the shared curated list (mirrored by Azure) untouched', () => {
        expect(XAI_MODELS.every((m) => m.long_context_pricing)).toBe(true);
        expect(XAI_MODELS.some((m) => m.pricingOverrides)).toBe(false);
    });
});

describe('fetchXaiCatalog request', () => {
    it('asks the global endpoint with the configured key and bounded size', async () => {
        const signal = new AbortController().signal;
        serve(fixtureModels());
        await fetchXaiCatalog('test-key', signal);
        expect(axiosGetMock).toHaveBeenCalledWith(
            'https://api.x.ai/v1/language-models',
            {
                headers: { Authorization: 'Bearer test-key' },
                signal,
                maxContentLength: 8 * 1024 * 1024,
                maxRedirects: 0,
            },
        );
    });

    it.each([
        ['a missing models array', { data: [] }],
        ['a non-array models field', { models: {} }],
        ['a non-JSON body', '<html>'],
        ['an oversized model list', { models: new Array(1001).fill({}) }],
    ])('rejects %s', async (_label, data) => {
        axiosGetMock.mockResolvedValueOnce({ data });
        await expect(
            fetchXaiCatalog('test-key', new AbortController().signal),
        ).rejects.toThrow('Invalid xAI catalog');
    });

    it('propagates transport failures so the cache keeps its last good value', async () => {
        axiosGetMock.mockRejectedValueOnce(new Error('socket hang up'));
        await expect(
            fetchXaiCatalog('test-key', new AbortController().signal),
        ).rejects.toThrow('socket hang up');
    });
});

describe('fetchXaiCatalog pricing', () => {
    it('converts USD cents per 100M tokens to cents per million, tier by tier', async () => {
        const models = await load(fixtureModels());
        const grok45 = find(models, 'grok-4.5');
        expect(grok45.costs).toEqual({
            tokens: 1_000_000,
            prompt_tokens: 200,
            completion_tokens: 600,
            cached_tokens: 30,
        });
        expect(grok45.pricingOverrides).toEqual([
            {
                minPromptTokens: 200_000,
                minPromptTokensInclusive: true,
                costs: {
                    prompt_tokens: 400,
                    cached_tokens: 60,
                    completion_tokens: 1200,
                },
            },
        ]);
        expect(find(models, 'grok-4.20-0309-reasoning').costs).toEqual({
            tokens: 1_000_000,
            prompt_tokens: 125,
            completion_tokens: 250,
            cached_tokens: 20,
        });
    });

    it('preserves curated identity, aliases, limits and modalities', async () => {
        const models = await load(fixtureModels());
        expect(models.map((m) => m.id)).toEqual(
            XAI_CHAT_MODELS.map((m) => m.id),
        );
        for (const model of models) {
            const { costs: _c, pricingOverrides: _o, ...rest } = model;
            const {
                costs: _cc,
                pricingOverrides: _co,
                ...curatedRest
            } = curated(model.id);
            expect(rest).toEqual(curatedRest);
        }
    });

    it('keeps fractional cents exactly', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                prompt_text_token_price: 12_345,
                prompt_image_token_price: 12_345,
                cached_prompt_text_token_price: 1,
                completion_text_token_price: 99_999,
            }),
        );
        expect(find(models, 'grok-4.5').costs).toEqual({
            tokens: 1_000_000,
            prompt_tokens: 123.45,
            completion_tokens: 999.99,
            cached_tokens: 0.01,
        });
    });

    it('represents independent long-context amounts without a common multiplier', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                prompt_text_token_price_long_context: 30_000,
                cached_prompt_text_token_price_long_context: 3_500,
                completion_text_token_price_long_context: 100_000,
            }),
        );
        expect(find(models, 'grok-4.5').pricingOverrides![0]!.costs).toEqual({
            prompt_tokens: 300,
            cached_tokens: 35,
            completion_tokens: 1000,
        });
    });

    it('keeps a one-unit long-context amount positive', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                cached_prompt_text_token_price_long_context: 1,
            }),
        );
        expect(
            find(models, 'grok-4.5').pricingOverrides![0]!.costs.cached_tokens,
        ).toBe(0.01);
    });

    it('bills the standard rate for a zero long-context amount, never zero', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                prompt_text_token_price_long_context: 0,
                cached_prompt_text_token_price_long_context: 0,
                completion_text_token_price_long_context: 120_000,
            }),
        );
        const model = find(models, 'grok-4.5');
        expect(model.pricingOverrides![0]!.costs).toEqual({
            completion_tokens: 1200,
        });
        expect(buildCostsOverride(usage(200_000), model)).toEqual({
            prompt_tokens: 199_000 * 200,
            cached_tokens: 1000 * 30,
            completion_tokens: 100 * 1200,
        });
    });

    it('drops the long-context tier when every long amount is zero', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                prompt_text_token_price_long_context: 0,
                cached_prompt_text_token_price_long_context: 0,
                completion_text_token_price_long_context: 0,
                long_context_threshold: 0,
            }),
        );
        const model = find(models, 'grok-4.5');
        expect(model.pricingOverrides).toEqual([]);
        expect(costsForRequest(model, 900_000)).toEqual(model.costs);
    });

    it('bills cached reads free when the cache rate is an explicit zero', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                cached_prompt_text_token_price: 0,
                cached_prompt_text_token_price_long_context: 0,
            }),
        );
        const model = find(models, 'grok-4.5');
        expect(model.costs.cached_tokens).toBe(0);
        expect(isFreeModel(model)).toBe(false);
        expect(buildCostsOverride(usage(10_000), model)).toEqual({
            prompt_tokens: 9000 * 200,
            cached_tokens: 0,
            completion_tokens: 100 * 600,
        });
        // A zero long cache amount falls back to the free standard cache rate.
        expect(buildCostsOverride(usage(200_000), model)).toEqual({
            prompt_tokens: 199_000 * 400,
            cached_tokens: 0,
            completion_tokens: 100 * 1200,
        });
    });

    it('applies a long cache amount above a free standard cache rate', async () => {
        const models = await load(
            withEntry('grok-4.5', { cached_prompt_text_token_price: 0 }),
        );
        const model = find(models, 'grok-4.5');
        expect(buildCostsOverride(usage(199_999), model).cached_tokens).toBe(0);
        expect(buildCostsOverride(usage(200_000), model).cached_tokens).toBe(
            1000 * 60,
        );
    });

    it.each([
        ['prompt', textRate(0), { prompt_tokens: 0 }],
        [
            'completion',
            { completion_text_token_price: 0 },
            { completion_tokens: 0 },
        ],
    ])(
        'bills an explicit zero standard %s rate as free below the long tier',
        async (_label, patch, zeroed) => {
            const models = await load(withEntry('grok-4.5', patch));
            const model = find(models, 'grok-4.5');
            const costs = {
                tokens: 1_000_000,
                prompt_tokens: 200,
                completion_tokens: 600,
                cached_tokens: 30,
                ...zeroed,
            };
            expect(model.costs).toEqual(costs);
            expect(isFreeModel(model)).toBe(false);
            expect(buildCostsOverride(usage(10_000), model)).toEqual({
                prompt_tokens: 9000 * costs.prompt_tokens,
                cached_tokens: 1000 * 30,
                completion_tokens: 100 * costs.completion_tokens,
            });
            // The fixture's positive long amounts still apply past the threshold.
            expect(buildCostsOverride(usage(200_000), model)).toEqual({
                prompt_tokens: 199_000 * 400,
                cached_tokens: 1000 * 60,
                completion_tokens: 100 * 1200,
            });
        },
    );

    it('admits a catalog entry whose every rate is an explicit zero as free', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                ...textRate(0),
                cached_prompt_text_token_price: 0,
                completion_text_token_price: 0,
                prompt_text_token_price_long_context: 0,
                cached_prompt_text_token_price_long_context: 0,
                completion_text_token_price_long_context: 0,
            }),
        );
        const model = find(models, 'grok-4.5');
        expect(model.costs).toEqual({
            tokens: 1_000_000,
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
        });
        expect(model.pricingOverrides).toEqual([]);
        expect(isFreeModel(model)).toBe(true);
        expect(buildCostsOverride(usage(300_000), model)).toEqual({
            prompt_tokens: 0,
            cached_tokens: 0,
            completion_tokens: 0,
        });
    });

    it('ignores the threshold when every long amount is zero', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                prompt_text_token_price_long_context: 0,
                cached_prompt_text_token_price_long_context: 0,
                completion_text_token_price_long_context: 0,
            }),
        );
        expect(find(models, 'grok-4.5').pricingOverrides).toEqual([]);
    });

    it.each([
        ['missing prompt rate', textRate(undefined)],
        ['null prompt rate', textRate(null)],
        ['missing completion rate', { completion_text_token_price: undefined }],
        ['null completion rate', { completion_text_token_price: null }],
        ['negative prompt rate', textRate(-1)],
        ['string prompt rate', textRate('20000')],
        ['fractional prompt rate', textRate(20_000.5)],
        ['subnormal prompt rate', textRate(5e-324)],
        ['unsafe-integer prompt rate', textRate(2 ** 53)],
        ['negative cache rate', { cached_prompt_text_token_price: -3000 }],
        ['object cache rate', { cached_prompt_text_token_price: { usd: 1 } }],
        ['missing cache rate', { cached_prompt_text_token_price: undefined }],
        ['null cache rate', { cached_prompt_text_token_price: null }],
        ['subnormal cache rate', { cached_prompt_text_token_price: 5e-324 }],
        [
            'negative long-context rate',
            { completion_text_token_price_long_context: -1 },
        ],
        [
            'malformed long-context rate',
            { prompt_text_token_price_long_context: '40000' },
        ],
        [
            'missing long-context prompt rate',
            { prompt_text_token_price_long_context: undefined },
        ],
        [
            'null long-context cache rate',
            { cached_prompt_text_token_price_long_context: null },
        ],
        [
            'missing long-context completion rate',
            { completion_text_token_price_long_context: undefined },
        ],
        [
            'subnormal long-context cache rate',
            { cached_prompt_text_token_price_long_context: 5e-324 },
        ],
        ['long tier without a threshold', { long_context_threshold: null }],
        ['missing threshold', { long_context_threshold: undefined }],
        [
            'missing threshold with no long amounts',
            {
                prompt_text_token_price_long_context: 0,
                cached_prompt_text_token_price_long_context: 0,
                completion_text_token_price_long_context: 0,
                long_context_threshold: undefined,
            },
        ],
        ['zero threshold beside long amounts', { long_context_threshold: 0 }],
        ['negative threshold', { long_context_threshold: -1 }],
        ['fractional threshold', { long_context_threshold: 199_999.5 }],
        ['string threshold', { long_context_threshold: '200000' }],
        ['image rate above text', { prompt_image_token_price: 30_000 }],
        ['image rate below text', { prompt_image_token_price: 10_000 }],
        ['missing image rate', { prompt_image_token_price: undefined }],
        ['no text output', { output_modalities: ['image'] }],
        ['malformed output modalities', { output_modalities: 'text' }],
    ])('keeps the previous pricing on a %s', async (_label, patch) => {
        const previous = XAI_CHAT_MODELS.map((m) =>
            m.id === 'grok-4.5'
                ? { ...m, costs: { ...m.costs, prompt_tokens: 222 } }
                : m,
        );
        const models = await load(withEntry('grok-4.5', patch), previous);
        expect(find(models, 'grok-4.5')).toBe(find(previous, 'grok-4.5'));
        expect(isFreeModel(find(models, 'grok-4.5'))).toBe(false);
        // Other models still refresh from the same response.
        expect(find(models, 'grok-4.6').costs.cached_tokens).toBe(50);
    });

    it('keeps the last good entry for a model the catalog omits', async () => {
        const first = await load(withEntry('grok-4.6', textRate(22_000)));
        const second = await load(
            fixtureModels().filter((m) => m.id !== 'grok-4.6'),
            first,
        );
        expect(find(second, 'grok-4.6').costs.prompt_tokens).toBe(220);
        expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    });

    it('keeps every model when the catalog is empty', async () => {
        expect(await load([])).toEqual(XAI_CHAT_MODELS);
    });

    it('admits no model outside the curated list', async () => {
        const models = await load([
            ...fixtureModels(),
            {
                ...fixtureModels()[4],
                id: 'grok-9-synthetic',
                aliases: ['grok-9-synthetic-latest'],
            },
        ]);
        expect(models.map((m) => m.id)).toEqual(
            XAI_CHAT_MODELS.map((m) => m.id),
        );
    });

    it('skips malformed entries without failing the refresh', async () => {
        const models = await load([
            null,
            'grok-4.5',
            [],
            { id: 42 },
            ...withEntry('grok-4.5', textRate(30_000)),
        ]);
        expect(find(models, 'grok-4.5').costs.prompt_tokens).toBe(300);
    });

    it('matches a curated id the catalog lists as an alias of a renamed model', async () => {
        const models = await load(
            withEntry('grok-4.5', {
                id: 'grok-4.5-0708',
                aliases: ['grok-4.5'],
                prompt_text_token_price: 21_000,
                prompt_image_token_price: 21_000,
            }),
        );
        const model = find(models, 'grok-4.5');
        expect(model.costs.prompt_tokens).toBe(210);
        expect(model.aliases).toEqual(curated('grok-4.5').aliases);
    });

    it('ignores an alias two catalog entries claim', async () => {
        const models = await load([
            ...fixtureModels().filter((m) => m.id !== 'grok-4.5'),
            { ...fixtureModels()[4], id: 'a', aliases: ['grok-4.5'] },
            {
                ...fixtureModels()[4],
                id: 'b',
                aliases: ['grok-4.5'],
                ...textRate(1),
            },
        ]);
        expect(find(models, 'grok-4.5')).toBe(curated('grok-4.5'));
    });

    it('keeps the last good entry when two catalog entries claim its id', async () => {
        const original = fixtureModels().find((m) => m.id === 'grok-4.5')!;
        const models = await load([
            ...withEntry('grok-4.5', textRate(30_000)),
            { ...original, ...textRate(40_000) },
        ]);
        expect(find(models, 'grok-4.5')).toBe(curated('grok-4.5'));
        expect(find(models, 'grok-4.6').costs.cached_tokens).toBe(50);
    });

    it('does not fall back to an alias when the exact id is ambiguous', async () => {
        const original = fixtureModels().find((m) => m.id === 'grok-4.5')!;
        const models = await load([
            ...fixtureModels(),
            { ...original, ...textRate(40_000) },
            {
                ...original,
                id: 'grok-4.5-0708',
                aliases: ['grok-4.5'],
                ...textRate(21_000),
            },
        ]);
        expect(find(models, 'grok-4.5')).toBe(curated('grok-4.5'));
    });

    it('ignores an alias whose entry shares its canonical id with another', async () => {
        const original = fixtureModels().find((m) => m.id === 'grok-4.5')!;
        const models = await load([
            ...fixtureModels().filter((m) => m.id !== 'grok-4.5'),
            {
                ...original,
                id: 'grok-4.5-0708',
                aliases: ['grok-4.5'],
                ...textRate(21_000),
            },
            {
                ...original,
                id: 'grok-4.5-0708',
                aliases: [],
                ...textRate(40_000),
            },
        ]);
        expect(find(models, 'grok-4.5')).toBe(curated('grok-4.5'));
    });
});

describe('xAI long-context tier boundary', () => {
    it.each([
        [199_999, false],
        [200_000, true],
        [200_001, true],
    ])('a %i-token prompt pays the long tier: %s', async (prompt, long) => {
        const model = find(await load(fixtureModels()), 'grok-4.5');
        expect(buildCostsOverride(usage(prompt), model)).toEqual({
            prompt_tokens: (prompt - 1000) * (long ? 400 : 200),
            cached_tokens: 1000 * (long ? 60 : 30),
            completion_tokens: 100 * (long ? 1200 : 600),
        });
        expect(costsForRequest(model, prompt).prompt_tokens).toBe(
            long ? 400 : 200,
        );
        // The curated fallback starts its tier at the same boundary.
        expect(buildCostsOverride(usage(prompt), curated('grok-4.5'))).toEqual(
            buildCostsOverride(usage(prompt), model),
        );
    });
});
