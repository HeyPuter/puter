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
 * constructs MetaProvider against the live wired `MeteringService`, so the
 * recording side is exercised end-to-end. The OpenAI SDK is mocked at the
 * module boundary — the Meta Model API is OpenAI-compatible, so the provider
 * talks to it through the same client — so nothing reaches the network. The
 * companion MetaProvider.integration.test.ts exercises the real endpoint.
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
import { MetaProvider } from './MetaProvider.js';
import { META_MODELS } from './models.js';

// -- OpenAI SDK mock -------------------------------------------------

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
    // The test server boots every provider, and some read `.OpenAI` off the
    // default export, so expose the constructor under both shapes.
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// -- Test harness ----------------------------------------------------

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
    const provider = new MetaProvider(
        {
            apiKey: config.apiKey ?? 'test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
        },
        server.services.metering,
        {
            fsEntry: server.stores.fsEntry,
            s3Object: server.stores.s3Object,
        },
        server.services.fs,
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

const baseCompletion = {
    choices: [
        {
            message: { content: 'hi', role: 'assistant' },
            finish_reason: 'stop',
        },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
};

beforeEach(() => {
    createMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Construction ----------------------------------------------------

describe('MetaProvider construction', () => {
    it('points the OpenAI SDK at the Meta Model API base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.meta.ai/v1',
        });
    });

    it('honours a custom apiBaseUrl override', () => {
        makeProvider({ apiBaseUrl: 'https://meta.test/v1' });
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://meta.test/v1',
        });
    });
});

// -- Model catalog ---------------------------------------------------

describe('MetaProvider model catalog', () => {
    it('returns muse-spark-1.2 as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('muse-spark-1.2');
    });

    it('exposes the static META_MODELS list verbatim from models()', () => {
        const { provider } = makeProvider();
        expect(provider.models()).toBe(META_MODELS);
    });

    it('list() flattens canonical ids and vendor-qualified aliases', () => {
        const { provider } = makeProvider();
        const names = provider.list();
        for (const m of META_MODELS) {
            expect(names).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(names).toContain(a);
            }
        }
        // The alias the reseller route is also keyed under — this is what puts
        // both routes in one bucket so the direct vendor can outrank it.
        expect(names).toContain('meta/muse-spark-1.2');
        expect(names).toContain('meta/muse-spark-1.1');
    });

    it('advertises only the models the API actually serves', () => {
        // `GET /models` returns these two and answers 404 for the documented
        // `-contributor` tier, so the catalog must not offer it: it would show
        // up in listModels() as a model every request fails against, at a
        // price that makes it look like the one to pick.
        expect(META_MODELS.map((m) => m.id)).toEqual([
            'muse-spark-1.2',
            'muse-spark-1.1',
        ]);
    });
});

// -- Request shape ---------------------------------------------------

describe('MetaProvider.complete request shape', () => {
    it('forwards model and messages without optional knobs', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('muse-spark-1.2');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        for (const key of [
            'max_completion_tokens',
            'temperature',
            'top_p',
            'tools',
            'tool_choice',
            'reasoning_effort',
            'prompt_cache_retention',
            'response_format',
            'seed',
        ]) {
            expect(key in args).toBe(false);
        }
    });

    it('resolves a vendor-qualified alias to the canonical model id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'meta/muse-spark-1.1',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('muse-spark-1.1');
    });

    it('falls back to the default model when the id is unknown', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-9.9',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('muse-spark-1.2');
    });

    it('renames max_tokens to max_completion_tokens', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 256,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.max_completion_tokens).toBe(256);
        expect('max_tokens' in args).toBe(false);
    });

    it('forwards temperature, top_p, tools, and tool_choice when supplied', async () => {
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
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                temperature: 0.4,
                top_p: 0.9,
                tools,
                tool_choice: 'auto',
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.temperature).toBe(0.4);
        expect(args.top_p).toBe(0.9);
        expect(args.tools).toBe(tools);
        expect(args.tool_choice).toBe('auto');
    });

    it('never sends the parameters Muse Spark rejects', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                verbosity: 'concise',
                custom: { stop: ['\n\n'], n: 2, logprobs: true },
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        for (const key of [
            'stop',
            'n',
            'logprobs',
            'logit_bias',
            'verbosity',
        ]) {
            expect(key in args).toBe(false);
        }
    });

    it('forwards reasoning_effort, including from the nested reasoning object', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'high',
            }),
        );
        expect(createMock.mock.calls[0]![0].reasoning_effort).toBe('high');

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning: { effort: 'low' },
            }),
        );
        expect(createMock.mock.calls[1]![0].reasoning_effort).toBe('low');
    });

    it('lets custom.reasoning_effort reach the efforts the driver field cannot express', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'low',
                custom: { reasoning_effort: 'xhigh' },
            }),
        );

        expect(createMock.mock.calls[0]![0].reasoning_effort).toBe('xhigh');
    });

    it('drops an effort Muse Spark would reject rather than sending it', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        // The model always reasons, so `none` comes back as a 400.
        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                custom: { reasoning_effort: 'none' },
            }),
        );

        expect('reasoning_effort' in createMock.mock.calls[0]![0]).toBe(false);
    });

    it('translates prompt_cache_retention to the wire spelling', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                prompt_cache_retention: 'in-memory',
            }),
        );
        expect(createMock.mock.calls[0]![0].prompt_cache_retention).toBe(
            'in_memory',
        );

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                prompt_cache_retention: '24h',
            }),
        );
        expect(createMock.mock.calls[1]![0].prompt_cache_retention).toBe('24h');
    });

    it('forwards response_format, seed, and the penalty knobs from custom', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                custom: {
                    response_format: { type: 'json_object' },
                    seed: 42,
                    frequency_penalty: 0.5,
                    presence_penalty: -0.5,
                },
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.response_format).toEqual({ type: 'json_object' });
        expect(args.seed).toBe(42);
        expect(args.frequency_penalty).toBe(0.5);
        expect(args.presence_penalty).toBe(-0.5);
    });

    it('strips the Anthropic-only cache_control marker off messages', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [
                    {
                        role: 'user',
                        content: 'hi',
                        cache_control: { type: 'ephemeral' },
                    },
                ],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('cache_control' in args.messages[0]).toBe(false);
    });

    it('asks for usage on the stream when streaming', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(asAsyncIterable([]));

        await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.stream).toBe(true);
        expect(args.stream_options).toEqual({ include_usage: true });
    });

    it('rejects a non-array messages payload before calling upstream', async () => {
        const { provider } = makeProvider();

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'muse-spark-1.2',
                    messages: 'hello' as unknown as [],
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
        expect(createMock).not.toHaveBeenCalled();
    });
});

// -- Non-stream output + metering ------------------------------------

describe('MetaProvider.complete non-stream output', () => {
    it('returns the first choice and bills the cache hit at the cached rate', async () => {
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
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        // Cached reads are priced on their own key, so they come out of the
        // prompt count instead of being charged at the full input rate too.
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        const muse = META_MODELS.find((m) => m.id === 'muse-spark-1.2')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('meta:muse-spark-1.2');
        expect(overrides.prompt_tokens).toBeCloseTo(
            90 * Number(muse.costs.prompt_tokens),
            5,
        );
        expect(overrides.completion_tokens).toBeCloseTo(
            50 * Number(muse.costs.completion_tokens),
            5,
        );
        expect(overrides.cached_tokens).toBeCloseTo(
            10 * Number(muse.costs.cached_tokens),
            5,
        );
    });

    it('never reports a negative prompt count when the cache hit covers the prompt', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            // A prompt count below its own cache hit shouldn't be possible,
            // but an unclamped subtraction would turn it into negative usage
            // and credit the account.
            usage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                prompt_tokens_details: { cached_tokens: 40 },
            },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(
            (result as { usage: Record<string, number> }).usage.prompt_tokens,
        ).toBe(0);
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
            usage: { prompt_tokens: 5, completion_tokens: 3 },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'look it up' }],
            }),
        );

        expect(result).toMatchObject({ finish_reason: 'tool_calls' });
        const message = (result as { message: Record<string, unknown> })
            .message;
        expect(message.tool_calls).toMatchObject([
            { id: 'call_1', function: { name: 'lookup' } },
        ]);
    });
});

// -- Streaming -------------------------------------------------------

describe('MetaProvider.complete streaming', () => {
    it('streams text deltas through to text events and meters final usage', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                {
                    choices: [{ delta: {} }],
                    usage: {
                        prompt_tokens: 40,
                        completion_tokens: 2,
                        prompt_tokens_details: { cached_tokens: 10 },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
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
        expect(
            events.filter((e) => e.type === 'text').map((e) => e.text),
        ).toEqual(['hel', 'lo']);

        const usageEvent = events.find((e) => e.type === 'usage');
        expect(usageEvent?.usage).toEqual({
            prompt_tokens: 30,
            completion_tokens: 2,
            cached_tokens: 10,
        });

        const muse = META_MODELS.find((m) => m.id === 'muse-spark-1.2')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('meta:muse-spark-1.2');
        expect(overrides.completion_tokens).toBeCloseTo(
            2 * Number(muse.costs.completion_tokens),
            5,
        );
    });
});

// -- Error mapping ---------------------------------------------------

describe('MetaProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const upstream = Object.assign(new Error('boom'), { status: 429 });
        createMock.mockRejectedValueOnce(upstream);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'muse-spark-1.2',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toBe(upstream);
    });
});

// -- Moderation ------------------------------------------------------

describe('MetaProvider.checkModeration', () => {
    it('throws — the Meta Model API exposes no moderation endpoint', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow();
    });
});
