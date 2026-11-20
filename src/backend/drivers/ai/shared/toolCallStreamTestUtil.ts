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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Vendor streams that answer with two tool calls in one turn, in each wire
 * format a chat provider reads: Chat Completions, Responses and Anthropic.
 */

import type { UpstreamReply } from './fuzzTestUtil.js';

export interface StreamedToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export type SseEvents = NonNullable<UpstreamReply['sse']>;

/** One entry of a Chat Completions chunk's `delta.tool_calls`. */
export type ChatToolCallDelta = Record<string, unknown>;

export const STREAMED_TOOL_CALLS: readonly StreamedToolCall[] = [
    {
        id: 'call_weather',
        name: 'get_weather',
        input: { city: 'Paris', units: { temp: 'C', wind: ['kph', 'm/s'] } },
    },
    {
        id: 'call_notes',
        name: 'search_notes',
        input: { query: 'say "hi"\n\tback\\slash é 🚀', limit: 2 },
    },
];

/**
 * A call's arguments as JSON text in three pieces. When the text has an escape,
 * the first cut lands inside it, between the `\` and what it escapes.
 */
export const argumentPieces = (call: StreamedToolCall): string[] => {
    const text = JSON.stringify(call.input);
    const backslash = text.indexOf('\\');
    const first = backslash >= 0 ? backslash + 1 : Math.floor(text.length / 3);
    const second = Math.max(first + 1, Math.floor((text.length * 2) / 3));
    return [
        text.slice(0, first),
        text.slice(first, second),
        text.slice(second),
    ];
};

/**
 * Each chunk's `delta.tool_calls`, shaped as OpenAI streams them: a call's
 * first delta carries its `index`, `id` and name, and the rest only `index`.
 * Interleaved, the calls' pieces alternate instead of following each other.
 */
export const chatToolCallDeltas = (options: {
    interleave: boolean;
}): ChatToolCallDelta[][] => {
    const perCall = STREAMED_TOOL_CALLS.map((call, index) =>
        argumentPieces(call).map((piece, n): ChatToolCallDelta =>
            n === 0
                ? {
                      index,
                      id: call.id,
                      type: 'function',
                      function: { name: call.name, arguments: piece },
                  }
                : { index, function: { arguments: piece } },
        ),
    );
    const ordered = options.interleave
        ? perCall[0].flatMap((_, n) => perCall.map((pieces) => pieces[n]))
        : perCall.flat();
    return ordered.map((delta) => [delta]);
};

const chatUsage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 };
const chatChunk = (delta: object, finish: string | null) => ({
    id: 'chatcmpl-tools',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
});

/** A Chat Completions stream with one chunk per entry of `deltas`. */
export const chatCompletionsToolStream = (
    deltas: ChatToolCallDelta[][],
): SseEvents => [
    { data: chatChunk({ role: 'assistant' }, null) },
    ...deltas.map((toolCalls) => ({
        data: chatChunk({ tool_calls: toolCalls }, null),
    })),
    { data: chatChunk({}, 'tool_calls') },
    { data: { ...chatChunk({}, null), choices: [], usage: chatUsage } },
    { data: '[DONE]' },
];

const responsesItem = (call: StreamedToolCall, n: number, done: boolean) => ({
    type: 'function_call',
    id: `fc_${n}`,
    call_id: call.id,
    name: call.name,
    arguments: done ? JSON.stringify(call.input) : '',
    status: done ? 'completed' : 'in_progress',
});

/** An OpenAI Responses stream that calls both tools, one after the other. */
export const responsesToolStream = (): SseEvents => {
    const response = {
        id: 'resp_tools',
        object: 'response',
        model: 'm',
    };
    const events: Record<string, unknown>[] = [
        {
            type: 'response.created',
            response: { ...response, status: 'in_progress', output: [] },
        },
    ];
    STREAMED_TOOL_CALLS.forEach((call, n) => {
        const item_id = `fc_${n}`;
        events.push(
            {
                type: 'response.output_item.added',
                output_index: n,
                item: responsesItem(call, n, false),
            },
            ...argumentPieces(call).map((delta) => ({
                type: 'response.function_call_arguments.delta',
                item_id,
                output_index: n,
                delta,
            })),
            {
                type: 'response.function_call_arguments.done',
                item_id,
                output_index: n,
                arguments: JSON.stringify(call.input),
            },
            {
                type: 'response.output_item.done',
                output_index: n,
                item: responsesItem(call, n, true),
            },
        );
    });
    events.push({
        type: 'response.completed',
        response: {
            ...response,
            status: 'completed',
            output: STREAMED_TOOL_CALLS.map((call, n) =>
                responsesItem(call, n, true),
            ),
            usage: {
                input_tokens: 3,
                output_tokens: 5,
                total_tokens: 8,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
            },
        },
    });
    return events.map((data) => ({ event: data.type as string, data }));
};

/** An Anthropic Messages stream with one `tool_use` block per call. */
export const anthropicToolStream = (): SseEvents => {
    const events: Record<string, unknown>[] = [
        {
            type: 'message_start',
            message: {
                id: 'msg_tools',
                type: 'message',
                role: 'assistant',
                model: 'm',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 3, output_tokens: 1 },
            },
        },
    ];
    STREAMED_TOOL_CALLS.forEach((call, index) => {
        events.push(
            {
                type: 'content_block_start',
                index,
                content_block: {
                    type: 'tool_use',
                    id: call.id,
                    name: call.name,
                    input: {},
                },
            },
            ...argumentPieces(call).map((partial_json) => ({
                type: 'content_block_delta',
                index,
                delta: { type: 'input_json_delta', partial_json },
            })),
            { type: 'content_block_stop', index },
        );
    });
    events.push(
        {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
    );
    return events.map((data) => ({ event: data.type as string, data }));
};
