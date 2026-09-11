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
 * One upstream offering of a model in Infron's catalog. The same model is often
 * served at several service tiers with different prices; `flex` is
 * batch-oriented and cheapest, `priority` is the fastest and dearest.
 */
type InfronApiProviderOffer = {
    provider_slug?: string;
    service_tier?: string;
    prompt_price?: number;
    completion_price?: number;
    context_length?: number;
};

/**
 * Shape of one entry in Infron's `GET /v1/models` catalog. Unlike OpenRouter
 * there is no `pricing` object; prices are USD per million tokens, per offering
 * in `providers` and as a catalog-wide floor in `min_prompt_price` /
 * `min_completion_price`. The catalog mixes non-chat modalities (image, video,
 * embeddings) that this provider filters out via `category_type`.
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
    providers?: InfronApiProviderOffer[];
};

/** Tier Infron routes to when a request carries no explicit `service_tier`. */
const DEFAULT_SERVICE_TIER = 'standard';

/** What one tier of a model costs, in USD per million tokens. */
type InfronTierPrices = {
    prompt: number;
    completion: number;
    context?: number;
};

/**
 * Cheapest offering of each service tier a model sells. Tiers differ in price
 * and sometimes in context window, so each one is quoted from its own row
 * rather than from the catalog-wide `min_*` floor.
 */
const pricesByTier = (model: InfronApiModel) => {
    const byTier = new Map<string, InfronTierPrices>();
    for (const offer of model.providers ?? []) {
        const tier = offer.service_tier;
        if (!tier) continue;
        const prompt = offer.prompt_price ?? 0;
        const completion = offer.completion_price ?? 0;
        const seen = byTier.get(tier);
        if (seen && seen.prompt + seen.completion <= prompt + completion) {
            continue;
        }
        byTier.set(tier, { prompt, completion, context: offer.context_length });
    }
    return byTier;
};

/**
 * Splits a model id into the id Infron expects on the wire and the tier to pin.
 * Catalog ids can contain a colon themselves (`…:free`), so an exact catalog
 * match always wins over reading the last segment as a tier suffix.
 */
const resolveTier = (id: string, catalog: InfronApiModel[]) => {
    const tiersOf = (model: InfronApiModel) =>
        new Set((model.providers ?? []).map((offer) => offer.service_tier));

    const exact = catalog.find((model) => model.id === id);
    if (exact) {
        return {
            wireModelId: id,
            // Unsuffixed ids are quoted at the default tier, so pin it — left
            // unset, Infron load-balances across tiers and could bill another.
            tier: tiersOf(exact).has(DEFAULT_SERVICE_TIER)
                ? DEFAULT_SERVICE_TIER
                : undefined,
        };
    }

    const cut = id.lastIndexOf(':');
    const base =
        cut > 0 ? catalog.find((m) => m.id === id.slice(0, cut)) : undefined;
    const tier = id.slice(cut + 1);
    if (base && tiersOf(base).has(tier)) return { wireModelId: base.id, tier };
    return { wireModelId: id, tier: undefined };
};

/**
 * One listed model: the default tier under the plain id, or a single service
 * tier under a `…:<tier>` id priced from that tier's own offering.
 */
const coerceModel = (
    model: InfronApiModel,
    prices: InfronTierPrices,
    tier?: string,
): IChatModel => {
    const suffix = tier ? `:${tier}` : '';
    const shortId = model.id.split('/').slice(1).join('/');
    // Catalog prices are USD per million tokens; costs are microcents per
    // token, so the conversion is ×100.
    const promptCost = Math.round(prices.prompt * 100);
    return {
        id: `infron:${model.id}${suffix}`,
        name: `${model.display_name || model.id} (Infron${tier ? `, ${tier}` : ''})`,
        aliases: [
            `${model.id}${suffix}`,
            ...(model.display_name && !tier ? [model.display_name] : []),
            `infron/${model.id}${suffix}`,
            `${shortId}${suffix}`,
            // The plain id already means the default tier; accept the
            // explicit spelling of it too.
            ...(tier ? [] : [`${model.id}:${DEFAULT_SERVICE_TIER}`]),
        ],
        context: tier
            ? (prices.context ?? model.context_length)
            : model.context_length,
        max_tokens: model.max_output_tokens ?? 0,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt',
        output_cost_key: 'completion',
        costs: {
            tokens: 1_000_000,
            prompt: promptCost,
            completion: Math.round(prices.completion * 100),
            // The catalog carries no cache-read price; charge the full
            // prompt rate in the fallback path so cached tokens are never
            // billed below list. The normal path bills the
            // gateway-reported cost instead.
            input_cache_read: promptCost,
            // USD per request → microcents per request.
            request: Math.round(
                (model.min_request_price ?? 0) * 1_000_000 * 100,
            ),
        },
    };
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
        return 'infron:qwen/qwen3.5-flash';
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

        const catalogId = modelUsed.id.startsWith('infron:')
            ? modelUsed.id.slice('infron:'.length)
            : modelUsed.id;

        // A `…:<tier>` id carries the tier to pin; a plain id means the
        // default tier. Only tiers the model actually sells are pinned —
        // Infron routes freely (and reports the tier back) when unset.
        const { wireModelId, tier } = resolveTier(
            catalogId,
            await this.#rawModels(),
        );

        const actor = Context.get('actor');

        messages = await OpenAIUtil.process_input_messages(messages);

        const completionParams = {
            messages,
            model: wireModelId,
            ...(tools ? { tools } : {}),
            max_tokens,
            temperature,
            stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
            // Without this Infron load-balances across service tiers, so a
            // request could be billed at a tier other than the one whose
            // price we quote in the catalog.
            ...(tier ? { provider: { service_tier: tier } } : {}),
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

    /** The catalog as Infron returns it, kv-cached and shared by callers. */
    async #rawModels(): Promise<InfronApiModel[]> {
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
        return models ?? [];
    }

    async models() {
        const models = await this.#rawModels();
        const coerced_models: IChatModel[] = [];
        for (const model of models) {
            // The catalog mixes chat with image/video/embedding/search
            // models — only chat-completion-capable models belong here.
            if (model.category_type !== 'LLM') continue;
            if (model.is_display_only) continue;
            if (!(model.supported_endpoint_types ?? []).includes('openai')) {
                continue;
            }
            const byTier = pricesByTier(model);
            const defaultPrices = byTier.get(DEFAULT_SERVICE_TIER) ?? {
                prompt: model.min_prompt_price ?? 0,
                completion: model.min_completion_price ?? 0,
            };
            // The unsuffixed id is the default tier; every other tier the
            // model sells gets its own `…:<tier>` id so callers can ask for
            // one by name and see what it costs.
            coerced_models.push(coerceModel(model, defaultPrices));
            for (const [tier, prices] of byTier) {
                if (tier === DEFAULT_SERVICE_TIER) continue;
                coerced_models.push(coerceModel(model, prices, tier));
            }
        }
        return coerced_models;
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
