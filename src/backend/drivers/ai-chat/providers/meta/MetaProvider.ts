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

import { HttpError } from '@heyputer/backend/src/core/http/HttpError.js';
import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../core/context.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import { processPuterPathUploads } from '../openai/fileUpload.js';
import { META_MODELS } from './models.js';

type MetaConfig = {
    apiKey: string;
    apiBaseUrl?: string;
};

type MetaCustomParams = {
    response_format?: unknown;
    seed?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    // Muse Spark accepts two efforts the driver's own field can't express.
    reasoning_effort?: string;
};

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';

// `none` is rejected with a 400 — Muse Spark always reasons — so it is not
// among the values we forward.
const REASONING_EFFORTS = new Set([
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
]);

// The driver spells the in-memory retention with a hyphen; Meta's wire format
// uses an underscore.
const CACHE_RETENTION: Record<string, string> = {
    'in-memory': 'in_memory',
    '24h': '24h',
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * Meta Model API provider — Muse Spark over Meta's OpenAI-compatible Chat
 * Completions endpoint. https://ai.developer.meta.com/docs
 *
 * Puter reaches these models through OpenRouter as well. This provider is a
 * direct vendor route, so `compareModelPreference` serves it first and leaves
 * the reseller as the fallback.
 */
export class MetaProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    #defaultModel = 'muse-spark-1.2';

    constructor(
        config: MetaConfig,
        meteringService: MeteringService,
        stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
        fsService: FSService,
    ) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl ?? DEFAULT_BASE_URL,
        });
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    models() {
        return META_MODELS;
    }

    list() {
        const modelIds: string[] = [];
        for (const model of this.models()) {
            modelIds.push(model.id);
            if (model.aliases) {
                modelIds.push(...model.aliases);
            }
        }
        return modelIds;
    }

    async complete(
        params: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const {
            custom,
            max_tokens,
            prompt_cache_retention,
            reasoning,
            reasoning_effort,
            stream,
            temperature,
            tools,
            tool_choice,
            top_p,
        } = params;
        let { messages, model } = params;

        if (!Array.isArray(messages)) {
            throw new HttpError(400, '`messages` must be an array', {
                legacyCode: 'bad_request',
            });
        }

        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        // Chat Completions takes no file references, so Puter-hosted files
        // have to be inlined as data URLs before the call.
        await processPuterPathUploads(
            messages,
            this.#stores,
            this.#fsService,
            actor,
        );
        messages = await OpenAIUtil.process_input_messages(messages);
        messages = messages.map((message) => {
            delete message.cache_control;
            return message;
        });

        const customParams = asRecord(custom) as MetaCustomParams;

        const requestedEffort =
            customParams.reasoning_effort ??
            reasoning_effort ??
            reasoning?.effort;
        const effort =
            requestedEffort && REASONING_EFFORTS.has(requestedEffort)
                ? requestedEffort
                : undefined;

        const retention = prompt_cache_retention
            ? CACHE_RETENTION[prompt_cache_retention]
            : undefined;

        const completionParams: ChatCompletionCreateParams = {
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            ...(max_tokens !== undefined
                ? { max_completion_tokens: max_tokens }
                : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            ...(effort ? { reasoning_effort: effort } : {}),
            ...(retention ? { prompt_cache_retention: retention } : {}),
            ...(customParams.response_format
                ? { response_format: customParams.response_format }
                : {}),
            ...(customParams.seed !== undefined
                ? { seed: customParams.seed }
                : {}),
            ...(customParams.frequency_penalty !== undefined
                ? { frequency_penalty: customParams.frequency_penalty }
                : {}),
            ...(customParams.presence_penalty !== undefined
                ? { presence_penalty: customParams.presence_penalty }
                : {}),
            stream: !!stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openai.chat.completions.create(completionParams);

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const cached_tokens =
                    usage?.prompt_tokens_details?.cached_tokens ?? 0;
                // Cached reads are billed at their own rate, so they come out
                // of the prompt count rather than being charged twice. Clamped
                // because a prompt count that came back below its own cache
                // hit would otherwise bill the account a negative amount.
                const trackedUsage = {
                    prompt_tokens: Math.max(
                        0,
                        (usage?.prompt_tokens ?? 0) - cached_tokens,
                    ),
                    // Reasoning tokens arrive as a subset of
                    // `completion_tokens` and bill at the same output rate, so
                    // there is nothing to separate out.
                    completion_tokens: usage?.completion_tokens ?? 0,
                    cached_tokens,
                };

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor!,
                    `meta:${modelUsed.id}`,
                    buildCostsOverride(trackedUsage, modelUsed),
                );
                return trackedUsage;
            },
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
