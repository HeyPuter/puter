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

import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — sibling JS module without an adjacent .d.ts
import {
    create_chat_stream_handler,
    create_chat_stream_handler_responses_api,
    create_usage_calculator,
    extractMeteredUsage,
    handle_completion_output,
    handle_completion_output_responses_api,
    process_input_messages,
    process_input_messages_responses_api,
} from './OpenAIUtil.js';
// @ts-expect-error — sibling JS module without an adjacent .d.ts
import { AIChatStream } from './Streaming.js';

// ── Stream test harness ─────────────────────────────────────────────
//
// These stream handlers (and AIChatStream itself) write
// newline-delimited JSON into a Writable. Tests use a real
// `AIChatStream` wired to a buffering Writable, then parse the
// captured chunks back out so assertions can inspect the live
// shape — no method spies on the stream classes.

const makeCapturingChatStream = () => {
    const chunks: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
    });
    const chatStream = new AIChatStream({ stream: sink });
    return {
        chatStream,
        events: () =>
            chunks
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
    };
};

const asAsyncIterable = <T>(items: T[]): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
        for (const item of items) {
            yield item;
        }
    },
});

// ── process_input_messages ──────────────────────────────────────────

describe('process_input_messages', () => {
    it('infers `image_url` and `video_url` types when missing', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'user',
                content: [
                    { image_url: 'https://cdn.test/a.png' },
                    { video_url: 'https://cdn.test/a.mp4' },
                    { type: 'text', text: 'hello' },
                ],
            },
        ];

        const result = (await process_input_messages(messages)) as Array<
            Record<string, unknown>
        >;
        const content = (result[0]!.content ?? []) as Array<
            Record<string, unknown>
        >;
        expect(content[0]?.type).toBe('image_url');
        expect(content[1]?.type).toBe('video_url');
        // Existing typed blocks are left alone.
        expect(content[2]?.type).toBe('text');
    });

    it('hoists tool_use blocks into top-level tool_calls and clears content', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'call_1',
                        name: 'lookup',
                        input: { q: 'puter' },
                    },
                ],
            },
        ];

        const [out] = (await process_input_messages(messages)) as Array<
            Record<string, unknown>
        >;
        // tool_calls flipped to OpenAI shape; content is null when this
        // message was originally just a tool call.
        expect(out!.content).toBeNull();
        expect(out!.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: {
                    name: 'lookup',
                    // input is JSON-stringified for the OpenAI wire format.
                    arguments: JSON.stringify({ q: 'puter' }),
                },
            },
        ]);
    });

    it('preserves extra_content on hoisted tool calls', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'call_2',
                        name: 'lookup',
                        input: {},
                        extra_content: { hint: 'metadata' },
                    },
                ],
            },
        ];

        const [out] = (await process_input_messages(messages)) as Array<
            Record<string, unknown>
        >;
        const calls = out!.tool_calls as Array<Record<string, unknown>>;
        expect(calls[0]?.extra_content).toEqual({ hint: 'metadata' });
    });

    it('coerces tool_result blocks into a top-level tool message', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call_1',
                        content: 'result body',
                    },
                ],
            },
        ];

        const [out] = (await process_input_messages(messages)) as Array<
            Record<string, unknown>
        >;
        expect(out!.role).toBe('tool');
        expect(out!.tool_call_id).toBe('call_1');
        expect(out!.content).toBe('result body');
    });

    it('skips messages with falsy or non-object content', async () => {
        const messages = [
            { role: 'system', content: 'hello' },
            { role: 'user', content: null },
        ];
        const out = (await process_input_messages(messages)) as Array<
            Record<string, unknown>
        >;
        // Strings + null are passed through unchanged.
        expect(out[0]?.content).toBe('hello');
        expect(out[1]?.content).toBeNull();
    });
});

// ── process_input_messages_responses_api ────────────────────────────

describe('process_input_messages_responses_api', () => {
    it('rewrites tool messages into function_call_output', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'tool',
                tool_call_id: 'call_1',
                content: 'tool said hi',
            },
        ];

        const [out] = (await process_input_messages_responses_api(
            messages,
        )) as Array<Record<string, unknown>>;
        expect(out!.type).toBe('function_call_output');
        expect(out!.call_id).toBe('call_1');
        expect(out!.output).toBe('tool said hi');
        // Original tool-shape fields are stripped.
        expect(out!.role).toBeUndefined();
        expect(out!.content).toBeUndefined();
        expect(out!.tool_call_id).toBeUndefined();
    });

    it('serializes complex tool content into the output string', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'tool',
                tool_call_id: 'call_1',
                content: [
                    { text: 'part-a' },
                    'part-b',
                    { content: 'part-c' },
                ],
            },
        ];

        const [out] = (await process_input_messages_responses_api(
            messages,
        )) as Array<Record<string, unknown>>;
        expect(out!.output).toBe('part-apart-bpart-c');
    });

    it('upgrades user/system text blocks to input_text', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
            },
            {
                role: 'system',
                content: [{ type: 'text', text: 'sys' }],
            },
        ];

        const out = (await process_input_messages_responses_api(
            messages,
        )) as Array<Record<string, unknown>>;
        const userBlocks = out[0]!.content as Array<Record<string, unknown>>;
        const sysBlocks = out[1]!.content as Array<Record<string, unknown>>;
        expect(userBlocks[0]?.type).toBe('input_text');
        expect(sysBlocks[0]?.type).toBe('input_text');
    });

    it('upgrades assistant text blocks to output_text', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'assistant',
                content: [{ type: 'text', text: 'hi from gpt' }],
            },
        ];
        const out = (await process_input_messages_responses_api(
            messages,
        )) as Array<Record<string, unknown>>;
        const blocks = out[0]!.content as Array<Record<string, unknown>>;
        expect(blocks[0]?.type).toBe('output_text');
    });

    it('hoists a single assistant tool_use into a top-level function_call', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'call_1',
                        canonical_id: 'fc_1',
                        name: 'lookup',
                        input: { q: 'puter' },
                    },
                ],
            },
        ];

        const [out] = (await process_input_messages_responses_api(
            messages,
        )) as Array<Record<string, unknown>>;
        expect(out!.type).toBe('function_call');
        expect(out!.call_id).toBe('call_1');
        expect(out!.id).toBe('fc_1');
        expect(out!.name).toBe('lookup');
        expect(out!.arguments).toBe(JSON.stringify({ q: 'puter' }));
        expect(out!.role).toBeUndefined();
        expect(out!.content).toBeUndefined();
    });

    it('rewrites tool_result blocks into function_call_output', async () => {
        const messages: Array<Record<string, unknown>> = [
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call_1',
                        content: 'result',
                    },
                ],
            },
        ];

        const [out] = (await process_input_messages_responses_api(
            messages,
        )) as Array<Record<string, unknown>>;
        expect(out!.type).toBe('function_call_output');
        expect(out!.call_id).toBe('call_1');
        expect(out!.output).toBe('result');
    });
});

// ── create_usage_calculator ─────────────────────────────────────────

describe('create_usage_calculator', () => {
    it('emits prompt + completion token rows priced by model_details.cost', () => {
        const calc = create_usage_calculator({
            model_details: {
                id: 'gpt-test',
                cost: { input: 0.01, output: 0.02 },
            },
        });
        const tokens = calc({
            usage: { prompt_tokens: 100, completion_tokens: 50 },
        });
        expect(tokens).toEqual([
            {
                type: 'prompt',
                model: 'gpt-test',
                amount: 100,
                cost: 100 * 0.01,
            },
            {
                type: 'completion',
                model: 'gpt-test',
                amount: 50,
                cost: 50 * 0.02,
            },
        ]);
    });
});

// ── extractMeteredUsage ─────────────────────────────────────────────

describe('extractMeteredUsage', () => {
    it('extracts prompt/completion/cached counts with safe defaults', () => {
        expect(
            extractMeteredUsage({
                prompt_tokens: 10,
                completion_tokens: 5,
                prompt_tokens_details: { cached_tokens: 3 },
            }),
        ).toEqual({
            prompt_tokens: 10,
            completion_tokens: 5,
            cached_tokens: 3,
        });
    });

    it('defaults missing fields to 0', () => {
        expect(extractMeteredUsage({})).toEqual({
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
        });
    });
});

// ── create_chat_stream_handler ──────────────────────────────────────

describe('create_chat_stream_handler', () => {
    it('streams text deltas through to a `text` content block', async () => {
        const completion = asAsyncIterable([
            { choices: [{ delta: { content: 'hel' } }] },
            { choices: [{ delta: { content: 'lo' } }] },
            { choices: [{ delta: {} }], usage: { prompt_tokens: 1 } },
        ]);
        const init = create_chat_stream_handler({
            deviations: undefined,
            completion,
            usage_calculator: ({ usage }: { usage: unknown }) => ({
                forwarded: usage,
            }),
        });

        const harness = makeCapturingChatStream();
        await init({ chatStream: harness.chatStream });

        const events = harness.events();
        // Deltas land as separate text events.
        const textEvents = events.filter((e) => e.type === 'text');
        expect(textEvents.map((e) => e.text)).toEqual(['hel', 'lo']);
        // Final usage event uses the calculator output.
        const usageEvent = events.find((e) => e.type === 'usage');
        expect(usageEvent?.usage).toEqual({ forwarded: { prompt_tokens: 1 } });
    });

    it('emits a separate reasoning event for `reasoning_content`', async () => {
        const completion = asAsyncIterable([
            { choices: [{ delta: { reasoning_content: 'thinking…' } }] },
            { choices: [{ delta: { content: 'done' } }] },
            { choices: [{ delta: {} }], usage: { prompt_tokens: 1 } },
        ]);
        const init = create_chat_stream_handler({
            deviations: undefined,
            completion,
            usage_calculator: () => ({}),
        });
        const harness = makeCapturingChatStream();
        await init({ chatStream: harness.chatStream });

        const events = harness.events();
        expect(events.some((e) => e.type === 'reasoning')).toBe(true);
        const reasoning = events.find((e) => e.type === 'reasoning');
        expect(reasoning?.reasoning).toBe('thinking…');
    });

    it('builds a tool_use block from streamed function-call deltas', async () => {
        const completion = asAsyncIterable([
            {
                choices: [
                    {
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    id: 'call_1',
                                    function: {
                                        name: 'lookup',
                                        arguments: '{"q":',
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
            {
                choices: [
                    {
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    function: { arguments: '"puter"}' },
                                },
                            ],
                        },
                    },
                ],
            },
            { choices: [{ delta: {} }], usage: { prompt_tokens: 2 } },
        ]);
        const init = create_chat_stream_handler({
            deviations: undefined,
            completion,
            usage_calculator: () => ({}),
        });
        const harness = makeCapturingChatStream();
        await init({ chatStream: harness.chatStream });

        const events = harness.events();
        const toolEvent = events.find((e) => e.type === 'tool_use');
        expect(toolEvent).toBeDefined();
        expect(toolEvent?.id).toBe('call_1');
        expect(toolEvent?.name).toBe('lookup');
        // Buffered partial-JSON is parsed once on `.end()`.
        expect(toolEvent?.input).toEqual({ q: 'puter' });
    });

    it('honors the deviations.chunk_but_like_actually unwrap', async () => {
        // Mistral wraps each chunk under `.data`.
        const completion = asAsyncIterable([
            { data: { choices: [{ delta: { content: 'hi' } }] } },
            {
                data: {
                    choices: [{ delta: {} }],
                    usage: { prompt_tokens: 1 },
                },
            },
        ]);
        const init = create_chat_stream_handler({
            deviations: {
                chunk_but_like_actually: (
                    chunk: { data: Record<string, unknown> },
                ) => chunk.data,
            },
            completion,
            usage_calculator: ({ usage }: { usage: unknown }) => usage,
        });
        const harness = makeCapturingChatStream();
        await init({ chatStream: harness.chatStream });

        const events = harness.events();
        expect(events.some((e) => e.type === 'text' && e.text === 'hi')).toBe(
            true,
        );
        const usage = events.find((e) => e.type === 'usage');
        expect(usage?.usage).toEqual({ prompt_tokens: 1 });
    });
});

// ── create_chat_stream_handler_responses_api ────────────────────────

describe('create_chat_stream_handler_responses_api', () => {
    it('streams text from response.output_text.delta chunks', async () => {
        const completion = asAsyncIterable([
            { type: 'response.output_text.delta', delta: 'hel' },
            { type: 'response.output_text.delta', delta: 'lo' },
            {
                type: 'response.completed',
                response: { usage: { input_tokens: 1, output_tokens: 2 } },
            },
        ]);
        const init = create_chat_stream_handler_responses_api({
            deviations: undefined,
            completion,
            usage_calculator: ({ usage }: { usage: unknown }) => ({
                forwarded: usage,
            }),
        });
        const harness = makeCapturingChatStream();
        await init({ chatStream: harness.chatStream });

        const events = harness.events();
        const textEvents = events.filter((e) => e.type === 'text');
        expect(textEvents.map((e) => e.text)).toEqual(['hel', 'lo']);
        const usage = events.find((e) => e.type === 'usage');
        expect(usage?.usage).toEqual({
            forwarded: { input_tokens: 1, output_tokens: 2 },
        });
    });

    it('emits a tool_use block when a function_call output_item completes', async () => {
        const completion = asAsyncIterable([
            {
                type: 'response.output_item.done',
                item: {
                    type: 'function_call',
                    id: 'fc_1',
                    call_id: 'call_1',
                    name: 'lookup',
                    arguments: '{"q":"puter"}',
                },
            },
            {
                type: 'response.completed',
                response: { usage: { input_tokens: 1, output_tokens: 2 } },
            },
        ]);
        const init = create_chat_stream_handler_responses_api({
            deviations: undefined,
            completion,
            usage_calculator: () => ({}),
        });
        const harness = makeCapturingChatStream();
        await init({ chatStream: harness.chatStream });

        const events = harness.events();
        const tool = events.find((e) => e.type === 'tool_use');
        expect(tool).toBeDefined();
        expect(tool?.id).toBe('call_1');
        expect(tool?.canonical_id).toBe('fc_1');
        expect(tool?.name).toBe('lookup');
        expect(tool?.input).toEqual({ q: 'puter' });
    });
});

// ── handle_completion_output (non-stream) ───────────────────────────

describe('handle_completion_output non-stream', () => {
    it('returns the first choice with usage from the calculator', async () => {
        const completion = {
            choices: [
                {
                    message: { content: 'hello there' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
        const result = await handle_completion_output({
            deviations: undefined,
            stream: false,
            completion,
            moderate: undefined,
            usage_calculator: ({ usage }: { usage: unknown }) => ({
                forwarded: usage,
            }),
            finally_fn: undefined,
        });
        expect(result.message.content).toBe('hello there');
        expect(result.usage).toEqual({
            forwarded: { prompt_tokens: 10, completion_tokens: 5 },
        });
    });

    it('falls back to a raw input/output token shape when no calculator', async () => {
        const completion = {
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
        };
        const result = await handle_completion_output({
            deviations: undefined,
            stream: false,
            completion,
        });
        expect(result.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
    });

    it('throws 400 when moderation flags the completion text', async () => {
        const completion = {
            choices: [{ message: { content: 'banned content' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        };
        const moderate = vi.fn(async () => ({ flagged: true }));
        await expect(
            handle_completion_output({
                deviations: undefined,
                stream: false,
                completion,
                moderate,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(moderate).toHaveBeenCalledWith('banned content');
    });

    it('skips moderation when the completion content is null', async () => {
        const completion = {
            choices: [{ message: { content: null } }],
            usage: { prompt_tokens: 1, completion_tokens: 0 },
        };
        const moderate = vi.fn(async () => ({ flagged: true }));
        const result = await handle_completion_output({
            deviations: undefined,
            stream: false,
            completion,
            moderate,
        });
        expect(moderate).not.toHaveBeenCalled();
        expect(result.message.content).toBeNull();
    });

    it('runs `finally_fn` before returning on the non-stream path', async () => {
        const completion = {
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        };
        const finally_fn = vi.fn(async () => {});
        await handle_completion_output({
            deviations: undefined,
            stream: false,
            completion,
            finally_fn,
        });
        expect(finally_fn).toHaveBeenCalled();
    });

    it('returns a stream init descriptor when stream=true (does not call finally_fn yet)', async () => {
        const completion = asAsyncIterable([]);
        const finally_fn = vi.fn(async () => {});
        const result = await handle_completion_output({
            deviations: undefined,
            stream: true,
            completion,
            finally_fn,
        });
        expect(result.stream).toBe(true);
        expect(typeof result.init_chat_stream).toBe('function');
        // finally_fn is forwarded for the caller to invoke after streaming.
        expect(result.finally_fn).toBe(finally_fn);
        expect(finally_fn).not.toHaveBeenCalled();
    });

    it('honors deviations.coerce_completion_usage (Mistral shape)', async () => {
        const completion = {
            choices: [{ message: { content: 'ok' } }],
            // Mistral wraps usage in a wrapper object — coerce drills in.
            wrapper: { prompt_tokens: 7, completion_tokens: 3 },
        };
        const result = await handle_completion_output({
            deviations: {
                coerce_completion_usage: (
                    c: { wrapper: Record<string, unknown> },
                ) => c.wrapper,
            },
            stream: false,
            completion,
        });
        expect(result.usage).toEqual({ input_tokens: 7, output_tokens: 3 });
    });
});

// ── handle_completion_output_responses_api (non-stream) ─────────────

describe('handle_completion_output_responses_api non-stream', () => {
    it('shapes responses.output_text into a v1 chat-completion message', async () => {
        const completion = {
            output: [{ role: 'assistant', type: 'message' }],
            output_text: 'hi',
            usage: { input_tokens: 1, output_tokens: 2 },
        };
        const result = await handle_completion_output_responses_api({
            deviations: undefined,
            stream: false,
            completion,
        });
        expect(result.finish_reason).toBe('stop');
        expect(result.message.content).toBe('hi');
        expect(result.role).toBe('assistant');
        expect(result.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
        // Sanity: no leftover `type` field bleeds into the response.
        expect(result.type).toBeUndefined();
    });

    it('surfaces tool_calls from output[type=function_call] entries', async () => {
        const completion = {
            output: [
                {
                    type: 'function_call',
                    id: 'fc_1',
                    call_id: 'call_1',
                    name: 'lookup',
                    arguments: '{"q":"puter"}',
                },
            ],
            output_text: '',
            usage: { input_tokens: 1, output_tokens: 2 },
        };
        const result = await handle_completion_output_responses_api({
            deviations: undefined,
            stream: false,
            completion,
        });
        expect(result.message.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"puter"}' },
                canonical_id: 'fc_1',
            },
        ]);
    });

    it('throws 400 when output_text is empty AND there are no tool calls', async () => {
        const completion = {
            output: [],
            output_text: '   ',
            usage: { input_tokens: 1, output_tokens: 0 },
        };
        await expect(
            handle_completion_output_responses_api({
                deviations: undefined,
                stream: false,
                completion,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('runs moderation against output_text when a moderate fn is supplied', async () => {
        const completion = {
            output: [{ role: 'assistant' }],
            output_text: 'questionable content',
            usage: { input_tokens: 1, output_tokens: 2 },
        };
        const moderate = vi.fn(async () => ({ flagged: true }));
        await expect(
            handle_completion_output_responses_api({
                deviations: undefined,
                stream: false,
                completion,
                moderate,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(moderate).toHaveBeenCalledWith('questionable content');
    });

    it('returns a stream init descriptor when stream=true', async () => {
        const completion = asAsyncIterable([]);
        const result = await handle_completion_output_responses_api({
            deviations: undefined,
            stream: true,
            completion,
        });
        expect(result.stream).toBe(true);
        expect(typeof result.init_chat_stream).toBe('function');
    });
});
