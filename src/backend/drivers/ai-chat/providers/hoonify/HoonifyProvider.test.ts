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
 * Offline unit tests for HoonifyProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs HoonifyProvider directly against the live
 * wired `MeteringService` so the recording side is exercised
 * end-to-end. The OpenAI SDK is mocked at the module boundary —
 * Hoonify is OpenAI-compatible so the provider talks to it through
 * the same client — so the provider never reaches the network. The
 * companion integration test (HoonifyProvider.integration.test.ts)
 * exercises the real Hoonify endpoint.
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
import { HOONIFY_MODELS } from './models.js';
import { HoonifyProvider } from './HoonifyProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────
//
// `vi.hoisted` lets us share spies between the (hoisted) factory and
// the test body so each test can stub `chat.completions.create` with
// the response shape it cares about. Hoonify uses the OpenAI wire
// shape so the provider talks to it via the OpenAI SDK.

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
    // Some providers (e.g. OllamaChatProvider) import the default export
    // and access `.OpenAI` on it, so expose the same constructor under
    // both shapes — the test server boots every provider, not just
    // Hoonify.
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (
    config: { apiKey?: string; apiBaseUrl?: string } = {},
) => {
    const provider = new HoonifyProvider(
        {
            apiKey: config.apiKey ?? 'hooni_test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
        },
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
    createMock.mockReset();
    openAICtor.mockReset();
    // Spy on the live MeteringService — we don't replace the impl
    // (that would skip the recording side we want covered) but we
    // capture the calls the provider makes so per-test assertions
    // can verify metering shape.
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('HoonifyProvider construction', () => {
    it('points the OpenAI SDK at the Hoonify base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'hooni_test-key',
            baseURL: 'https://api.hoonify.ai/v1',
        });
    });

    it('honours a custom apiBaseUrl override', () => {
        makeProvider({ apiBaseUrl: 'https://staging.hoonify.test/v1' });
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'hooni_test-key',
            baseURL: 'https://staging.hoonify.test/v1',
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('HoonifyProvider model catalog', () => {
    it('returns hoonify:google/gemma-4-31b-it as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            'hoonify:google/gemma-4-31b-it',
        );
    });

    it('exposes the static HOONIFY_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(HOONIFY_MODELS);
    });

    it('list() flattens canonical ids and aliases', () => {
        const { provider } = makeProvider();
        const names = provider.list();
        for (const m of HOONIFY_MODELS) {
            expect(names).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(names).toContain(a);
            }
        }
        // Sanity: a known alias resolves alongside its canonical id.
        expect(names).toContain('hoonify:zai-org/glm-5.2');
        expect(names).toContain('hoonify/zai-org/glm-5.2');
        expect(names).toContain('zai-org/glm-5.2');
    });

    it('every catalog id is lowercase and namespaced; wireId keeps exact case', () => {
        for (const m of HOONIFY_MODELS) {
            expect(m.id).toBe(m.id.toLowerCase());
            expect(m.id).toBe(`hoonify:${m.wireId.toLowerCase()}`);
        }
    });

    it('aliases qwen/qwen3.6-27b to join the Alibaba bucket as a fallback', () => {
        // Aggregator entries join a first-party bucket by sharing an alias;
        // `AGGREGATOR_PROVIDERS` ranks Hoonify behind the vendor so it only
        // serves once Alibaba's route fails.
        const { provider } = makeProvider();
        expect(provider.list()).toContain('qwen/qwen3.6-27b');
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('HoonifyProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('sends the exact-case wire id, not the lowercased catalog id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'hoonify:qwen/qwen3.6-27b',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('Qwen/Qwen3.6-27B');
    });

    it('forwards messages and omits optional knobs unless supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect('max_tokens' in args).toBe(false);
        expect('temperature' in args).toBe(false);
        expect('top_p' in args).toBe(false);
        expect('top_k' in args).toBe(false);
        expect('tools' in args).toBe(false);
        expect('tool_choice' in args).toBe(false);
    });

    it('forwards max_tokens, temperature, top_p, tools, and tool_choice when supplied', async () => {
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
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 256,
                temperature: 0.4,
                top_p: 0.9,
                tools,
                tool_choice: 'auto',
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.max_tokens).toBe(256);
        expect(args.temperature).toBe(0.4);
        expect(args.top_p).toBe(0.9);
        expect(args.tools).toBe(tools);
        expect(args.tool_choice).toBe('auto');
    });

    it('forwards the Hoonify-specific custom top_k extension', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hi' }],
                custom: { top_k: 40 },
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.top_k).toBe(40);
    });

    it('strips Anthropic-style cache_control from messages before sending', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'hoonify:zai-org/glm-5.2',
                messages: [
                    {
                        role: 'user',
                        content: 'hi',
                        cache_control: { type: 'ephemeral' },
                    } as unknown as { role: string; content: string },
                ],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('cache_control' in args.messages[0]).toBe(false);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();
        // Non-stream path.
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        const [nonStreamArgs] = createMock.mock.calls[0]!;
        expect(nonStreamArgs.stream).toBe(false);
        expect('stream_options' in nonStreamArgs).toBe(false);

        // Stream path.
        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        const [streamArgs] = createMock.mock.calls[1]!;
        expect(streamArgs.stream).toBe(true);
        expect(streamArgs.stream_options).toEqual({ include_usage: true });
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('HoonifyProvider model resolution', () => {
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
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('zai-org/GLM-5.2');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'hoonify:zai-org/glm-5.2',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical wire id (alias rewriting)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'hoonify/google/gemma-4-31b-it',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe(
            'google/gemma-4-31B-it',
        );
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'hoonify:google/gemma-4-31b-it',
            expect.any(Object),
        );
    });

    it('falls back to the default model when given an unknown id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'totally-not-a-real-model',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe(
            'google/gemma-4-31B-it',
        );
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'hoonify:google/gemma-4-31b-it',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('HoonifyProvider.complete non-stream output', () => {
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
                model: 'hoonify:zai-org/glm-5.2',
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
            cached_tokens: 10,
        });

        // Cost overrides scale per-token usage by the per-token cents from
        // the model's costs table, so derive expectations from
        // HOONIFY_MODELS directly to avoid hardcoded float-precision drift.
        const glm = HOONIFY_MODELS.find(
            (m) => m.id === 'hoonify:zai-org/glm-5.2',
        )!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('hoonify:zai-org/glm-5.2');
        expect(overrides.prompt_tokens).toBeCloseTo(
            100 * Number(glm.costs.prompt_tokens),
            5,
        );
        expect(overrides.completion_tokens).toBeCloseTo(
            50 * Number(glm.costs.completion_tokens),
            5,
        );
        expect(overrides.cached_tokens).toBeCloseTo(
            10 * Number(glm.costs.cached_tokens ?? 0),
            5,
        );
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
                model: 'hoonify:zai-org/glm-5.2',
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
                model: 'hoonify:zai-org/glm-5.2',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('HoonifyProvider.complete streaming', () => {
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
                model: 'hoonify:zai-org/glm-5.2',
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
            cached_tokens: 1,
        });

        const glm = HOONIFY_MODELS.find(
            (m) => m.id === 'hoonify:zai-org/glm-5.2',
        )!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('hoonify:zai-org/glm-5.2');
        expect(overrides.prompt_tokens).toBeCloseTo(
            4 * Number(glm.costs.prompt_tokens),
            5,
        );
        expect(overrides.completion_tokens).toBeCloseTo(
            2 * Number(glm.costs.completion_tokens),
            5,
        );
        expect(overrides.cached_tokens).toBeCloseTo(
            1 * Number(glm.costs.cached_tokens ?? 0),
            5,
        );
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
                model: 'hoonify:zai-org/glm-5.2',
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

describe('HoonifyProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('Hoonify exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'hoonify:zai-org/glm-5.2',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        // No metering should be recorded on a failed call.
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('HoonifyProvider.checkModeration', () => {
    it('throws — Hoonify provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
