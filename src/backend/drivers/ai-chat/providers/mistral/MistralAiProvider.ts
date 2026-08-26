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

import { Mistral } from '@mistralai/mistralai';
import { ChatCompletionResponse } from '@mistralai/mistralai/models/components/chatcompletionresponse.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IChatCompleteResult,
    IChatProvider,
    ICompleteArguments,
} from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { MISTRAL_MODELS } from './models.js';
import { modelLookupNames } from '../../utils/modelRouting.js';

// Mistral's finish reasons mapped to the OpenAI vocabulary; values without
// an OpenAI analog (e.g. `error`) pass through unmapped.
const MISTRAL_FINISH_REASON_MAP: Record<string, string> = {
    stop: 'stop',
    length: 'length',
    model_length: 'length',
    tool_calls: 'tool_calls',
};

export class MistralAIProvider implements IChatProvider {
    #client: Mistral;

    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        this.#client = new Mistral({
            apiKey: config.apiKey,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return 'mistral-small-2603';
    }

    async models() {
        return MISTRAL_MODELS;
    }

    async list() {
        return modelLookupNames(await this.models());
    }

    /**
     * Mistral's API expects `image_url` content parts to carry a plain string
     * URL, not the OpenAI-style `{ url: string }` object. This method
     * normalises any `{ type: 'image_url', image_url: { url } }` parts to `{
     * type: 'image_url', image_url: url }` before the request is sent. Messages
     * whose `content` is a plain string are left untouched.
     */
    #coerceImageUrls(
        messages: { role: string; content: unknown }[],
    ): { role: string; content: unknown }[] {
        return messages.map((message) => {
            if (!Array.isArray(message.content)) return message;
            const content = message.content.map(
                (part: { type?: string; image_url?: unknown }) => {
                    if (
                        part.type === 'image_url' &&
                        part.image_url !== null &&
                        typeof part.image_url === 'object' &&
                        'url' in (part.image_url as object)
                    ) {
                        return {
                            ...part,
                            image_url: (part.image_url as { url: string }).url,
                        };
                    }
                    return part;
                },
            );
            return { ...message, content };
        });
    }

    async complete({
        messages,
        stream,
        model,
        tools,
        max_tokens,
        temperature,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        messages = await OpenAIUtil.process_input_messages(messages);
        messages = this.#coerceImageUrls(messages);
        for (const message of messages) {
            if (message.tool_calls) {
                message.toolCalls = message.tool_calls;
                delete message.tool_calls;
            }
            if (message.tool_call_id) {
                message.toolCallId = message.tool_call_id;
                delete message.tool_call_id;
            }
        }

        const selectedModel =
            (await this.models()).find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) ||
            (await this.models()).find((m) => m.id === this.getDefaultModel())!;
        const actor = Context.get('actor');
        const completion = await this.#client.chat[
            stream ? 'stream' : 'complete'
        ]({
            model: selectedModel.id,
            ...(tools ? { tools: tools as any[] } : {}),
            messages,
            maxTokens: max_tokens,
            temperature,
        });

        // The Mistral SDK speaks camelCase (`finishReason`, `toolCalls`,
        // object-typed `arguments`); remap each choice to the OpenAI wire
        // shape so the result matches every other provider's.
        if (!stream) {
            const choices =
                (completion as ChatCompletionResponse).choices ?? [];
            for (const choice of choices as unknown as Record<
                string,
                unknown
            >[]) {
                if (
                    choice.finish_reason === undefined &&
                    typeof choice.finishReason === 'string'
                ) {
                    choice.finish_reason =
                        MISTRAL_FINISH_REASON_MAP[choice.finishReason] ??
                        choice.finishReason;
                }
                delete choice.finishReason;
                const message = choice.message as
                    | (Record<string, unknown> & {
                          toolCalls?: {
                              id?: string;
                              function?: { name?: string; arguments?: unknown };
                          }[];
                      })
                    | undefined;
                if (
                    message &&
                    message.tool_calls === undefined &&
                    Array.isArray(message.toolCalls)
                ) {
                    message.tool_calls = message.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.function?.name,
                            arguments:
                                typeof tc.function?.arguments === 'string'
                                    ? tc.function.arguments
                                    : JSON.stringify(
                                          tc.function?.arguments ?? {},
                                      ),
                        },
                    }));
                }
                if (message) delete message.toolCalls;
            }
        }

        return await OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: (chunk: {
                    usage?: Record<string, number>;
                }) => {
                    if (!chunk.usage) return;

                    const snake_usage: Record<string, number> = {};
                    for (const key in chunk.usage) {
                        const snakeKey = key
                            .replace(/([A-Z])/g, '_$1')
                            .toLowerCase();
                        snake_usage[snakeKey] = chunk.usage[key]!;
                    }

                    return snake_usage;
                },
                chunk_but_like_actually: (chunk: unknown) =>
                    (chunk as any).data,
                index_tool_calls_from_stream_choice: (choice: {
                    delta?: unknown;
                }) => (choice.delta as any).toolCalls,
                coerce_completion_usage: (
                    completion: ChatCompletionResponse,
                ) => ({
                    prompt_tokens: completion.usage.promptTokens,
                    completion_tokens: completion.usage.completionTokens,
                }),
            },
            completion: completion as ChatCompletionResponse,
            stream,
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverrideFromModel = Object.fromEntries(
                    Object.entries(trackedUsage).map(([k, v]) => {
                        return [k, v * selectedModel.costs[k]];
                    }),
                );
                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    `mistral:${selectedModel.id}`,
                    costsOverrideFromModel,
                );
                return trackedUsage;
            },
        });
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
