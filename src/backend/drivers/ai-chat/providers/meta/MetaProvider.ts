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
import { META_MODELS } from './models.js';

export class MetaProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    constructor(
        config: { apiKey: string; apiBaseUrl?: string },
        meteringService: MeteringService,
    ) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl || 'https://api.meta.ai/v1',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return 'meta:muse-spark-1.2';
    }

    models() {
        return META_MODELS;
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
        max_tokens,
        temperature,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        const modelIdForParams = modelUsed.id.startsWith('meta:')
            ? modelUsed.id.slice('meta:'.length)
            : modelUsed.id;

        messages = await OpenAIUtil.process_input_messages(messages);
        let completion;
        try {
            completion = await this.#openai.chat.completions.create({
                messages,
                model: modelIdForParams,
                ...(tools ? { tools } : {}),
                max_tokens,
                temperature,
                stream,
                ...(stream
                    ? {
                          stream_options: { include_usage: true },
                      }
                    : {}),
            } as ChatCompletionCreateParams);
        } catch (e) {
            console.log('Meta API completion error: ', e);
            throw e;
        }

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const inputKey =
                    (modelUsed.input_cost_key as string) || 'prompt_tokens';
                const outputKey =
                    (modelUsed.output_cost_key as string) ||
                    'completion_tokens';

                const costsOverride = {
                    prompt_tokens:
                        (trackedUsage.prompt_tokens ?? 0) *
                        Number(modelUsed.costs[inputKey] ?? 0),
                    completion_tokens:
                        (trackedUsage.completion_tokens ?? 0) *
                        Number(modelUsed.costs[outputKey] ?? 0),
                    cached_tokens:
                        (trackedUsage.cached_tokens ?? 0) *
                        Number(modelUsed.costs.cached_tokens ?? 0),
                };

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
