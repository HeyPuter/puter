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
 * The OpenAI SDK is mocked so the provider never reaches the network —
 * we drive `chat.completions.create` directly to assert how
 * MoonshotProvider shapes requests (hardcoded max_tokens=1000,
 * stream_options gating), routes vision requests through
 * `inlineHttpImageUrls`, surfaces streamed/non-streamed responses,
 * maps errors, and reports metering. Image inlining behaviour itself
 * is covered by `imageHandling.test.ts`; here we only verify the
 * provider invokes it for vision-capable models. The companion
 * integration test (MoonshotProvider.integration.test.ts) exercises
 * the real Moonshot endpoint.
 */

import { Writable } from 'node:stream';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import {
    makeMeteringStub as makeBaseMeteringStub,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { MOONSHOT_MODELS } from './models.js';
import { MoonshotProvider } from './MoonshotProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { createMock, openAICtor } = vi.hoisted(() => {
    const createMock = vi.fn();
    const openAICtor = vi.fn();
    return { createMock, openAICtor };
});

vi.mock('openai', () => ({
    OpenAI: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
    }),
}));

// `imageHandling` is a sibling module — stub `inlineHttpImageUrls` so
// vision requests don't actually try to fetch network URLs and we can
// assert the provider invokes it.
const { inlineHttpImageUrlsMock } = vi.hoisted(() => ({
    inlineHttpImageUrlsMock: vi.fn(async () => {}),
}));
vi.mock('./imageHandling.js', () => ({
    inlineHttpImageUrls: inlineHttpImageUrlsMock,
}));

// ── Test helpers ────────────────────────────────────────────────────

type SpiedMetering = MeteringService & {
    utilRecordUsageObject: MockInstance<
        MeteringService['utilRecordUsageObject']
    >;
};

const makeProvider = () => {
    const metering = makeBaseMeteringStub() as SpiedMetering;
    vi.spyOn(metering, 'utilRecordUsageObject');
    const provider = new MoonshotProvider({ apiKey: 'test-key' }, metering);
    return { provider, metering };
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
    inlineHttpImageUrlsMock.mockReset();
    inlineHttpImageUrlsMock.mockImplementation(async () => {});
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
        const names = await provider.list();
        for (const m of MOONSHOT_MODELS) {
            expect(names).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(names).toContain(a);
            }
        }
        // Sanity: the short alias is exposed alongside the canonical id.
        expect(names).toContain('kimi');
        expect(names).toContain('kimi-k2.6');
    });
});

// ── Request shape (OpenAI-compat quirks specific to Moonshot) ───────

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

    it('forwards model + messages and locks max_tokens=1000', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'kimi-k2.6',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('kimi-k2.6');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        // max_tokens is hardcoded by the provider — the call to Moonshot
        // should always cap at 1000 tokens of completion.
        expect(args.max_tokens).toBe(1000);
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

    it('passes tool definitions through unchanged when supplied', async () => {
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
        // Reference equality: provider doesn't deep-clone tool specs.
        expect(args.tools).toBe(tools);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();
        // Non-stream path.
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

        // Stream path.
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
        // process_input_messages should have rewritten the assistant
        // message into the OpenAI tool_calls shape and nulled content.
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
                model: 'kimi-k2.5', // kimi-k2.5 declares image input modality
                messages: messages as unknown as { role: string; content: unknown }[],
            }),
        );

        expect(inlineHttpImageUrlsMock).toHaveBeenCalledTimes(1);
        // The provider passes the same messages array — image inlining
        // mutates parts in place before process_input_messages runs.
        expect(inlineHttpImageUrlsMock.mock.calls[0]![0]).toBe(messages);
    });

    it('does not invoke inlineHttpImageUrls for text-only models', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // kimi-k2.6 (default) is text-only → no inlining.
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
        const { provider, metering } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'moonshot-v1-32k',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('moonshot-v1-32k');
        expect(metering.utilRecordUsageObject).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'moonshotai:moonshot-v1-32k',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical id (alias rewriting)', async () => {
        const { provider, metering } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // `kimi` is an alias of `kimi-k2.6` in models.ts.
                model: 'kimi',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // The wire model should be the canonical id, not the alias.
        expect(createMock.mock.calls[0]![0].model).toBe('kimi-k2.6');
        expect(metering.utilRecordUsageObject).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'moonshotai:kimi-k2.6',
            expect.any(Object),
        );
    });

    it('falls back to the default model when given an unknown id', async () => {
        const { provider, metering } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'totally-not-a-real-model',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('kimi-k2.6');
        expect(metering.utilRecordUsageObject).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'moonshotai:kimi-k2.6',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion + tool-call passthrough ───────────────────

describe('MoonshotProvider.complete non-stream output', () => {
    it('returns the first choice and runs the metered usage calculator', async () => {
        const { provider, metering } = makeProvider();
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
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        // Metering: usage is recorded once, with the right model
        // namespace, actor, and a costsOverride priced from
        // models.ts (kimi-k2.6: prompt=95, completion=400, cached=16).
        expect(metering.utilRecordUsageObject).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] =
            metering.utilRecordUsageObject.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('moonshotai:kimi-k2.6');
        expect(overrides).toEqual({
            prompt_tokens: 100 * 95,
            completion_tokens: 50 * 400,
            cached_tokens: 10 * 16,
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
        const { provider, metering } = makeProvider();
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

        const [usage, , , overrides] =
            metering.utilRecordUsageObject.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        // 0 cached tokens × any rate = 0 metered cost.
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('MoonshotProvider.complete streaming', () => {
    it('streams text deltas through to text events and meters final usage', async () => {
        const { provider, metering } = makeProvider();
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
            prompt_tokens: 4,
            completion_tokens: 2,
            cached_tokens: 1,
        });

        // kimi-k2.6 costs: prompt=95, completion=400, cached=16.
        expect(metering.utilRecordUsageObject).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] =
            metering.utilRecordUsageObject.mock.calls[0]!;
        expect(prefix).toBe('moonshotai:kimi-k2.6');
        expect(overrides).toEqual({
            prompt_tokens: 4 * 95,
            completion_tokens: 2 * 400,
            cached_tokens: 1 * 16,
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
    it('logs and rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider, metering } = makeProvider();
        const apiError = new Error('Moonshot exploded');
        createMock.mockRejectedValueOnce(apiError);
        // Provider logs via console.log before rethrowing — silence it.
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'kimi-k2.6',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        // No metering should be recorded on a failed call.
        expect(metering.utilRecordUsageObject).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
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
