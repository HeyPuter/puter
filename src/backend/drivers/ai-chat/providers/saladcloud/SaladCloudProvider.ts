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
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../core/context.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IChatCompleteResult,
    IChatProvider,
    ICompleteArguments,
} from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import { processPuterPathUploads } from '../openai/fileUpload.js';
import {
    SALADCLOUD_DEFAULT_MODEL,
    SALADCLOUD_MODELS,
    stripSaladCloudPrefix,
} from './models.js';

const DEFAULT_API_BASE_URL = 'https://ai.salad.cloud/v1';

export class SaladCloudProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #stores: Parameters<typeof processPuterPathUploads>[1];

    #fsService: FSService;

    constructor(
        config: { apiBaseUrl?: string; apiKey: string },
        meteringService: MeteringService,
        stores: Parameters<typeof processPuterPathUploads>[1],
        fsService: FSService,
    ) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl || DEFAULT_API_BASE_URL,
        });
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
    }

    getDefaultModel() {
        return SALADCLOUD_DEFAULT_MODEL;
    }

    models() {
        return SALADCLOUD_MODELS;
    }

    async list() {
        return this.models().flatMap((model) => [
            model.id,
            ...(model.aliases ?? []),
        ]);
    }

    async complete({
        messages,
        stream,
        model,
        tools,
        tool_choice,
        parallel_tool_calls,
        max_tokens,
        temperature,
        top_p,
        reasoning,
        reasoning_effort,
        text,
        verbosity,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        const modelUsed =
            this.models().find((candidate) =>
                [candidate.id, ...(candidate.aliases ?? [])].includes(model),
            ) ?? this.models()[0];
        const actor = Context.get('actor');
        const userIdentifier = actor?.user.id
            ? `${actor.user.id}${actor.app?.uid ? `:${actor.app.uid}` : ''}`
            : undefined;

        await processPuterPathUploads(
            messages,
            this.#stores,
            this.#fsService,
            actor,
        );
        messages = await OpenAIUtil.process_input_messages(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;

        const completion = await this.#openai.chat.completions.create({
            messages,
            model: stripSaladCloudPrefix(modelUsed.id),
            ...(userIdentifier ? { user: userIdentifier } : {}),
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            ...(parallel_tool_calls !== undefined
                ? { parallel_tool_calls }
                : {}),
            ...(max_tokens !== undefined ? { max_tokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            ...(requestedReasoningEffort !== undefined
                ? { reasoning_effort: requestedReasoningEffort }
                : {}),
            ...(requestedVerbosity !== undefined
                ? { verbosity: requestedVerbosity }
                : {}),
            stream: !!stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
        } as ChatCompletionCreateParams);

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const cachedTokens =
                    usage.prompt_tokens_details?.cached_tokens ?? 0;
                const trackedUsage = {
                    prompt_tokens: (usage.prompt_tokens ?? 0) - cachedTokens,
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens: cachedTokens,
                };
                const costsOverride = buildCostsOverride(
                    trackedUsage,
                    modelUsed,
                );

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    modelUsed.id,
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
