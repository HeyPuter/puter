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

import Groq from 'groq-sdk';
import { ChatCompletionCreateParams } from 'groq-sdk/resources/chat/completions.mjs';
import { CompletionUsage } from 'openai/resources';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { GROQ_MODELS } from './models.js';
import { modelLookupNames } from '../../utils/modelRouting.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import { meterChatUsage } from '../../utils/meterChatUsage.js';

export class GroqAIProvider implements IChatProvider {
    #client: Groq;

    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        this.#client = new Groq({
            apiKey: config.apiKey,
            // groq-sdk's own default timeout.
            ...sdkClientOptions(60_000),
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return 'openai/gpt-oss-20b';
    }

    models() {
        return GROQ_MODELS;
    }

    async list() {
        return modelLookupNames(this.models());
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string): string {
        return `groq:${modelId}`;
    }

    async complete({
        messages,
        model,
        stream,
        tools,
        max_tokens,
        temperature,
    }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);
        for (const message of messages) {
            if (message.tool_calls && Array.isArray(message.content)) {
                message.content = '';
            }
        }

        const completion = await this.#client.chat.completions.create(
            {
                messages,
                model: modelUsed.id,
                stream,
                tools,
                max_completion_tokens: max_tokens,
                temperature,
            } as ChatCompletionCreateParams,
            { signal: Context.get('abortSignal') },
        );

        return OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: (chunk: unknown) =>
                    // x_groq contains usage details for streamed responses
                    (chunk as { x_groq?: { usage?: CompletionUsage } }).x_groq
                        ?.usage,
            },
            usage_calculator: ({ usage, setUsageCosts }) => {
                const metered = meterChatUsage(
                    this.#meteringService,
                    actor,
                    this.meteringModelKey(modelUsed.id),
                    modelUsed,
                    OpenAIUtil.splitCachedPrompt(usage),
                );
                setUsageCosts(metered.costs);
                return metered.usage;
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
