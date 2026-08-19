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

/**
 * The adapter's contract is "the existing chat-completions pipeline cannot tell
 * the difference", so the streaming tests here run translated chunks through
 * the real `create_chat_stream_handler` rather than asserting on chunk shapes a
 * hand-written fake would happily accept.
 */

import type { Interactions } from '@google/genai';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { create_chat_stream_handler } from '../../ai-chat/utils/OpenAIUtil.js';
import { AIChatStream } from '../../ai-chat/utils/Streaming.js';
import {
    INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS,
    interactionStreamToChunks,
    interactionToCompletion,
    interactionUsageToOpenAI,
} from './response.js';

const MODEL = 'gemini-3.5-flash';

const interaction = (
    overrides: Partial<Interactions.Interaction> = {},
): Interactions.Interaction => ({
    id: 'int_1',
    created: '2026-08-19T00:00:00Z',
    updated: '2026-08-19T00:00:01Z',
    status: 'completed',
    model: MODEL,
    ...overrides,
});

const drain = async (
    events: Interactions.InteractionSSEEvent[],
): Promise<{
    chunks: unknown[];
    usage: Record<string, number> | undefined;
}> => {
    async function* source() {
        for (const event of events) yield event;
    }
    const chunks: unknown[] = [];
    for await (const chunk of interactionStreamToChunks(source(), {
        model: MODEL,
    })) {
        chunks.push(chunk);
    }
    return { chunks, usage: undefined };
};

/** Run translated chunks through the production stream handler. */
const runStreamHandler = async (
    events: Interactions.InteractionSSEEvent[],
): Promise<Record<string, unknown>[]> => {
    async function* source() {
        for (const event of events) yield event;
    }

    const written: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            written.push(chunk.toString('utf8'));
            cb();
        },
    });
    const chatStream = new AIChatStream({ stream: sink });

    await create_chat_stream_handler({
        completion: interactionStreamToChunks(source(), { model: MODEL }),
        usage_calculator: ({ usage }: { usage: Record<string, number> }) =>
            usage,
    })({ chatStream });

    return written
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
};

describe('interactionUsageToOpenAI', () => {
    it('folds thought tokens into completion_tokens for the OpenAI convention', () => {
        // The whole point of the constant: downstream calculators subtract
        // reasoning back out, so it has to be in there to begin with.
        expect(INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS).toBe(true);

        const usage = interactionUsageToOpenAI({
            total_input_tokens: 100,
            total_output_tokens: 40,
            total_thought_tokens: 25,
            total_cached_tokens: 10,
        });

        expect(usage.prompt_tokens).toBe(100);
        expect(usage.completion_tokens).toBe(65);
        expect(usage.completion_tokens_details.reasoning_tokens).toBe(25);
        expect(usage.prompt_tokens_details.cached_tokens).toBe(10);
    });

    it('survives an upstream that reports no usage at all', () => {
        const usage = interactionUsageToOpenAI(undefined);
        expect(usage.prompt_tokens).toBe(0);
        expect(usage.completion_tokens).toBe(0);
        expect(usage.grounding_requests).toBe(0);
    });

    it('sums grounding invocations into a real request count', () => {
        const usage = interactionUsageToOpenAI({
            grounding_tool_count: [
                { type: 'google_search', count: 2 },
                { type: 'google_maps', count: 1 },
            ],
        });
        expect(usage.grounding_requests).toBe(3);
    });
});

describe('interactionToCompletion', () => {
    it('produces a chat-completions choice from text output', () => {
        const completion = interactionToCompletion(
            interaction({
                outputs: [{ type: 'text', text: 'hello there' }],
                usage: { total_input_tokens: 5, total_output_tokens: 2 },
            }),
            { model: MODEL },
        );

        expect(completion.choices[0]).toMatchObject({
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'hello there' },
        });
        expect(completion.usage.prompt_tokens).toBe(5);
    });

    it('joins thought summaries into reasoning', () => {
        const completion = interactionToCompletion(
            interaction({
                outputs: [
                    {
                        type: 'thought',
                        summary: [{ type: 'text', text: 'thinking...' }],
                    },
                    { type: 'text', text: 'answer' },
                ],
            }),
            { model: MODEL },
        );

        expect(completion.choices[0].message.reasoning).toBe('thinking...');
        expect(completion.choices[0].message.content).toBe('answer');
    });

    it('reports tool calls with stringified arguments and finish_reason', () => {
        const completion = interactionToCompletion(
            interaction({
                outputs: [
                    {
                        type: 'function_call',
                        id: 'call_1',
                        name: 'get_weather',
                        arguments: { city: 'Zagreb' },
                        signature: 'sig',
                    },
                ],
            }),
            { model: MODEL },
        );

        expect(completion.choices[0].finish_reason).toBe('tool_calls');
        expect(completion.choices[0].message.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: {
                    name: 'get_weather',
                    arguments: '{"city":"Zagreb"}',
                },
                extra_content: { signature: 'sig' },
            },
        ]);
        // Null, not '', so the moderation gate skips a tool-only turn.
        expect(completion.choices[0].message.content).toBeNull();
    });

    it('routes generated media to extra_content instead of content', () => {
        const completion = interactionToCompletion(
            interaction({
                outputs: [
                    { type: 'text', text: 'here you go' },
                    { type: 'image', uri: 'https://example.com/a.png' },
                ],
            }),
            { model: MODEL },
        );

        expect(completion.choices[0].message.content).toBe('here you go');
        expect(completion.choices[0].message.extra_content).toEqual({
            outputs: [{ type: 'image', uri: 'https://example.com/a.png' }],
        });
    });

    it("maps an incomplete interaction to finish_reason 'length'", () => {
        const completion = interactionToCompletion(
            interaction({
                status: 'incomplete',
                outputs: [{ type: 'text', text: 'truncated' }],
            }),
            { model: MODEL },
        );
        expect(completion.choices[0].finish_reason).toBe('length');
    });

    it('raises rather than serving an empty completion for a failed interaction', () => {
        expect(() =>
            interactionToCompletion(interaction({ status: 'failed' }), {
                model: MODEL,
            }),
        ).toThrow(/failed/i);
    });
});

describe('interactionStreamToChunks', () => {
    it('forwards text deltas as chat-completions content', async () => {
        const events = await runStreamHandler([
            { event_type: 'interaction.start', interaction: interaction() },
            {
                event_type: 'content.delta',
                index: 0,
                delta: { type: 'text', text: 'Hel' },
            },
            {
                event_type: 'content.delta',
                index: 0,
                delta: { type: 'text', text: 'lo' },
            },
            {
                event_type: 'interaction.complete',
                interaction: interaction({
                    usage: { total_input_tokens: 3, total_output_tokens: 2 },
                }),
            },
        ]);

        const text = events
            .filter((e) => e.type === 'text')
            .map((e) => e.text)
            .join('');
        expect(text).toBe('Hello');

        const usage = events.find((e) => e.type === 'usage');
        expect(usage?.usage).toMatchObject({ prompt_tokens: 3 });
    });

    it('surfaces thought summaries as reasoning chunks', async () => {
        const events = await runStreamHandler([
            { event_type: 'interaction.start', interaction: interaction() },
            {
                event_type: 'content.delta',
                index: 0,
                delta: {
                    type: 'thought_summary',
                    content: { type: 'text', text: 'pondering' },
                },
            },
            {
                event_type: 'interaction.complete',
                interaction: interaction({ usage: {} }),
            },
        ]);

        expect(events.some((e) => e.reasoning === 'pondering')).toBe(true);
    });

    it('emits a tool call once, at content.stop, with parseable arguments', async () => {
        const events = await runStreamHandler([
            { event_type: 'interaction.start', interaction: interaction() },
            {
                event_type: 'content.start',
                index: 0,
                content: {
                    type: 'function_call',
                    id: 'call_1',
                    name: 'get_weather',
                    arguments: {},
                },
            },
            {
                event_type: 'content.delta',
                index: 0,
                delta: {
                    type: 'function_call',
                    id: 'call_1',
                    name: 'get_weather',
                    arguments: { city: 'Zagreb' },
                },
            },
            { event_type: 'content.stop', index: 0 },
            {
                event_type: 'interaction.complete',
                interaction: interaction({ usage: {} }),
            },
        ]);

        // Two emissions would concatenate two JSON objects in the handler's
        // per-index buffer and blow up on parse.
        const toolUse = events.filter((e) => e.type === 'tool_use');
        expect(toolUse).toHaveLength(1);
        expect(toolUse[0]).toMatchObject({
            id: 'call_1',
            name: 'get_weather',
            input: { city: 'Zagreb' },
        });
    });

    it('indexes parallel tool calls independently', async () => {
        const events = await runStreamHandler([
            { event_type: 'interaction.start', interaction: interaction() },
            {
                event_type: 'content.delta',
                index: 0,
                delta: {
                    type: 'function_call',
                    id: 'call_1',
                    name: 'a',
                    arguments: { n: 1 },
                },
            },
            {
                event_type: 'content.delta',
                index: 1,
                delta: {
                    type: 'function_call',
                    id: 'call_2',
                    name: 'b',
                    arguments: { n: 2 },
                },
            },
            { event_type: 'content.stop', index: 0 },
            { event_type: 'content.stop', index: 1 },
            {
                event_type: 'interaction.complete',
                interaction: interaction({ usage: {} }),
            },
        ]);

        expect(
            events
                .filter((e) => e.type === 'tool_use')
                .map((e) => [e.name, e.input]),
        ).toEqual([
            ['a', { n: 1 }],
            ['b', { n: 2 }],
        ]);
    });

    it('throws on an error event rather than ending the stream quietly', async () => {
        await expect(
            drain([
                { event_type: 'interaction.start', interaction: interaction() },
                {
                    event_type: 'error',
                    error: { code: 'x', message: 'upstream exploded' },
                },
            ]),
        ).rejects.toThrow('upstream exploded');
    });
});
