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
import { BYTEPLUS_MODELS } from './models.js';
import { modelLookupNames } from '../../utils/modelRouting.js';

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
        return modelLookupNames(this.models());
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string): string {
        return `byteplus:${modelId}`;
    }

    async complete(
        params: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const { custom, max_tokens, stream, temperature, tools, top_p } =
            params;
        let { messages, model } = params;
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        messages = OpenAIUtil.toOpenAIChatMessages(messages);
        messages = await OpenAIUtil.process_input_messages(messages);

        const mappedTools = tools
            ? make_openai_tools(tools, { dialect: 'chat' })
            : undefined;
        const customParams = asRecord(custom) as BytePlusCustomParams;

        const completionParams: ChatCompletionCreateParams = {
            messages,
            model: modelUsed.id,
            ...(mappedTools?.length ? { tools: mappedTools } : {}),
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
            ...openAICompatParams({ ...params, tools: mappedTools }, 'chat'),
        } as unknown as ChatCompletionCreateParams;

        const completion = await this.#openai.chat.completions.create(
            completionParams,
            { signal: Context.get('abortSignal') },
        );

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
                    this.meteringModelKey(modelUsed.id),
                    costsOverride,
                );
                return trackedUsage;
            },
            stream,
            completion,
        });

        return result;
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
