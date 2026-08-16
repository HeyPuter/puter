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
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { BYTEPLUS_MODELS } from './models.js';

type BytePlusConfig = {
    apiKey: string;
    apiBaseUrl?: string;
};

type BytePlusCustomParams = {
    response_format?: unknown;
    stop?: string[];
    // Ark-specific toggle for deep reasoning; the seed models reason by
    // default and route those tokens to `reasoning_content`.
    thinking?: {
        type?: 'enabled' | 'disabled' | 'auto';
    };
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * BytePlus ModelArk provider — an OpenAI-compatible endpoint serving
 * ByteDance's Seed models plus hosted third-party models (GLM, DeepSeek,
 * GPT-OSS). https://docs.byteplus.com/en/docs/ModelArk/1330626
 */
export class BytePlusProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #defaultModel = 'seed-2-0-lite-260428';

    constructor(config: BytePlusConfig, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL:
                config.apiBaseUrl ??
                'https://ark.ap-southeast.bytepluses.com/api/v3',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    models() {
        return BYTEPLUS_MODELS;
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
            stream,
            temperature,
            tools,
            tool_choice,
            top_p,
        } = params;
        let { messages, model } = params;
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);
        messages = messages.map((message) => {
            delete message.cache_control;
            return message;
        });

        const customParams = asRecord(custom) as BytePlusCustomParams;

        const completionParams: ChatCompletionCreateParams = {
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            ...(max_tokens !== undefined ? { max_tokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            ...(customParams.response_format
                ? { response_format: customParams.response_format }
                : {}),
            ...(customParams.stop ? { stop: customParams.stop } : {}),
            ...(customParams.thinking
                ? { thinking: customParams.thinking }
                : {}),
            stream: !!stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openai.chat.completions.create(completionParams);

        const result = await OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = usage
                    ? OpenAIUtil.extractMeteredUsage(usage)
                    : {
                          prompt_tokens: 0,
                          completion_tokens: 0,
                          cached_tokens: 0,
                      };
                const costsOverride = Object.fromEntries(
                    Object.entries(trackedUsage).map(([key, value]) => {
                        return [key, value * Number(modelUsed.costs[key] ?? 0)];
                    }),
                );
                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor!,
                    `byteplus:${modelUsed.id}`,
                    costsOverride,
                );
                return trackedUsage;
            },
            stream,
            completion,
        });

        // Ark's deep-reasoning models return `reasoning_content` (DeepSeek
        // wire convention); expose it under `reasoning` like other providers.
        OpenAIUtil.normalizeReasoningContent(result);
        return result;
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
