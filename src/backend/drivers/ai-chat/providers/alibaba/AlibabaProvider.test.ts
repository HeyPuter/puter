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
 * Offline unit tests for AlibabaProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs AlibabaProvider directly against the live wired `MeteringService`
 * so the recording side is exercised end-to- end. Alibaba is OpenAI-compatible
 * so the OpenAI SDK is mocked at the module boundary; that's the real network
 * egress point. The companion integration test
 * (AlibabaProvider.integration.test.ts) exercises the real DashScope endpoint.
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

import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { mapAlibabaCatalogModel, type AlibabaApiModel } from './catalog.js';
import page1 from './fixtures/page1.test.json';
import page2 from './fixtures/page2.test.json';
import { CATALOG_TTL_MS } from '../../utils/cachedRemoteCatalog.js';
import { ALIBABA_MODELS } from './models.js';
import { AlibabaProvider } from './AlibabaProvider.js';
import { modelLookupNames } from '../../utils/modelRouting.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { createMock, openAICtor, axiosGetMock } = vi.hoisted(() => {
    const createMock = vi.fn();
    const openAICtor = vi.fn();
    return { createMock, openAICtor, axiosGetMock: vi.fn() };
});

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

vi.mock('axios', () => ({ default: { get: axiosGetMock } }));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (config?: { apiKey?: string; apiBaseUrl?: string }) => {
    const provider = new AlibabaProvider(
        { apiKey: 'test-key', ...config },
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
    axiosGetMock.mockReset();
    axiosGetMock.mockRejectedValue(new Error('Catalog unavailable'));
    createMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('AlibabaProvider construction', () => {
    it('points the OpenAI SDK at the DashScope base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
            maxRetries: 0,
            timeout: 10 * 60 * 1000,
        });
    });

    it('uses a custom base URL when configured', () => {
        makeProvider({ apiBaseUrl: 'https://custom.endpoint/v1' });
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://custom.endpoint/v1',
            maxRetries: 0,
            timeout: 10 * 60 * 1000,
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('AlibabaProvider model catalog', () => {
    it('returns qwen-plus-latest as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('qwen-plus-latest');
    });

    it('uses the curated catalog when the initial fetch fails', async () => {
        const { provider } = makeProvider();
        expect(await provider.models()).toBe(ALIBABA_MODELS);
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const ids = modelLookupNames(await provider.models());
        for (const m of ALIBABA_MODELS) {
            expect(ids).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(ids).toContain(a);
            }
        }
        expect(ids).toContain('qwen-plus');
        expect(ids).toContain('qwen/qwen-plus');
        expect(ids).toContain('qwen-max');
        expect(ids).toContain('qwen/qwen-max');
    });

    it.each([
        ['qwen3.8-flash', 15, 47, 1.6],
        ['qwen3.8-omni-flash', 15, 47, 1.6],
        ['qwen3.8-max-0902', 200, 600, 25],
        // No cache discount: cached reads bill at the input rate.
        ['qwen3.7-max-2026-05-17', 250, 750, undefined],
        ['deepseek-v4.1-flash', 30, 120, undefined],
    ])('exposes %s at its list price', (id, input, output, cached) => {
        const model = ALIBABA_MODELS.find((m) => m.id === id);
        expect(model?.costs).toMatchObject({
            prompt_tokens: input,
            completion_tokens: output,
        });
        expect(model?.costs.cached_tokens).toBe(cached);
    });

    it.each([
        'qwen3-max',
        'qwen3.6-max-preview',
        'qwen-turbo',
        'qwen3-vl-flash',
        'qwen3-coder-plus',
        'qwen-omni-turbo',
        'deepseek-v4-flash',
    ])('drops %s, which Model Studio is retiring', async (id) => {
        const { provider } = makeProvider();
        expect(modelLookupNames(await provider.models())).not.toContain(id);
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('AlibabaProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('forwards model + messages and defaults max_tokens to 1000 when caller omits it', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('qwen-plus');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_tokens).toBe(1000);
    });

    it('respects an explicit max_tokens override', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 256,
            }),
        );

        expect(createMock.mock.calls[0]![0].max_tokens).toBe(256);
    });

    it('forwards max_tokens 0 instead of substituting the default 1000', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 0,
            }),
        );

        expect(createMock.mock.calls[0]![0].max_tokens).toBe(0);
    });

    it('forwards temperature when supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
                temperature: 0.7,
            }),
        );

        expect(createMock.mock.calls[0]![0].temperature).toBe(0.7);
    });

    it('omits the `tools` key entirely when no tools are supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
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
                    parameters: { type: 'object', properties: {} },
                },
            },
        ];
        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
            }),
        );

        expect(createMock.mock.calls[0]![0].tools).toEqual(tools);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
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
                model: 'qwen-plus',
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
                model: 'qwen-plus',
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

// ── Model resolution ────────────────────────────────────────────────

describe('AlibabaProvider model resolution', () => {
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
                model: 'qwen-max',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('qwen-max');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'alibaba:qwen-max',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical id (alias rewriting)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'qwen/qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('qwen-plus');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'alibaba:qwen-plus',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('AlibabaProvider.complete non-stream output', () => {
    it('returns the first choice and runs the metered usage calculator', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hi there', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 0,
        });

        const qwenPlus = ALIBABA_MODELS.find((m) => m.id === 'qwen-plus')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 0,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('alibaba:qwen-plus');
        expect(overrides).toEqual({
            prompt_tokens: 100 * Number(qwenPlus.costs.prompt_tokens),
            completion_tokens: 50 * Number(qwenPlus.costs.completion_tokens),
            cached_tokens: 0,
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
                model: 'qwen-plus',
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
                function: { name: 'lookup', arguments: '{"q":"puter"}' },
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
                model: 'qwen-plus',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });

    it('accounts for cached_tokens when prompt_tokens_details is present', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 50,
                completion_tokens: 20,
                prompt_tokens_details: { cached_tokens: 15 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'qwen3.8-max',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const model = ALIBABA_MODELS.find((m) => m.id === 'qwen3.8-max')!;
        const [usage, , prefix, overrides] = recordSpy.mock.calls[0]!;
        // Cached reads come out of `prompt_tokens`; they're priced once.
        expect(usage).toEqual({
            prompt_tokens: 35,
            completion_tokens: 20,
            cached_tokens: 15,
        });
        expect(prefix).toBe('alibaba:qwen3.8-max');
        expect(overrides).toEqual({
            prompt_tokens: 35 * Number(model.costs.prompt_tokens),
            completion_tokens: 20 * Number(model.costs.completion_tokens),
            cached_tokens: 15 * Number(model.costs.cached_tokens ?? 0),
        });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('AlibabaProvider.complete streaming', () => {
    it('streams text deltas through to text events and meters final usage', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                {
                    choices: [{ delta: {} }],
                    usage: { prompt_tokens: 4, completion_tokens: 2 },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'qwen-plus',
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
            prompt_tokens: 4,
            completion_tokens: 2,
            cached_tokens: 0,
        });

        const qwenPlus = ALIBABA_MODELS.find((m) => m.id === 'qwen-plus')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('alibaba:qwen-plus');
        expect(overrides).toEqual({
            prompt_tokens: 4 * Number(qwenPlus.costs.prompt_tokens),
            completion_tokens: 2 * Number(qwenPlus.costs.completion_tokens),
            cached_tokens: 0,
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
                model: 'qwen-plus',
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

describe('AlibabaProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('DashScope exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'qwen-plus',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('AlibabaProvider.checkModeration', () => {
    it('throws — Alibaba provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});

describe('Alibaba official catalog', () => {
    const seedPages = () => {
        axiosGetMock.mockReset();
        axiosGetMock
            .mockResolvedValueOnce({ data: page1 })
            .mockResolvedValueOnce({ data: page2 });
    };

    it('fetches all official pages, deduplicates ids and preserves curated aliases and prices', async () => {
        seedPages();
        const { provider } = makeProvider();
        const [models, concurrent] = await Promise.all([
            provider.models(),
            provider.models(),
        ]);
        expect(concurrent).toBe(models);
        expect(axiosGetMock).toHaveBeenCalledTimes(2);
        expect(axiosGetMock.mock.calls.map((call) => call[0])).toEqual([
            'https://dashscope-intl.aliyuncs.com/api/v1/models',
            'https://dashscope-intl.aliyuncs.com/api/v1/models',
        ]);
        expect(
            axiosGetMock.mock.calls.map((call) => call[1].params.page_no),
        ).toEqual([1, 2]);
        expect(axiosGetMock.mock.calls[0][1]).toMatchObject({
            headers: { Authorization: 'Bearer test-key' },
            params: { page_size: 100, language: 'en-US' },
            signal: expect.any(AbortSignal),
        });
        expect(
            models.filter((model) => model.id === 'qwen-catalog-fixture'),
        ).toHaveLength(1);
        expect(models.some((model) => model.id === 'qwen-image-fixture')).toBe(
            false,
        );
        const plus = models.find((model) => model.id === 'qwen-plus')!;
        const original = ALIBABA_MODELS.find(
            (model) => model.id === 'qwen-plus',
        )!;
        expect(plus.costs).toBe(original.costs);
        expect(plus.aliases).toEqual(original.aliases);
        expect(plus.puterId).toBe(original.puterId);
        expect(plus.release_date).toBe(original.release_date);
        expect(models.some((model) => model.id === 'qwen-max')).toBe(true);
        expect(await provider.models()).toBe(models);
        expect(axiosGetMock).toHaveBeenCalledTimes(2);
    });

    it('normalizes capabilities, limits, release and retirement metadata', () => {
        const model = mapAlibabaCatalogModel(
            page1.output.models[1] as AlibabaApiModel,
        );
        expect(model).toMatchObject({
            id: 'qwen-catalog-fixture',
            context: 131072,
            max_tokens: 16384,
            maxInputTokens: 130048,
            maxReasoningTokens: 8192,
            reasoningMaxInputTokens: 64000,
            reasoningMaxOutputTokens: 8192,
            tool_call: true,
            modalities: { input: ['text', 'image'], output: ['text'] },
            release_date: '2026-08-01',
            equivalentSnapshot: 'qwen-catalog-fixture-0801',
            retirementDates: { international: '2027-01-01 00:00:00' },
        });
    });

    it('normalizes unit denominators and preserves unknown currency, cache prices and abbreviated boundaries', () => {
        const model = mapAlibabaCatalogModel(
            page1.output.models[1] as AlibabaApiModel,
        )!;
        expect(model.costs).toEqual({ tokens: 1_000_000 });
        expect(model.catalogPricing).toMatchObject([
            {
                minInputTokensExclusive: 0,
                maxInputTokensInclusive: 32768,
                prices: [
                    { amount: 0.002, tokens: 1000, perMillionTokens: 2 },
                    { amount: 8, tokens: 1_000_000, perMillionTokens: 8 },
                    { amount: undefined, perMillionTokens: undefined },
                ],
            },
            { name: '32k<Input<=128k' },
        ]);
        const tiers =
            model.catalogPricing as import('./catalog.js').AlibabaCatalogTier[];
        expect(tiers[0].prices[0].currency).toBeUndefined();
        expect(tiers[1].minInputTokensExclusive).toBeUndefined();
        expect(tiers[1].maxInputTokensInclusive).toBeUndefined();
    });

    it.each([null, '', -1, 'TBD'])(
        'keeps ambiguous price %s unknown',
        (value) => {
            const model = mapAlibabaCatalogModel({
                model: 'fixture',
                capabilities: ['TG'],
                prices: [
                    {
                        range_name: 'Default',
                        prices: [
                            {
                                type: 'input_token',
                                price: value,
                                price_unit: 'per million tokens',
                            },
                        ],
                    },
                ],
            })!;
            expect(model.catalogPricing).toMatchObject([
                {
                    prices: [
                        { amount: undefined, perMillionTokens: undefined },
                    ],
                },
            ]);
            expect(model.costs).toEqual({ tokens: 1_000_000 });
        },
    );

    it('does not infer limits or release dates from missing, null or zero fields', () => {
        const model = mapAlibabaCatalogModel({
            model: 'fixture',
            capabilities: ['TG'],
            published_time: '0',
            model_info: { context_window: null, max_output_tokens: 0 },
        })!;
        expect(model.release_date).toBeUndefined();
        expect(model.context).toBeUndefined();
        expect(model.max_tokens).toBe(0);
        expect(model.costs).toEqual({ tokens: 1_000_000 });
    });

    it('refuses inference with unverified catalog prices', async () => {
        seedPages();
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'qwen-catalog-fixture',
                    messages: [],
                }),
            ),
        ).rejects.toMatchObject({ legacyCode: 'model_pricing_unavailable' });
        expect(createMock).not.toHaveBeenCalled();
        expect(recordSpy).not.toHaveBeenCalled();
    });

    it.each(['failed', 'malformed', 'empty', 'repeated'])(
        'keeps the full last-good catalog after a %s refresh page',
        async (failure) => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            seedPages();
            const { provider } = makeProvider();
            const good = await provider.models();
            vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
            axiosGetMock.mockResolvedValueOnce({ data: page1 });
            if (failure === 'failed')
                axiosGetMock.mockRejectedValueOnce(new Error('unavailable'));
            else if (failure === 'malformed')
                axiosGetMock.mockResolvedValueOnce({
                    data: { success: false },
                });
            else if (failure === 'empty')
                axiosGetMock.mockResolvedValueOnce({
                    data: {
                        success: true,
                        output: { total: 4, page_no: 2, models: [] },
                    },
                });
            else
                axiosGetMock.mockResolvedValueOnce({
                    data: { ...page1, output: { ...page1.output, page_no: 2 } },
                });
            expect(await provider.models()).toBe(good);
            expect(await provider.models()).toBe(good);
            expect(axiosGetMock).toHaveBeenCalledTimes(4);
        },
    );
});


it('keeps previously discovered Alibaba models when a successful refresh omits them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    axiosGetMock.mockReset();
    axiosGetMock.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });
    const { provider } = makeProvider();
    await provider.models();
    vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
    axiosGetMock.mockResolvedValueOnce({ data: { success: true, output: { total: 0, page_no: 1, models: [] } } });
    expect((await provider.models()).some(model => model.id === 'qwen-catalog-fixture')).toBe(true);
});


it.each([
    ['per token', 1, 2000], ['per thousand tokens', 1000, 2],
    ['per million tokens', 1_000_000, 0.002], ['per image', undefined, undefined],
])('normalizes Alibaba unit %s without assigning a currency', (unit, tokens, perMillionTokens) => {
    const model = mapAlibabaCatalogModel({ model: 'fixture', capabilities: ['TG'], prices: [{
        range_name: 'Default', prices: [{ type: 'input_token', price: '0.002', price_unit: unit }],
    }] })!;
    const [tier] = model.catalogPricing as import('./catalog.js').AlibabaCatalogTier[];
    expect(tier.prices[0].tokens).toBe(tokens);
    expect(tier.prices[0].perMillionTokens).toBe(perMillionTokens);
    expect(tier.prices[0].currency).toBeUndefined();
});

it.each(['100<Input<=10', '9007199254740992<Input<=9007199254740993'])('keeps invalid Alibaba range %s unresolved', range => {
    const model = mapAlibabaCatalogModel({ model: 'fixture', capabilities: ['TG'], prices: [{ range_name: range }] })!;
    const [tier] = model.catalogPricing as import('./catalog.js').AlibabaCatalogTier[];
    expect(tier.minInputTokensExclusive).toBeUndefined();
    expect(tier.maxInputTokensInclusive).toBeUndefined();
});


it('uses the official Alibaba catalog path behind a configured proxy prefix', async () => {
    axiosGetMock.mockReset();
    axiosGetMock.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });
    const { provider } = makeProvider({ apiBaseUrl: 'https://custom.endpoint/proxy/compatible-mode/v1' });
    await provider.models();
    expect(axiosGetMock.mock.calls[0][0]).toBe('https://custom.endpoint/proxy/api/v1/models');
});
