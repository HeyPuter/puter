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
 * Offline unit tests for MetaProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs MetaProvider against the live wired `MeteringService` so the
 * recording side is exercised end-to-end. The OpenAI SDK is mocked at the
 * module boundary — Meta's Model API is OpenAI-compatible, so the provider
 * reaches it through the same client — meaning nothing leaves the process. The
 * companion integration test (MetaProvider.integration.test.ts) exercises the
 * real api.meta.ai endpoint.
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

import type { Actor } from '../../../../core/actor.js';
import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { MetaProvider } from './MetaProvider.js';
import { META_MODELS } from './models.js';

// -- OpenAI SDK mock ----------------------------------------------
//
// `vi.hoisted` shares spies between the hoisted factory and the test body so
// each test can stub `chat.completions.create` with the response shape it
// cares about.

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
    // The test server boots every provider, and some (e.g. OllamaChatProvider)
    // import the default export and read `.OpenAI` off it — expose both shapes.
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// -- Test harness -------------------------------------------------

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (config: { apiKey?: string; apiBaseUrl?: string } = {}) =>
    new MetaProvider(
        server.services.metering,
        {
            fsEntry: server.stores.fsEntry,
            s3Object: server.stores.s3Object,
        },
        server.services.fs,
        {
            apiKey: config.apiKey ?? 'test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
        },
    );

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

const OK_COMPLETION = {
    choices: [
        {
            message: { content: 'hi', role: 'assistant' },
            finish_reason: 'stop',
        },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
};

const complete = (
    provider: MetaProvider,
    params: Record<string, unknown> = {},
    actor?: Actor,
) =>
    withTestActor(
        () =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                ...params,
            } as never),
        actor,
    );

beforeEach(() => {
    createMock.mockReset();
    openAICtor.mockReset();
    // Spy on the live MeteringService without replacing the impl, so the
    // recording side still runs while per-test assertions see the calls.
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Construction -------------------------------------------------

describe('MetaProvider construction', () => {
    it('points the OpenAI SDK at the Meta Model API with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.meta.ai/v1',
        });
    });

    it('honours a custom apiBaseUrl override', () => {
        makeProvider({ apiBaseUrl: 'https://staging.meta.test/v1' });
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://staging.meta.test/v1',
        });
    });
});

// -- Model catalog ------------------------------------------------

describe('MetaProvider model catalog', () => {
    it('returns muse-spark-1.2 as the default', () => {
        expect(makeProvider().getDefaultModel()).toBe('muse-spark-1.2');
    });

    it('exposes the static META_MODELS list verbatim from models()', () => {
        expect(makeProvider().models()).toBe(META_MODELS);
    });

    it('list() flattens canonical ids and aliases', () => {
        const names = makeProvider().list();
        for (const m of META_MODELS) {
            expect(names).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(names).toContain(a);
            }
        }
        expect(names).toContain('meta/muse-spark-1.2');
    });

    it('leaves the contributor tier out of the catalog entirely', () => {
        // It is the cheapest input rate Meta sells, so any name pointing at it
        // would win bucket routing — and Meta trains on what it serves. It is
        // also gated behind a separate enrolment, so a standard-tier key gets
        // `model_not_found` for it.
        const names = new Set(makeProvider().list());
        for (const name of names) {
            expect(name).not.toContain('contributor');
        }
    });
});

// -- Request shape ------------------------------------------------

describe('MetaProvider.complete request shape', () => {
    it('sends model and messages without optional knobs', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider());

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('muse-spark-1.2');
        expect(args.messages).toEqual([{ role: 'user', content: 'hi' }]);
        for (const key of [
            'max_completion_tokens',
            'temperature',
            'top_p',
            'tools',
            'tool_choice',
            'reasoning_effort',
            'prompt_cache_key',
            'prompt_cache_retention',
            'response_format',
            'seed',
        ]) {
            expect(key in args).toBe(false);
        }
    });

    it('caps output with max_completion_tokens, not the legacy max_tokens', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), { max_tokens: 512 });

        const [args] = createMock.mock.calls[0]!;
        expect(args.max_completion_tokens).toBe(512);
        expect('max_tokens' in args).toBe(false);
    });

    it('forwards temperature, top_p, tools, and tool_choice when supplied', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        const tools = [
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
        ];
        await complete(makeProvider(), {
            temperature: 0.4,
            top_p: 0.9,
            tools,
            tool_choice: 'auto',
        });

        const [args] = createMock.mock.calls[0]!;
        expect(args.temperature).toBe(0.4);
        expect(args.top_p).toBe(0.9);
        expect(args.tools).toBe(tools);
        expect(args.tool_choice).toBe('auto');
    });

    it('forwards reasoning_effort, including the Meta-only tiers', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), { reasoning_effort: 'xhigh' });
        expect(createMock.mock.calls[0]![0].reasoning_effort).toBe('xhigh');
    });

    it('falls back to reasoning.effort when reasoning_effort is absent', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), { reasoning: { effort: 'low' } });
        expect(createMock.mock.calls[0]![0].reasoning_effort).toBe('low');
    });

    it('drops reasoning_effort: none, which Muse Spark rejects with a 400', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), { reasoning_effort: 'none' });
        expect('reasoning_effort' in createMock.mock.calls[0]![0]).toBe(false);
    });

    it("translates the hyphenated in-memory cache retention to Meta's enum", async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(provider, {
            prompt_cache_key: 'cache-abc',
            prompt_cache_retention: 'in-memory',
        });

        // Meta rejects the hyphenated spelling outright: "unknown variant
        // `in-memory`, expected `in_memory` or `24h`".
        const [args] = createMock.mock.calls[0]!;
        expect(args.prompt_cache_key).toBe('cache-abc');
        expect(args.prompt_cache_retention).toBe('in_memory');

        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(provider, { prompt_cache_retention: '24h' });
        expect(createMock.mock.calls[1]![0].prompt_cache_retention).toBe('24h');
    });

    it('forwards Muse-Spark-specific custom params', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), {
            custom: {
                seed: 7,
                response_format: { type: 'json_object' },
                frequency_penalty: 0.5,
                presence_penalty: -0.5,
            },
        });

        const [args] = createMock.mock.calls[0]!;
        expect(args.seed).toBe(7);
        expect(args.response_format).toEqual({ type: 'json_object' });
        expect(args.frequency_penalty).toBe(0.5);
        expect(args.presence_penalty).toBe(-0.5);
    });

    it('strips Anthropic-style cache_control from messages before sending', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), {
            messages: [
                {
                    role: 'user',
                    content: 'hi',
                    cache_control: { type: 'ephemeral' },
                },
            ],
        });

        expect(
            'cache_control' in createMock.mock.calls[0]![0].messages[0],
        ).toBe(false);
    });

    it('derives safety_identifier from the actor and truncates it to 64 chars', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        const userActor: Actor = {
            user: { id: 42, uuid: 'u42', username: 'alice' },
            app: { id: 7, uid: 'a'.repeat(80) },
        };

        await complete(makeProvider(), {}, userActor);

        const identifier = createMock.mock.calls[0]![0].safety_identifier;
        expect(identifier.startsWith('puter-42-a')).toBe(true);
        expect(identifier.length).toBe(64);
    });

    it('prefers an explicit custom.safety_identifier over the actor-derived one', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        const userActor: Actor = { user: { id: 42, uuid: 'u42' } };
        await complete(
            makeProvider(),
            { custom: { safety_identifier: 'caller-supplied' } },
            userActor,
        );
        expect(createMock.mock.calls[0]![0].safety_identifier).toBe(
            'caller-supplied',
        );
    });

    it('omits safety_identifier for the system actor (no user.id)', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider());
        expect('safety_identifier' in createMock.mock.calls[0]![0]).toBe(false);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(provider, { stream: false });

        const [nonStreamArgs] = createMock.mock.calls[0]!;
        expect(nonStreamArgs.stream).toBe(false);
        expect('stream_options' in nonStreamArgs).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await complete(provider, { stream: true });

        const [streamArgs] = createMock.mock.calls[1]!;
        expect(streamArgs.stream).toBe(true);
        expect(streamArgs.stream_options).toEqual({ include_usage: true });
    });
});

// -- Model resolution ---------------------------------------------

describe('MetaProvider model resolution', () => {
    it('resolves an alias to its canonical id', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), { model: 'meta/muse-spark-1.1' });

        expect(createMock.mock.calls[0]![0].model).toBe('muse-spark-1.1');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'meta:muse-spark-1.1',
            expect.any(Object),
        );
    });

    it('falls back to the default model when given an unknown id', async () => {
        createMock.mockResolvedValueOnce(OK_COMPLETION);
        await complete(makeProvider(), { model: 'totally-not-a-real-model' });

        expect(createMock.mock.calls[0]![0].model).toBe('muse-spark-1.2');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'meta:muse-spark-1.2',
            expect.any(Object),
        );
    });
});

// -- Non-stream output --------------------------------------------

describe('MetaProvider.complete non-stream output', () => {
    it('bills cache reads separately from the remaining prompt tokens', async () => {
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
                prompt_tokens_details: { cached_tokens: 40 },
            },
        });

        const result = await complete(makeProvider());

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        // Meta reports cache reads inside prompt_tokens; only the uncached
        // remainder is charged at the input rate.
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 60,
            completion_tokens: 50,
            cached_tokens: 40,
        });

        const model = META_MODELS.find((m) => m.id === 'muse-spark-1.2')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 60,
            completion_tokens: 50,
            cached_tokens: 40,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('meta:muse-spark-1.2');
        expect(overrides!.prompt_tokens).toBeCloseTo(
            60 * Number(model.costs.prompt_tokens),
            5,
        );
        expect(overrides!.completion_tokens).toBeCloseTo(
            50 * Number(model.costs.completion_tokens),
            5,
        );
        expect(overrides!.cached_tokens).toBeCloseTo(
            40 * Number(model.costs.cached_tokens),
            5,
        );
    });

    it('zeroes cached_tokens when prompt_tokens_details is missing', async () => {
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 7, completion_tokens: 3 },
        });

        await complete(makeProvider());

        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 7,
            completion_tokens: 3,
            cached_tokens: 0,
        });
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });

    it('preserves OpenAI-shaped tool_calls on the assistant response', async () => {
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

        const result = (await complete(makeProvider(), {
            tools: [
                {
                    type: 'function',
                    function: { name: 'lookup', parameters: {} },
                },
            ],
        })) as { message: { tool_calls?: unknown[] }; finish_reason: string };

        expect(result.finish_reason).toBe('tool_calls');
        expect(result.message.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"puter"}' },
            },
        ]);
    });

    it('leaves reasoning token counts out of the metered usage', async () => {
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'done', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 8,
                completion_tokens: 100,
                completion_tokens_details: { reasoning_tokens: 90 },
            },
        });

        await complete(makeProvider());

        // Muse Spark always reasons, and counts those tokens inside
        // `completion_tokens` — billing them again would double-charge.
        const [usage] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 8,
            completion_tokens: 100,
            cached_tokens: 0,
        });
    });
});

// -- Streaming ----------------------------------------------------

describe('MetaProvider.complete streaming', () => {
    it('streams text deltas and meters the final usage chunk', async () => {
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                {
                    choices: [{ delta: {} }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 2,
                        prompt_tokens_details: { cached_tokens: 4 },
                    },
                },
            ]),
        );

        const result = await complete(makeProvider(), { stream: true });
        expect((result as { stream: boolean }).stream).toBe(true);

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        expect(
            events.filter((e) => e.type === 'text').map((e) => e.text),
        ).toEqual(['hel', 'lo']);
        expect(events.find((e) => e.type === 'usage')?.usage).toEqual({
            prompt_tokens: 6,
            completion_tokens: 2,
            cached_tokens: 4,
        });

        const model = META_MODELS.find((m) => m.id === 'muse-spark-1.2')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('meta:muse-spark-1.2');
        expect(overrides!.prompt_tokens).toBeCloseTo(
            6 * Number(model.costs.prompt_tokens),
            5,
        );
        expect(overrides!.cached_tokens).toBeCloseTo(
            4 * Number(model.costs.cached_tokens),
            5,
        );
    });

    it('builds a tool_use event from streamed function-call deltas', async () => {
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

        const result = await complete(makeProvider(), {
            stream: true,
            tools: [
                {
                    type: 'function',
                    function: { name: 'lookup', parameters: {} },
                },
            ],
        });

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const toolEvent = harness.events().find((e) => e.type === 'tool_use');
        expect(toolEvent).toBeDefined();
        expect(toolEvent?.id).toBe('call_1');
        expect(toolEvent?.name).toBe('lookup');
        expect(toolEvent?.input).toEqual({ q: 'puter' });
    });
});

// -- Error mapping ------------------------------------------------

describe('MetaProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const apiError = new Error('Model API exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(complete(makeProvider())).rejects.toBe(apiError);
        // A failed call must not be metered.
        expect(recordSpy).not.toHaveBeenCalled();
    });

    it('rejects a missing messages payload with a 400', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().complete({
                    model: 'muse-spark-1.2',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });
});

// -- Moderation ---------------------------------------------------

describe('MetaProvider.checkModeration', () => {
    it('throws — the Meta provider does not implement moderation', () => {
        expect(() => makeProvider().checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
