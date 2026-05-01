/**
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

// Preamble: Before this we used Gemini's SDK directly and as we found out
// its actually kind of terrible. So we use the openai sdk now
import openai, { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import {
    handle_completion_output,
    process_input_messages,
} from '../../utils/OpenAIUtil.js';
import { GEMINI_MODELS } from './models.js';

export class GeminiChatProvider implements IChatProvider {
    meteringService: MeteringService;
    openai: OpenAI;

    defaultModel = 'gemini-2.5-flash';

    constructor(meteringService: MeteringService, config: { apiKey: string }) {
        this.meteringService = meteringService;
        this.openai = new openai.OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });
    }

    getDefaultModel() {
        return this.defaultModel;
    }

    async models() {
        return GEMINI_MODELS;
    }
    async list() {
        return (await this.models())
            .map((m) => [m.id, ...(m.aliases || [])])
            .flat();
    }

    async complete({
        messages,
        stream,
        model,
        tools,
        max_tokens,
        temperature,
    }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        messages = await process_input_messages(messages);

        // delete cache_control
        messages = messages.map((m) => {
            delete m.cache_control;
            return m;
        });

        const modelUsed =
            (await this.models()).find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) ||
            (await this.models()).find((m) => m.id === this.getDefaultModel())!;
        const sdk_params: ChatCompletionCreateParams = {
            messages: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
        } as ChatCompletionCreateParams;

        let completion;
        try {
            completion = await this.openai.chat.completions.create(sdk_params);
        } catch (e) {
            console.error('Gemini completion error: ', e);
            throw e;
        }

        return handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens:
                        (usage.prompt_tokens ?? 0) -
                        (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens:
                        usage.prompt_tokens_details?.cached_tokens ?? 0,
                };

                const costsOverrideFromModel = Object.fromEntries(
                    Object.entries(trackedUsage).map(([k, v]) => {
                        return [k, v * modelUsed.costs[k]];
                    }),
                );
                this.meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    `gemini:${modelUsed?.id}`,
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
        throw new Error('No moderation logic.');
    }
}
