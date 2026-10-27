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
import type { IChatModel } from '../../types.js';
import { catalogPrice } from '../../utils/pricing.js';
import { ALIBABA_MODELS } from './models.js';

export interface AlibabaApiModel {
    model: string;
    name?: string;
    description?: string;
    capabilities?: string[];
    features?: string[];
    published_time?: string | null;
    equivalent_snapshot?: string | null;
    inference_metadata?: {
        request_modality?: string[];
        response_modality?: string[];
    };
    model_info?: {
        context_window?: number | null;
        max_input_tokens?: number | null;
        max_output_tokens?: number | null;
        max_reasoning_tokens?: number | null;
        reasoning_max_input_tokens?: number | null;
        reasoning_max_output_tokens?: number | null;
    };
    inference_offline_info?: Record<string, { offline_time?: string | null }>;
    prices?: Array<{
        range_name?: string;
        prices?: Array<{
            type?: string;
            price?: string | number | null;
            price_unit?: string;
            price_name?: string;
        }>;
    }>;
}

export interface AlibabaCatalogPrice {
    type?: string;
    name?: string;
    amount?: number;
    unit?: string;
    tokens?: number;
    perMillionTokens?: number;
    currency?: string;
}

export interface AlibabaCatalogTier {
    name?: string;
    minInputTokensExclusive?: number;
    maxInputTokensInclusive?: number;
    prices: AlibabaCatalogPrice[];
}

const tokenDenominators: Record<string, number> = {
    'per token': 1,
    'per thousand tokens': 1000,
    'per million tokens': 1_000_000,
};

const positiveLimit = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;

export const mapAlibabaCatalogModel = (
    raw: AlibabaApiModel,
    previous?: IChatModel,
): IChatModel | null => {
    if (typeof raw.model !== 'string' || !raw.model.trim()) return null;
    const id = raw.model.trim();
    const existing =
        previous ?? ALIBABA_MODELS.find((model) => model.id === id);
    const output = raw.inference_metadata?.response_modality;
    if (output && !output.includes('Text')) return null;
    if (
        !output &&
        !existing &&
        !raw.capabilities?.some((capability) =>
            ['TG', 'Reasoning', 'VU'].includes(capability),
        )
    )
        return null;
    const catalogPricing: AlibabaCatalogTier[] = (raw.prices ?? []).map(
        (tier) => {
            // Abbreviated ranges do not specify whether k means 1000 or 1024 tokens.
            const match = tier.range_name?.match(/^(\d+)<Input<=(\d+)$/);
            const range =
                match &&
                Number.isSafeInteger(Number(match[1])) &&
                Number.isSafeInteger(Number(match[2])) &&
                Number(match[2]) > Number(match[1])
                    ? match
                    : undefined;
            return {
                name: tier.range_name,
                ...(range
                    ? {
                          minInputTokensExclusive: Number(range[1]),
                          maxInputTokensInclusive: Number(range[2]),
                      }
                    : {}),
                prices: (tier.prices ?? []).map((price) => {
                    const amount = catalogPrice(price.price);
                    const tokens = tokenDenominators[price.price_unit ?? ''];
                    return {
                        type: price.type,
                        name: price.price_name,
                        amount,
                        unit: price.price_unit,
                        tokens,
                        perMillionTokens:
                            amount !== undefined && tokens
                                ? catalogPrice(amount, 1_000_000 / tokens)
                                : undefined,
                    };
                }),
            };
        },
    );
    const publishedDate = raw.published_time?.match(
        /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}$/,
    )?.[1];
    const releaseDate =
        publishedDate &&
        Number.isFinite(Date.parse(publishedDate)) &&
        new Date(publishedDate).toISOString().slice(0, 10) === publishedDate
            ? publishedDate
            : undefined;
    return {
        ...existing,
        id,
        name: raw.name ?? existing?.name ?? id,
        description: raw.description ?? existing?.description,
        aliases: existing?.aliases,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        // The official catalog omits currency; curated rates remain the billing source.
        costs: existing?.costs ?? { tokens: 1_000_000 },
        context:
            positiveLimit(raw.model_info?.context_window) ?? existing?.context,
        max_tokens:
            positiveLimit(raw.model_info?.max_output_tokens) ??
            existing?.max_tokens ??
            0,
        maxInputTokens: positiveLimit(raw.model_info?.max_input_tokens),
        maxReasoningTokens: positiveLimit(raw.model_info?.max_reasoning_tokens),
        reasoningMaxInputTokens: positiveLimit(
            raw.model_info?.reasoning_max_input_tokens,
        ),
        reasoningMaxOutputTokens: positiveLimit(
            raw.model_info?.reasoning_max_output_tokens,
        ),
        release_date: existing?.release_date ?? releaseDate,
        modalities: raw.inference_metadata
            ? {
                  input: (raw.inference_metadata.request_modality ?? []).map(
                      (modality) => modality.toLowerCase(),
                  ),
                  output: (output ?? []).map((modality) =>
                      modality.toLowerCase(),
                  ),
              }
            : existing?.modalities,
        tool_call: raw.features
            ? raw.features.includes('function-calling')
            : existing?.tool_call,
        capabilities: raw.capabilities,
        features: raw.features,
        equivalentSnapshot: raw.equivalent_snapshot ?? undefined,
        retirementDates: Object.fromEntries(
            Object.entries(raw.inference_offline_info ?? {}).flatMap(
                ([site, info]) =>
                    info?.offline_time ? [[site, info.offline_time]] : [],
            ),
        ),
        catalogPricing,
    };
};

export const fetchAlibabaCatalog = async (
    apiBaseUrl: string,
    apiKey: string,
    signal: AbortSignal,
    previous = ALIBABA_MODELS,
): Promise<IChatModel[]> => {
    const models = new Map(previous.map((model) => [model.id, model]));
    const seen = new Set<string>();
    let count = 0;
    let total: number | undefined;
    for (let page = 1; page <= 200; page++) {
        const response = await axios.get(`${apiBaseUrl}/api/v1/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            params: { page_no: page, page_size: 100, language: 'en-US' },
            signal,
            maxContentLength: 8 * 1024 * 1024,
        });
        const body = response.data;
        const output = body?.output;
        if (
            body?.success !== true ||
            !Array.isArray(output?.models) ||
            !Number.isSafeInteger(output.total) ||
            output.total < 0 ||
            output.page_no !== page ||
            output.total > 20_000
        ) {
            throw new Error('Invalid Alibaba catalog page');
        }
        total ??= output.total;
        if (total !== output.total)
            throw new Error('Alibaba catalog changed during pagination');
        const entries = output.models as AlibabaApiModel[];
        if (entries.length === 0 && count < output.total)
            throw new Error('Incomplete Alibaba catalog');
        const previousSize = seen.size;
        for (const raw of entries) {
            if (typeof raw.model !== 'string' || !raw.model.trim())
                throw new Error('Invalid Alibaba model id');
            seen.add(raw.model.trim());
            const model = mapAlibabaCatalogModel(
                raw,
                models.get(raw.model.trim()),
            );
            if (model) models.set(model.id, model);
        }
        if (models.size > 20_000)
            throw new Error('Alibaba catalog size limit exceeded');
        if (entries.length && previousSize === seen.size)
            throw new Error('Repeated Alibaba catalog page');
        count += entries.length;
        if (count >= output.total) return [...models.values()];
    }
    throw new Error('Alibaba catalog pagination limit exceeded');
};
