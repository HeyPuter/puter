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
 * Offline unit tests for MistralAIProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs MistralAIProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. The Mistral SDK is mocked at the module boundary (the real
 * network egress point) so the provider never reaches the network.
 * The companion integration test (MistralAiProvider.integration.test.ts)
 * exercises the real Mistral endpoint.
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
import { MISTRAL_MODELS } from './models.js';
import { MistralAIProvider } from './MistralAiProvider.js';

// ── Mistral SDK mock ────────────────────────────────────────────────
//
// `vi.hoisted` lets us share spies between the (hoisted) factory and
// the test body so each test can stub `chat.complete` / `chat.stream`
// with the response shape it cares about.

const { completeMock, streamMock, mistralCtor } = vi.hoisted(() => ({
    completeMock: vi.fn(),
    streamMock: vi.fn(),
    mistralCtor: vi.fn(),
}));

vi.mock('@mistralai/mistralai', () => ({
    Mistral: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        mistralCtor(opts);
        this.chat = { complete: completeMock, stream: streamMock };
    }),
}));

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
    const provider = new MistralAIProvider(
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
    completeMock.mockReset();
    streamMock.mockReset();
    mistralCtor.mockReset();
    // Spy on the live MeteringService — keep the underlying impl so
    // recording-side bugs surface here, but capture calls so per-test
    // assertions can verify metering shape.
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('MistralAIProvider construction', () => {
    it('constructs the Mistral SDK with the configured API key', () => {
        makeProvider();
        expect(mistralCtor).toHaveBeenCalledTimes(1);
        expect(mistralCtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('MistralAIProvider model catalog', () => {
    it('returns the configured small model as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('mistral-small-2603');
    });

    it('exposes the static MISTRAL_MODELS list verbatim from models()', async () => {
        const { provider } = makeProvider();
        // models() is async on this provider.
        expect(await provider.models()).toBe(MISTRAL_MODELS);
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        for (const m of MISTRAL_MODELS) {
            expect(ids).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(ids).toContain(a);
            }
        }
        // Sanity: a known alias is present alongside its canonical id.
        expect(ids).toContain('mistral-small-latest');
        expect(ids).toContain('mistral-small-2603');
    });
});

// ── Request shape (Mistral-specific quirks) ─────────────────────────

describe('MistralAIProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finishReason: 'stop',
            },
        ],
        usage: { promptTokens: 1, completionTokens: 1 },
    };

    it('forwards model + messages and threads max_tokens/temperature into camelCase fields', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
                temperature: 0.4,
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        expect(args.model).toBe('mistral-small-2603');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        // Mistral's SDK uses maxTokens (camelCase). The provider should
        // adapt our snake_case input.
        expect(args.maxTokens).toBe(256);
        expect(args.temperature).toBe(0.4);
    });

    it('omits the `tools` key when no tools are supplied', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        expect('tools' in args).toBe(false);
    });

    it('passes tool definitions through unchanged when supplied', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

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
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        // Reference equality after the `tools as any[]` cast.
        expect(args.tools).toBe(tools);
    });

    it('rewrites tool_calls/tool_call_id on assistant messages to camelCase before sending', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
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
                    {
                        role: 'tool',
                        tool_call_id: 'call_1',
                        content: 'result',
                    },
                ],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;

        // Assistant: process_input_messages produced tool_calls; then the
        // Mistral provider renames it to toolCalls + nulls content.
        expect(args.messages[0].content).toBeNull();
        expect(args.messages[0].toolCalls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: {
                    name: 'lookup',
                    arguments: JSON.stringify({ q: 'puter' }),
                },
            },
        ]);
        expect('tool_calls' in args.messages[0]).toBe(false);

        // Tool message: tool_call_id → toolCallId.
        expect(args.messages[1].toolCallId).toBe('call_1');
        expect('tool_call_id' in args.messages[1]).toBe(false);
    });

    it('routes via chat.stream for stream=true and chat.complete otherwise', async () => {
        const { provider } = makeProvider();

        // Non-stream → chat.complete.
        completeMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect(completeMock).toHaveBeenCalledTimes(1);
        expect(streamMock).not.toHaveBeenCalled();

        // Stream → chat.stream.
        streamMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(streamMock).toHaveBeenCalledTimes(1);
        // chat.complete should NOT have been called a second time.
        expect(completeMock).toHaveBeenCalledTimes(1);
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('MistralAIProvider model resolution', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'ok', role: 'assistant' },
                finishReason: 'stop',
            },
        ],
        usage: { promptTokens: 1, completionTokens: 1 },
    };

    it('resolves an exact canonical id', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'codestral-2508',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(completeMock.mock.calls[0]![0].model).toBe('codestral-2508');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'mistral:codestral-2508',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical id (alias rewriting)', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // `mistral-small-latest` is an alias of `mistral-small-2603`.
                model: 'mistral-small-latest',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(completeMock.mock.calls[0]![0].model).toBe('mistral-small-2603');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'mistral:mistral-small-2603',
            expect.any(Object),
        );
    });

    it('falls back to the default model when given an unknown id', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'totally-not-a-real-model',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(completeMock.mock.calls[0]![0].model).toBe('mistral-small-2603');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'mistral:mistral-small-2603',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('MistralAIProvider.complete non-stream output', () => {
    it('returns the first choice and runs the metered usage calculator with camelCase usage coercion', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hi there', role: 'assistant' },
                    finishReason: 'stop',
                },
            ],
            // Mistral SDK uses camelCase keys.
            usage: { promptTokens: 100, completionTokens: 50 },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
        });
        // Mistral's coerce_completion_usage maps promptTokens/completionTokens
        // back to snake_case for the metered usage object. cached_tokens
        // defaults to 0 because Mistral doesn't expose prompt_tokens_details.
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 0,
        });

        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] =
            recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 0,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('mistral:mistral-small-2603');
        // mistral-small-2603 costs: prompt=15, completion=60. cached_tokens
        // is undefined in the model row → multiplied by 0 → NaN-safe 0.
        expect(overrides).toMatchObject({
            prompt_tokens: 100 * 15,
            completion_tokens: 50 * 60,
        });
    });

    it('preserves OpenAI-shaped tool_calls on the assistant response', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
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
                    finishReason: 'tool_calls',
                },
            ],
            usage: { promptTokens: 1, completionTokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'do a tool call' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: {} },
                    },
                ],
            }),
        )) as { message: { tool_calls?: unknown[] } };

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
});

// ── Streaming deltas (Mistral-specific deviations) ──────────────────

describe('MistralAIProvider.complete streaming', () => {
    it('un-wraps `chunk.data`, reads camelCase delta.toolCalls, and snake-cases usage', async () => {
        const { provider } = makeProvider();
        // Mistral wraps each event in an outer { data: ... } envelope; the
        // provider's `chunk_but_like_actually` deviation unwraps it.
        streamMock.mockReturnValueOnce(
            asAsyncIterable([
                { data: { choices: [{ delta: { content: 'hel' } }] } },
                { data: { choices: [{ delta: { content: 'lo' } }] } },
                {
                    data: {
                        choices: [{ delta: {} }],
                        // Final chunk carries usage in camelCase; the provider's
                        // `index_usage_from_stream_chunk` deviation rewrites
                        // it to snake_case.
                        usage: { promptTokens: 4, completionTokens: 2 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
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

        // mistral-small-2603: prompt=15, completion=60.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] =
            recordSpy.mock.calls[0]!;
        expect(prefix).toBe('mistral:mistral-small-2603');
        expect(overrides).toMatchObject({
            prompt_tokens: 4 * 15,
            completion_tokens: 2 * 60,
        });
    });

    it('builds a tool_use block from camelCase delta.toolCalls deltas', async () => {
        const { provider } = makeProvider();
        streamMock.mockReturnValueOnce(
            asAsyncIterable([
                {
                    data: {
                        choices: [
                            {
                                delta: {
                                    // Mistral uses `toolCalls` on the delta,
                                    // not OpenAI's `tool_calls`.
                                    toolCalls: [
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
                },
                {
                    data: {
                        choices: [
                            {
                                delta: {
                                    toolCalls: [
                                        {
                                            index: 0,
                                            function: {
                                                arguments: '"puter"}',
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
                {
                    data: {
                        choices: [{ delta: {} }],
                        usage: { promptTokens: 1, completionTokens: 1 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
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
        // Partial JSON across deltas is parsed once on tool block end.
        expect(toolEvent?.input).toEqual({ q: 'puter' });
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('MistralAIProvider.complete error mapping', () => {
    it('rethrows errors raised by the Mistral client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('Mistral exploded');
        completeMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'mistral-small-2603',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        // No metering should be recorded on a failed call.
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('MistralAIProvider.checkModeration', () => {
    it('throws — Mistral provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
