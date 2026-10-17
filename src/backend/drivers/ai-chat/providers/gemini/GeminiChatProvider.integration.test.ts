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
 * Integration test for the Gemini chat provider.
 *
 * Hits the real Google Gemini API with `gemini-3.7-flash` (one of the cheapest
 * variants). Skipped when `PUTER_TEST_AI_GEMINI_API_KEY` is unset.
 */

import { Writable } from 'node:stream';
import axios from 'axios';
import { setupPuterTestEnv } from '../../../../testUtil.js';
import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import type {
    ICompleteArguments,
    IChatMessageResult,
    UsageDetails,
} from '../../types.js';
import { normalize_messages } from '../../utils/Messages.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { GeminiChatProvider } from './GeminiChatProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_GEMINI_API_KEY';

/** The reported output breakdown matches the tokens that were billed. */
const expectBilledOutput = (
    usage: Record<string, number>,
    details: UsageDetails | undefined,
) => {
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(details?.outputTokens).toBe(
        usage.completion_tokens + usage.thinking_tokens,
    );
    expect(details?.reasoningTokens).toBe(usage.thinking_tokens);
};

/** Runs a streamed result through `AIChatStream` and returns its events. */
const collectStream = async (result: unknown) => {
    const lines: string[] = [];
    const chatStream = new AIChatStream({
        stream: new Writable({
            write(chunk, _enc, cb) {
                lines.push(chunk.toString('utf8'));
                cb();
            },
        }),
    });
    await withTestActor(() =>
        (
            result as {
                init_chat_stream: (p: {
                    chatStream: AIChatStream;
                }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream }),
    );
    const events = lines
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    return { events, chatStream };
};

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'GeminiChatProvider (integration)',
    () => {
        it(
            'returns a non-empty completion from gemini-3.7-flash',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = new GeminiChatProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                );

                const result = await withTestActor(() =>
                    provider.complete({
                        model: 'gemini-3.7-flash',
                        messages: [
                            { role: 'user', content: 'Say hi in one word.' },
                        ],
                        max_tokens: 256,
                    }),
                );

                const text = (result as { message?: { content?: string } })
                    .message?.content;
                expect(typeof text === 'string' && text.length > 0).toBe(true);
            },
        );

    },
);

// Four requests in all. Assertions never print responses or signatures.
describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'GeminiChatProvider native Flash models (integration)',
    () => {
        const restored = (model: string, args: Partial<ICompleteArguments>) =>
            withTestActor(() =>
                new GeminiChatProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                ).complete({
                    model,
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    reasoning_effort: 'high',
                    // Thinking counts against the cap; leave room for it.
                    max_tokens: 2048,
                    ...args,
                } as ICompleteArguments),
            );

        it.each([
            'google/gemini-3.1-flash-lite',
            'google/gemini-3-flash-preview',
        ])(
            'answers %s at high thinking with explicit thought usage',
            async (model) => {
                const result = (await restored(
                    model,
                    {},
                )) as IChatMessageResult;

                const text = result.message.content;
                expect(typeof text).toBe('string');
                expect((text as string).trim().length).toBeGreaterThan(0);
                expect(result.usageDetails?.reasoningTokens).toBeGreaterThan(0);
                expectBilledOutput(result.usage, result.usageDetails);
            },
            INTEGRATION_TEST_TIMEOUT_MS,
        );

        it.each([
            'google/gemini-3.1-flash-lite',
            'google/gemini-3-flash-preview',
        ])(
            'streams %s with a final explicit thought usage report',
            async (model) => {
                const { events, chatStream } = await collectStream(
                    await restored(model, { stream: true }),
                );
                const usageLine = events.find((e) => e.type === 'usage');
                expect(events.some((e) => e.type === 'text')).toBe(true);
                expect(chatStream.reportedUsage).not.toBeNull();
                expect(usageLine.usageDetails.reasoningTokens).toBeGreaterThan(
                    0,
                );
                expectBilledOutput(usageLine.usage, usageLine.usageDetails);
            },
            INTEGRATION_TEST_TIMEOUT_MS,
        );
    },
);

// Seven requests in all. Assertions never print signatures or the key.
describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'GeminiChatProvider gemini-4-argon (integration)',
    () => {
        const provider = () =>
            new GeminiChatProvider(
                { apiKey: optionalEnv(ENV_VAR)! },
                makeMeteringStub(),
            );

        const argon = (args: Partial<ICompleteArguments>) =>
            withTestActor(() =>
                provider().complete({
                    model: 'gemini-4-argon',
                    messages: [
                        {
                            role: 'user',
                            content: 'Reply with the single word OK.',
                        },
                    ],
                    // Thinking counts against the cap; leave room for it.
                    max_tokens: 8192,
                    ...args,
                } as ICompleteArguments),
            );

        it.each(['low', 'medium', 'high'] as const)(
            'answers at thinking level %s with explicit usage',
            async (effort) => {
                const result = (await argon({
                    reasoning_effort: effort,
                })) as IChatMessageResult;
                expect(typeof result.message.content).toBe('string');
                expectBilledOutput(result.usage, result.usageDetails);
            },
            INTEGRATION_TEST_TIMEOUT_MS,
        );

        it(
            'streams with a final explicit usage report',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const { events, chatStream } = await collectStream(
                    await argon({ stream: true, reasoning_effort: 'low' }),
                );
                const usageLine = events.find((e) => e.type === 'usage');
                expect(events.some((e) => e.type === 'text')).toBe(true);
                expect(chatStream.reportedUsage).not.toBeNull();
                expectBilledOutput(usageLine.usage, usageLine.usageDetails);
            },
        );

        it(
            'reads a small inline image',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                // A 5x5 red dot.
                const redDot =
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
                const result = (await argon({
                    reasoning_effort: 'low',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: 'What color is this image? Answer with one word.',
                                },
                                {
                                    type: 'image_url',
                                    image_url: { url: redDot },
                                },
                            ],
                        },
                    ],
                })) as IChatMessageResult;
                expect(String(result.message.content)).toMatch(/red/i);
            },
        );

        it(
            'round-trips a forced tool call with its thought signature',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const tools = [
                    {
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            description: 'Current weather for a city',
                            parameters: {
                                type: 'object',
                                properties: { city: { type: 'string' } },
                                required: ['city'],
                            },
                        },
                    },
                ];
                const question = {
                    role: 'user',
                    content: 'What is the weather in Paris?',
                };
                const first = (await argon({
                    reasoning_effort: 'low',
                    tools,
                    tool_choice: { type: 'tool', name: 'get_weather' },
                    messages: [question],
                })) as IChatMessageResult;
                const calls = first.message.tool_calls as Array<{
                    id: string;
                    extra_content?: { google?: { thought_signature?: string } };
                }>;
                expect(calls?.length).toBeGreaterThan(0);
                const signature =
                    calls[0]!.extra_content?.google?.thought_signature;
                expect(
                    typeof signature === 'string' && signature.length > 0,
                ).toBe(true);

                // Google rejects a follow-up whose call lost its signature.
                const second = (await argon({
                    reasoning_effort: 'low',
                    tools,
                    messages: normalize_messages([
                        question,
                        first.message,
                        ...calls.map((call) => ({
                            role: 'tool',
                            tool_call_id: call.id,
                            content: '18C and sunny',
                        })),
                    ]),
                })) as IChatMessageResult;
                expect(String(second.message.content).length).toBeGreaterThan(
                    0,
                );
            },
        );
    },
);

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'Argon authenticated HTTP (integration)',
    () => {
        it(
            'completes through the public driver route',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const env = await setupPuterTestEnv({
                    providers: {
                        gemini: { apiKey: optionalEnv(ENV_VAR)! },
                        ollama: { enabled: false },
                    },
                    unlimitedMetering: true,
                    extensions: [],
                });
                try {
                    const endpoint = new URL('/drivers/call', env.apiOrigin);
                    const host = endpoint.host;
                    endpoint.hostname = '127.0.0.1';
                    const response = await axios.request({
                        url: endpoint.toString(),
                        validateStatus: () => true,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${env.users.user.apiToken}`,
                            Origin: env.apiOrigin,
                            Host: host,
                        },
                        data: {
                            interface: 'puter-chat-completion',
                            method: 'complete',
                            args: {
                                model: 'gemini-4-argon',
                                messages: [
                                    {
                                        role: 'user',
                                        content: 'Reply with exactly OK.',
                                    },
                                ],
                                reasoning_effort: 'low',
                                max_tokens: 256,
                            },
                        },
                    });
                    expect(response.status).toBe(200);
                    const body = response.data;
                    expect(JSON.stringify(body)).toContain('OK');
                } finally {
                    await env.shutdown();
                }
            },
        );
    },
);
