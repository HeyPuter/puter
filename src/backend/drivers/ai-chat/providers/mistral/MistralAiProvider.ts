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
import { shouldPresentAsOpenAI } from '../../utils/normalizeToOpenAI.js';

/**
 * Mistral's reasoning models (`magistral-*`) return `content` as a chunk array
 * rather than a string, with the thinking text nested one level deeper inside
 * `thinking` chunks. Split it into the string content + `reasoning` string
 * every other provider produces. Text nested in a chunk is joined; a `thinking`
 * chunk's own chunks are flattened the same way, and separate thinking chunks
 * are separated by a blank line — the same separator the Responses summary
 * handler and the Anthropic coercer use.
 */
const flattenChunkText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value
        .map((chunk) => {
            if (typeof chunk === 'string') return chunk;
            const c = chunk as Record<string, unknown>;
            return typeof c?.text === 'string' ? c.text : '';
        })
        .join('');
};

const splitMistralContentChunks = (
    content: unknown[],
): { text: string; reasoning: string } => {
    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    for (const chunk of content) {
        if (typeof chunk === 'string') {
            textParts.push(chunk);
            continue;
        }
        const c = chunk as Record<string, unknown>;
        if (c?.type === 'thinking') {
            const thinking = flattenChunkText(c.thinking);
            if (thinking) reasoningParts.push(thinking);
            continue;
        }
        // Non-text chunks (`reference`, images) carry nothing to surface as
        // message content and are dropped, same as the Anthropic coercer.
        if (typeof c?.text === 'string') textParts.push(c.text);
    }
    return {
        text: textParts.join(''),
        reasoning: reasoningParts.join('\n\n'),
    };
};

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
        normalize,
        response,
        custom,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        // Mistral's reasoning prompt mode: with `prompt_mode: 'reasoning'`,
        // magistral models return their thinking as structured ThinkChunk
        // content (which the splitter below separates into `reasoning`)
        // instead of inlining it as answer prose. Opt-in passthrough rather
        // than a default because the API rejects it on accounts/models where
        // the mode is not enabled ('Reasoning prompt mode is not enabled for
        // this model', code 3051).
        const customParams =
            custom && typeof custom === 'object' && !Array.isArray(custom)
                ? (custom as { prompt_mode?: 'reasoning' | null })
                : {};
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
            ...(customParams.prompt_mode !== undefined
                ? { promptMode: customParams.prompt_mode }
                : {}),
            messages,
            maxTokens: max_tokens,
            temperature,
        });

        // The Mistral SDK speaks camelCase (`finishReason`, `toolCalls`,
        // object-typed `arguments`) and its reasoning models return chunked
        // `content`; remap each choice to the OpenAI wire shape so the result
        // matches every other provider's.
        //
        // This changes what the provider returns, so it sits behind the same
        // policy resolution the driver's coercer uses rather than firing on
        // every Mistral call — a caller reading the SDK's native
        // `finishReason`/`toolCalls` keys keeps seeing them unless it asked
        // for the equalized shape.
        //
        // Streaming is deliberately NOT gated on this, and the deviation below
        // is uniform in both directions: streamed chunks are provider-uniform
        // by design, and every other reasoning path in this repo routes
        // thinking to the `reasoning` channel unconditionally (ClaudeProvider's
        // thinking_delta, the DeepSeek/OpenRouter rename in
        // `create_chat_stream_handler`, the Responses summary-delta handler).
        // Gating it would make Mistral the only provider whose streamed chunk
        // *types* depend on a response-format flag.
        const presentAsOpenAI = shouldPresentAsOpenAI(
            { normalize, response },
            selectedModel.release_date,
        );
        if (!stream && presentAsOpenAI) {
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
                    // Dropped only once its value carried over. Deleting
                    // unconditionally left a choice with neither key when
                    // `finishReason` was not a string.
                    delete choice.finishReason;
                }
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
                if (message && Array.isArray(message.content)) {
                    const { text, reasoning } = splitMistralContentChunks(
                        message.content,
                    );
                    // Null content alongside tool calls is OpenAI's own
                    // convention for a tool-only turn.
                    message.content = text === '' ? null : text;
                    if (reasoning && message.reasoning === undefined) {
                        message.reasoning = reasoning;
                    }
                }
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
                // Mistral wraps each event; unwrap it, then split a
                // reasoning model's chunked `delta.content` into the two
                // channels the shared handler already understands: visible
                // text, and `reasoning`.
                //
                // Both halves are unconditional. Leaving the array on
                // `delta.content` would hand it to `addText` and reach the
                // caller as stringified objects, and putting the thinking text
                // into the visible channel would make this the only place in
                // the repo where chain-of-thought is answer text. So the split
                // matches every other provider and does not depend on the
                // normalize policy — streamed chunk types stay identical
                // whichever way that resolves.
                chunk_but_like_actually: (chunk: unknown) => {
                    const data = (chunk as { data?: unknown }).data as
                        | {
                              choices?: {
                                  delta?: Record<string, unknown>;
                              }[];
                          }
                        | undefined;
                    if (!data || !Array.isArray(data.choices)) return data;
                    for (const choice of data.choices) {
                        const delta = choice?.delta;
                        if (!delta || !Array.isArray(delta.content)) continue;
                        const { text, reasoning } = splitMistralContentChunks(
                            delta.content,
                        );
                        delta.content = text;
                        if (reasoning && delta.reasoning === undefined) {
                            delta.reasoning = reasoning;
                        }
                    }
                    return data;
                },
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
