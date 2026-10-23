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
 * Offline unit tests for MoonshotProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs MoonshotProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. Moonshot is OpenAI-compatible so the OpenAI SDK is mocked at
 * the module boundary; that's the real network egress point. Image-
 * inlining behaviour is covered by `utils/inlineImages.test.ts`; here we
 * stub `inlineHttpImageUrls` so http URLs in vision messages don't
 * trigger network fetches and only verify the provider invokes it
 * for vision-capable models. The companion integration test
 * (MoonshotProvider.integration.test.ts) exercises the real Moonshot
 * endpoint.
 */

import { Readable, Writable } from 'node:stream';
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

import { ChatCompletionDriver } from '../../ChatCompletionDriver.js';
import {
    clearUnhealthyRoutes,
    isRouteUnhealthy,
} from '../../utils/providerHealth.js';
import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import {
    readStreamResult,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { FakeChatProvider } from '../FakeChatProvider.js';
import { MOONSHOT_MODELS } from './models.js';
import { MoonshotProvider } from './MoonshotProvider.js';
import { modelLookupNames } from '../../utils/modelRouting.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { createMock, openAICtor } = vi.hoisted(() => {
    const createMock = vi.fn();
    const openAICtor = vi.fn();
    return { createMock, openAICtor };
});

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
    });
    // Some providers (e.g. OllamaChatProvider, GeminiChatProvider)
    // import the default export and access `.OpenAI` on it, so expose
    // the same constructor under both shapes — the test server boots
    // every provider, not just Moonshot.
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// ── inlineImages stub ──────────────────────────────────────────────

const { inlineHttpImageUrlsMock } = vi.hoisted(() => ({
    // Declared with the real function's arity so `mock.calls[0][0]` is typed.
    inlineHttpImageUrlsMock: vi.fn(async (_messages: unknown) => {}),
}));

vi.mock('../../utils/inlineImages.js', () => ({
    inlineHttpImageUrls: inlineHttpImageUrlsMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: ChatCompletionDriver;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
    driver = new ChatCompletionDriver(
        {
            providers: {
                moonshot: { apiKey: 'test-key' },
                ollama: { enabled: false },
            },
        } as never,
        server.clients,
        server.stores,
        server.services,
    );
    await driver.onServerStart();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () => {
    const provider = new MoonshotProvider(
        { apiKey: 'test-key' },
        server.services.metering,
    );
    return { provider };
};

const asAsyncIterable = <T>(items: T[]): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
        for (const item of items) {
            yield item;
        }
    },
});

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

beforeEach(() => {
    clearUnhealthyRoutes();
    createMock.mockReset();
    openAICtor.mockReset();
    inlineHttpImageUrlsMock.mockReset();
    inlineHttpImageUrlsMock.mockImplementation(async () => {});
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('MoonshotProvider construction', () => {
    it('points the OpenAI SDK at the Moonshot base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.moonshot.ai/v1',
            maxRetries: 0,
            timeout: 10 * 60 * 1000,
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('MoonshotProvider model catalog', () => {
    it('returns kimi-k2.6 as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('kimi-k2.6');
    });

    it('exposes the static MOONSHOT_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(MOONSHOT_MODELS);
    });

    it('list() flattens canonical ids and aliases (returned via async)', async () => {
        const { provider } = makeProvider();
        const names = modelLookupNames(await provider.models());
        for (const m of MOONSHOT_MODELS) {
            expect(names).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(names).toContain(a);
            }
        }
        expect(names).toContain('kimi');
        expect(names).toContain('kimi-k2.6');
    });

    it.each(MOONSHOT_MODELS.map((m) => m.id))(
        'declares image and video input for %s, as the live API reports',
        (id) => {
            const model = MOONSHOT_MODELS.find((m) => m.id === id)!;
            expect(model.modalities.input).toEqual(['text', 'image', 'video']);
        },
    );
});

// ── Request shape ───────────────────────────────────────────────────

describe('MoonshotProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('forwards model + messages and passes max_tokens through unchanged', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 2048,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('kimi-k2.6');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_tokens).toBe(2048);
    });

    it('forwards max_tokens as undefined when not supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.max_tokens).toBeUndefined();
    });

    it('omits the `tools` key entirely when no tools are supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('tools' in args).toBe(false);
    });

    it('sends function tools in the OpenAI shape', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        const tools = [
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    description: 'find a thing',
                    parameters: {
                        type: 'object',
                        properties: { q: { type: 'string' } },
                        required: ['q'],
                    },
                },
            },
        ];
        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.tools).toEqual(tools);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        const [nonStreamArgs] = createMock.mock.calls[0]!;
        expect(nonStreamArgs.stream).toBe(false);
        expect('stream_options' in nonStreamArgs).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        const [streamArgs] = createMock.mock.calls[1]!;
        expect(streamArgs.stream).toBe(true);
        expect(streamArgs.stream_options).toEqual({ include_usage: true });
    });

    it('hoists Puter-style tool_use blocks into OpenAI tool_calls before sending', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [
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
                ],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.messages[0].content).toBeNull();
        expect(args.messages[0].tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: {
                    name: 'lookup',
                    arguments: JSON.stringify({ q: 'puter' }),
                },
            },
        ]);
    });
});

// ── Image inlining for vision models ────────────────────────────────

describe('MoonshotProvider image inlining', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'ok', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('routes vision-capable models through inlineHttpImageUrls', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        const messages = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'what is this?' },
                    {
                        type: 'image_url',
                        image_url: { url: 'https://example.com/img.png' },
                    },
                ],
            },
        ];

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k3', // kimi-k3 declares image input modality
                messages: messages as unknown as {
                    role: string;
                    content: unknown;
                }[],
            }),
        );

        expect(inlineHttpImageUrlsMock).toHaveBeenCalledTimes(1);
        // The provider passes the same messages array — image inlining
        // mutates parts in place before process_input_messages runs.
        expect(inlineHttpImageUrlsMock.mock.calls[0]![0]).toBe(messages);
    });

    it('does not invoke inlineHttpImageUrls for text-only models', async () => {
        const { provider } = makeProvider();
        // Every live Kimi model takes images, so stub a text-only entry.
        vi.spyOn(provider, 'models').mockReturnValue([
            {
                ...MOONSHOT_MODELS.find((m) => m.id === 'kimi-k2.6')!,
                modalities: { input: ['text'], output: ['text'] },
            },
        ]);
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(inlineHttpImageUrlsMock).not.toHaveBeenCalled();
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('MoonshotProvider model resolution', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'ok', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('resolves an exact canonical id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.7-code',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('kimi-k2.7-code');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'moonshotai:kimi-k2.7-code',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical id (alias rewriting)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('kimi-k2.6');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'moonshotai:kimi-k2.6',
            expect.any(Object),
        );
    });

    it('rejects an unknown id instead of substituting the default', async () => {
        const { provider } = makeProvider();

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'totally-not-a-real-model',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('MoonshotProvider.complete non-stream output', () => {
    it('returns the first choice and runs the metered usage calculator', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hi there', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 10 },
            },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        // kimi-k2.6 costs: prompt=95, completion=400, cached=16.
        const kimi = MOONSHOT_MODELS.find((m) => m.id === 'kimi-k2.6')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('moonshotai:kimi-k2.6');
        expect(overrides).toEqual({
            prompt_tokens: 90 * Number(kimi.costs.prompt_tokens),
            completion_tokens: 50 * Number(kimi.costs.completion_tokens),
            cached_tokens: 10 * Number(kimi.costs.cached_tokens ?? 0),
        });
    });

    it('preserves OpenAI-shaped tool_calls on the assistant response', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'lookup',
                                    arguments: '{"q":"puter"}',
                                },
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'do a tool call' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: {} },
                    },
                ],
            }),
        )) as { message: { tool_calls?: unknown[] }; finish_reason: string };

        expect(result.finish_reason).toBe('tool_calls');
        expect(result.message.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: {
                    name: 'lookup',
                    arguments: '{"q":"puter"}',
                },
            },
        ]);
    });

    it('zeroes cached_tokens when prompt_tokens_details is missing', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 7, completion_tokens: 3 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('MoonshotProvider.complete streaming', () => {
    it('streams text deltas through to text events and meters final usage', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                {
                    choices: [{ delta: {} }],
                    usage: {
                        prompt_tokens: 4,
                        completion_tokens: 2,
                        prompt_tokens_details: { cached_tokens: 1 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'say hi' }],
                stream: true,
            }),
        );
        expect((result as { stream: boolean }).stream).toBe(true);

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        const textEvents = events.filter((e) => e.type === 'text');
        expect(textEvents.map((e) => e.text)).toEqual(['hel', 'lo']);

        const usageEvent = events.find((e) => e.type === 'usage');
        expect(usageEvent?.usage).toEqual({
            prompt_tokens: 3,
            completion_tokens: 2,
            cached_tokens: 1,
        });

        const kimi = MOONSHOT_MODELS.find((m) => m.id === 'kimi-k2.6')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('moonshotai:kimi-k2.6');
        expect(overrides).toEqual({
            prompt_tokens: 3 * Number(kimi.costs.prompt_tokens),
            completion_tokens: 2 * Number(kimi.costs.completion_tokens),
            cached_tokens: 1 * Number(kimi.costs.cached_tokens ?? 0),
        });
    });

    it('builds a tool_use block from streamed function-call deltas', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
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
                {
                    choices: [{ delta: {} }],
                    usage: { prompt_tokens: 1, completion_tokens: 1 },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'do tool call' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: {} },
                    },
                ],
                stream: true,
            }),
        );

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        const toolEvent = events.find((e) => e.type === 'tool_use');
        expect(toolEvent).toBeDefined();
        expect(toolEvent?.id).toBe('call_1');
        expect(toolEvent?.name).toBe('lookup');
        expect(toolEvent?.input).toEqual({ q: 'puter' });
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('MoonshotProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('Moonshot exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'kimi-k2.6',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('MoonshotProvider.checkModeration', () => {
    it('throws — Moonshot provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});

describe('Kimi K3.1 Pro', () => {
    const models = ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'];
    const usage = {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 50 },
    };
    const response = () => ({
        choices: [
            {
                message: {
                    role: 'assistant',
                    content: 'answer',
                    reasoning_content: 'reasoning',
                },
                finish_reason: 'stop',
            },
        ],
        usage: structuredClone(usage),
    });
    const mockResponse = (
        data: unknown,
        oneHour: string | null = '10',
        fiveMinute: string | null = null,
    ) => {
        const headers = new Headers();
        if (oneHour !== null)
            headers.set('Msh-Usage-Cache-Write-Tokens-1h', oneHour);
        if (fiveMinute !== null)
            headers.set('Msh-Usage-Cache-Write-Tokens-5m', fiveMinute);
        createMock.mockReturnValueOnce({
            withResponse: async () => ({
                data,
                response: new Response(null, { headers }),
            }),
        });
    };

    it.each(models)(
        'maps %s caps and reasoning without sampling parameters',
        async (model) => {
            const { provider } = makeProvider();
            mockResponse(response());
            await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 512,
                    reasoning_effort: 'high',
                    temperature: 0.2,
                    top_p: 0.1,
                }),
            );
            expect(createMock.mock.calls[0]![0]).toMatchObject({
                model,
                max_completion_tokens: 512,
                reasoning_effort: 'high',
            });
            expect(createMock.mock.calls[0]![0]).not.toHaveProperty(
                'max_tokens',
            );
            expect(createMock.mock.calls[0]![0]).not.toHaveProperty(
                'temperature',
            );
            expect(createMock.mock.calls[0]![0]).not.toHaveProperty('top_p');
        },
    );

    it('uses the official default output cap and preserves the default thinking mode', async () => {
        const { provider } = makeProvider();
        mockResponse(response());
        await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );
        expect(createMock.mock.calls[0]![0].max_completion_tokens).toBe(131072);
        expect(createMock.mock.calls[0]![0]).not.toHaveProperty('thinking');
        expect(createMock.mock.calls[0]![0]).not.toHaveProperty(
            'reasoning_effort',
        );
    });

    it.each(['low', 'max'] as const)(
        'forwards %s reasoning effort',
        async (effort) => {
            const { provider } = makeProvider();
            mockResponse(response(), '0');
            await withTestActor(() =>
                provider.complete({
                    model: models[0]!,
                    messages: [{ role: 'user', content: 'hi' }],
                    reasoning_effort: effort,
                }),
            );
            expect(createMock.mock.calls[0]![0].reasoning_effort).toBe(effort);
        },
    );

    it('keeps K3 on its existing request and billing path', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(response());
        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k3',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 512,
            }),
        );
        expect(createMock.mock.calls[0]![0]).toMatchObject({
            model: 'kimi-k3',
            max_tokens: 512,
        });
        expect(createMock.mock.calls[0]![0]).not.toHaveProperty(
            'max_completion_tokens',
        );
        expect(recordSpy.mock.calls[0]![0]).toEqual({
            prompt_tokens: 80,
            completion_tokens: 10,
            cached_tokens: 20,
        });
    });

    it('rejects unsupported reasoning effort before inference', async () => {
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: models[0]!,
                    messages: [{ role: 'user', content: 'hi' }],
                    reasoning_effort: 'medium',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });

    it.each(models)(
        'meters disjoint cache reads, writes and uncached input for %s',
        async (model) => {
            const { provider } = makeProvider();
            mockResponse(response());
            const result = await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            );
            const inputRate = model.endsWith('highspeed') ? 400 : 200;
            expect(recordSpy).toHaveBeenCalledWith(
                {
                    prompt_tokens: 30,
                    completion_tokens: 10,
                    cached_tokens: 20,
                    cache_write_tokens: 40,
                    cache_write_1h_tokens: 10,
                },
                expect.anything(),
                `moonshotai:${model}`,
                {
                    prompt_tokens: 30 * inputRate,
                    completion_tokens: 10 * inputRate * 5,
                    cached_tokens: 20 * 20,
                    cache_write_tokens: 40 * inputRate,
                    cache_write_1h_tokens: 10 * inputRate * 2,
                },
            );
            expect(result).toMatchObject({
                usageDetails: {
                    inputTokens: 30,
                    outputTokens: 10,
                    cacheReadTokens: 20,
                    cacheWrite5mTokens: 40,
                    cacheWrite1hTokens: 10,
                },
            });
        },
    );

    it('preserves assistant reasoning, text and tool-call order on replay', async () => {
        const { provider } = makeProvider();
        const toolCalls = ['a', 'b'].map((id) => ({
            id,
            type: 'function',
            function: { name: 'lookup', arguments: '{}' },
        }));
        const first = response();
        Object.assign(first.choices[0]!.message, { tool_calls: toolCalls });
        mockResponse(first);
        const result = await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );
        mockResponse(response());
        await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [(result as { message: unknown }).message],
            }),
        );
        expect(createMock.mock.calls[1]![0].messages[0]).toEqual({
            role: 'assistant',
            content: 'answer',
            reasoning_content: 'reasoning',
            tool_calls: toolCalls,
        });
        mockResponse(response());
        await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [
                    {
                        role: 'assistant',
                        reasoning: 'reasoning',
                        content: [
                            { type: 'text', text: 'answer' },
                            ...['a', 'b'].map((id) => ({
                                type: 'tool_use',
                                id,
                                name: 'lookup',
                                input: {},
                            })),
                        ],
                    },
                ],
            }),
        );
        expect(createMock.mock.calls[2]![0].messages[0]).toEqual({
            role: 'assistant',
            reasoning_content: 'reasoning',
            content: [{ type: 'text', text: 'answer' }],
            tool_calls: toolCalls,
        });
    });

    it('meters streamed cache writes from final usage and response headers', async () => {
        const { provider } = makeProvider();
        mockResponse(
            asAsyncIterable([
                { choices: [{ delta: { reasoning_content: 'reasoning' } }] },
                { choices: [{ delta: { content: 'answer' } }] },
                { choices: [], usage: structuredClone(usage) },
            ]),
        );
        const result = await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });
        expect(createMock.mock.calls[0]![0].stream_options).toEqual({
            include_usage: true,
        });
        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy.mock.calls[0]![0]).toEqual({
            prompt_tokens: 30,
            completion_tokens: 10,
            cached_tokens: 20,
            cache_write_tokens: 40,
            cache_write_1h_tokens: 10,
        });
    });
    it.each(models)(
        'reserves the highest write rate before sending %s',
        async (model) => {
            const inputRate = model.endsWith('highspeed') ? 800 : 400;
            const outputRate = model.endsWith('highspeed') ? 2000 : 1000;
            vi.spyOn(
                server.services.metering,
                'getUsageHeadroom',
            ).mockResolvedValue({ balance: 2_000_000_000, held: 0 });
            const reserve = vi.spyOn(
                server.services.metering,
                'reserveCredits',
            );
            mockResponse(
                {
                    choices: [
                        {
                            message: { role: 'assistant', content: 'ok' },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: {
                        prompt_tokens: 1_000_000,
                        completion_tokens: 10,
                        prompt_tokens_details: {
                            cached_tokens: 100_000,
                            cache_write_tokens: 900_000,
                        },
                    },
                },
                '900000',
            );
            await withTestActor(() =>
                driver.complete({
                    model,
                    provider: 'moonshotai',
                    messages: [
                        { role: 'user', content: 'x'.repeat(8_000_000) },
                    ],
                    max_tokens: 10,
                }),
            );
            expect(reserve).toHaveBeenCalledTimes(1);
            expect(reserve.mock.calls[0]![1]).toBeGreaterThanOrEqual(
                1_000_000 * inputRate + 10 * outputRate,
            );
            expect(reserve.mock.calls[0]![1]).toBeLessThan(
                1_000_001 * inputRate + 10 * outputRate,
            );
            expect(recordSpy.mock.calls[0]![0]).toMatchObject({
                cached_tokens: 100_000,
                cache_write_1h_tokens: 900_000,
                prompt_tokens: 0,
            });
        },
    );

    it.each(['kimi-k3', 'kimi-k2.6'])(
        'keeps the existing driver reservation rate for %s',
        async (model) => {
            const entry = MOONSHOT_MODELS.find(
                (candidate) => candidate.id === model,
            )!;
            vi.spyOn(
                server.services.metering,
                'getUsageHeadroom',
            ).mockResolvedValue({ balance: 2_000_000_000, held: 0 });
            const reserve = vi.spyOn(
                server.services.metering,
                'reserveCredits',
            );
            createMock.mockResolvedValueOnce(response());
            await withTestActor(() =>
                driver.complete({
                    model,
                    provider: 'moonshotai',
                    messages: [{ role: 'user', content: 'x'.repeat(8000) }],
                    max_tokens: 10,
                }),
            );
            expect(reserve.mock.calls[0]![1]).toBe(
                1000 * Number(entry.costs.prompt_tokens) +
                    10 * Number(entry.costs.completion_tokens),
            );
        },
    );

    it.each(models)(
        'rejects an underfunded inherited-cache request for %s before inference',
        async (model) => {
            vi.spyOn(
                server.services.metering,
                'getUsageHeadroom',
            ).mockResolvedValue({
                balance: model.endsWith('highspeed')
                    ? 600_000_000
                    : 300_000_000,
                held: 0,
            });
            await expect(
                withTestActor(() =>
                    driver.complete({
                        model,
                        provider: 'moonshotai',
                        messages: [
                            { role: 'user', content: 'x'.repeat(8_000_000) },
                        ],
                        max_tokens: 10,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 402 });
            expect(createMock).not.toHaveBeenCalled();
        },
    );

    it.each([null, ''])(
        'round-trips tool-only assistant content %s through the driver',
        async (content) => {
            const toolCalls = [
                {
                    id: 'call_paris',
                    type: 'function',
                    function: {
                        name: 'weather',
                        arguments: '{"city":"Paris"}',
                    },
                },
            ];
            mockResponse(
                {
                    choices: [
                        {
                            message: {
                                role: 'assistant',
                                content,
                                reasoning_content: 'Check weather',
                                tool_calls: toolCalls,
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                    usage: { prompt_tokens: 1, completion_tokens: 1 },
                },
                null,
            );
            const first = await withTestActor(() =>
                driver.complete({
                    model: models[0]!,
                    provider: 'moonshotai',
                    messages: [{ role: 'user', content: 'weather?' }],
                }),
            );
            mockResponse(response());
            await withTestActor(() =>
                driver.complete({
                    model: models[0]!,
                    provider: 'moonshotai',
                    messages: [
                        (first as { message: unknown }).message,
                        {
                            role: 'tool',
                            tool_call_id: 'call_paris',
                            content: 'sunny',
                        },
                    ],
                }),
            );
            const assistant = createMock.mock.calls[1]![0].messages.find(
                (message: { role: string }) => message.role === 'assistant',
            );
            expect(assistant).toMatchObject({
                role: 'assistant',
                content: null,
                reasoning_content: 'Check weather',
                tool_calls: toolCalls,
            });
            expect(
                JSON.parse(assistant.tool_calls[0].function.arguments),
            ).toEqual({ city: 'Paris' });
        },
    );

    it.each([{ city: 'Paris' }, 'Paris'])(
        'keeps native tool_use input %j through the driver',
        async (input) => {
            mockResponse(response());
            await withTestActor(() =>
                driver.complete({
                    model: models[0]!,
                    provider: 'moonshotai',
                    messages: [
                        {
                            role: 'assistant',
                            reasoning_content: 'Check weather',
                            content: [
                                {
                                    type: 'tool_use',
                                    id: 'call_paris',
                                    name: 'weather',
                                    input,
                                },
                            ],
                        },
                        {
                            role: 'tool',
                            tool_call_id: 'call_paris',
                            content: 'sunny',
                        },
                    ],
                }),
            );
            const assistant = createMock.mock.calls[0]![0].messages.find(
                (message: { role: string }) => message.role === 'assistant',
            );
            expect(assistant.reasoning_content).toBe('Check weather');
            expect(
                JSON.parse(assistant.tool_calls[0].function.arguments),
            ).toEqual(input);
        },
    );

    it.each([
        [null, null],
        ['bad', null],
        ['51', null],
        ['-1', null],
        ['10', '41'],
    ] as const)(
        'rejects unverifiable TTL counters %s/%s without guessing a charge',
        async (oneHour, fiveMinute) => {
            const { provider } = makeProvider();
            mockResponse(response(), oneHour, fiveMinute);
            await expect(
                withTestActor(() =>
                    provider.complete({
                        model: models[0]!,
                        messages: [{ role: 'user', content: 'hi' }],
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 502 });
            expect(recordSpy).not.toHaveBeenCalled();
        },
    );

    it.each([
        [false, null, null, false],
        [false, '10', '41', false],
        [true, null, null, false],
        [true, '10', '41', false],
        [false, null, null, true],
        [false, '10', '41', true],
    ] as const)(
        'terminates accounting failures (stream=%s, TTL=%s/%s, fallback=%s) without retry or estimated charge',
        async (stream, oneHour, fiveMinute, startWithFake) => {
            const model = MOONSHOT_MODELS.find((m) => m.id === models[0])!;
            // A real alternative route ensures a retry would be observable.
            vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValue([
                model,
            ]);
            const fallback = vi.spyOn(FakeChatProvider.prototype, 'complete');
            if (startWithFake)
                fallback.mockRejectedValueOnce(new Error('Connection failed'));
            const d = new ChatCompletionDriver(
                {
                    providers: {
                        moonshot: { apiKey: 'test-key' },
                        ollama: { enabled: false },
                    },
                } as never,
                server.clients,
                server.stores,
                server.services,
            );
            await d.onServerStart();
            const actor = {
                user: {
                    uuid: `kimi-accounting-${Math.random()}`,
                    username: 'kimi-accounting',
                    email: 'kimi@test.com',
                },
            } as never;
            const take = vi.spyOn(server.stores.creditHold, 'take');
            const release = vi.spyOn(server.stores.creditHold, 'release');
            mockResponse(
                stream
                    ? asAsyncIterable([
                          { choices: [{ delta: { content: 'answer' } }] },
                          { choices: [], usage: structuredClone(usage) },
                      ])
                    : response(),
                oneHour,
                fiveMinute,
            );
            const completion = withTestActor(
                () =>
                    d.complete({
                        model: models[0]!,
                        provider: startWithFake ? 'fake-chat' : 'moonshot',
                        messages: [{ role: 'user', content: 'hi' }],
                        max_tokens: 10,
                        stream,
                    }),
                actor,
            );
            if (stream) {
                const result = (await completion) as unknown as {
                    stream: Readable;
                };
                const events = (await readStreamResult(result))
                    .toString()
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line));
                expect(events).toContainEqual(
                    expect.objectContaining({
                        type: 'error',
                        code: 'completion_accounting_failed',
                        status: 502,
                        message: expect.stringContaining(
                            'No charge was recorded',
                        ),
                    }),
                );
            } else {
                await expect(completion).rejects.toMatchObject({
                    statusCode: 502,
                    legacyCode: 'completion_accounting_failed',
                    message: expect.stringContaining('No charge was recorded'),
                });
            }
            await vi.waitFor(() =>
                expect(release).toHaveBeenCalledTimes(startWithFake ? 2 : 1),
            );
            expect(take).toHaveBeenCalledTimes(startWithFake ? 2 : 1);
            expect(take.mock.calls[0]![1]).toBeGreaterThan(0);
            expect(
                await server.services.metering.getOutstandingHolds(actor),
            ).toBe(0);
            expect(createMock).toHaveBeenCalledTimes(1);
            expect(fallback).toHaveBeenCalledTimes(startWithFake ? 1 : 0);
            expect(recordSpy).not.toHaveBeenCalled();
            expect(isRouteUnhealthy('moonshot', models[0]!)).toBe(false);
        },
    );

    it('derives one-hour writes from the five-minute header and total writes', async () => {
        const { provider } = makeProvider();
        mockResponse(response(), null, '40');
        await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );
        expect(recordSpy.mock.calls[0]![0]).toMatchObject({
            cache_write_tokens: 40,
            cache_write_1h_tokens: 10,
        });
    });
});
