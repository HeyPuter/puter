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
import { MINIMAX_MODELS } from './models.js';

type MiniMaxConfig = {
    apiKey: string;
    apiBaseUrl?: string;
};

export class MiniMaxProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #defaultModel = 'minimax-m2.7';

    constructor(config: MiniMaxConfig, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl ?? 'https://api.minimax.io/v1',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    models() {
        return MINIMAX_MODELS;
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

    async complete({
        messages,
        stream,
        model,
        tools,
        tool_choice,
        max_tokens,
        temperature,
        top_p,
    }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);
        const requestedMaxTokens = max_tokens ?? 1000;

        const completion = await this.#openai.chat.completions.create({
            messages,
            model: modelUsed.apiModel,
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            max_tokens: Math.min(requestedMaxTokens, modelUsed.max_tokens),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
            stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
        } as ChatCompletionCreateParams);

        return OpenAIUtil.handle_completion_output({
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
                    `minimax:${modelUsed.id}`,
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
