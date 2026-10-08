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

import { Context } from '../../../../core/context.js';
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

import { ResponseValidationError } from '@mistralai/mistralai/models/errors/responsevalidationerror.js';
import { SDKValidationError } from '@mistralai/mistralai/models/errors/sdkvalidationerror.js';
import { UsageInfo$inboundSchema } from '@mistralai/mistralai/models/components/usageinfo.js';
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

    it('does not redirect the retired Magistral ids to another model', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        expect(ids).not.toContain('magistral-small-latest');
        expect(ids).not.toContain('magistral-medium-latest');
    });

    it('keeps mistral-large-2512, which Mistral still serves as active', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        expect(ids).toContain('mistral-large-2512');
        expect(ids).toContain('mistral-large-latest');
    });

    it('lists Large 4 with standard pricing and multimodal tool support', async () => {
        const { provider } = makeProvider();
        const model = (await provider.models()).find(
            (model) => model.id === 'mistral-large-4',
        );
        expect(model).toMatchObject({
            release_date: '2026-10-06',
            modalities: { input: ['text', 'image'], output: ['text'] },
            tool_call: true,
            context: 1_000_000,
            max_tokens: 1_000_000,
            open_weights: false,
            costs_currency: 'usd-cents',
            costs: {
                tokens: 1_000_000,
                prompt_tokens: 136,
                cached_tokens: 14,
                completion_tokens: 418,
            },
        });
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

    it('passes the request cancellation signal to the SDK', async () => {
        const { provider } = makeProvider();
        const abort = new AbortController();
        completeMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() => {
            Context.set('abortSignal', abort.signal);
            return provider.complete({
                model: 'mistral-small-latest',
                messages: [{ role: 'user', content: 'hi' }],
            });
        });
        expect(completeMock.mock.calls[0][1]?.signal).toBe(abort.signal);
    });

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

    it('turns the SDK client-side validation error into a 400', async () => {
        const { provider } = makeProvider();
        completeMock.mockRejectedValueOnce(
            new SDKValidationError('Input validation failed', new Error(), {}),
        );

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'mistral-small-2603',
                    messages: [{ role: 'user', content: 'hello' }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('passes an unparseable upstream response through rather than blaming the request', async () => {
        const { provider } = makeProvider();
        const upstreamError = new ResponseValidationError(
            'Response validation failed',
            {
                cause: new Error(),
                rawValue: {},
                rawMessage: 'Response validation failed',
                request: new Request(
                    'https://api.mistral.ai/v1/chat/completions',
                ),
                response: new Response('{}', { status: 200 }),
                body: '{}',
            },
        );
        completeMock.mockRejectedValueOnce(upstreamError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'mistral-small-2603',
                    messages: [{ role: 'user', content: 'hello' }],
                }),
            ),
        ).rejects.toBe(upstreamError);
    });

    it('forwards custom.prompt_mode as the SDK promptMode', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'ok' },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 1, completionTokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'think' }],
                custom: { prompt_mode: 'reasoning' },
            }),
        );

        expect(completeMock.mock.calls[0]![0].promptMode).toBe('reasoning');
    });

    it('omits promptMode when custom does not carry prompt_mode', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'ok' },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 1, completionTokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect('promptMode' in completeMock.mock.calls[0]![0]).toBe(false);
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

    it.each([
        ['mistral-large-4', 'mistral-large-4'],
        ['mistral-large-4-0', 'mistral-large-4'],
        ['mistralai/mistral-large-4', 'mistral-large-4'],
        ['mistralai/mistral-large-4-0', 'mistral-large-4'],
        ['mistral-large-latest', 'mistral-large-2512'],
        ['zai-glm-latest', 'zai-glm-5-3'],
        ['zai-glm-5', 'zai-glm-5-3'],
        ['mistral-code-latest', 'codestral-2508'],
    ])('resolves %s to %s', async (model, canonicalId) => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(completeMock.mock.calls[0]![0].model).toBe(canonicalId);
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            `mistral:${canonicalId}`,
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
    it.each([
        ['mistral-large-4', false, 136, 14, 418],
        ['mistral-large-4', true, 136, 14, 418],
        ['mistral-small-2603', false, 15, 1.5, 60],
        ['mistral-small-2603', true, 15, 1.5, 60],
        ['ministral-8b-2512', false, 15, 1.5, 15],
        ['ministral-3b-2512', false, 10, 1, 10],
    ] as const)(
        'meters %s cached input separately (stream=%s)',
        async (model, stream, inputRate, cacheRate, outputRate) => {
            const { provider } = makeProvider();
            const usage = UsageInfo$inboundSchema.parse({
                prompt_tokens: 1013,
                completion_tokens: 30,
                total_tokens: 1043,
                prompt_tokens_details: { cached_tokens: 1008 },
            });
            if (stream) {
                streamMock.mockResolvedValueOnce(
                    asAsyncIterable([
                        { data: { choices: [{ delta: { content: 'hello' } }] } },
                        { data: { choices: [], usage } },
                    ]),
                );
            } else {
                completeMock.mockResolvedValueOnce({
                    choices: [
                        {
                            message: { role: 'assistant', content: 'hello' },
                            finishReason: 'stop',
                        },
                    ],
                    usage,
                });
            }
            const result = await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    stream,
                }),
            );
            if (stream) {
                const { chatStream } = makeCapturingChatStream();
                await withTestActor(() =>
                    (
                        result as {
                            init_chat_stream: (params: {
                                chatStream: AIChatStream;
                            }) => Promise<void>;
                        }
                    ).init_chat_stream({ chatStream }),
                );
            } else {
                expect(result).toMatchObject({ message: { content: 'hello' } });
            }
            expect(recordSpy).toHaveBeenCalledWith(
                { prompt_tokens: 5, cached_tokens: 1008, completion_tokens: 30 },
                SYSTEM_ACTOR,
                `mistral:${model}`,
                {
                    prompt_tokens: 5 * inputRate,
                    cached_tokens: 1008 * cacheRate,
                    completion_tokens: 30 * outputRate,
                },
            );
        },
    );

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
        // defaults to 0 when Mistral doesn't report prompt_tokens_details.
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
        // mistral-small-2603 costs: prompt=15, completion=60.
        expect(overrides).toMatchObject({
            prompt_tokens: 100 * 15,
            completion_tokens: 50 * 60,
        });
    });

    it('flattens a reasoning chunked content array into string content + reasoning', async () => {
        // Mistral's reasoning models return `content` as a chunk array with
        // the thinking text nested inside `thinking` chunks. Left alone it
        // reaches the caller as an array with no `reasoning`, breaking the
        // one-shape-per-provider guarantee.
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'thinking',
                                thinking: [
                                    { type: 'text', text: 'step one.' },
                                ],
                            },
                            {
                                type: 'thinking',
                                thinking: [
                                    { type: 'text', text: 'step two.' },
                                ],
                            },
                            { type: 'text', text: 'the answer' },
                        ],
                    },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 1, completionTokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'think' }],
                normalize: true,
            }),
        )) as { message: Record<string, unknown> };

        expect(result.message.content).toBe('the answer');
        // Multiple thinking chunks join with a blank line, matching the
        // Responses handler and the Anthropic coercer.
        expect(result.message.reasoning).toBe('step one.\n\nstep two.');
    });

    it('leaves plain string content untouched', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'plain' },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 1, completionTokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { message: Record<string, unknown> };

        expect(result.message.content).toBe('plain');
        expect('reasoning' in result.message).toBe(false);
    });

    it('leaves the SDK dialect untouched when normalization does not apply', async () => {
        // The remap changes what this provider returns, so it is gated on the
        // same policy the driver's coercer uses. Without `normalize`, and with
        // a pre-cutoff model, a caller reading the SDK's native keys keeps
        // seeing them — nothing is deleted out from under it.
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: 'hi there',
                        toolCalls: [
                            {
                                id: 'call_1',
                                function: {
                                    name: 'get_weather',
                                    arguments: { city: 'Paris' },
                                },
                            },
                        ],
                    },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 1, completionTokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { message: Record<string, unknown> } & Record<string, unknown>;

        expect('toolCalls' in result.message).toBe(true);
        expect('tool_calls' in result.message).toBe(false);
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

    it.each([
        ['normalize: true', true],
        ['normalize unset', undefined],
    ])(
        'splits chunked delta.content into text and reasoning events (%s)',
        async (_label, normalize) => {
            // The reasoning split is unconditional: streamed chunk types must
            // not depend on the normalize policy, because chat.md promises
            // "Streaming is unaffected by normalization" and because every
            // other provider routes thinking to the reasoning channel
            // regardless. Both rows below assert the same event stream.
            const { provider } = makeProvider();
            streamMock.mockReturnValueOnce(
                asAsyncIterable([
                    {
                        data: {
                            choices: [
                                {
                                    delta: {
                                        content: [
                                            {
                                                type: 'thinking',
                                                thinking: [
                                                    {
                                                        type: 'text',
                                                        text: 'thinking…',
                                                    },
                                                ],
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
                                        content: [
                                            { type: 'text', text: 'answer' },
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
                    messages: [{ role: 'user', content: 'think' }],
                    stream: true,
                    ...(normalize === undefined ? {} : { normalize }),
                }),
            );

            const harness = makeCapturingChatStream();
            await (
                result as {
                    init_chat_stream: (p: {
                        chatStream: unknown;
                    }) => Promise<void>;
                }
            ).init_chat_stream({ chatStream: harness.chatStream });

            const events = harness.events();
            // Thinking goes to the reasoning channel, never the text channel.
            expect(
                events
                    .filter((e) => e.type === 'reasoning')
                    .map((e) => e.reasoning),
            ).toEqual(['thinking…']);
            const text = events
                .filter((e) => e.type === 'text')
                .map((e) => e.text)
                .join('');
            expect(text).toBe('answer');
            // And the array never reaches addText as an object.
            expect(text).not.toContain('object');
            expect(text).not.toContain('{');
        },
    );

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

// -- Mistral image_url coercion --

describe('MistralAIProvider image_url coercion', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'ok', role: 'assistant' },
                finishReason: 'stop',
            },
        ],
        usage: { promptTokens: 1, completionTokens: 1 },
    };

    it('rewrites canonical image_url parts to the SDK\'s camelCase imageUrl', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        const imagePartIn = {
            type: 'image_url',
            image_url: { url: 'https://example.com/img.png' },
        };
        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'describe this image' },
                            imagePartIn,
                        ],
                    },
                ],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        const imagePart = (args.messages[0].content as unknown[]).find(
            (p: unknown) => (p as { type: string }).type === 'image_url',
        ) as Record<string, unknown>;
        // The SDK's zod schema wants `imageUrl`; a snake_case `image_url` fails
        // validation before the request leaves the box.
        expect(imagePart).toEqual({
            type: 'image_url',
            imageUrl: 'https://example.com/img.png',
        });
        // Copy-on-write: the driver reuses the caller's parts on fallback.
        expect(imagePartIn).toEqual({
            type: 'image_url',
            image_url: { url: 'https://example.com/img.png' },
        });
    });

    it('carries `detail` into an imageUrl object and accepts a bare string URL', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: {
                                    url: 'https://example.com/hi.png',
                                    detail: 'high',
                                },
                            },
                            {
                                type: 'image_url',
                                image_url: 'https://example.com/already-flat.png',
                            },
                        ],
                    },
                ],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        const parts = args.messages[0].content as Record<string, unknown>[];
        expect(parts[0]).toEqual({
            type: 'image_url',
            imageUrl: { url: 'https://example.com/hi.png', detail: 'high' },
        });
        expect(parts[1]).toEqual({
            type: 'image_url',
            imageUrl: 'https://example.com/already-flat.png',
        });
    });

    it('replaces video parts with an inline note since Mistral has no video input', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'video_url',
                                video_url: { url: 'https://example.com/a.mp4' },
                            },
                        ],
                    },
                ],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        const parts = args.messages[0].content as Record<string, unknown>[];
        expect(parts[0]!.type).toBe('text');
        expect(parts[0]!.text).toMatch(/video input is not supported/);
    });

    it('leaves messages with plain string content untouched', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [{ role: 'user', content: 'plain text message' }],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        expect(args.messages[0].content).toBe('plain text message');
    });

    it('coerces only image_url parts and leaves other content parts intact', async () => {
        const { provider } = makeProvider();
        completeMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'mistral-small-2603',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'what is in this image?' },
                            {
                                type: 'image_url',
                                image_url: { url: 'https://example.com/photo.jpg' },
                            },
                        ],
                    },
                ],
            }),
        );

        const [args] = completeMock.mock.calls[0]!;
        const parts = args.messages[0].content as { type: string; text?: string; imageUrl?: unknown }[];
        const textPart = parts.find((p) => p.type === 'text');
        const imgPart = parts.find((p) => p.type === 'image_url');
        expect(textPart?.text).toBe('what is in this image?');
        expect(imgPart?.imageUrl).toBe('https://example.com/photo.jpg');
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
