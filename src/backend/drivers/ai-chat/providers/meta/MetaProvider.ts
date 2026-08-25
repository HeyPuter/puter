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

import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import { processPuterPathUploads } from '../openai/fileUpload.js';
import { META_MODELS, MUSE_SPARK_DEFAULT_MODEL } from './models.js';
import { modelLookupNames } from '../../utils/modelRouting.js';

const DEFAULT_API_BASE_URL = 'https://api.meta.ai/v1';

// `safety_identifier` is capped at 64 characters by the Model API.
const SAFETY_IDENTIFIER_MAX_LENGTH = 64;

type MetaConfig = {
    apiBaseUrl?: string;
    apiKey: string;
};

/**
 * Chat Completions params Muse Spark accepts that Puter has no first-class
 * argument for. Passed through `custom`.
 */
type MetaCustomParams = {
    frequency_penalty?: number;
    presence_penalty?: number;
    response_format?: unknown;
    safety_identifier?: string;
    seed?: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * Meta's Model API — the Muse Spark family, served OpenAI-compatible from
 * `https://api.meta.ai/v1`.
 *
 * Only the Chat Completions protocol is used here; Meta also fronts the same
 * models behind Responses- and Anthropic-Messages-shaped endpoints.
 */
export class MetaProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    constructor(
        meteringService: MeteringService,
        stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
        fsService: FSService,
        config: MetaConfig,
    ) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
        });
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
    }

    getDefaultModel() {
        return MUSE_SPARK_DEFAULT_MODEL;
    }

    models() {
        return META_MODELS;
    }

    list() {
        return modelLookupNames(this.models());
    }

    async complete(
        params: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const {
            custom,
            max_tokens,
            prompt_cache_key,
            prompt_cache_retention,
            reasoning,
            reasoning_effort,
            stream,
            temperature,
            tool_choice,
            tools,
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

        // Muse Spark reads images, video, PDFs and audio, but Chat Completions
        // takes them inline only — resolve `puter_path` parts to data URLs.
        await processPuterPathUploads(
            messages,
            this.#stores,
            this.#fsService,
            actor,
        );

        messages = await OpenAIUtil.process_input_messages(messages);
        messages = messages.map((message) => {
            // Anthropic-shaped cache hints don't belong on this wire; Meta
            // caches via `prompt_cache_key` / `prompt_cache_retention`.
            delete message.cache_control;
            return message;
        });

        const customParams = asRecord(custom) as MetaCustomParams;

        // Reasoning is always on for Muse Spark — `reasoning_effort: 'none'`
        // is a 400 — so a request to switch it off is dropped, not forwarded.
        const requestedEffort = (reasoning_effort ?? reasoning?.effort) as
            string | undefined;
        const effort =
            requestedEffort && requestedEffort !== 'none'
                ? requestedEffort
                : undefined;

        // Puter spells the in-memory retention with a hyphen; Meta's enum
        // uses an underscore.
        const cacheRetention =
            prompt_cache_retention === 'in-memory'
                ? 'in_memory'
                : prompt_cache_retention;

        const safetyIdentifier =
            customParams.safety_identifier ??
            (actor?.user?.id
                ? `puter-${actor.user.id}${actor.app?.uid ? `-${actor.app.uid}` : ''}`.slice(
                      0,
                      SAFETY_IDENTIFIER_MAX_LENGTH,
                  )
                : undefined);

        const completionParams = {
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            // Reasoning tokens come out of this same budget, so a tight cap
            // returns `content: null` with `finish_reason: 'length'`.
            ...(max_tokens !== undefined
                ? { max_completion_tokens: max_tokens }
                : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            ...(effort ? { reasoning_effort: effort } : {}),
            ...(prompt_cache_key !== undefined ? { prompt_cache_key } : {}),
            ...(cacheRetention !== undefined
                ? { prompt_cache_retention: cacheRetention }
                : {}),
            ...(safetyIdentifier
                ? { safety_identifier: safetyIdentifier }
                : {}),
            ...(customParams.response_format
                ? { response_format: customParams.response_format }
                : {}),
            ...(customParams.frequency_penalty !== undefined
                ? { frequency_penalty: customParams.frequency_penalty }
                : {}),
            ...(customParams.presence_penalty !== undefined
                ? { presence_penalty: customParams.presence_penalty }
                : {}),
            ...(customParams.seed !== undefined
                ? { seed: customParams.seed }
                : {}),
            stream: !!stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openai.chat.completions.create(completionParams);

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const cachedTokens =
                    usage?.prompt_tokens_details?.cached_tokens ?? 0;
                // Meta reports cache reads as a subset of `prompt_tokens`, so
                // the remainder is what the input rate applies to. Reasoning
                // tokens (`completion_tokens_details.reasoning_tokens`) are
                // likewise already inside `completion_tokens` — metering them
                // again would bill the same tokens twice.
                const trackedUsage = {
                    prompt_tokens: (usage?.prompt_tokens ?? 0) - cachedTokens,
                    completion_tokens: usage?.completion_tokens ?? 0,
                    cached_tokens: cachedTokens,
                };
                const costsOverride = buildCostsOverride(
                    trackedUsage,
                    modelUsed,
                );
                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor!,
                    `meta:${modelUsed.id}`,
                    costsOverride,
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
