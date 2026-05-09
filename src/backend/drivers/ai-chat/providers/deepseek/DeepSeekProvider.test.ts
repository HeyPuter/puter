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
 * Offline unit tests for DeepSeekProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs DeepSeekProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. DeepSeek is OpenAI-compatible so the OpenAI SDK is mocked at
 * the module boundary; that's the real network egress point. The
 * companion integration test (DeepSeekProvider.integration.test.ts)
 * exercises the real DeepSeek endpoint.
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
import { DEEPSEEK_MODELS } from './models.js';
import { DeepSeekProvider } from './DeepSeekProvider.js';

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

const makeProvider = () => {
    const provider = new DeepSeekProvider(
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
    createMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('DeepSeekProvider construction', () => {
    it('points the OpenAI SDK at the DeepSeek base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.deepseek.com',
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('DeepSeekProvider model catalog', () => {
    it('returns deepseek-chat as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('deepseek-chat');
    });

    it('exposes the static DEEPSEEK_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(DEEPSEEK_MODELS);
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        for (const m of DEEPSEEK_MODELS) {
            expect(ids).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(ids).toContain(a);
            }
        }
        expect(ids).toContain('deepseek-chat');
        expect(ids).toContain('deepseek/deepseek-chat');
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('DeepSeekProvider.complete request shape', () => {
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
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('deepseek-chat');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_tokens).toBe(1000);
    });

    it('respects an explicit max_tokens override', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 256,
            }),
        );

        expect(createMock.mock.calls[0]![0].max_tokens).toBe(256);
    });

    it('omits the `tools` key entirely when no tools are supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('tools' in args).toBe(false);
    });

    it('passes tool definitions through unchanged when supplied', async () => {
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
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
            }),
        );

        expect(createMock.mock.calls[0]![0].tools).toBe(tools);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'deepseek-chat',
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
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        const [streamArgs] = createMock.mock.calls[1]!;
        expect(streamArgs.stream).toBe(true);
        expect(streamArgs.stream_options).toEqual({ include_usage: true });
    });

    it('blanks string-array content alongside tool_calls (DeepSeek rejects that combo)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'assistant',
                        // Already-shaped OpenAI message with tool_calls AND
                        // array content — the combination DeepSeek rejects.
                        content: [{ type: 'text', text: 'thinking…' }],
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
                ],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // DeepSeek-specific: when both tool_calls and array content survive
        // process_input_messages, content gets blanked to ''.
        expect(args.messages[0].content).toBe('');
        expect(args.messages[0].tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"puter"}' },
            },
        ]);
    });

    it('hoists Puter-style tool_use blocks into OpenAI tool_calls before sending', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'deepseek-chat',
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

    it('injects a system reminder after each tool message (workaround for DeepSeek tool-result loop)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'deepseek-chat',
                messages: [
                    { role: 'user', content: 'do tool call' },
                    {
                        role: 'tool',
                        tool_call_id: 'call_1',
                        content: 'tool-result-text',
                    },
                ],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // After the tool message there should be an injected system message
        // referencing the same tool_call_id.
        const toolIdx = args.messages.findIndex(
            (m: { role: string }) => m.role === 'tool',
        );
        expect(toolIdx).toBeGreaterThanOrEqual(0);
        const injected = args.messages[toolIdx + 1];
        expect(injected.role).toBe('system');
        const text = Array.isArray(injected.content)
            ? injected.content[0].text
            : injected.content;
        expect(text).toMatch(/call_1/);
        expect(text).toMatch(/tool-result-text/);
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('DeepSeekProvider model resolution', () => {
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
                model: 'deepseek-reasoner',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('deepseek-reasoner');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'deepseek:deepseek-reasoner',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical id (alias rewriting)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // `deepseek/deepseek-chat` is an alias of `deepseek-chat`.
                model: 'deepseek/deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('deepseek-chat');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'deepseek:deepseek-chat',
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

        expect(createMock.mock.calls[0]![0].model).toBe('deepseek-chat');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'deepseek:deepseek-chat',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('DeepSeekProvider.complete non-stream output', () => {
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
                model: 'deepseek-chat',
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

        // deepseek-chat costs: prompt=56, completion=168, cached=0.
        const chat = DEEPSEEK_MODELS.find((m) => m.id === 'deepseek-chat')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('deepseek:deepseek-chat');
        expect(overrides).toEqual({
            prompt_tokens: 100 * Number(chat.costs.prompt_tokens),
            completion_tokens: 50 * Number(chat.costs.completion_tokens),
            cached_tokens: 10 * Number(chat.costs.cached_tokens ?? 0),
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
                model: 'deepseek-chat',
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
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('DeepSeekProvider.complete streaming', () => {
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
                model: 'deepseek-chat',
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

        const chat = DEEPSEEK_MODELS.find((m) => m.id === 'deepseek-chat')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('deepseek:deepseek-chat');
        expect(overrides).toEqual({
            prompt_tokens: 4 * Number(chat.costs.prompt_tokens),
            completion_tokens: 2 * Number(chat.costs.completion_tokens),
            cached_tokens: 1 * Number(chat.costs.cached_tokens ?? 0),
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
                model: 'deepseek-chat',
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

describe('DeepSeekProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('DeepSeek exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        // No metering should be recorded on a failed call.
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('DeepSeekProvider.checkModeration', () => {
    it('throws — DeepSeek provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
