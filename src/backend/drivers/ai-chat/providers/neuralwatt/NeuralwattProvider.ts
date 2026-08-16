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
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { kv } from '../../../../util/kvSingleton.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import type {
    IChatModel,
    IChatProvider,
    IChatCompleteResult,
    ICompleteArguments,
} from '../../types.js';
import { inlineHttpImageUrls } from '../moonshot/imageHandling.js';
import {
    mapNeuralwattApiModel,
    messagesHaveImageContent,
    modelSupportsVision,
    NEURALWATT_DEFAULT_MODEL,
    NEURALWATT_ID_PREFIX,
    stripNeuralwattPrefix,
    type NeuralwattAccountingMethod,
    type NeuralwattApiModel,
    type NeuralwattCost,
    type NeuralwattEnergy,
} from './models.js';

const DEFAULT_API_BASE_URL = 'https://api.neuralwatt.com/v1';
const KV_MODELS_KEY = 'neuralwattChat:models';
const KV_QUOTA_KEY = 'neuralwattChat:quota';
const CACHE_TTL_SEC = 15 * 60;

type NeuralwattUsage = OpenAI.Completions.CompletionUsage & {
    request_cost_usd?: number;
    energy_kwh?: number;
    energy_joules?: number;
    measurement_available?: boolean;
};

export class NeuralwattProvider implements IChatProvider {
    #meteringService: MeteringService;

    #openai: OpenAI;

    #apiKey: string;

    #apiBaseUrl: string = DEFAULT_API_BASE_URL;

    constructor(
        config: { apiBaseUrl?: string; apiKey: string },
        meteringService: MeteringService,
    ) {
        this.#apiBaseUrl = config.apiBaseUrl || DEFAULT_API_BASE_URL;
        this.#apiKey = config.apiKey;
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: this.#apiBaseUrl,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return NEURALWATT_DEFAULT_MODEL;
    }

    async list() {
        const models = await this.models();
        const modelNames: string[] = [];
        for (const model of models) {
            modelNames.push(model.id);
            if (model.aliases) modelNames.push(...model.aliases);
        }
        return modelNames;
    }

    async models(): Promise<IChatModel[]> {
        let apiModels = kv.get(KV_MODELS_KEY) as
            NeuralwattApiModel[] | undefined;
        if (!apiModels) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.#apiBaseUrl}/models`,
                    headers: {
                        Authorization: `Bearer ${this.#apiKey}`,
                    },
                });
                apiModels = resp.data.data ?? [];
                kv.set(KV_MODELS_KEY, apiModels, { EX: CACHE_TTL_SEC });
            } catch (e) {
                console.error(
                    'Failed to fetch Neuralwatt models:',
                    (e as Error).message,
                );
            }
        }
        if (!apiModels) return [];

        const coerced: IChatModel[] = [];
        for (const model of apiModels) {
            if (model.metadata?.deprecated) continue;
            const mapped = mapNeuralwattApiModel(model);
            if (mapped) coerced.push(mapped);
        }
        return coerced;
    }

    /**
     * Cached account accounting method (`energy` | `token`) from `GET
     * /v1/quota`. Used only to annotate returned usage — billing always prefers
     * `cost.request_cost_usd` on the completion.
     */
    async getAccountingMethod(): Promise<
        NeuralwattAccountingMethod | undefined
    > {
        let method = kv.get(KV_QUOTA_KEY) as
            NeuralwattAccountingMethod | undefined;
        if (method === 'energy' || method === 'token') return method;

        try {
            const resp = await axios.request({
                method: 'GET',
                url: `${this.#apiBaseUrl}/quota`,
                headers: {
                    Authorization: `Bearer ${this.#apiKey}`,
                },
            });
            const raw = resp.data?.balance?.accounting_method;
            if (raw === 'energy' || raw === 'token') {
                method = raw;
                kv.set(KV_QUOTA_KEY, method, { EX: CACHE_TTL_SEC });
                return method;
            }
        } catch (e) {
            console.error(
                'Failed to fetch Neuralwatt quota:',
                (e as Error).message,
            );
        }
        return undefined;
    }

    async complete({
        messages,
        stream,
        model,
        tools,
        max_tokens,
        temperature,
        reasoning_effort,
        reasoning,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        // Catalog carries per-model vision / reasoning_effort flags from
        // Neuralwatt `GET /models` — resolve against it before shaping the
        // upstream request so image-bearing prompts land on a vision model.
        const availableModels = await this.models();
        const hasImages = messagesHaveImageContent(messages ?? []);
        const modelLower = (model ?? '').toLowerCase();
        let modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].some(
                    (id) => id.toLowerCase() === modelLower,
                ),
            ) ?? undefined;

        if (!modelUsed) {
            if (hasImages) {
                modelUsed = availableModels.find((m) => modelSupportsVision(m));
            }
            modelUsed =
                modelUsed ||
                availableModels.find((m) => m.id === this.getDefaultModel()) ||
                availableModels[0];
        }

        if (!modelUsed) {
            throw new Error('No Neuralwatt models available');
        }

        if (hasImages && !modelSupportsVision(modelUsed)) {
            throw new HttpError(
                400,
                `Model ${modelUsed.id} does not support image input`,
                { legacyCode: 'bad_request' },
            );
        }

        const modelIdForParams = stripNeuralwattPrefix(modelUsed.id);
        const actor = Context.get('actor');
        const accountingMethod = await this.getAccountingMethod();

        // Vision models: Neuralwatt (like Moonshot) expects inline data URLs
        // rather than remote http(s) fetches for image_url parts.
        if (modelSupportsVision(modelUsed)) {
            await inlineHttpImageUrls(messages);
        }

        messages = await OpenAIUtil.process_input_messages(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const supportsReasoningEffort = modelUsed.reasoning_effort === true;

        const completionParams = {
            messages,
            model: modelIdForParams,
            ...(tools ? { tools } : {}),
            ...(max_tokens !== undefined ? { max_tokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(supportsReasoningEffort && requestedReasoningEffort
                ? { reasoning_effort: requestedReasoningEffort }
                : {}),
            stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openai.chat.completions.create(completionParams);

        const usage_calculator = ({
            usage,
            cost,
            energy,
        }: {
            usage: NeuralwattUsage;
            cost?: NeuralwattCost;
            energy?: NeuralwattEnergy;
        }) => {
            // Non-streaming spreads the full completion into this call;
            // streaming merges top-level cost/energy onto `usage` via the
            // index_usage_from_stream_chunk deviation below.
            const requestCostUsd =
                typeof cost?.request_cost_usd === 'number'
                    ? cost.request_cost_usd
                    : typeof usage.request_cost_usd === 'number'
                      ? usage.request_cost_usd
                      : undefined;

            const energyBlock = energy ?? {
                energy_kwh: usage.energy_kwh,
                energy_joules: usage.energy_joules,
                measurement_available: usage.measurement_available,
            };

            const trackedTokens = OpenAIUtil.extractMeteredUsage(usage);
            const energyUnits: Record<string, number> = {};
            if (
                energyBlock.measurement_available !== false &&
                typeof energyBlock.energy_kwh === 'number' &&
                Number.isFinite(energyBlock.energy_kwh) &&
                energyBlock.energy_kwh > 0
            ) {
                energyUnits.energy_kwh = energyBlock.energy_kwh;
            }
            if (
                energyBlock.measurement_available !== false &&
                typeof energyBlock.energy_joules === 'number' &&
                Number.isFinite(energyBlock.energy_joules) &&
                energyBlock.energy_joules > 0
            ) {
                energyUnits.energy_joules = energyBlock.energy_joules;
            }

            const annotate = (tracked: Record<string, number>) => {
                const out: Record<string, number | string> = { ...tracked };
                if (accountingMethod) {
                    out.accounting_method = accountingMethod;
                }
                return out;
            };

            if (
                typeof requestCostUsd === 'number' &&
                Number.isFinite(requestCostUsd)
            ) {
                const billedTrackedUsage = {
                    ...trackedTokens,
                    ...energyUnits,
                    billedUsage: 1,
                };
                const costOverwrites = Object.fromEntries(
                    Object.keys(billedTrackedUsage).map((k) => [k, 0]),
                );
                costOverwrites.billedUsage = requestCostUsd * 100_000_000;
                this.#meteringService.utilRecordUsageObject(
                    billedTrackedUsage,
                    actor!,
                    modelUsed.id,
                    costOverwrites,
                );
                const result = annotate(billedTrackedUsage);
                result.usd_cents = requestCostUsd * 100;
                return result;
            }

            // Fallback: catalog token rates (preflight / when Neuralwatt
            // omits request_cost_usd).
            const trackedUsage = { ...trackedTokens, ...energyUnits };
            const costOverwrites = Object.fromEntries(
                Object.entries(trackedUsage).map(([k, v]) => {
                    if (k === 'energy_kwh' || k === 'energy_joules') {
                        return [k, 0];
                    }
                    return [k, (modelUsed.costs[k] ?? 0) * v];
                }),
            );
            this.#meteringService.utilRecordUsageObject(
                trackedUsage,
                actor!,
                modelUsed.id,
                costOverwrites,
            );
            return annotate(trackedUsage);
        };

        return OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: (chunk: {
                    usage?: NeuralwattUsage;
                    cost?: NeuralwattCost;
                    energy?: NeuralwattEnergy;
                }) => {
                    if (!chunk.usage) return chunk.usage;
                    return {
                        ...chunk.usage,
                        ...(typeof chunk.cost?.request_cost_usd === 'number'
                            ? {
                                  request_cost_usd: chunk.cost.request_cost_usd,
                              }
                            : {}),
                        ...(chunk.energy
                            ? {
                                  energy_kwh: chunk.energy.energy_kwh,
                                  energy_joules: chunk.energy.energy_joules,
                                  measurement_available:
                                      chunk.energy.measurement_available,
                              }
                            : {}),
                    };
                },
            },
            usage_calculator,
            stream,
            completion,
        });
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}

export { NEURALWATT_ID_PREFIX, NEURALWATT_DEFAULT_MODEL };
