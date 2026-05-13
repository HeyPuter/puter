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
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import type {
    IChatProvider,
    ICompleteArguments,
    IChatCompleteResult,
} from '../../types.js';
import { inlineHttpImageUrls } from './imageHandling.js';
import { MOONSHOT_MODELS } from './models.js';

export class MoonshotProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.moonshot.ai/v1',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return 'kimi-k2.6';
    }

    models() {
        return MOONSHOT_MODELS;
    }

    async list() {
        const models = this.models();
        const modelNames: string[] = [];
        for (const model of models) {
            modelNames.push(model.id);
            if (model.aliases) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }

    async complete({
        messages,
        stream,
        model,
        tools,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        // Moonshot's vision API doesn't fetch http(s) URLs; inline them
        // so callers can pass plain links like other vision providers.
        if (modelUsed.modalities?.input?.includes('image')) {
            await inlineHttpImageUrls(messages);
        }

        messages = await OpenAIUtil.process_input_messages(messages);
        let completion;
        try {
            completion = await this.#openai.chat.completions.create({
                messages,
                model: modelUsed.id,
                ...(tools ? { tools } : {}),
                max_tokens: 1000,
                stream,
                ...(stream
                    ? {
                          stream_options: { include_usage: true },
                      }
                    : {}),
            } as ChatCompletionCreateParams);
        } catch (e) {
            console.log('Moonshot AI process_input_messages error: ', e);
            throw e;
        }

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(
                    Object.entries(trackedUsage).map(([key, value]) => {
                        return [key, value * modelUsed.costs[key]];
                    }),
                );
                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    `moonshotai:${modelUsed.id}`,
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
