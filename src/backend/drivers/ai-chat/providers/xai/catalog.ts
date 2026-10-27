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

import axios from 'axios';
import type { IChatModel, ModelCost } from '../../types.js';
import { costKeys, isOutputCostKey } from '../../utils/pricing.js';
import { XAI_MODELS } from './models.js';

export const XAI_BASE_URL = 'https://api.x.ai/v1';

/** One entry of `GET /v1/language-models`; every field is untrusted. */
export type XaiLanguageModel = Record<string, unknown>;

// xAI's long-context tier starts at the threshold, not past it. Azure mirrors
// `XAI_MODELS` with its own semantics, so the conversion happens here.
const inclusiveLongContext = ({
    long_context_pricing: tier,
    ...model
}: IChatModel): IChatModel => {
    if (!tier) return model;
    const { outputKey } = costKeys(model);
    return {
        ...model,
        pricingOverrides: [
            {
                minPromptTokens: tier.threshold,
                minPromptTokensInclusive: true,
                costs: Object.fromEntries(
                    Object.entries(model.costs)
                        .filter(([key]) => key !== 'tokens')
                        .map(([key, rate]) => [
                            key,
                            rate *
                                (isOutputCostKey(key, outputKey)
                                    ? tier.output_multiplier
                                    : tier.input_multiplier),
                        ]),
                ),
            },
        ],
    };
};

/** The curated catalog as the direct xAI provider bills it. */
export const XAI_CHAT_MODELS: IChatModel[] =
    XAI_MODELS.map(inclusiveLongContext);

const isCount = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * USD cents per 100M tokens as cents per 1M; undefined when absent or not the
 * documented non-negative integer.
 */
const centsPerMTok = (value: unknown): number | undefined =>
    isCount(value) ? value / 100 : undefined;

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Reprices a curated model from its catalog entry. Null when the entry can't be
 * billed faithfully, so the caller keeps the model's last-good pricing.
 */
export const mapXaiCatalogModel = (
    raw: XaiLanguageModel,
    previous: IChatModel,
): IChatModel | null => {
    if (
        !isStringArray(raw.output_modalities) ||
        !raw.output_modalities.includes('text')
    )
        return null;
    const prompt = centsPerMTok(raw.prompt_text_token_price);
    const completion = centsPerMTok(raw.completion_text_token_price);
    const cached = centsPerMTok(raw.cached_prompt_text_token_price);
    if (
        prompt === undefined ||
        completion === undefined ||
        cached === undefined
    )
        return null;

    // Image tokens are metered under `prompt_tokens`, so only a text-equal
    // image rate can be billed without blending.
    const acceptsImages =
        previous.modalities?.input.includes('image') ||
        (isStringArray(raw.input_modalities) &&
            raw.input_modalities.includes('image'));
    if (acceptsImages && centsPerMTok(raw.prompt_image_token_price) !== prompt)
        return null;

    // Unlike the long-context amounts, a zero standard rate is a real free rate.
    const costs: ModelCost = {
        tokens: 1_000_000,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cached_tokens: cached,
    };

    // A zero long-context amount means the standard rate applies.
    const longCosts: ModelCost = {};
    for (const [key, value] of [
        ['prompt_tokens', raw.prompt_text_token_price_long_context],
        ['cached_tokens', raw.cached_prompt_text_token_price_long_context],
        ['completion_tokens', raw.completion_text_token_price_long_context],
    ] as const) {
        const rate = centsPerMTok(value);
        if (rate === undefined) return null;
        if (rate > 0) longCosts[key] = rate;
    }
    // A zero threshold means no long tier, which contradicts a long amount.
    const threshold = raw.long_context_threshold;
    if (!isCount(threshold)) return null;
    const hasLongTier = Object.keys(longCosts).length > 0;
    if (hasLongTier && threshold === 0) return null;

    return {
        ...previous,
        costs,
        pricingOverrides: hasLongTier
            ? [
                  {
                      minPromptTokens: threshold,
                      minPromptTokensInclusive: true,
                      costs: longCosts,
                  },
              ]
            : [],
    };
};

/**
 * Refreshes the curated models' pricing from xAI's catalog. Models the catalog
 * omits or prices unusably keep their previous entry, and models outside the
 * curated list aren't admitted: the catalog carries no context or output
 * limits, nor which endpoints a model supports.
 */
export const fetchXaiCatalog = async (
    apiKey: string,
    signal: AbortSignal,
    previous: IChatModel[] = XAI_CHAT_MODELS,
): Promise<IChatModel[]> => {
    const response = await axios.get(`${XAI_BASE_URL}/language-models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
        maxContentLength: 8 * 1024 * 1024,
        maxRedirects: 0,
    });
    const entries: unknown = response.data?.models;
    if (!Array.isArray(entries) || entries.length > 1000)
        throw new Error('Invalid xAI catalog');

    // An id or alias two entries claim resolves to neither, an ambiguous id
    // doesn't fall back to an alias, and an alias only resolves to an entry
    // that uniquely owns its own id.
    const byId = new Map<string, XaiLanguageModel | null>();
    const byAlias = new Map<string, XaiLanguageModel | null>();
    for (const raw of entries) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const entry = raw as XaiLanguageModel;
        if (typeof entry.id !== 'string') continue;
        byId.set(entry.id, byId.has(entry.id) ? null : entry);
        for (const alias of isStringArray(entry.aliases) ? entry.aliases : []) {
            byAlias.set(alias, byAlias.has(alias) ? null : entry);
        }
    }

    return previous.map((model) => {
        const aliased = byAlias.get(model.id);
        const raw = byId.has(model.id)
            ? byId.get(model.id)
            : aliased && byId.get(aliased.id as string) === aliased
              ? aliased
              : null;
        return (raw && mapXaiCatalogModel(raw, model)) || model;
    });
};
