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
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs MoonshotProvider directly against the live wired `MeteringService`
 * so the recording side is exercised end-to- end. Moonshot is OpenAI-compatible
 * so the OpenAI SDK is mocked at the module boundary; that's the real network
 * egress point. Image- inlining behaviour is covered by
 * `utils/inlineImages.test.ts`; here we stub `inlineHttpImageUrls` so http URLs
 * in vision messages don't trigger network fetches and only verify the provider
 * invokes it for vision-capable models. The companion integration test
 * (MoonshotProvider.integration.test.ts) exercises the real Moonshot endpoint.
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

import { ChatCompletionDriver } from '../../ChatCompletionDriver.js';
import { clearUnhealthyRoutes } from '../../utils/providerHealth.js';
import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import {
    readStreamResult,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { MOONSHOT_MODELS } from './models.js';
import { MoonshotProvider } from './MoonshotProvider.js';
import {
    estimatePromptTokens,
    estimateTextTokens,
} from '../../utils/usageEstimate.js';
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
    /** Catalog rates in µ¢ per token: $2/$10 for Pro, $4/$20 for Highspeed. */
    const rates = (model: string) =>
        model.endsWith('highspeed')
            ? { input: 400, output: 2000 }
            : { input: 200, output: 1000 };
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
    const fund = (balance: number) =>
        vi.spyOn(
            server.services.metering,
            'getUsageHeadroom',
        ).mockResolvedValue({ balance, held: 0 });
    const user = (content: string) => [{ role: 'user', content }];

    it.each(models)(
        'maps %s caps and reasoning without sampling parameters',
        async (model) => {
            const { provider } = makeProvider();
            createMock.mockResolvedValueOnce(response());
            await withTestActor(() =>
                provider.complete({
                    model,
                    messages: user('hi'),
                    max_tokens: 512,
                    reasoning_effort: 'high',
                    temperature: 0.2,
                    top_p: 0.1,
                }),
            );
            const sent = createMock.mock.calls[0]![0];
            expect(sent).toMatchObject({
                model,
                max_completion_tokens: 512,
                reasoning_effort: 'high',
            });
            expect(sent).not.toHaveProperty('max_tokens');
            expect(sent).not.toHaveProperty('temperature');
            expect(sent).not.toHaveProperty('top_p');
        },
    );

    it('uses the upstream default output cap and leaves thinking to the model', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(response());
        await withTestActor(() =>
            provider.complete({ model: models[0]!, messages: user('hi') }),
        );
        const sent = createMock.mock.calls[0]![0];
        expect(sent.max_completion_tokens).toBe(131072);
        expect(sent).not.toHaveProperty('thinking');
        expect(sent).not.toHaveProperty('reasoning_effort');
    });

    it.each(['low', 'max'] as const)(
        'forwards %s reasoning effort',
        async (effort) => {
            const { provider } = makeProvider();
            createMock.mockResolvedValueOnce(response());
            await withTestActor(() =>
                provider.complete({
                    model: models[0]!,
                    messages: user('hi'),
                    reasoning_effort: effort,
                }),
            );
            expect(createMock.mock.calls[0]![0].reasoning_effort).toBe(effort);
        },
    );

    it('rejects an unsupported reasoning effort before inference', async () => {
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: models[0]!,
                    messages: user('hi'),
                    reasoning_effort: 'medium',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });

    it.each([
        { options: { reasoning: { effort: 'low' } }, expected: 'low' },
        { options: { reasoning: { effort: 'max' } }, expected: 'max' },
        {
            options: { reasoning: { effort: 'low' }, reasoning_effort: 'high' },
            expected: 'high',
        },
        { options: {}, expected: undefined },
    ])(
        'sends the nested reasoning form through the driver: $options',
        async ({ options, expected }) => {
            createMock.mockResolvedValueOnce(response());
            await withTestActor(() =>
                driver.complete({
                    model: models[0]!,
                    provider: 'moonshotai',
                    messages: user('hi'),
                    ...options,
                } as never),
            );
            expect(createMock).toHaveBeenCalledTimes(1);
            expect(createMock.mock.calls[0]![0].reasoning_effort).toBe(
                expected,
            );
        },
    );

    it.each(['medium', 'none'])(
        'rejects the nested reasoning form %s through the driver',
        async (effort) => {
            await expect(
                withTestActor(() =>
                    driver.complete({
                        model: models[0]!,
                        provider: 'moonshotai',
                        messages: user('hi'),
                        reasoning: { effort },
                    } as never),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect(createMock).not.toHaveBeenCalled();
        },
    );

    it('keeps K3 on max_tokens and bills its cache writes at the K3 write rate', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(response());
        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k3',
                messages: user('hi'),
                max_tokens: 512,
            }),
        );
        const sent = createMock.mock.calls[0]![0];
        expect(sent).toMatchObject({ model: 'kimi-k3', max_tokens: 512 });
        expect(sent).not.toHaveProperty('max_completion_tokens');
        expect(recordSpy).toHaveBeenCalledWith(
            {
                prompt_tokens: 30,
                completion_tokens: 10,
                cached_tokens: 20,
                cache_write_tokens: 50,
            },
            expect.anything(),
            'moonshotai:kimi-k3',
            {
                prompt_tokens: 30 * 300,
                completion_tokens: 10 * 1500,
                cached_tokens: 20 * 30,
                cache_write_tokens: 50 * 300,
            },
        );
    });

    it.each(models)(
        'meters cache reads, writes and uncached input separately for %s',
        async (model) => {
            const { provider } = makeProvider();
            createMock.mockResolvedValueOnce(response());
            const result = await withTestActor(() =>
                provider.complete({ model, messages: user('hi') }),
            );
            const { input, output } = rates(model);
            expect(recordSpy).toHaveBeenCalledWith(
                {
                    prompt_tokens: 30,
                    completion_tokens: 10,
                    cached_tokens: 20,
                    cache_write_tokens: 50,
                },
                expect.anything(),
                `moonshotai:${model}`,
                {
                    prompt_tokens: 30 * input,
                    completion_tokens: 10 * output,
                    cached_tokens: 20 * 20,
                    cache_write_tokens: 50 * input,
                },
            );
            expect(result).toMatchObject({
                usageDetails: {
                    inputTokens: 30,
                    outputTokens: 10,
                    cacheReadTokens: 20,
                    cacheWrite5mTokens: 50,
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
        createMock.mockResolvedValueOnce(first);
        const result = await withTestActor(() =>
            provider.complete({ model: models[0]!, messages: user('hi') }),
        );
        createMock.mockResolvedValueOnce(response());
        await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: [(result as { message: unknown }).message],
            }),
        );
        const replayed = createMock.mock.calls[1]![0].messages[0];
        expect(replayed).toMatchObject({
            role: 'assistant',
            content: 'answer',
            reasoning_content: 'reasoning',
        });
        expect(replayed).not.toHaveProperty('reasoning');
        expect(replayed.tool_calls).toEqual(toolCalls);
        createMock.mockResolvedValueOnce(response());
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

    it('meters a stream from its final usage chunk', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { reasoning_content: 'reasoning' } }] },
                { choices: [{ delta: { content: 'answer' } }] },
                { choices: [], usage: structuredClone(usage) },
            ]),
        );
        const result = await withTestActor(() =>
            provider.complete({
                model: models[0]!,
                messages: user('hi'),
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
            cache_write_tokens: 50,
        });
    });

    it.each(models)(
        'reserves the prompt at the input rate for %s',
        async (model) => {
            const { input, output } = rates(model);
            fund(2_000_000_000);
            const reserve = vi.spyOn(
                server.services.metering,
                'reserveCredits',
            );
            createMock.mockResolvedValueOnce({
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
            });
            await withTestActor(() =>
                driver.complete({
                    model,
                    provider: 'moonshotai',
                    messages: user('x'.repeat(8_000_000)),
                    max_tokens: 10,
                }),
            );
            expect(reserve).toHaveBeenCalledTimes(1);
            expect(reserve.mock.calls[0]![1]).toBeGreaterThanOrEqual(
                1_000_000 * input + 10 * output,
            );
            expect(reserve.mock.calls[0]![1]).toBeLessThan(
                1_000_001 * input + 10 * output,
            );
            expect(recordSpy.mock.calls[0]![0]).toMatchObject({
                prompt_tokens: 0,
                completion_tokens: 10,
                cached_tokens: 100_000,
                cache_write_tokens: 900_000,
            });
        },
    );

    it.each(['kimi-k3', 'kimi-k2.6'])(
        'keeps the existing reservation for %s',
        async (model) => {
            const entry = MOONSHOT_MODELS.find(
                (candidate) => candidate.id === model,
            )!;
            fund(2_000_000_000);
            const reserve = vi.spyOn(
                server.services.metering,
                'reserveCredits',
            );
            createMock.mockResolvedValueOnce(response());
            await withTestActor(() =>
                driver.complete({
                    model,
                    provider: 'moonshotai',
                    messages: [
                        {
                            role: 'assistant',
                            content: 'x'.repeat(8000),
                            reasoning: 'thought '.repeat(90000),
                        },
                    ],
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
        'rejects an underfunded request for %s before inference',
        async (model) => {
            // Short of the prompt alone at the input rate.
            fund(model.endsWith('highspeed') ? 300_000_000 : 150_000_000);
            await expect(
                withTestActor(() =>
                    driver.complete({
                        model,
                        provider: 'moonshotai',
                        messages: user('x'.repeat(8_000_000)),
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
            createMock.mockResolvedValueOnce({
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
            });
            const first = await withTestActor(() =>
                driver.complete({
                    model: models[0]!,
                    provider: 'moonshotai',
                    messages: user('weather?'),
                }),
            );
            createMock.mockResolvedValueOnce(response());
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
            });
            expect(assistant).not.toHaveProperty('normalized');
            expect(assistant.tool_calls).toEqual(toolCalls);
            expect(
                JSON.parse(assistant.tool_calls[0].function.arguments),
            ).toEqual({ city: 'Paris' });
        },
    );

    it.each([{ city: 'Paris' }, '{"city":"Paris"}'])(
        'keeps native tool_use input %j through the driver',
        async (input) => {
            createMock.mockResolvedValueOnce(response());
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
            expect(assistant.tool_calls[0].function.arguments).toBe(
                '{"city":"Paris"}',
            );
        },
    );

    it.each(
        models.flatMap((model) =>
            ['reasoning', 'reasoning_content', 'both'].map((alias) => ({
                model,
                alias,
            })),
        ),
    )(
        'reserves replayed reasoning once with wire precedence: $model $alias',
        async ({ model, alias }) => {
            const text = 'reasoning '.repeat(90000);
            const assistant = {
                role: 'assistant',
                content: 'answer',
                ...(alias !== 'reasoning_content'
                    ? { reasoning: alias === 'both' ? 'short' : text }
                    : {}),
                ...(alias !== 'reasoning' ? { reasoning_content: text } : {}),
            };
            const messages = [
                ...user('hi'),
                assistant,
                ...user('continue'),
            ];
            const tokens =
                estimatePromptTokens(messages) + estimateTextTokens(text);
            const { input, output } = rates(model);
            const headroom = fund(2_000_000_000);
            const reserve = vi.spyOn(
                server.services.metering,
                'reserveCredits',
            );
            createMock.mockResolvedValueOnce(response());
            await withTestActor(() =>
                driver.complete({
                    model,
                    messages: structuredClone(messages),
                    max_tokens: 10,
                }),
            );
            expect(reserve.mock.calls[0]![1]).toBe(
                tokens * input + 10 * output,
            );
            expect(
                createMock.mock.calls[0]![0].messages[1].reasoning_content,
            ).toBe(text);
            headroom.mockResolvedValue({
                balance: tokens * input - 1,
                held: 0,
            });
            await expect(
                withTestActor(() =>
                    driver.complete({
                        model,
                        messages: structuredClone(messages),
                        max_tokens: 10,
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 402 });
            expect(createMock).toHaveBeenCalledTimes(1);
            expect(reserve).toHaveBeenCalledTimes(1);
        },
    );

    it.each(models)(
        'charges the estimate, replayed reasoning included, when a %s stream is interrupted',
        async (model) => {
            const reasoning = 'history '.repeat(1000);
            const messages = [
                {
                    role: 'assistant',
                    content: 'answer',
                    reasoning: 'ignored alias',
                    reasoning_content: reasoning,
                },
                ...user('hi'),
            ];
            const expectedInput =
                estimatePromptTokens(messages) + estimateTextTokens(reasoning);
            createMock.mockResolvedValueOnce(
                (async function* () {
                    yield {
                        choices: [{ delta: { content: 'partial answer' } }],
                    };
                    throw new Error('upstream connection lost');
                })(),
            );
            const result = await withTestActor(() =>
                driver.complete({
                    model,
                    messages: structuredClone(messages),
                    stream: true,
                }),
            );
            const text = (await readStreamResult(result)).toString();
            expect(text).toContain('upstream connection lost');
            await vi.waitFor(() => expect(recordSpy).toHaveBeenCalledTimes(1));
            expect(
                createMock.mock.calls[0]![0].messages[0].reasoning_content,
            ).toBe(reasoning);
            expect(recordSpy.mock.calls[0]![0]).toHaveProperty(
                'estimated_prompt_tokens',
                expectedInput,
            );
            expect(recordSpy.mock.calls[0]![0]).toHaveProperty(
                'estimated_completion_tokens',
            );
        },
    );

    it.each(models)(
        'charges the estimate when a %s stream completes without a usage chunk',
        async (model) => {
            createMock.mockResolvedValueOnce(
                asAsyncIterable([
                    { choices: [{ delta: { content: 'answer' } }] },
                    { choices: [{ delta: {}, finish_reason: 'stop' }] },
                ]),
            );
            const result = await withTestActor(() =>
                driver.complete({
                    model,
                    provider: 'moonshotai',
                    messages: user('hi'),
                    stream: true,
                }),
            );
            const events = (await readStreamResult(result))
                .toString()
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(events.some((event) => event.type === 'error')).toBe(false);
            await vi.waitFor(() => expect(recordSpy).toHaveBeenCalledTimes(1));
            expect(recordSpy.mock.calls[0]![0]).toMatchObject({
                estimated_prompt_tokens: expect.any(Number),
                estimated_completion_tokens: expect.any(Number),
            });
        },
    );
});
