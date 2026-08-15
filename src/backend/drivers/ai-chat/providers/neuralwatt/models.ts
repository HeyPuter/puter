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

import type { IChatModel } from '../../types.js';
import { usdPerMToken } from '../../utils/pricing.js';

export const NEURALWATT_ID_PREFIX = 'neuralwatt:';
export const NEURALWATT_DEFAULT_MODEL = 'neuralwatt:deepseek-v4-flash';

/**
 * Shape of one entry in Neuralwatt's `GET /v1/models` catalog. Pricing is USD
 * per million tokens under `metadata.pricing` and is used only for Puter
 * preflight estimates / token-cost fallback. Live billing uses each
 * completion's `cost.request_cost_usd`.
 */

export type NeuralwattApiModel = {
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    max_model_len?: number;
    metadata?: {
        display_name?: string;
        description?: string | null;
        provider?: string;
        huggingface_id?: string | null;
        pricing?: {
            input_per_million?: number;
            output_per_million?: number;
            cached_input_per_million?: number | null;
            cached_output_per_million?: number | null;
            currency?: string;
            pricing_tbd?: boolean;
        };
        capabilities?: {
            tools?: boolean;
            json_mode?: boolean;
            vision?: boolean;
            reasoning?: boolean;
            reasoning_effort?: boolean;
            streaming?: boolean;
            system_role?: boolean;
            developer_role?: boolean;
        };
        limits?: {
            max_context_length?: number | null;
            max_output_tokens?: number | null;
            max_images?: number | null;
        };
        deprecated?: boolean;
        deprecated_message?: string | null;
    };
};

export type NeuralwattAccountingMethod = 'energy' | 'token';

export type NeuralwattEnergy = {
    energy_joules?: number;
    energy_kwh?: number;
    measurement_available?: boolean;
    avg_power_watts?: number;
    duration_seconds?: number;
    attribution_method?: string;
    attribution_ratio?: number;
};

export type NeuralwattCost = {
    request_cost_usd?: number;
    cache_savings_usd?: number;
    allowance_remaining_usd?: number;
};

/** Strip the Puter-facing `neuralwatt:` prefix for upstream API calls. */
export const stripNeuralwattPrefix = (modelId: string): string =>
    modelId.startsWith(NEURALWATT_ID_PREFIX)
        ? modelId.slice(NEURALWATT_ID_PREFIX.length)
        : modelId;

/**
 * Map a Neuralwatt catalog entry to Puter's `IChatModel`. Returns `null` when
 * pricing is TBD (placeholders) so the model is not offered for preflight
 * credit checks until Neuralwatt publishes real rates.
 */
export const mapNeuralwattApiModel = (
    model: NeuralwattApiModel,
): IChatModel | null => {
    const pricing = model.metadata?.pricing;
    if (pricing?.pricing_tbd) return null;

    const inputUsd = Number(pricing?.input_per_million ?? 0);
    const outputUsd = Number(pricing?.output_per_million ?? 0);
    const cachedUsd =
        pricing?.cached_input_per_million == null
            ? 0
            : Number(pricing.cached_input_per_million);

    const caps = model.metadata?.capabilities;
    const limits = model.metadata?.limits;
    const context =
        limits?.max_context_length ?? model.max_model_len ?? undefined;
    const maxTokens = limits?.max_output_tokens ?? context ?? 0;

    const inputModalities = ['text'];
    if (caps?.vision) inputModalities.push('image');

    const displayName = model.metadata?.display_name || model.id;
    const pathTail = model.id.includes('/')
        ? model.id.split('/').slice(1).join('/')
        : undefined;

    return {
        id: `${NEURALWATT_ID_PREFIX}${model.id}`,
        name: `${displayName} (Neuralwatt)`,
        aliases: [
            model.id,
            `neuralwatt/${model.id}`,
            ...(pathTail && pathTail !== model.id ? [pathTail] : []),
        ],
        context,
        max_tokens: maxTokens,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: usdPerMToken(inputUsd, outputUsd, cachedUsd),
        modalities: { input: inputModalities, output: ['text'] },
        tool_call: caps?.tools === true,
        // Surfaced from Neuralwatt `/models` so `complete()` can gate
        // reasoning_effort without re-fetching the catalog entry.
        reasoning_effort: caps?.reasoning_effort === true,
        ...(typeof limits?.max_images === 'number'
            ? { max_images: limits.max_images }
            : {}),
        ...(model.metadata?.description
            ? { description: model.metadata.description }
            : {}),
        ...(model.created
            ? {
                  release_date: new Date(model.created * 1000)
                      .toISOString()
                      .slice(0, 10),
              }
            : {}),
    };
};

/** True when the Puter model catalog entry advertises image input. */
export const modelSupportsVision = (model: IChatModel): boolean =>
    Array.isArray(model.modalities?.input) &&
    model.modalities.input.includes('image');

/**
 * Detect image / puter_path parts so we can prefer a vision-capable model from
 * the Neuralwatt catalog (or reject a text-only pick).
 */
export const messagesHaveImageContent = (
    messages: Array<{ content?: unknown }>,
): boolean => {
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as Array<Record<string, unknown>>) {
            if (!part || typeof part !== 'object') continue;
            if (part.type === 'image_url' || part.image_url) return true;
            if (typeof part.puter_path === 'string' && part.puter_path) {
                return true;
            }
        }
    }
    return false;
};
