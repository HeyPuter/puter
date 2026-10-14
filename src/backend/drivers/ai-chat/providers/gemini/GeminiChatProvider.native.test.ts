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
 * GeminiChatProvider models served over the native `generateContent` API. Boots
 * a real PuterServer so metering is recorded end to end; the Google and OpenAI
 * SDKs are mocked at the module boundary, which is the network egress.
 */

import { Writable } from 'node:stream';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import {
    readStreamResult,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { ChatCompletionDriver } from '../../ChatCompletionDriver.js';
import type { ICompleteArguments, UsageDetails } from '../../types.js';
import { normalize_messages } from '../../utils/Messages.js';
import { trackedOutputTokens } from '../../utils/pricing.js';
import { AIChatStream } from '../../utils/Streaming.js';
import {
    isUpstreamTimeoutError,
    UpstreamDeadlineError,
} from '../../../util/upstreamErrors.js';
import { GeminiChatProvider } from './GeminiChatProvider.js';
import { geminiNativeClient } from './geminiNative.js';
import { GEMINI_MODELS } from './models.js';

const { generateContent, generateContentStream, genAICtor, openAICreate } =
    vi.hoisted(() => ({
        generateContent: vi.fn(),
        generateContentStream: vi.fn(),
        genAICtor: vi.fn(),
        openAICreate: vi.fn(),
    }));

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        genAICtor(opts);
        this.models = { generateContent, generateContentStream };
    }),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.chat = { completions: { create: openAICreate } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    genAICtor.mockReset();
    openAICreate.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeProvider = (
    config: { apiKey: string; apiBaseUrl?: string } = { apiKey: 'test-key' },
) => new GeminiChatProvider(config, server.services.metering);

const ARGON = GEMINI_MODELS.find((m) => m.id === 'gemini-4-argon')!;
const LAUNCH = new Date('2026-10-14T12:00:00Z');
const NATIVE_IDS = [
    'gemini-4-argon',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
];

// The usage Google returned for a live gemini-4-argon "Say OK" request.
const LIVE_USAGE = {
    promptTokenCount: 36,
    candidatesTokenCount: 5,
    thoughtsTokenCount: 69,
    totalTokenCount: 110,
};

const textResponse = (text: string, usageMetadata: object = LIVE_USAGE) => ({
    candidates: [
        {
            content: { role: 'model', parts: [{ text }] },
            finishReason: 'STOP',
        },
    ],
    usageMetadata,
});

const WEATHER_TOOL = {
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
};

const toolCallResponse = (functionCall: Record<string, unknown>) => ({
    candidates: [
        {
            content: {
                role: 'model',
                parts: [{ functionCall, thoughtSignature: 'c2lnLTE=' }],
            },
            finishReason: 'STOP',
        },
    ],
    usageMetadata: LIVE_USAGE,
});

const asAsyncIterable = <T>(items: T[]): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
        for (const item of items) yield item;
    },
});

const complete = (args: Partial<ICompleteArguments>, pricingTime = LAUNCH) =>
    withTestActor(() =>
        makeProvider().complete(
            {
                model: 'gemini-4-argon',
                messages: [{ role: 'user', content: 'Say OK' }],
                ...args,
            } as ICompleteArguments,
            undefined,
            pricingTime,
        ),
    ) as Promise<Record<string, unknown>>;

const runStream = async (args: Partial<ICompleteArguments>) => {
    const result = await complete({ ...args, stream: true });
    const chunks: string[] = [];
    const chatStream = new AIChatStream({
        stream: new Writable({
            write(chunk, _enc, cb) {
                chunks.push(chunk.toString('utf8'));
                cb();
            },
        }),
    });
    await (
        result as {
            init_chat_stream: (p: {
                chatStream: AIChatStream;
            }) => Promise<void>;
        }
    ).init_chat_stream({ chatStream });
    const events = chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    return { events, chatStream };
};

const requestOf = (mock = generateContent) =>
    mock.mock.calls[0]![0] as {
        model: string;
        contents: unknown[];
        config: Record<string, unknown>;
    };

describe('gemini-4-argon catalog and routing', () => {
    it('lists Argon with its unified window and output cap', () => {
        expect(ARGON).toMatchObject({
            puterId: 'google:google/gemini-4-argon',
            context: 1_048_576,
            max_tokens: 65_536,
            modalities: { input: ['text', 'image'], output: ['text'] },
            tool_call: true,
        });
    });

    it('builds the native client once', () => {
        makeProvider();
        expect(genAICtor).toHaveBeenCalledTimes(1);
        expect(genAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('routes the alias to the native API under the canonical id', async () => {
        generateContent.mockResolvedValueOnce(textResponse('OK'));
        await complete({ model: 'google/gemini-4-argon' });

        expect(requestOf().model).toBe('gemini-4-argon');
        expect(openAICreate).not.toHaveBeenCalled();
        expect(recordSpy.mock.calls[0]![2]).toBe('gemini:gemini-4-argon');
    });

    it('keeps every other Gemini model on the OpenAI-compatible endpoint', async () => {
        openAICreate.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'hi' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                completion_tokens_details: { reasoning_tokens: 3 },
            },
        });
        const result = await complete({
            model: 'gemini-3.7-flash',
            reasoning_effort: 'xhigh',
        });

        expect(generateContent).not.toHaveBeenCalled();
        expect(openAICreate.mock.calls[0]![0]).not.toHaveProperty(
            'reasoning_effort',
        );
        expect(recordSpy.mock.calls[0]![0]).toEqual({
            prompt_tokens: 10,
            completion_tokens: 1,
            cached_tokens: 0,
            thinking_tokens: 3,
            grounding_requests: 0,
        });
        expect(result.usageDetails).toEqual({
            inputTokens: 10,
            outputTokens: 1,
        });
    });

    it.each([
        'https://generativelanguage.googleapis.com/v1beta/openai/',
        'https://generativelanguage.googleapis.com/v1beta/openai',
    ])('keeps Argon when apiBaseUrl is Google’s own %s', async (apiBaseUrl) => {
        const provider = makeProvider({ apiKey: 'test-key', apiBaseUrl });
        expect((await provider.models()).map((m) => m.id)).toContain(
            'gemini-4-argon',
        );
    });

    describe('with a custom apiBaseUrl', () => {
        const proxied = () =>
            makeProvider({
                apiKey: 'test-key',
                apiBaseUrl: 'https://gemini-proxy.test/v1beta/openai/',
            });

        it('leaves every native model out of the catalog and never builds the native client', async () => {
            const ids = (await proxied().models()).map((m) => m.id);
            for (const id of NATIVE_IDS) expect(ids).not.toContain(id);
            expect(ids).toContain('gemini-3.7-flash');
            expect(genAICtor).not.toHaveBeenCalled();
        });

        it.each(NATIVE_IDS)(
            'rejects %s without calling Google or the proxy',
            async (model) => {
                await expect(
                    withTestActor(() =>
                        proxied().complete({
                            model,
                            messages: [{ role: 'user', content: 'hi' }],
                        }),
                    ),
                ).rejects.toMatchObject({ statusCode: 400 });
                expect(generateContent).not.toHaveBeenCalled();
                expect(openAICreate).not.toHaveBeenCalled();
            },
        );

        it('still serves the other Gemini models through the proxy', async () => {
            openAICreate.mockResolvedValueOnce({
                choices: [
                    {
                        message: { role: 'assistant', content: 'hi' },
                        finish_reason: 'stop',
                    },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
            });
            const result = await withTestActor(() =>
                proxied().complete({
                    model: 'gemini-3.7-flash',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            );
            expect(result).toMatchObject({ message: { content: 'hi' } });
        });
    });

    it('does not call Google when the request was already cancelled', async () => {
        const abort = new AbortController();
        abort.abort();
        const error = await withTestActor(() => {
            Context.set('abortSignal', abort.signal);
            return makeProvider().complete({
                model: 'gemini-4-argon',
                messages: [{ role: 'user', content: 'hi' }],
            });
        }).catch((e: unknown) => e);
        expect((error as Error).name).toBe('AbortError');
        expect(generateContent).not.toHaveBeenCalled();
    });
});

describe('gemini-4-argon thinking levels', () => {
    it.each([
        [{ reasoning_effort: 'low' }, 'LOW'],
        [{ reasoning_effort: 'medium' }, 'MEDIUM'],
        [{ reasoning_effort: 'high' }, 'HIGH'],
        [{ reasoning: { effort: 'high' } }, 'HIGH'],
    ])('sends %j as thinkingLevel %s', async (args, level) => {
        generateContent.mockResolvedValueOnce(textResponse('OK'));
        await complete(args as Partial<ICompleteArguments>);
        expect(requestOf().config.thinkingConfig).toEqual({
            thinkingLevel: level,
        });
    });

    it('leaves the level to the model default when none is asked for', async () => {
        generateContent.mockResolvedValueOnce(textResponse('OK'));
        await complete({});
        expect(requestOf().config).not.toHaveProperty('thinkingConfig');
    });

    it.each(['none', 'minimal', 'xhigh', 'max'])(
        'rejects reasoning_effort %s before calling Google',
        async (effort) => {
            await expect(
                complete({
                    reasoning_effort:
                        effort as ICompleteArguments['reasoning_effort'],
                }),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect(generateContent).not.toHaveBeenCalled();
        },
    );
});

describe('gemini-4-argon text completion', () => {
    it('returns the answer, skips thought parts and meters native usage', async () => {
        generateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        role: 'model',
                        parts: [
                            { text: 'planning the reply', thought: true },
                            { text: 'OK' },
                        ],
                    },
                    finishReason: 'STOP',
                },
            ],
            usageMetadata: LIVE_USAGE,
        });

        const result = await complete({
            messages: [
                { role: 'system', content: 'Be terse.' },
                { role: 'user', content: 'Say OK' },
            ],
            max_tokens: 64,
            temperature: 0.4,
        });

        expect(result).toMatchObject({
            message: { role: 'assistant', content: 'OK' },
            finish_reason: 'stop',
        });
        const request = requestOf();
        expect(request.contents).toEqual([
            { role: 'user', parts: [{ text: 'Say OK' }] },
        ]);
        expect(request.config).toMatchObject({
            systemInstruction: { parts: [{ text: 'Be terse.' }] },
            maxOutputTokens: 64,
        });
        expect(request.config).not.toHaveProperty('temperature');

        const [usage, , , costs] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 36,
            completion_tokens: 5,
            thinking_tokens: 69,
            cached_tokens: 0,
        });
        // $2 in, $10 out and thinking per million, in µ¢ per token.
        expect(costs).toEqual({
            prompt_tokens: 36 * 200,
            completion_tokens: 5 * 1000,
            thinking_tokens: 69 * 1000,
            cached_tokens: 0,
        });
        // The reported breakdown counts the same output tokens that were billed.
        expect(result.usageDetails).toEqual({
            inputTokens: 36,
            outputTokens: 5 + 69,
            reasoningTokens: 69,
        });
        expect((result.usageDetails as UsageDetails).outputTokens).toBe(
            trackedOutputTokens(usage, ARGON),
        );
    });

    it('bills cached and thought tokens once each', async () => {
        generateContent.mockResolvedValueOnce(
            textResponse('OK', {
                promptTokenCount: 1000,
                cachedContentTokenCount: 800,
                candidatesTokenCount: 10,
                thoughtsTokenCount: 20,
                totalTokenCount: 1030,
            }),
        );
        const result = await complete({});
        expect(result.usageDetails).toEqual({
            inputTokens: 200,
            outputTokens: 30,
            reasoningTokens: 20,
            cacheReadTokens: 800,
        });

        const [usage, , , costs] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 200,
            completion_tokens: 10,
            thinking_tokens: 20,
            cached_tokens: 800,
        });
        expect(costs).toEqual({
            prompt_tokens: 200 * 200,
            completion_tokens: 10 * 1000,
            thinking_tokens: 20 * 1000,
            cached_tokens: 800 * 10,
        });
    });

    it('bills server-tool prompt tokens at the input rate if Google reports any', async () => {
        generateContent.mockResolvedValueOnce(
            textResponse('OK', { ...LIVE_USAGE, toolUsePromptTokenCount: 7 }),
        );
        await complete({});
        const [, , , costs] = recordSpy.mock.calls[0]!;
        expect(costs).toMatchObject({ tool_use_prompt_tokens: 7 * 200 });
    });

    it('inlines data-URL images as inline data', async () => {
        generateContent.mockResolvedValueOnce(textResponse('A dog'));
        await complete({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is this?' },
                        {
                            type: 'image_url',
                            image_url: {
                                url: 'data:image/png;base64,iVBORw0K',
                            },
                        },
                    ],
                },
            ],
        });
        expect(requestOf().contents).toEqual([
            {
                role: 'user',
                parts: [
                    { text: 'What is this?' },
                    { inlineData: { mimeType: 'image/png', data: 'iVBORw0K' } },
                ],
            },
        ]);
    });
});

describe('gemini-4-argon unsupported content', () => {
    const AUDIO = {
        type: 'input_audio',
        input_audio: { data: 'UklGRg==', format: 'wav' },
    };
    const FILE = {
        type: 'file',
        file: {
            filename: 'notes.pdf',
            file_data: 'data:application/pdf;base64,JVBERi0=',
        },
    };

    it.each([
        [
            'text and audio',
            'input_audio',
            [{ type: 'text', text: 'Transcribe this' }, AUDIO],
        ],
        ['audio only', 'input_audio', [AUDIO]],
        [
            'text and a file',
            'file',
            [{ type: 'text', text: 'Summarize this' }, FILE],
        ],
    ])(
        'rejects %s before calling Google',
        async (_label, partType, content) => {
            await expect(
                complete({ messages: [{ role: 'user', content }] }),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
                message: `${partType} content is not supported by this model`,
            });
            expect(generateContent).not.toHaveBeenCalled();
        },
    );
});

describe('gemini-4-argon pricing by date', () => {
    it.each([
        ['2026-11-30T23:59:59.999Z', 200, 1000, 10],
        ['2026-12-01T00:00:00.000Z', 400, 2000, 20],
        ['2027-01-15T08:00:00.000Z', 400, 2000, 20],
    ])(
        'prices a request at %s at the matching rates',
        async (iso, input, output, cached) => {
            generateContent.mockResolvedValueOnce(
                textResponse('OK', {
                    ...LIVE_USAGE,
                    cachedContentTokenCount: 6,
                }),
            );
            await complete({}, new Date(iso));
            const [, , , costs] = recordSpy.mock.calls[0]!;
            expect(costs).toEqual({
                prompt_tokens: 30 * input,
                completion_tokens: 5 * output,
                thinking_tokens: 69 * output,
                cached_tokens: 6 * cached,
            });
        },
    );

    it('settles at the instant the driver priced the attempt at, not the clock', async () => {
        vi.useFakeTimers({
            toFake: ['Date'],
            now: new Date('2026-12-01T00:00:01Z'),
        });
        try {
            generateContent.mockResolvedValueOnce(textResponse('OK'));
            await complete({}, new Date('2026-11-30T23:59:58Z'));
            const [, , , costs] = recordSpy.mock.calls[0]!;
            expect(costs).toEqual({
                prompt_tokens: 36 * 200,
                completion_tokens: 5 * 1000,
                thinking_tokens: 69 * 1000,
                cached_tokens: 0,
            });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('gemini-4-argon streaming', () => {
    it('streams text and meters the final cumulative usage once', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([
                {
                    candidates: [
                        { content: { role: 'model', parts: [{ text: 'O' }] } },
                    ],
                    usageMetadata: {
                        promptTokenCount: 36,
                        totalTokenCount: 36,
                    },
                },
                {
                    candidates: [
                        {
                            content: { role: 'model', parts: [{ text: 'K' }] },
                            finishReason: 'STOP',
                        },
                    ],
                    usageMetadata: LIVE_USAGE,
                },
            ]),
        );

        const { events } = await runStream({ reasoning_effort: 'high' });

        expect(requestOf(generateContentStream).config.thinkingConfig).toEqual({
            thinkingLevel: 'HIGH',
        });
        expect(
            events.filter((e) => e.type === 'text').map((e) => e.text),
        ).toEqual(['O', 'K']);
        const usageLine = events.find((e) => e.type === 'usage');
        expect(usageLine).toMatchObject({
            usage: {
                prompt_tokens: 36,
                completion_tokens: 5,
                thinking_tokens: 69,
                cached_tokens: 0,
            },
            usageDetails: {
                inputTokens: 36,
                outputTokens: 74,
                reasoningTokens: 69,
            },
            stopReason: 'end_turn',
        });
        expect(recordSpy).toHaveBeenCalledTimes(1);
    });

    // The counts Google streamed for a live request: an early partial
    // report, then the cumulative final one.
    it('meters the final cumulative report, not an earlier partial one', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([
                {
                    candidates: [
                        { content: { role: 'model', parts: [{ text: 'O' }] } },
                    ],
                    usageMetadata: {
                        promptTokenCount: 5,
                        candidatesTokenCount: 1,
                        totalTokenCount: 6,
                    },
                },
                {
                    candidates: [
                        {
                            content: { role: 'model', parts: [{ text: 'K' }] },
                            finishReason: 'STOP',
                        },
                    ],
                    usageMetadata: {
                        promptTokenCount: 36,
                        candidatesTokenCount: 5,
                        totalTokenCount: 41,
                    },
                },
            ]),
        );

        await runStream({});

        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy.mock.calls[0]![0]).toEqual({
            prompt_tokens: 36,
            completion_tokens: 5,
            thinking_tokens: 0,
            cached_tokens: 0,
        });
    });

    it.each([
        ['no usage metadata', undefined],
        ['empty usage metadata', {}],
    ])(
        'leaves a stream with %s unreported so the driver estimates it',
        async (_label, usageMetadata) => {
            generateContentStream.mockResolvedValueOnce(
                asAsyncIterable([
                    {
                        candidates: [
                            {
                                content: {
                                    role: 'model',
                                    parts: [{ text: 'OK' }],
                                },
                                finishReason: 'STOP',
                            },
                        ],
                        usageMetadata,
                    },
                ]),
            );

            const { events, chatStream } = await runStream({});

            expect(events.filter((e) => e.type === 'text')).toHaveLength(1);
            // Null is what makes the driver charge its output estimate.
            expect(chatStream.reportedUsage).toBeNull();
            expect(
                recordSpy.mock.calls.flatMap(([usage]) => Object.values(usage)),
            ).toEqual([]);
        },
    );

    it('streams a tool call with its thought signature', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([
                {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            id: 'fc_1',
                                            name: 'get_weather',
                                            args: { city: 'Paris' },
                                        },
                                        thoughtSignature: 'c2lnLTE=',
                                    },
                                ],
                            },
                            finishReason: 'STOP',
                        },
                    ],
                    usageMetadata: LIVE_USAGE,
                },
            ]),
        );

        const { events } = await runStream({ tools: [WEATHER_TOOL] });

        expect(events.find((e) => e.type === 'tool_use')).toMatchObject({
            id: 'fc_1',
            name: 'get_weather',
            input: { city: 'Paris' },
            extra_content: { google: { thought_signature: 'c2lnLTE=' } },
        });
        expect(events.find((e) => e.type === 'usage')).toMatchObject({
            stopReason: 'tool_use',
        });
    });
});

describe('gemini-4-argon output cap', () => {
    it.each([
        ['no max_tokens', undefined],
        ['a larger max_tokens', 65_536],
    ])(
        'caps a non-streamed request with %s at 32,768 output tokens',
        async (_label, maxTokens) => {
            generateContent.mockResolvedValueOnce(textResponse('OK'));
            await complete({ max_tokens: maxTokens });
            expect(requestOf().config.maxOutputTokens).toBe(32_768);
        },
    );

    it('sends a stream the max_tokens it asked for', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([textResponse('OK')]),
        );
        await runStream({ max_tokens: 65_536 });
        expect(requestOf(generateContentStream).config.maxOutputTokens).toBe(
            65_536,
        );
    });

    describe('through the driver', () => {
        let driver: ChatCompletionDriver;
        let reserve: MockInstance<MeteringService['reserveCredits']>;

        beforeEach(async () => {
            // Launch rates, so a hold converts to output tokens exactly.
            vi.useFakeTimers({ toFake: ['Date'], now: LAUNCH });
            driver = new ChatCompletionDriver(
                {
                    providers: {
                        gemini: { apiKey: 'test-key' },
                        ollama: { enabled: false },
                    },
                } as never,
                server.clients,
                server.stores,
                server.services,
            );
            await driver.onServerStart();
            // Enough balance that only the request and the model bound output.
            vi.spyOn(
                server.services.metering,
                'getUsageHeadroom',
            ).mockResolvedValue({ balance: Number.MAX_SAFE_INTEGER, held: 0 });
            reserve = vi.spyOn(server.services.metering, 'reserveCredits');
        });

        afterEach(() => {
            driver.onServerShutdown();
            vi.useRealTimers();
        });

        const viaDriver = (args: Partial<ICompleteArguments>) =>
            withTestActor(() =>
                driver.complete({
                    model: 'gemini-4-argon',
                    messages: [{ role: 'user', content: 'Say OK' }],
                    ...args,
                } as ICompleteArguments),
            );

        // The two-token prompt costs less than one output token.
        const heldOutputTokens = () =>
            Math.floor(
                reserve.mock.calls[0]![1] / ARGON.costs.completion_tokens,
            );

        it.each([
            ['no max_tokens', 32_768, undefined],
            ['a larger max_tokens', 32_768, 65_536],
            ['a smaller max_tokens', 1_000, 1_000],
        ])(
            'sends and holds a non-streamed request with %s at %i output tokens',
            async (_label, expected, maxTokens) => {
                generateContent.mockResolvedValueOnce(textResponse('OK'));
                await viaDriver({ max_tokens: maxTokens });
                expect(requestOf().config.maxOutputTokens).toBe(expected);
                expect(heldOutputTokens()).toBe(expected);
            },
        );

        it('sends and holds a stream at the full 65,536-token limit', async () => {
            generateContentStream.mockResolvedValueOnce(
                asAsyncIterable([textResponse('OK')]),
            );
            await readStreamResult(await viaDriver({ stream: true }));
            expect(
                requestOf(generateContentStream).config.maxOutputTokens,
            ).toBe(65_536);
            expect(heldOutputTokens()).toBe(65_536);
        });
    });
});

describe('gemini-4-argon finish reasons', () => {
    const LIVE_METERED = {
        prompt_tokens: 36,
        completion_tokens: 5,
        thinking_tokens: 69,
        cached_tokens: 0,
    };
    const partial = (finishReason: string) => ({
        candidates: [
            {
                content: { role: 'model', parts: [{ text: 'Partial' }] },
                finishReason,
            },
        ],
        usageMetadata: LIVE_USAGE,
    });

    // A native reason with no OpenAI analog reaches the caller verbatim.
    const REASONS = [
        ['STOP', 'stop'],
        ['MAX_TOKENS', 'length'],
        ['SAFETY', 'content_filter'],
        ['RECITATION', 'content_filter'],
        ['BLOCKLIST', 'content_filter'],
        ['PROHIBITED_CONTENT', 'content_filter'],
        ['SPII', 'content_filter'],
        ['MALFORMED_FUNCTION_CALL', 'MALFORMED_FUNCTION_CALL'],
        ['MISSING_THOUGHT_SIGNATURE', 'MISSING_THOUGHT_SIGNATURE'],
        ['MALFORMED_RESPONSE', 'MALFORMED_RESPONSE'],
        ['UNEXPECTED_TOOL_CALL', 'UNEXPECTED_TOOL_CALL'],
        ['LANGUAGE', 'LANGUAGE'],
        ['OTHER', 'OTHER'],
        ['CONTINUATION', 'length'],
        ['SOME_FUTURE_REASON', 'SOME_FUTURE_REASON'],
    ] as const;

    it.each(REASONS)(
        'returns %s as %s with the partial output and its usage',
        async (native, expected) => {
            generateContent.mockResolvedValueOnce(partial(native));
            const result = await complete({});
            expect(result).toMatchObject({
                message: { role: 'assistant', content: 'Partial' },
                finish_reason: expected,
            });
            expect(recordSpy.mock.calls[0]![0]).toEqual(LIVE_METERED);
        },
    );

    it.each(REASONS)(
        'streams %s as %s with the partial output and its usage',
        async (native, expected) => {
            generateContentStream.mockResolvedValueOnce(
                asAsyncIterable([partial(native)]),
            );
            const { events } = await runStream({});
            expect(
                events.filter((e) => e.type === 'text').map((e) => e.text),
            ).toEqual(['Partial']);
            expect(events.find((e) => e.type === 'usage')).toMatchObject({
                usage: LIVE_METERED,
                finish_reason: expected,
            });
        },
    );

    // The raw API puts a resume token beside CONTINUATION; nothing here can
    // use it, so it must not reach the caller.
    const continued = {
        candidates: [
            {
                content: { role: 'model', parts: [{ text: 'Partial' }] },
                finishReason: 'CONTINUATION',
                continuationToken: 'resume-token',
            },
        ],
        usageMetadata: LIVE_USAGE,
    };

    it('ends a CONTINUATION cut as length without its resume token', async () => {
        generateContent.mockResolvedValueOnce(continued);
        const result = await complete({});
        expect(result).toMatchObject({ finish_reason: 'length' });
        expect(JSON.stringify(result)).not.toContain('resume-token');
    });

    it('streams a CONTINUATION cut as a max_tokens stop without its resume token', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([continued]),
        );
        const { events } = await runStream({});
        expect(events.find((e) => e.type === 'usage')).toMatchObject({
            finish_reason: 'length',
            stopReason: 'max_tokens',
        });
        expect(JSON.stringify(events)).not.toContain('resume-token');
    });
});

describe('gemini-4-argon blocked prompts', () => {
    const PROMPT_USAGE = { promptTokenCount: 12, totalTokenCount: 12 };
    const blocked = (usageMetadata?: object) => ({
        promptFeedback: {
            blockReason: 'PROHIBITED_CONTENT',
            blockReasonMessage: 'internal classifier detail',
        },
        ...(usageMetadata ? { usageMetadata } : {}),
    });

    it('answers a blocked prompt with an empty content_filter turn and meters its prompt', async () => {
        generateContent.mockResolvedValueOnce(blocked(PROMPT_USAGE));
        const result = await complete({});

        expect(result).toMatchObject({
            message: { role: 'assistant', content: '', refusal: null },
            finish_reason: 'content_filter',
        });
        expect(JSON.stringify(result)).not.toMatch(
            /internal classifier detail|PROHIBITED_CONTENT/,
        );
        expect(recordSpy.mock.calls[0]![0]).toEqual({
            prompt_tokens: 12,
            completion_tokens: 0,
            thinking_tokens: 0,
            cached_tokens: 0,
        });
    });

    it('answers a blocked prompt without usage and meters nothing', async () => {
        generateContent.mockResolvedValueOnce(blocked());
        const result = await complete({});

        expect(result).toMatchObject({ finish_reason: 'content_filter' });
        expect(
            recordSpy.mock.calls.flatMap(([usage]) => Object.values(usage)),
        ).toEqual([]);
    });

    it.each([
        [
            'an unspecified block reason',
            { blockReason: 'BLOCKED_REASON_UNSPECIFIED' },
        ],
        [
            'the API docs spelling of it',
            { blockReason: 'BLOCK_REASON_UNSPECIFIED' },
        ],
        ['no prompt feedback', undefined],
    ])(
        'still rejects a response with no candidates and %s',
        async (_label, promptFeedback) => {
            generateContent.mockResolvedValueOnce({
                ...(promptFeedback ? { promptFeedback } : {}),
                usageMetadata: PROMPT_USAGE,
            });
            await expect(complete({})).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_response',
            });
        },
    );

    it('streams a blocked prompt as a content_filter end with its usage', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([blocked(PROMPT_USAGE)]),
        );
        const { events, chatStream } = await runStream({});

        expect(events.some((e) => e.type === 'text' && e.text)).toBe(false);
        expect(events.find((e) => e.type === 'usage')).toMatchObject({
            finish_reason: 'content_filter',
            stopReason: 'refusal',
        });
        expect(JSON.stringify(events)).not.toMatch(
            /internal classifier detail|PROHIBITED_CONTENT/,
        );
        expect(chatStream.reportedUsage).toMatchObject({ prompt_tokens: 12 });
    });

    it('streams a blocked prompt without usage as an unreported content_filter end', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([blocked()]),
        );
        const { events, chatStream } = await runStream({});

        expect(events.find((e) => e.type === 'usage')).toMatchObject({
            finish_reason: 'content_filter',
        });
        expect(chatStream.reportedUsage).toBeNull();
    });
});

describe('gemini-4-argon tool calls', () => {
    it('declares tools, forces a named tool and returns the call with its signature', async () => {
        generateContent.mockResolvedValueOnce(
            toolCallResponse({
                id: 'fc_1',
                name: 'get_weather',
                args: { city: 'Paris' },
            }),
        );

        const result = await complete({
            tools: [WEATHER_TOOL],
            tool_choice: { type: 'tool', name: 'get_weather' },
        });

        expect(requestOf().config).toMatchObject({
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: 'get_weather',
                            description: 'Current weather for a city',
                            parametersJsonSchema:
                                WEATHER_TOOL.function.parameters,
                        },
                    ],
                },
            ],
            toolConfig: {
                functionCallingConfig: {
                    mode: 'ANY',
                    allowedFunctionNames: ['get_weather'],
                },
            },
        });
        expect(result).toMatchObject({
            finish_reason: 'tool_calls',
            message: {
                content: null,
                tool_calls: [
                    {
                        id: 'fc_1',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            arguments: '{"city":"Paris"}',
                        },
                        extra_content: {
                            google: { thought_signature: 'c2lnLTE=' },
                        },
                    },
                ],
            },
        });
    });

    it('replays the call, its signature and the tool result on the next turn', async () => {
        generateContent.mockResolvedValueOnce(
            toolCallResponse({
                id: 'fc_1',
                name: 'get_weather',
                args: { city: 'Paris' },
            }),
        );
        const first = await complete({ tools: [WEATHER_TOOL] });
        const assistant = (first as { message: Record<string, unknown> })
            .message;

        generateContent.mockResolvedValueOnce(textResponse('18C in Paris'));
        // The driver normalizes messages before any provider sees them.
        await complete({
            tools: [WEATHER_TOOL],
            messages: normalize_messages([
                { role: 'user', content: 'Weather in Paris?' },
                assistant,
                { role: 'tool', tool_call_id: 'fc_1', content: '18C' },
            ]),
        });

        expect(generateContent.mock.calls[1]![0].contents).toEqual([
            { role: 'user', parts: [{ text: 'Weather in Paris?' }] },
            {
                role: 'model',
                parts: [
                    {
                        functionCall: {
                            id: 'fc_1',
                            name: 'get_weather',
                            args: { city: 'Paris' },
                        },
                        thoughtSignature: 'c2lnLTE=',
                    },
                ],
            },
            {
                role: 'user',
                parts: [
                    {
                        functionResponse: {
                            id: 'fc_1',
                            name: 'get_weather',
                            response: { result: '18C' },
                        },
                    },
                ],
            },
        ]);
    });

    it('replays parallel calls in the order Google made them, signature on the first', async () => {
        generateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        role: 'model',
                        parts: [
                            {
                                functionCall: {
                                    id: 'fc_a',
                                    name: 'get_weather',
                                    args: { city: 'Paris' },
                                },
                                thoughtSignature: 'c2lnLTE=',
                            },
                            {
                                functionCall: {
                                    id: 'fc_b',
                                    name: 'get_weather',
                                    args: { city: 'Rome' },
                                },
                            },
                        ],
                    },
                    finishReason: 'STOP',
                },
            ],
            usageMetadata: LIVE_USAGE,
        });
        const first = await complete({ tools: [WEATHER_TOOL] });
        const assistant = (first as { message: Record<string, unknown> })
            .message;

        generateContent.mockResolvedValueOnce(textResponse('Both mild'));
        await complete({
            tools: [WEATHER_TOOL],
            messages: normalize_messages([
                { role: 'user', content: 'Weather in Paris and Rome?' },
                assistant,
                { role: 'tool', tool_call_id: 'fc_a', content: '18C' },
                { role: 'tool', tool_call_id: 'fc_b', content: '22C' },
            ]),
        });

        const [, model, results] = generateContent.mock.calls[1]![0]
            .contents as Array<{ parts: Array<Record<string, unknown>> }>;
        expect(model!.parts).toEqual([
            {
                functionCall: {
                    id: 'fc_a',
                    name: 'get_weather',
                    args: { city: 'Paris' },
                },
                thoughtSignature: 'c2lnLTE=',
            },
            {
                functionCall: {
                    id: 'fc_b',
                    name: 'get_weather',
                    args: { city: 'Rome' },
                },
            },
        ]);
        expect(
            results!.parts.map(
                (p) => (p.functionResponse as { id: string }).id,
            ),
        ).toEqual(['fc_a', 'fc_b']);
    });

    it('never sends back an id Google did not issue', async () => {
        generateContent.mockResolvedValueOnce(
            toolCallResponse({ name: 'get_weather', args: { city: 'Rome' } }),
        );
        const first = await complete({ tools: [WEATHER_TOOL] });
        const assistant = (
            first as {
                message: { tool_calls: Array<{ id: string }> };
            }
        ).message;
        const callId = assistant.tool_calls[0]!.id;
        expect(callId).toMatch(/^gemini_call_/);

        generateContent.mockResolvedValueOnce(textResponse('20C'));
        await complete({
            tools: [WEATHER_TOOL],
            messages: normalize_messages([
                { role: 'user', content: 'Weather in Rome?' },
                assistant,
                { role: 'tool', tool_call_id: callId, content: '20C' },
            ]),
        });

        const [, model, toolResult] = generateContent.mock.calls[1]![0]
            .contents as Array<{ parts: Array<Record<string, unknown>> }>;
        expect(model!.parts[0]!.functionCall).not.toHaveProperty('id');
        expect(model!.parts[0]!.thoughtSignature).toBe('c2lnLTE=');
        expect(toolResult!.parts[0]!.functionResponse).toEqual({
            name: 'get_weather',
            response: { result: '20C' },
        });
    });

    it('offers only caller-defined functions, never a built-in server tool', async () => {
        generateContent.mockResolvedValueOnce(textResponse('OK'));
        await complete({
            tools: [{ type: 'web_search' }, WEATHER_TOOL],
            tool_choice: { type: 'any' },
        });
        const { config } = requestOf();
        expect(config.tools).toEqual([
            {
                functionDeclarations: [
                    expect.objectContaining({ name: 'get_weather' }),
                ],
            },
        ]);
        expect(config.toolConfig).toEqual({
            functionCallingConfig: { mode: 'ANY' },
        });
    });

    it('rejects a tool result with no matching call', async () => {
        await expect(
            complete({
                messages: normalize_messages([
                    { role: 'user', content: 'hi' },
                    { role: 'tool', tool_call_id: 'nope', content: 'x' },
                ]),
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateContent).not.toHaveBeenCalled();
    });
});

// The usage Google returned for live "Say OK" requests at the model default.
const RESTORED = [
    {
        model: 'gemini-3.1-flash-lite',
        rates: { input: 25, output: 150, cached: 2.5 },
        usage: {
            promptTokenCount: 16,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 206,
            totalTokenCount: 225,
        },
    },
    {
        model: 'gemini-3-flash-preview',
        rates: { input: 50, output: 300, cached: 5 },
        usage: {
            promptTokenCount: 16,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 169,
            totalTokenCount: 188,
        },
    },
];

describe.each(RESTORED)('$model served natively', ({ model, rates, usage }) => {
    const entry = GEMINI_MODELS.find((m) => m.id === model)!;
    const thoughts = usage.thoughtsTokenCount;

    it('lists text and image input only', () => {
        expect(entry).toMatchObject({
            puterId: `google:google/${model}`,
            context: 1_048_576,
            max_tokens: 65_536,
            modalities: { input: ['text', 'image'], output: ['text'] },
            tool_call: true,
        });
    });

    it('routes the alias natively and bills candidates and thoughts separately', async () => {
        generateContent.mockResolvedValueOnce(textResponse('OK', usage));
        const result = await complete({ model: `google/${model}` });

        expect(requestOf().model).toBe(model);
        expect(requestOf().config).not.toHaveProperty('thinkingConfig');
        expect(openAICreate).not.toHaveBeenCalled();
        const [metered, , prefix, costs] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe(`gemini:${model}`);
        expect(metered).toEqual({
            prompt_tokens: 16,
            completion_tokens: 3,
            thinking_tokens: thoughts,
            cached_tokens: 0,
        });
        expect(costs).toEqual({
            prompt_tokens: 16 * rates.input,
            completion_tokens: 3 * rates.output,
            thinking_tokens: thoughts * rates.output,
            cached_tokens: 0,
        });
        expect(result.usageDetails).toEqual({
            inputTokens: 16,
            outputTokens: 3 + thoughts,
            reasoningTokens: thoughts,
        });
        expect((result.usageDetails as UsageDetails).outputTokens).toBe(
            trackedOutputTokens(metered, entry),
        );
    });

    it('bills cached, prompt, candidate and thought tokens once each', async () => {
        generateContent.mockResolvedValueOnce(
            textResponse('OK', {
                promptTokenCount: 1000,
                cachedContentTokenCount: 400,
                candidatesTokenCount: 10,
                thoughtsTokenCount: 20,
                totalTokenCount: 1030,
            }),
        );
        const result = await complete({ model });

        const [metered, , , costs] = recordSpy.mock.calls[0]!;
        expect(metered).toEqual({
            prompt_tokens: 600,
            completion_tokens: 10,
            thinking_tokens: 20,
            cached_tokens: 400,
        });
        expect(costs).toEqual({
            prompt_tokens: 600 * rates.input,
            completion_tokens: 10 * rates.output,
            thinking_tokens: 20 * rates.output,
            cached_tokens: 400 * rates.cached,
        });
        expect(result.usageDetails).toEqual({
            inputTokens: 600,
            outputTokens: 30,
            reasoningTokens: 20,
            cacheReadTokens: 400,
        });
    });

    it.each([
        ['minimal', 'MINIMAL'],
        ['low', 'LOW'],
        ['medium', 'MEDIUM'],
        ['high', 'HIGH'],
    ])('sends reasoning_effort %s as thinkingLevel %s', async (effort, level) => {
        generateContent.mockResolvedValueOnce(textResponse('OK', usage));
        await complete({
            model,
            reasoning_effort: effort as ICompleteArguments['reasoning_effort'],
        });
        expect(requestOf().config.thinkingConfig).toEqual({
            thinkingLevel: level,
        });
    });

    it.each(['none', 'xhigh', 'max'])(
        'rejects reasoning_effort %s before calling Google',
        async (effort) => {
            await expect(
                complete({
                    model,
                    reasoning_effort: effort as ICompleteArguments['reasoning_effort'],
                }),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect(generateContent).not.toHaveBeenCalled();
        },
    );

    it.each([0, 0.5])('forwards temperature %s', async (temperature) => {
        generateContent.mockResolvedValueOnce(textResponse('OK', usage));
        await complete({ model, temperature });
        expect(requestOf().config.temperature).toBe(temperature);
    });

    it('leaves temperature unset when the caller omits it', async () => {
        generateContent.mockResolvedValueOnce(textResponse('OK', usage));
        await complete({ model });
        expect(requestOf().config).not.toHaveProperty('temperature');
    });

    it('streams text and meters the final usage with its thoughts once', async () => {
        generateContentStream.mockResolvedValueOnce(
            asAsyncIterable([
                {
                    candidates: [{ content: { role: 'model', parts: [{ text: 'O' }] } }],
                    usageMetadata: { promptTokenCount: 16, totalTokenCount: 16 },
                },
                {
                    candidates: [
                        {
                            content: { role: 'model', parts: [{ text: 'K' }] },
                            finishReason: 'STOP',
                        },
                    ],
                    usageMetadata: usage,
                },
            ]),
        );

        const { events } = await runStream({ model, reasoning_effort: 'high' });

        expect(requestOf(generateContentStream).config.thinkingConfig).toEqual({
            thinkingLevel: 'HIGH',
        });
        expect(
            events.filter((e) => e.type === 'text').map((e) => e.text),
        ).toEqual(['O', 'K']);
        expect(events.find((e) => e.type === 'usage')).toMatchObject({
            usage: {
                prompt_tokens: 16,
                completion_tokens: 3,
                thinking_tokens: thoughts,
                cached_tokens: 0,
            },
            usageDetails: {
                inputTokens: 16,
                outputTokens: 3 + thoughts,
                reasoningTokens: thoughts,
            },
        });
        expect(recordSpy).toHaveBeenCalledTimes(1);
    });
});

describe('geminiNativeClient deadline', () => {
    type Request = { config?: { abortSignal?: AbortSignal } };
    // The SDK aborts its own controller without a reason.
    const abortedBy = (request: Request) =>
        new Promise<never>((_resolve, reject) => {
            request.config!.abortSignal!.addEventListener('abort', () =>
                reject(
                    new DOMException(
                        'This operation was aborted',
                        'AbortError',
                    ),
                ),
            );
        });
    const clientWith = (models: Record<string, unknown>, timeoutMs = 10) =>
        geminiNativeClient({ models } as never, timeoutMs);
    const params = (stream: boolean) =>
        ({
            model: 'gemini-4-argon',
            messages: [{ role: 'user', content: 'hi' }],
            stream,
        }) as never;
    const errorOf = async (run: () => Promise<unknown>) => {
        try {
            await run();
        } catch (err) {
            return err;
        }
        throw new Error('expected a rejection');
    };

    it('reports its own deadline as a timeout', async () => {
        const client = clientWith({ generateContent: abortedBy });
        const err = await errorOf(() =>
            client.chat.completions.create(params(false), {}),
        );
        expect(err).toBeInstanceOf(UpstreamDeadlineError);
        expect(isUpstreamTimeoutError(err)).toBe(true);
    });

    it('reports a stream cut by its deadline as a timeout', async () => {
        const client = clientWith({
            generateContentStream: async (request: Request) =>
                (async function* () {
                    yield* [];
                    await abortedBy(request);
                })(),
        });
        const err = await errorOf(async () => {
            const stream = (await client.chat.completions.create(
                params(true),
                {},
            )) as AsyncIterable<unknown>;
            for await (const _chunk of stream);
        });
        expect(err).toBeInstanceOf(UpstreamDeadlineError);
    });

    it('leaves a caller abort as an abort', async () => {
        const abort = new AbortController();
        const client = clientWith(
            {
                generateContent: (request: Request) => {
                    const pending = abortedBy(request);
                    abort.abort();
                    return pending;
                },
            },
            60_000,
        );
        const err = await errorOf(() =>
            client.chat.completions.create(params(false), {
                signal: abort.signal,
            }),
        );
        expect((err as Error).name).toBe('AbortError');
        expect(isUpstreamTimeoutError(err)).toBe(false);
    });
});
