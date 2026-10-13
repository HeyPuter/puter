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
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatModel, ICompleteArguments } from '../../types.js';
import { cachedRemoteCatalog } from '../../utils/cachedRemoteCatalog.js';
import { catalogPrice } from '../../utils/pricing.js';
import { mapOpenRouterPricing } from './pricing.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
    type UsageSource,
} from '../OpenAICompatProvider.js';
import { OPEN_ROUTER_MODEL_OVERRIDES } from './modelOverrides.js';

type OpenrouterUsage = OpenAI.Completions.CompletionUsage & {
    cost?: number;
};

export class OpenRouterProvider extends OpenAICompatProvider {
    #apiBaseUrl: string;

    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        const apiBaseUrl = config.apiBaseUrl || 'https://openrouter.ai/api/v1';
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: apiBaseUrl,
                ...sdkClientOptions(),
            }),
            requireTokenPrices: true,
            defaultModel: 'openrouter:openai/gpt-6-luna',
            idPrefix: 'openrouter:',
            passthrough: ['temperature'],
            // OpenRouter is the one OpenAI-family dialect that forwards
            // Anthropic caching through, so it keeps `cache_control`.
            stripAnthropicShape: 'keepCacheControl',
            compatParams: { dialect: 'openrouter' },
            // OpenRouter rejects an overlarge max_tokens rather than
            // truncating.
            retryOnContextLength: true,
        });
        this.#apiBaseUrl = apiBaseUrl;
    }

    override async complete(args: ICompleteArguments, resolved?: IChatModel) {
        if (args.model === 'openrouter/auto') {
            throw new HttpError(
                400,
                "The model 'openrouter/auto' is not allowed",
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'model',
                        expected: 'allowed model',
                        got: 'disallowed model',
                    },
                },
            );
        }
        return super.complete(args, resolved);
    }

    override async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    #catalog = cachedRemoteCatalog({
        name: 'OpenRouter catalog',
        fallback: [] as IChatModel[],
        fetch: (signal) => this.#fetchModels(signal),
    });

    async #fetchModels(signal: AbortSignal): Promise<IChatModel[]> {
        const resp = await axios.request({
            method: 'GET',
            url: `${this.#apiBaseUrl}/models`,
            signal,
            maxContentLength: 8 * 1024 * 1024,
        });
        if (!Array.isArray(resp.data?.data))
            throw new Error('Invalid OpenRouter catalog');
        const models = resp.data.data;
        const coerced_models: IChatModel[] = [];
        for (const model of models) {
            if (
                typeof model.id !== 'string' ||
                model.id.includes('openrouter/auto')
            ) {
                continue;
            }
            // OpenRouter sets expiration_date on deprecated models scheduled for removal.
            if (model.expiration_date) {
                continue;
            }
            const overridenModel = OPEN_ROUTER_MODEL_OVERRIDES.find(
                (m) => m.id === `openrouter:${model.id}`,
            );
            const pricing = mapOpenRouterPricing(model.pricing ?? {});
            coerced_models.push({
                id: `openrouter:${model.id}`,
                name: `${model.name ?? model.id} (OpenRouter)`,
                aliases: [
                    model.id,
                    ...(typeof model.name === 'string' ? [model.name] : []),
                    `openrouter/${model.id}`,
                    model.id.split('/').slice(1).join('/'),
                ],
                context: model.context_length,
                // OpenRouter leaves max_completion_tokens null when a model
                // declares no output cap separate from its context window.
                max_tokens:
                    model.top_provider?.max_completion_tokens ??
                    model.context_length ??
                    0,
                costs_currency: 'usd-cents',
                input_cost_key: 'prompt',
                output_cost_key: 'completion',
                costs: {
                    tokens: 1_000_000,
                    ...pricing.costs,
                },
                pricingOverrides: pricing.overrides,
                modalities: model.architecture
                    ? {
                          input: model.architecture.input_modalities ?? [
                              'text',
                          ],
                          output: model.architecture.output_modalities ?? [
                              'text',
                          ],
                      }
                    : undefined,
                tool_call: model.supported_parameters?.includes('tools'),
                ...overridenModel,
            });
        }
        return coerced_models;
    }

    protected override vendorParams(params: Record<string, unknown>) {
        // Puts OpenRouter's own `cost` on the usage it reports.
        return { ...params, usage: { include: true } };
    }

    protected override meteredUsage(source: UsageSource) {
        const usage = source.usage as OpenrouterUsage;
        return {
            usage: {
                prompt:
                    (usage.prompt_tokens ?? 0) -
                    (usage.prompt_tokens_details?.cached_tokens ?? 0),
                completion: usage.completion_tokens ?? 0,
                input_cache_read:
                    usage.prompt_tokens_details?.cached_tokens ?? 0,
                request:
                    (usage as unknown as Record<string, number>).request ?? 1,
            },
            // What OpenRouter billed, when it says; the catalog's prices
            // otherwise.
            meterOptions:
                catalogPrice(usage.cost) !== undefined
                    ? { authoritativeUsd: usage.cost }
                    : {},
        };
    }
}
