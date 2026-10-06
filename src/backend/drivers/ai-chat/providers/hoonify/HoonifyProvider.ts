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
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import { make_openai_tools } from '../../utils/FunctionCalling.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { openAICompatParams } from '../../utils/openaiParams.js';
import { HOONIFY_MODELS } from './models.js';

type HoonifyConfig = {
    apiBaseUrl?: string;
    apiKey: string;
};

type HoonifyCustomParams = {
    top_k?: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * Chat provider for Hoonify (https://hoonify.ai) — open-weights inference
 * behind an OpenAI-compatible API at https://api.hoonify.ai/v1.
 */
export class HoonifyProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #defaultModel = 'hoonify:google/gemma-4-31b-it';

    constructor(config: HoonifyConfig, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl ?? 'https://api.hoonify.ai/v1',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    models() {
        return HOONIFY_MODELS;
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

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string): string {
        return modelId;
    }

    async complete(
        params: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const { custom, max_tokens, stream, temperature, tools, top_p } =
            params;
        let { messages } = params;
        const { model } = params;
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        // Anthropic-style shape (cache_control, thinking/server-tool blocks)
        // is not part of Hoonify's OpenAI-compatible surface — drop it rather
        // than risk a 400.
        messages = OpenAIUtil.toOpenAIChatMessages(messages);
        messages = await OpenAIUtil.process_input_messages(messages);

        const mappedTools = tools
            ? make_openai_tools(tools, { dialect: 'chat' })
            : undefined;
        const customParams = asRecord(custom) as HoonifyCustomParams;

        const completionParams: ChatCompletionCreateParams = {
            messages,
            model: modelUsed.wireId,
            ...(mappedTools?.length ? { tools: mappedTools } : {}),
            ...(max_tokens !== undefined ? { max_tokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            // Hoonify extension: sample from the top-k logits.
            ...(customParams.top_k !== undefined
                ? { top_k: customParams.top_k }
                : {}),
            stream: !!stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
            ...openAICompatParams({ ...params, tools: mappedTools }, 'chat', {
                only: ['tool_choice'],
            }),
        } as unknown as ChatCompletionCreateParams;

        const completion = await this.#openai.chat.completions.create(
            completionParams,
            { signal: Context.get('abortSignal') },
        );

        return await OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = usage
                    ? OpenAIUtil.extractMeteredUsage(usage)
                    : {
                          prompt_tokens: 0,
                          completion_tokens: 0,
                          cached_tokens: 0,
                      };
                const costsOverrideFromModel = Object.fromEntries(
                    Object.entries(trackedUsage).map(([key, value]) => {
                        return [key, value * Number(modelUsed.costs[key] ?? 0)];
                    }),
                );
                // `modelUsed.id` already carries the `hoonify:` namespace.
                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    this.meteringModelKey(modelUsed.id),
                    costsOverrideFromModel,
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
