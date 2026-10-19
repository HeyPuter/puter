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
 * Offline unit tests for XAIProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs XAIProvider directly against the live wired
 * `MeteringService` so the recording side is exercised end-to-end.
 * xAI is OpenAI-compatible so the OpenAI SDK is mocked at the module
 * boundary; that's the real network egress point. The companion
 * integration test (XAIProvider.integration.test.ts) exercises the
 * real xAI endpoint.
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
import { costsForRequest, usageCost } from '../../utils/pricing.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { XAI_CHAT_MODELS } from './catalog.js';
import catalogFixture from './fixtures/language-models.json';
import { XAI_MODELS } from './models.js';
import { XAIProvider } from './XAIProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────
//
// `vi.hoisted` lets us share spies between the (hoisted) factory and
// the test body so each test can stub `chat.completions.create` with
// the response shape it cares about.

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
    // Some providers (e.g. OllamaChatProvider, GeminiChatProvider)
    // import the default export and access `.OpenAI` on it, so expose
    // the same constructor under both shapes — the test server boots
    // every provider, not just xAI.
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// The pricing catalog is fetched with axios; tests that don't serve one see
// the upstream down and get the curated catalog.
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

const makeProvider = () => {
    const provider = new XAIProvider(
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
    axiosGetMock.mockReset();
    axiosGetMock.mockRejectedValue(new Error('Catalog unavailable'));
    // Spy on the live MeteringService — keep the underlying impl so
    // recording-side bugs surface here, but capture calls so per-test
    // assertions can verify metering shape.
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('XAIProvider construction', () => {
    it('points the OpenAI SDK at the xAI base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.x.ai/v1',
            maxRetries: 0,
            timeout: 10 * 60 * 1000,
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('XAIProvider model catalog', () => {
    it('returns grok-4.5 as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('grok-4.5');
    });

    it('serves the curated catalog from models() while the upstream is down', async () => {
        const { provider } = makeProvider();
        expect(await provider.models()).toBe(XAI_CHAT_MODELS);
        expect(
            (await provider.models()).map(({ id, aliases }) => ({
                id,
                aliases,
            })),
        ).toEqual(XAI_MODELS.map(({ id, aliases }) => ({ id, aliases })));
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const names = await provider.list();
        // Every canonical id should be present.
        for (const m of XAI_MODELS) {
            expect(names).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(names).toContain(a);
            }
        }
        // Sanity: a known alias resolves to its expected id sibling.
        expect(names).toContain('grok-4.6');
        expect(names).toContain('x-ai/grok-4.6');
    });
});

// ── Request shape (OpenAI-compat quirks) ────────────────────────────

describe('XAIProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('forwards model, messages and the max_tokens it was given', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.6',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 4096,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('grok-4.6');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        // The driver's credit gate writes its output cap here.
        expect(args.max_tokens).toBe(4096);
    });

    it('leaves max_tokens off the request when none is given', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.6',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('max_tokens' in args).toBe(false);
    });

    it('omits the `tools` key entirely when no tools are supplied', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // The provider spreads `...(tools ? { tools } : {})`, so the
        // absent case should leave the key off the wire payload.
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
                model: 'grok-4.6',
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
                model: 'grok-4.6',
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
                model: 'grok-4.6',
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
                model: 'grok-4.6',
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

// ── Model resolution ────────────────────────────────────────────────

describe('XAIProvider model resolution', () => {
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
                model: 'grok-build-0.1',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('grok-build-0.1');
        // Metering namespace mirrors the resolved canonical id.
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'xai:grok-build-0.1',
            expect.any(Object),
        );
    });

    it('resolves an alias to its canonical id (alias rewriting)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // `x-ai/grok-4.6` is an alias of `grok-4.6` in models.ts.
                model: 'x-ai/grok-4.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // The wire model should be the canonical id, not the alias.
        expect(createMock.mock.calls[0]![0].model).toBe('grok-4.6');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'xai:grok-4.6',
            expect.any(Object),
        );
    });

    it('meters grok-4.7 at its standard rates below the long-context threshold', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 1000,
                completion_tokens: 500,
                prompt_tokens_details: { cached_tokens: 200 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'x-ai/grok-4.7',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('grok-4.7');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'xai:grok-4.7',
            {
                prompt_tokens: 800 * 200,
                completion_tokens: 500 * 600,
                cached_tokens: 200 * 50,
            },
        );
    });

    it('doubles every rate once the prompt passes 200K tokens', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 250_000,
                completion_tokens: 500,
                prompt_tokens_details: { cached_tokens: 50_000 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.7',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'xai:grok-4.7',
            {
                prompt_tokens: 200_000 * 200 * 2,
                completion_tokens: 500 * 600 * 2,
                cached_tokens: 50_000 * 50 * 2,
            },
        );
    });

    it('resolves the upstream grok-4.20-beta alias to the 0309 reasoning model', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.20-beta',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe(
            'grok-4.20-0309-reasoning',
        );
    });

    it('resolves grok-4.6 aliases to grok-4.6 with correct metering overrides', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 1000,
                completion_tokens: 500,
                prompt_tokens_details: { cached_tokens: 200 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.6-latest',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('grok-4.6');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'xai:grok-4.6',
            {
                prompt_tokens: 800 * 200,
                completion_tokens: 500 * 600,
                cached_tokens: 200 * 50,
            },
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

        expect(createMock.mock.calls[0]![0].model).toBe('grok-4.5');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'xai:grok-4.5',
            expect.any(Object),
        );
    });
});

// ── Non-stream completion + tool-call passthrough ───────────────────

// ── Remote pricing catalog ──────────────────────────────────────────

/** The live catalog with grok-4.5 repriced, so catalog rates are observable. */
const repricedCatalog = () => ({
    models: catalogFixture.models.map((m) =>
        m.id === 'grok-4.5'
            ? {
                  ...m,
                  prompt_text_token_price: 25_000,
                  prompt_image_token_price: 25_000,
                  cached_prompt_text_token_price: 2_500,
                  completion_text_token_price: 70_000,
                  prompt_text_token_price_long_context: 45_000,
                  cached_prompt_text_token_price_long_context: 0,
                  completion_text_token_price_long_context: 150_000,
              }
            : m,
    ),
});

const okCompletion = (usage: Record<string, unknown>) => ({
    choices: [
        {
            message: { content: 'ok', role: 'assistant' },
            finish_reason: 'stop',
        },
    ],
    usage,
});

const promptOf = (total: number) => ({
    prompt_tokens: total,
    completion_tokens: 100,
    prompt_tokens_details: { cached_tokens: 1000 },
});

describe('XAIProvider remote pricing catalog', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('fetches the catalog once and serves it from memory', async () => {
        axiosGetMock.mockResolvedValue({ data: repricedCatalog() });
        const { provider } = makeProvider();

        const [a, b, c] = await Promise.all([
            provider.models(),
            provider.models(),
            provider.list(),
        ]);
        await provider.models();

        expect(axiosGetMock).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
        expect(c).toEqual(await provider.list());
        expect(a.find((m) => m.id === 'grok-4.5')!.costs).toEqual({
            tokens: 1_000_000,
            prompt_tokens: 250,
            completion_tokens: 700,
            cached_tokens: 25,
        });
    });

    it('keeps the last good catalog when a refresh fails, and remembers the failure', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        axiosGetMock.mockResolvedValueOnce({ data: repricedCatalog() });
        const { provider } = makeProvider();
        const good = await provider.models();

        vi.setSystemTime(Date.now() + 16 * 60 * 1000);
        axiosGetMock.mockRejectedValue(new Error('upstream down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await provider.models()).toBe(good);
        expect(await provider.models()).toBe(good);
        expect(axiosGetMock).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).not.toContain('test-key');
    });

    it('serves the curated catalog when the first fetch returns garbage', async () => {
        axiosGetMock.mockResolvedValueOnce({ data: { data: [] } });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { provider } = makeProvider();
        expect(await provider.models()).toBe(XAI_CHAT_MODELS);
    });

    it('bills completions at catalog rates and keeps aliases and the default', async () => {
        axiosGetMock.mockResolvedValue({ data: repricedCatalog() });
        const { provider } = makeProvider();
        for (const model of ['grok-build-latest', 'not-a-model']) {
            createMock.mockResolvedValueOnce(okCompletion(promptOf(11_000)));
            await withTestActor(() =>
                provider.complete({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            );
        }

        expect(createMock.mock.calls.map((c) => c[0].model)).toEqual([
            'grok-4.5',
            'grok-4.5',
        ]);
        for (const call of recordSpy.mock.calls) {
            expect(call[2]).toBe('xai:grok-4.5');
            expect(call[3]).toEqual({
                prompt_tokens: 10_000 * 250,
                cached_tokens: 1000 * 25,
                completion_tokens: 100 * 700,
            });
        }
    });

    it.each([
        [199_999, { prompt: 250, cached: 25, completion: 700 }],
        // The long tier's zero cache amount falls back to the standard rate.
        [200_000, { prompt: 450, cached: 25, completion: 1500 }],
        [200_001, { prompt: 450, cached: 25, completion: 1500 }],
    ])(
        'a %i-token prompt is metered, reported and estimated at one rate',
        async (prompt, rate) => {
            axiosGetMock.mockResolvedValue({ data: repricedCatalog() });
            const { provider } = makeProvider();
            createMock.mockResolvedValueOnce(okCompletion(promptOf(prompt)));

            const result = (await withTestActor(() =>
                provider.complete({
                    model: 'grok-4.5',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            )) as {
                usage: Record<string, number>;
                usageCosts: Record<string, number>;
            };

            const ledger = {
                prompt_tokens: (prompt - 1000) * rate.prompt,
                cached_tokens: 1000 * rate.cached,
                completion_tokens: 100 * rate.completion,
            };
            expect(recordSpy.mock.calls[0]![0]).toEqual({
                prompt_tokens: prompt - 1000,
                cached_tokens: 1000,
                completion_tokens: 100,
            });
            expect(recordSpy.mock.calls[0]![3]).toEqual(ledger);
            expect(result.usageCosts).toEqual(ledger);

            // The figure the driver reports from the returned usage matches
            // the ledger, and the credit gate quotes the same tier.
            const model = (await provider.models()).find(
                (m) => m.id === 'grok-4.5',
            )!;
            const cost = usageCost(result.usage, model, result.usageCosts)!;
            expect(cost.inputMicroCents + cost.outputMicroCents).toBe(
                ledger.prompt_tokens +
                    ledger.cached_tokens +
                    ledger.completion_tokens,
            );
            const estimate = costsForRequest(model, prompt);
            expect(estimate.prompt_tokens).toBe(rate.prompt);
            expect(estimate.completion_tokens).toBe(rate.completion);
        },
    );

    it('bills explicit zero catalog rates as free and keeps a priced cache rate', async () => {
        const catalog = repricedCatalog();
        catalog.models = catalog.models.map((m) =>
            m.id === 'grok-4.5'
                ? {
                      ...m,
                      prompt_text_token_price: 0,
                      prompt_image_token_price: 0,
                      completion_text_token_price: 0,
                  }
                : m,
        );
        axiosGetMock.mockResolvedValue({ data: catalog });
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(okCompletion(promptOf(11_000)));

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.5',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy.mock.calls[0]![3]).toEqual({
            prompt_tokens: 0,
            cached_tokens: 1000 * 25,
            completion_tokens: 0,
        });
    });
});

/** The live catalog with grok-4.5 priced above the fixture on every rate. */
const higherCatalog = () => ({
    models: catalogFixture.models.map((m) =>
        m.id === 'grok-4.5'
            ? {
                  ...m,
                  prompt_text_token_price: 30_000,
                  prompt_image_token_price: 30_000,
                  cached_prompt_text_token_price: 5_000,
                  completion_text_token_price: 90_000,
                  prompt_text_token_price_long_context: 60_000,
                  cached_prompt_text_token_price_long_context: 10_000,
                  completion_text_token_price_long_context: 180_000,
              }
            : m,
    ),
});

const usageChunks = (usage: Record<string, unknown>) =>
    asAsyncIterable([
        { choices: [{ delta: { content: 'ok' } }] },
        { choices: [{ delta: {} }], usage },
    ]);

describe('XAIProvider resolved catalog snapshot', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([false, true])(
        'bills the snapshot the driver held credit against after the catalog refreshes higher (stream: %s)',
        async (stream) => {
            vi.useFakeTimers({ toFake: ['Date'] });
            axiosGetMock.mockResolvedValueOnce({
                data: structuredClone(catalogFixture),
            });
            const { provider } = makeProvider();
            const snapshot = (await provider.models()).find(
                (m) => m.id === 'grok-4.5',
            )!;

            vi.setSystemTime(Date.now() + 16 * 60 * 1000);
            axiosGetMock.mockResolvedValue({ data: higherCatalog() });
            const usage = promptOf(200_000);
            if (stream) createMock.mockReturnValueOnce(usageChunks(usage));
            else createMock.mockResolvedValueOnce(okCompletion(usage));

            const result = await withTestActor(() =>
                provider.complete(
                    {
                        model: 'grok-4.5',
                        messages: [{ role: 'user', content: 'hi' }],
                        stream,
                    },
                    snapshot,
                ),
            );
            if (stream) {
                await (
                    result as {
                        init_chat_stream: (p: {
                            chatStream: unknown;
                        }) => Promise<void>;
                    }
                ).init_chat_stream({
                    chatStream: makeCapturingChatStream().chatStream,
                });
            }

            // No catalog fetch of its own, and the snapshot's long tier
            // applies from the inclusive threshold.
            expect(axiosGetMock).toHaveBeenCalledTimes(1);
            expect(createMock.mock.calls[0]![0].model).toBe('grok-4.5');
            expect(recordSpy).toHaveBeenCalledTimes(1);
            expect(recordSpy.mock.calls[0]![2]).toBe('xai:grok-4.5');
            expect(recordSpy.mock.calls[0]![3]).toEqual({
                prompt_tokens: 199_000 * 400,
                cached_tokens: 1000 * 60,
                completion_tokens: 100 * 1200,
            });

            // The catalog the provider would have read is newer and higher.
            const fresh = (await provider.models()).find(
                (m) => m.id === 'grok-4.5',
            )!;
            expect(axiosGetMock).toHaveBeenCalledTimes(2);
            expect(costsForRequest(fresh, 200_000)).toMatchObject({
                prompt_tokens: 600,
                cached_tokens: 100,
                completion_tokens: 1800,
            });
        },
    );

    it('resolves and refreshes the catalog itself when called without a snapshot', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        axiosGetMock.mockResolvedValueOnce({
            data: structuredClone(catalogFixture),
        });
        const { provider } = makeProvider();
        await provider.models();

        vi.setSystemTime(Date.now() + 16 * 60 * 1000);
        axiosGetMock.mockResolvedValue({ data: higherCatalog() });
        createMock.mockResolvedValueOnce(okCompletion(promptOf(200_000)));
        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.5-latest',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(axiosGetMock).toHaveBeenCalledTimes(2);
        expect(createMock.mock.calls[0]![0].model).toBe('grok-4.5');
        expect(recordSpy.mock.calls[0]![3]).toEqual({
            prompt_tokens: 199_000 * 600,
            cached_tokens: 1000 * 100,
            completion_tokens: 100 * 1800,
        });
    });
});

describe('XAIProvider.complete non-stream output', () => {
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
                model: 'grok-4.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // Non-stream branch returns the first choice with a `usage`
        // field overlaid by the calculator.
        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        // The calculator is the metered usage object: prompt/completion
        // and cached tokens, not the raw OpenAI usage shape.
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        // Metering: usage is recorded once, with the right model
        // namespace, actor, and a costsOverride priced from
        // models.ts (grok-4.6: prompt=200, completion=600, cached=50).
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] =
            recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('xai:grok-4.6');
        expect(overrides).toEqual({
            prompt_tokens: 90 * 200,
            completion_tokens: 50 * 600,
            cached_tokens: 10 * 50,
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
                model: 'grok-4.6',
                messages: [{ role: 'user', content: 'do a tool call' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'lookup', parameters: {} },
                    },
                ],
            }),
        )) as { message: { tool_calls?: unknown[] }; finish_reason: string };

        // Tool calls are not re-shaped on the response side — the
        // provider relays the OpenAI-compat payload through unchanged.
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
            // No prompt_tokens_details on the response.
            usage: { prompt_tokens: 7, completion_tokens: 3 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4.6',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage, , , overrides] =
            recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        // 0 cached tokens × any rate = 0 metered cost.
        expect(overrides).toMatchObject({ cached_tokens: 0 });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('XAIProvider.complete streaming', () => {
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
                model: 'grok-build-0.1',
                messages: [{ role: 'user', content: 'say hi' }],
                stream: true,
            }),
        );
        // Stream descriptor surfaced.
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

        // The usage event carries the metered usage shape.
        const usageEvent = events.find((e) => e.type === 'usage');
        expect(usageEvent?.usage).toEqual({
            prompt_tokens: 4,
            completion_tokens: 2,
            cached_tokens: 1,
        });

        // grok-build-0.1 costs: prompt=100, completion=200, cached=20.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] =
            recordSpy.mock.calls[0]!;
        expect(prefix).toBe('xai:grok-build-0.1');
        expect(overrides).toEqual({
            prompt_tokens: 3 * 100,
            completion_tokens: 2 * 200,
            cached_tokens: 1 * 20,
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
                model: 'grok-4.6',
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

describe('XAIProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('xAI exploded');
        createMock.mockRejectedValueOnce(apiError);
        // Provider logs the error before rethrowing — silence the noise.
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'grok-4.6',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        // No metering should be recorded on a failed call.
        expect(recordSpy).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('XAIProvider.checkModeration', () => {
    it('throws — xAI provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
