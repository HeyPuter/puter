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
import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { kv } from '../../../../util/kvSingleton.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import type {
    IChatModel,
    IChatProvider,
    IChatCompleteResult,
    ICompleteArguments,
} from '../../types.js';

/**
 * Shape of one entry in Infron's `GET /v1/models` catalog. Unlike OpenRouter
 * there is no `pricing` object; prices are USD per million tokens in
 * `min_prompt_price` / `min_completion_price`, and the catalog mixes non-chat
 * modalities (image, video, embeddings) that this provider filters out via
 * `category_type`.
 */
type InfronApiModel = {
    id: string;
    display_name?: string;
    category_type?: string;
    is_display_only?: boolean;
    supported_endpoint_types?: string[];
    context_length?: number;
    max_output_tokens?: number;
    min_prompt_price?: number;
    min_completion_price?: number;
    min_request_price?: number;
};

type InfronUsage = OpenAI.Completions.CompletionUsage & {
    cost?: number;
};

const KV_MODELS_KEY = 'infronChat:models';

export class InfronProvider implements IChatProvider {
    #meteringService: MeteringService;

    #openai: OpenAI;

    #apiKey: string;

    #apiBaseUrl: string = 'https://llm.onerouter.pro/v1';

    constructor(
        config: { apiBaseUrl?: string; apiKey: string },
        meteringService: MeteringService,
    ) {
        this.#apiBaseUrl = config.apiBaseUrl || 'https://llm.onerouter.pro/v1';
        this.#apiKey = config.apiKey;
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: this.#apiBaseUrl,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return 'infron:deepseek/deepseek-v4-flash';
    }

    /**
     * Returns a list of available model names
     *
     * @returns {Promise<string[]>} Array of model identifiers
     */
    async list() {
        const models = await this.models();
        const model_names: string[] = [];
        for (const model of models) {
            model_names.push(model.id);
        }
        return model_names;
    }

    /** AI Chat completion method. See AIChatService for more details. */
    async complete({
        messages,
        stream,
        model,
        tools,
        max_tokens,
        temperature,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        const availableModels = await this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        const modelIdForParams = modelUsed.id.startsWith('infron:')
            ? modelUsed.id.slice('infron:'.length)
            : modelUsed.id;

        const actor = Context.get('actor');

        messages = await OpenAIUtil.process_input_messages(messages);

        const completionParams = {
            messages,
            model: modelIdForParams,
            ...(tools ? { tools } : {}),
            max_tokens,
            temperature,
            stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
            // Surfaces the authoritative `cost` field (USD) on the
            // response so metering doesn't depend on catalog prices.
            usage: { include: true },
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openai.chat.completions.create(completionParams);

        const usage_calculator = ({
            usage,
            cost,
        }: {
            usage: InfronUsage;
            cost?: number;
        }) => {
            // Infron reports `cost` at the top level of the response, not
            // inside `usage`. Non-streaming calls get it via the spread
            // completion below; streaming injects it into `usage` via the
            // `index_usage_from_stream_chunk` deviation.
            const authoritativeCost =
                typeof cost === 'number' ? cost : usage.cost;
            const trackedUsage = {
                prompt:
                    (usage.prompt_tokens ?? 0) -
                    (usage.prompt_tokens_details?.cached_tokens ?? 0),
                completion: usage.completion_tokens ?? 0,
                input_cache_read:
                    usage.prompt_tokens_details?.cached_tokens ?? 0,
                request: 1,
            };
            if (typeof authoritativeCost === 'number') {
                // Bill the gateway-reported cost as a single line item and
                // zero the per-token costs so nothing double-bills.
                const billedTrackedUsage = { ...trackedUsage, billedUsage: 1 };
                const costOverwrites = Object.fromEntries(
                    Object.keys(billedTrackedUsage).map((k) => [k, 0]),
                );
                costOverwrites.billedUsage =
                    authoritativeCost * 100_000_000 || 1;
                this.#meteringService.utilRecordUsageObject(
                    billedTrackedUsage,
                    actor,
                    modelUsed.id,
                    costOverwrites,
                );
                (billedTrackedUsage as Record<string, number>).usd_cents =
                    authoritativeCost * 100;
                return billedTrackedUsage;
            }
            // Fallback: per-token pricing from the model catalog.
            const costOverwrites = Object.fromEntries(
                Object.keys(trackedUsage).map((k) => {
                    return [
                        k,
                        (modelUsed.costs[k] ?? 0) *
                            trackedUsage[k as keyof typeof trackedUsage],
                    ];
                }),
            );
            this.#meteringService.utilRecordUsageObject(
                trackedUsage,
                actor,
                modelUsed.id,
                costOverwrites,
            );
            return trackedUsage;
        };

        return OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: (chunk: {
                    usage?: InfronUsage;
                    cost?: number;
                }) =>
                    chunk.usage
                        ? { ...chunk.usage, cost: chunk.cost }
                        : chunk.usage,
            },
            usage_calculator,
            stream,
            completion,
        });
    }

    async models() {
        let models = kv.get(KV_MODELS_KEY) as InfronApiModel[] | undefined;
        if (!models) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.#apiBaseUrl}/models`,
                    // Infron requires authentication on the catalog endpoint.
                    headers: {
                        Authorization: `Bearer ${this.#apiKey}`,
                    },
                });

                models = resp.data.data;
                kv.set(KV_MODELS_KEY, models, { EX: 15 * 60 }); // cache for 15 minutes
            } catch (e) {
                console.log(e);
            }
        }
        if (!models) return [];
        const coerced_models: IChatModel[] = [];
        for (const model of models) {
            // The catalog mixes chat with image/video/embedding/search
            // models — only chat-completion-capable models belong here.
            if (model.category_type !== 'LLM') continue;
            if (model.is_display_only) continue;
            if (!(model.supported_endpoint_types ?? []).includes('openai')) {
                continue;
            }
            // Catalog prices are USD per million tokens; costs are
            // microcents per token, so the conversion is ×100.
            const promptCost = Math.round((model.min_prompt_price ?? 0) * 100);
            coerced_models.push({
                id: `infron:${model.id}`,
                name: `${model.display_name || model.id} (Infron)`,
                aliases: [
                    model.id,
                    ...(model.display_name ? [model.display_name] : []),
                    `infron/${model.id}`,
                    model.id.split('/').slice(1).join('/'),
                ],
                context: model.context_length,
                max_tokens: model.max_output_tokens ?? 0,
                costs_currency: 'usd-cents',
                input_cost_key: 'prompt',
                output_cost_key: 'completion',
                costs: {
                    tokens: 1_000_000,
                    prompt: promptCost,
                    completion: Math.round(
                        (model.min_completion_price ?? 0) * 100,
                    ),
                    // The catalog carries no cache-read price; charge the
                    // full prompt rate in the fallback path so cached
                    // tokens are never billed below list. The normal path
                    // bills the gateway-reported cost instead.
                    input_cache_read: promptCost,
                    // USD per request → microcents per request.
                    request: Math.round(
                        (model.min_request_price ?? 0) * 1_000_000 * 100,
                    ),
                },
            });
        }
        return coerced_models;
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
