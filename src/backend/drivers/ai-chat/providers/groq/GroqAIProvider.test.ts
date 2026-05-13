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
 * Offline unit tests for GroqAIProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs GroqAIProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. The Groq SDK is mocked at the module boundary (the real
 * network egress point) so the provider never reaches the network.
 * The companion integration test (GroqAIProvider.integration.test.ts)
 * exercises the real Groq endpoint.
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
import { GROQ_MODELS } from './models.js';
import { GroqAIProvider } from './GroqAIProvider.js';

// ── Groq SDK mock ───────────────────────────────────────────────────

const { createMock, groqCtor } = vi.hoisted(() => {
    const createMock = vi.fn();
    const groqCtor = vi.fn();
    return { createMock, groqCtor };
});

vi.mock('groq-sdk', () => {
    const GroqCtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        groqCtor(opts);
        this.chat = { completions: { create: createMock } };
    });
    return { default: GroqCtor };
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
    const provider = new GroqAIProvider(
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
    groqCtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('GroqAIProvider construction', () => {
    it('constructs the Groq SDK with the configured API key', () => {
        makeProvider();
        expect(groqCtor).toHaveBeenCalledTimes(1);
        expect(groqCtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('GroqAIProvider model catalog', () => {
    it('returns llama-3.1-8b-instant as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('llama-3.1-8b-instant');
    });

    it('exposes the static GROQ_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(GROQ_MODELS);
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        for (const m of GROQ_MODELS) {
            expect(ids).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(ids).toContain(a);
            }
        }
        expect(ids).toContain('llama-3.1-8b-instant');
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('GroqAIProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('forwards model + messages and renames max_tokens to max_completion_tokens', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
                temperature: 0.4,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('llama-3.1-8b-instant');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        // Groq's SDK uses max_completion_tokens; the provider passes through
        // verbatim with no implicit cap.
        expect(args.max_completion_tokens).toBe(256);
        expect(args.temperature).toBe(0.4);
    });

    it('passes tools through (including undefined when omitted, not deleted from the wire)', async () => {
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
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
            }),
        );

        expect(createMock.mock.calls[0]![0].tools).toBe(tools);
    });

    it('routes via stream=true verbatim (Groq SDK accepts the boolean)', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect(createMock.mock.calls[0]![0].stream).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream).toBe(true);
    });

    it('blanks string-array content alongside tool_calls (Groq follows DeepSeek-style restriction)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'llama-3.1-8b-instant',
                messages: [
                    {
                        role: 'assistant',
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
        expect(args.messages[0].content).toBe('');
        expect(args.messages[0].tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"puter"}' },
            },
        ]);
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('GroqAIProvider model resolution', () => {
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
                model: 'gemma2-9b-it',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('gemma2-9b-it');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'groq:gemma2-9b-it',
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

        expect(createMock.mock.calls[0]![0].model).toBe('llama-3.1-8b-instant');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'groq:llama-3.1-8b-instant',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('GroqAIProvider.complete non-stream output', () => {
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
                model: 'llama-3.1-8b-instant',
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

        // llama-3.1-8b-instant costs: prompt=5, completion=8.
        const llama = GROQ_MODELS.find((m) => m.id === 'llama-3.1-8b-instant')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('groq:llama-3.1-8b-instant');
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 0,
        });
        expect(overrides).toMatchObject({
            prompt_tokens: 100 * Number(llama.costs.prompt_tokens),
            completion_tokens: 50 * Number(llama.costs.completion_tokens),
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
                model: 'llama-3.1-8b-instant',
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
});

// ── Streaming deltas (Groq-specific deviation: x_groq.usage) ────────

describe('GroqAIProvider.complete streaming', () => {
    it('reads usage from the x_groq envelope and meters once at stream end', async () => {
        const { provider } = makeProvider();
        // Groq streams usage on a final `x_groq.usage` envelope rather than a
        // top-level `usage` field. The provider's
        // `index_usage_from_stream_chunk` deviation reaches into x_groq.
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                {
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                    x_groq: {
                        usage: { prompt_tokens: 4, completion_tokens: 2 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'llama-3.1-8b-instant',
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

        // llama-3.1-8b-instant: prompt=5, completion=8.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('groq:llama-3.1-8b-instant');
        expect(overrides).toMatchObject({
            prompt_tokens: 4 * 5,
            completion_tokens: 2 * 8,
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
                    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
                    x_groq: {
                        usage: { prompt_tokens: 1, completion_tokens: 1 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'llama-3.1-8b-instant',
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

describe('GroqAIProvider.complete error mapping', () => {
    it('rethrows errors raised by the Groq client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('Groq exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'llama-3.1-8b-instant',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('GroqAIProvider.checkModeration', () => {
    it('throws — Groq provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
