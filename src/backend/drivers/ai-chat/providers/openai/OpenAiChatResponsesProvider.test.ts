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
 * Offline unit tests for OpenAiResponsesChatProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs OpenAiResponsesChatProvider directly against
 * the live wired `MeteringService`, `stores`, and `FSService`. The
 * OpenAI SDK is mocked at the module boundary; that's the real network
 * egress point. Unlike the Chat Completions sibling, the Responses API
 * uses `responses.create`, returns `output`/`output_text` shapes,
 * streams typed `response.*` events, and counts tokens as
 * `input_tokens` / `output_tokens`. The companion integration test
 * (none yet) would exercise the real OpenAI Responses endpoint.
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
import { OPEN_AI_MODELS } from './models.js';
import { OpenAiResponsesChatProvider } from './OpenAiChatResponsesProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { responsesCreateMock, moderationsCreateMock, openAICtor } = vi.hoisted(
    () => ({
        responsesCreateMock: vi.fn(),
        moderationsCreateMock: vi.fn(),
        openAICtor: vi.fn(),
    }),
);

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.responses = { create: responsesCreateMock };
        this.moderations = { create: moderationsCreateMock };
        // Some sibling providers boot via the same SDK module — give them
        // the chat shape too even though we don't drive it here.
        this.chat = { completions: { create: vi.fn() } };
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
    const provider = new OpenAiResponsesChatProvider(
        server.services.metering,
        {
            fsEntry: server.stores.fsEntry,
            s3Object: server.stores.s3Object,
        },
        server.services.fs,
        { apiKey: 'test-key' },
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
    responsesCreateMock.mockReset();
    moderationsCreateMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider construction', () => {
    it('constructs the OpenAI SDK with the configured API key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider model catalog', () => {
    it('returns gpt-5-nano as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('gpt-5-nano');
    });

    it('models() with default args exposes only responses_api_only entries', () => {
        const { provider } = makeProvider();
        const ids = provider.models().map((m: { id: string }) => m.id);
        // Sanity: a known responses_api_only model is included.
        expect(ids).toContain('o3-pro');
        // And a known Chat-Completions-only model is excluded.
        expect(ids).not.toContain('gpt-5-nano-2025-08-07');
    });

    it('models({ no_restrictions: true }) returns the entire catalog (used by complete())', () => {
        const { provider } = makeProvider();
        const ids = provider
            .models({ no_restrictions: true })
            .map((m: { id: string }) => m.id);
        // Both responses-only AND chat-only ids should be present.
        expect(ids).toContain('o3-pro');
        expect(ids).toContain('gpt-5-nano-2025-08-07');
    });

    it('list() flattens canonical ids and aliases for responses-only models', () => {
        const { provider } = makeProvider();
        const ids = provider.list();
        expect(ids).toContain('o3-pro');
        expect(ids).toContain('openai/o3-pro');
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('OpenAiResponsesChatProvider.complete argument validation', () => {
    it('throws 400 when messages is not an array', async () => {
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'o3-pro',
                    messages: 'hello' as unknown as never,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(responsesCreateMock).not.toHaveBeenCalled();
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider.complete request shape', () => {
    const baseResponse = {
        output: [],
        output_text: 'hi',
        usage: { input_tokens: 1, output_tokens: 1 },
    };

    it('forwards model + input messages and renames max_tokens to max_output_tokens', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
                temperature: 0.4,
            }),
        );

        const [args] = responsesCreateMock.mock.calls[0]!;
        expect(args.model).toBe('o3-pro');
        // Responses API takes `input`, not `messages`.
        expect(args.input).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_output_tokens).toBe(256);
        expect(args.temperature).toBe(0.4);
    });

    it('unravels function tools into the flat Responses API shape', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'lookup',
                            parameters: {
                                type: 'object',
                                properties: { q: { type: 'string' } },
                            },
                        },
                    },
                ] as never,
            }),
        );

        const [args] = responsesCreateMock.mock.calls[0]!;
        // Chat-style { type: 'function', function: { name, parameters } }
        // becomes { type: 'function', name, parameters } at the top level.
        expect(args.tools).toEqual([
            {
                type: 'function',
                name: 'lookup',
                parameters: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                },
            },
        ]);
    });

    it('passes through Responses-only knobs (tool_choice, parallel_tool_calls, include, store, top_p, truncation, etc.)', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'hi' }],
                tool_choice: 'auto',
                parallel_tool_calls: false,
                include: ['file_search_call.results'],
                store: true,
                top_p: 0.9,
                truncation: 'auto',
                background: false,
                service_tier: 'default',
            } as never),
        );

        const [args] = responsesCreateMock.mock.calls[0]!;
        expect(args.tool_choice).toBe('auto');
        expect(args.parallel_tool_calls).toBe(false);
        expect(args.include).toEqual(['file_search_call.results']);
        expect(args.store).toBe(true);
        expect(args.top_p).toBe(0.9);
        expect(args.truncation).toBe('auto');
        expect(args.background).toBe(false);
        expect(args.service_tier).toBe('default');
    });

    it('drops reasoning_effort/verbosity for gpt-5 models and forwards them for non-gpt-5 reasoning models', async () => {
        const { provider } = makeProvider();

        // gpt-5-pro: gpt-5 family → drops the controls.
        responsesCreateMock.mockResolvedValueOnce(baseResponse);
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5.2-pro-2025-12-11',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'high',
                verbosity: 'high',
            } as never),
        );
        const [gpt5Args] = responsesCreateMock.mock.calls[0]!;
        expect('reasoning_effort' in gpt5Args).toBe(false);
        expect('verbosity' in gpt5Args).toBe(false);

        // o3-pro: not gpt-5 → forwards both.
        responsesCreateMock.mockResolvedValueOnce(baseResponse);
        await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'medium',
                verbosity: 'low',
            } as never),
        );
        const [o3Args] = responsesCreateMock.mock.calls[1]!;
        expect(o3Args.reasoning_effort).toBe('medium');
        expect(o3Args.verbosity).toBe('low');
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider model resolution', () => {
    const baseResponse = {
        output: [],
        output_text: 'ok',
        usage: { input_tokens: 1, output_tokens: 1 },
    };

    it('resolves an alias to its canonical id (across the entire model catalog)', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                // openai/o3-pro is an alias of o3-pro.
                model: 'openai/o3-pro',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(responsesCreateMock.mock.calls[0]![0].model).toBe('o3-pro');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'openai:o3-pro',
            expect.any(Object),
        );
    });

    it('resolves the bare default-model name (gpt-5-nano alias) to its canonical id', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(baseResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // `gpt-5-nano` is an alias of gpt-5-nano-2025-08-07 in the catalog.
        expect(responsesCreateMock.mock.calls[0]![0].model).toBe(
            'gpt-5-nano-2025-08-07',
        );
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'openai:gpt-5-nano-2025-08-07',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('OpenAiResponsesChatProvider.complete non-stream output', () => {
    it('returns output_text as message.content and meters input/output token costs with cached split', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce({
            output: [{ role: 'assistant' }],
            output_text: 'hi there',
            usage: {
                input_tokens: 100,
                output_tokens: 50,
                input_tokens_details: { cached_tokens: 10 },
            },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // Responses API surfaces text via output_text — the helper
        // re-shapes it into the OpenAI Chat-style message.
        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        // The Responses provider's calculator subtracts cached_tokens from
        // input_tokens (matches Chat Completions semantics).
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        // o3-pro costs: prompt=2000, completion=8000, cached=50.
        const o3pro = OPEN_AI_MODELS.find((m) => m.id === 'o3-pro')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('openai:o3-pro');
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(overrides).toEqual({
            prompt_tokens: 90 * Number(o3pro.costs.prompt_tokens),
            completion_tokens: 50 * Number(o3pro.costs.completion_tokens),
            cached_tokens: 10 * Number(o3pro.costs.cached_tokens ?? 0),
        });
    });

    it('shapes function_call output items into OpenAI tool_calls on the response', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce({
            output: [
                {
                    type: 'function_call',
                    id: 'fc_internal',
                    call_id: 'call_1',
                    name: 'lookup',
                    arguments: '{"q":"puter"}',
                },
            ],
            // Empty output_text alongside a tool call must NOT trigger the
            // empty-response error — only when there are also no tool calls.
            output_text: '',
            usage: { input_tokens: 1, output_tokens: 1 },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'do a tool call' }],
            }),
        )) as { message: { tool_calls?: unknown[] } };

        expect(result.message.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"puter"}' },
                canonical_id: 'fc_internal',
            },
        ]);
    });

    it('throws 400 when output_text is empty AND no tool calls were produced', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockResolvedValueOnce({
            output: [],
            output_text: '   ',
            usage: { input_tokens: 1, output_tokens: 0 },
        });

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'o3-pro',
                    messages: [{ role: 'user', content: 'silence' }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider.complete streaming', () => {
    it('streams response.output_text.delta as text events and meters usage from response.completed', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockReturnValueOnce(
            asAsyncIterable([
                { type: 'response.output_text.delta', delta: 'hel' },
                { type: 'response.output_text.delta', delta: 'lo' },
                {
                    type: 'response.completed',
                    response: {
                        usage: {
                            input_tokens: 4,
                            output_tokens: 2,
                            input_tokens_details: { cached_tokens: 1 },
                        },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
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

        // Final usage event reflects metered shape with cached split.
        const usageEvent = events.find((e) => e.type === 'usage');
        expect(usageEvent?.usage).toEqual({
            prompt_tokens: 3,
            completion_tokens: 2,
            cached_tokens: 1,
        });

        // o3-pro costs: prompt=2000, completion=8000, cached=50.
        const o3pro = OPEN_AI_MODELS.find((m) => m.id === 'o3-pro')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('openai:o3-pro');
        expect(overrides).toEqual({
            prompt_tokens: 3 * Number(o3pro.costs.prompt_tokens),
            completion_tokens: 2 * Number(o3pro.costs.completion_tokens),
            cached_tokens: 1 * Number(o3pro.costs.cached_tokens ?? 0),
        });
    });

    it('emits a tool_use block when response.output_item.done arrives with a function_call', async () => {
        const { provider } = makeProvider();
        responsesCreateMock.mockReturnValueOnce(
            asAsyncIterable([
                {
                    type: 'response.output_item.done',
                    item: {
                        type: 'function_call',
                        id: 'fc_internal',
                        call_id: 'call_1',
                        name: 'lookup',
                        arguments: '{"q":"puter"}',
                    },
                },
                {
                    type: 'response.completed',
                    response: {
                        usage: { input_tokens: 1, output_tokens: 1 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'o3-pro',
                messages: [{ role: 'user', content: 'tool call' }],
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

// ── Moderation ──────────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider.checkModeration', () => {
    it('flags content when any category score exceeds 0.8', async () => {
        const { provider } = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({
            results: [
                { category_scores: { violence: 0.9, hate: 0.1 } },
            ],
        });

        const result = await provider.checkModeration('something risky');
        expect(moderationsCreateMock).toHaveBeenCalledWith({
            model: 'omni-moderation-latest',
            input: 'something risky',
        });
        expect(result.flagged).toBe(true);
    });

    it('does NOT flag when all category scores are at/under 0.8', async () => {
        const { provider } = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({
            results: [
                { category_scores: { violence: 0.8, hate: 0.5 } },
            ],
        });

        const result = await provider.checkModeration('borderline');
        expect(result.flagged).toBe(false);
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('OpenAiResponsesChatProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('OpenAI exploded');
        responsesCreateMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'o3-pro',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});
