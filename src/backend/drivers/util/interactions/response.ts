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

import type { Interactions } from '@google/genai';
import { HttpError } from '../../../core/http/HttpError.js';
import type {
    IOpenAIChunk,
    IOpenAICompletion,
    IOpenAIMessage,
    IOpenAIToolCall,
    IOpenAIUsage,
} from './types.js';

/**
 * Gemini Interactions response -> OpenAI chat-completions response.
 *
 * The inverse of `request.ts`. Both the buffered object and the SSE stream are
 * translated, so `handle_completion_output` and `create_chat_stream_handler`
 * consume an Interactions upstream without modification.
 */

/**
 * Whether `usage.total_output_tokens` counts thought tokens separately from
 * generated output — the long-standing meaning of Gemini's
 * `candidatesTokenCount`.
 *
 * OpenAI's convention is the opposite: `completion_tokens` is inclusive of
 * `reasoning_tokens`, and every downstream calculator in this repo subtracts
 * the reasoning back out. So under Gemini's meaning the adapter has to add the
 * thoughts in, or the subtraction bills thinking twice and generation not at
 * all. Getting this backwards is a silent billing error in one direction or the
 * other, which is why it is one named constant with a test rather than an
 * inline `+`. The companion integration test asserts it against a live thinking
 * response; flip it there, not here, if Google's meaning changes.
 */
export const INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS = true;

/** Interactions `Usage` -> the OpenAI `usage` shape metering already reads. */
export const interactionUsageToOpenAI = (
    usage?: Interactions.Usage,
): IOpenAIUsage => {
    const input = usage?.total_input_tokens ?? 0;
    const output = usage?.total_output_tokens ?? 0;
    const thoughts = usage?.total_thought_tokens ?? 0;
    const cached = usage?.total_cached_tokens ?? 0;

    const completion = INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS
        ? output + thoughts
        : output;

    return {
        prompt_tokens: input,
        completion_tokens: completion,
        total_tokens: usage?.total_tokens ?? input + completion,
        prompt_tokens_details: { cached_tokens: cached },
        completion_tokens_details: { reasoning_tokens: thoughts },
        tool_use_tokens: usage?.total_tool_use_tokens ?? 0,
        // Grounding is billed per invocation. The OpenAI-compat shim only lets
        // a provider infer "grounding happened"; here we get the real count.
        grounding_requests: (usage?.grounding_tool_count ?? []).reduce(
            (total, entry) => total + (entry.count ?? 0),
            0,
        ),
    };
};

const thoughtText = (content: Interactions.ThoughtContent): string =>
    (content.summary ?? [])
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('');

const toToolCall = (
    content: Interactions.FunctionCallContent,
): IOpenAIToolCall => ({
    id: content.id,
    type: 'function',
    function: {
        name: content.name,
        arguments: JSON.stringify(content.arguments ?? {}),
    },
    // Gemini rejects a replayed tool call whose thought signature was dropped,
    // so it round-trips through the channel the pipeline already forwards.
    ...(content.signature
        ? { extra_content: { signature: content.signature } }
        : {}),
});

const epochSeconds = (iso?: string): number => {
    const parsed = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(parsed)
        ? Math.floor(parsed / 1000)
        : Math.floor(Date.now() / 1000);
};

/**
 * A terminal status is the upstream telling us it produced nothing usable.
 * Surfaced as a 4xx/5xx rather than an empty completion so the driver's
 * fallback loop can route around it instead of serving the caller a blank.
 */
const assertUsableStatus = (interaction: Interactions.Interaction): void => {
    if (interaction.status === 'failed') {
        throw new HttpError(502, 'Gemini interaction failed', {
            legacyCode: 'bad_response',
        });
    }
    if (interaction.status === 'cancelled') {
        throw new HttpError(499, 'Gemini interaction was cancelled', {
            legacyCode: 'bad_request',
        });
    }
};

export interface IPartitionedOutputs {
    text: string;
    reasoning: string;
    toolCalls: IOpenAIToolCall[];
    /** Everything chat-completions has no field for: media, search results. */
    extra: Interactions.Content[];
    annotations: unknown[];
}

/** Split `interaction.outputs` into the chat-completions message fields. */
export const partitionOutputs = (
    outputs: Interactions.Content[] = [],
): IPartitionedOutputs => {
    const partitioned: IPartitionedOutputs = {
        text: '',
        reasoning: '',
        toolCalls: [],
        extra: [],
        annotations: [],
    };

    for (const output of outputs) {
        switch (output.type) {
            case 'text':
                partitioned.text += output.text;
                if (output.annotations?.length) {
                    partitioned.annotations.push(...output.annotations);
                }
                break;
            case 'thought':
                partitioned.reasoning += thoughtText(output);
                break;
            case 'function_call':
                partitioned.toolCalls.push(toToolCall(output));
                break;
            default:
                partitioned.extra.push(output);
        }
    }

    return partitioned;
};

const buildExtraContent = (
    partitioned: IPartitionedOutputs,
): Record<string, unknown> | undefined => {
    const extra: Record<string, unknown> = {};
    if (partitioned.extra.length) extra.outputs = partitioned.extra;
    if (partitioned.annotations.length) {
        extra.annotations = partitioned.annotations;
    }
    return Object.keys(extra).length ? extra : undefined;
};

/** Buffered `Interaction` -> OpenAI `ChatCompletion`. */
export const interactionToCompletion = (
    interaction: Interactions.Interaction,
    { model }: { model: string },
): IOpenAICompletion => {
    assertUsableStatus(interaction);

    const partitioned = partitionOutputs(interaction.outputs);
    const extraContent = buildExtraContent(partitioned);

    const message: IOpenAIMessage = {
        role: 'assistant',
        // Null rather than '' when the turn was purely a tool call: the
        // moderation gate skips null and would otherwise scan an empty string.
        content:
            partitioned.text === '' && partitioned.toolCalls.length
                ? null
                : partitioned.text,
        reasoning: partitioned.reasoning || null,
        refusal: null,
        ...(partitioned.toolCalls.length
            ? { tool_calls: partitioned.toolCalls }
            : {}),
        ...(extraContent ? { extra_content: extraContent } : {}),
    };

    const finish_reason = partitioned.toolCalls.length
        ? 'tool_calls'
        : interaction.status === 'incomplete'
          ? 'length'
          : 'stop';

    return {
        id: interaction.id,
        object: 'chat.completion',
        created: epochSeconds(interaction.created),
        model: interaction.model ?? model,
        choices: [{ index: 0, message, finish_reason }],
        usage: interactionUsageToOpenAI(interaction.usage),
    };
};

interface IStreamBlock {
    type: string;
    toolCall?: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        signature?: string;
    };
}

/**
 * SSE `InteractionSSEEvent` stream -> OpenAI `ChatCompletion.Chunk` stream.
 *
 * Text and thought summaries forward as they arrive. Tool calls are held until
 * their `content.stop`: the stream handler accumulates arguments per tool-call
 * index with `addPartialJSON`, so emitting one index twice concatenates two
 * complete JSON objects into an unparseable buffer. Interactions delivers whole
 * arguments per delta rather than a partial-JSON drip, so there is nothing to
 * gain by forwarding early and a broken tool call to lose.
 */
export async function* interactionStreamToChunks(
    events: AsyncIterable<Interactions.InteractionSSEEvent>,
    { model }: { model: string },
): AsyncGenerator<IOpenAIChunk> {
    const blocks = new Map<number, IStreamBlock>();
    let id = '';
    let created = Math.floor(Date.now() / 1000);
    let resolvedModel = model;
    let toolCallOrdinal = 0;

    const chunk = (
        delta: IOpenAIChunk['choices'][number]['delta'],
        finish_reason: string | null = null,
    ): IOpenAIChunk => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model: resolvedModel,
        choices: [{ index: 0, delta, finish_reason }],
    });

    for await (const event of events) {
        switch (event.event_type) {
            case 'interaction.start':
                id = event.interaction.id;
                created = epochSeconds(event.interaction.created);
                resolvedModel = event.interaction.model ?? model;
                break;

            case 'content.start':
                blocks.set(event.index, { type: event.content.type });
                if (event.content.type === 'function_call') {
                    blocks.set(event.index, {
                        type: 'function_call',
                        toolCall: {
                            id: event.content.id,
                            name: event.content.name,
                            arguments: event.content.arguments ?? {},
                            signature: event.content.signature,
                        },
                    });
                }
                break;

            case 'content.delta': {
                const { delta } = event;
                if (delta.type === 'text') {
                    yield chunk({ content: delta.text });
                } else if (delta.type === 'thought_summary') {
                    const text =
                        delta.content?.type === 'text'
                            ? delta.content.text
                            : '';
                    if (text) yield chunk({ reasoning: text });
                } else if (delta.type === 'function_call') {
                    blocks.set(event.index, {
                        type: 'function_call',
                        toolCall: {
                            id: delta.id,
                            name: delta.name,
                            arguments: delta.arguments ?? {},
                            signature: delta.signature,
                        },
                    });
                } else if (
                    delta.type === 'image' ||
                    delta.type === 'video' ||
                    delta.type === 'audio'
                ) {
                    yield chunk({ extra_content: { output: delta } });
                }
                break;
            }

            case 'content.stop': {
                const block = blocks.get(event.index);
                blocks.delete(event.index);
                if (!block?.toolCall) break;
                yield chunk({
                    tool_calls: [
                        {
                            index: toolCallOrdinal++,
                            id: block.toolCall.id,
                            type: 'function',
                            function: {
                                name: block.toolCall.name,
                                arguments: JSON.stringify(
                                    block.toolCall.arguments,
                                ),
                            },
                            ...(block.toolCall.signature
                                ? {
                                      extra_content: {
                                          signature: block.toolCall.signature,
                                      },
                                  }
                                : {}),
                        },
                    ],
                });
                break;
            }

            case 'interaction.complete':
                assertUsableStatus(event.interaction);
                // Choices are empty on purpose: the stream handler reads usage
                // off any chunk and skips ones that carry no choice.
                yield {
                    id: event.interaction.id || id,
                    object: 'chat.completion.chunk',
                    created,
                    model: resolvedModel,
                    choices: [],
                    usage: interactionUsageToOpenAI(event.interaction.usage),
                };
                break;

            case 'error':
                throw new HttpError(
                    502,
                    event.error?.message ?? 'Gemini interaction stream failed',
                    { legacyCode: 'bad_response' },
                );

            default:
                break;
        }
    }

    // A stream that ended without a closing `content.stop` still produced a
    // tool call the caller was billed for; emitting it late beats dropping it.
    for (const [index, block] of blocks) {
        if (!block.toolCall) continue;
        blocks.delete(index);
        yield chunk({
            tool_calls: [
                {
                    index: toolCallOrdinal++,
                    id: block.toolCall.id,
                    type: 'function',
                    function: {
                        name: block.toolCall.name,
                        arguments: JSON.stringify(block.toolCall.arguments),
                    },
                },
            ],
        });
    }
}
