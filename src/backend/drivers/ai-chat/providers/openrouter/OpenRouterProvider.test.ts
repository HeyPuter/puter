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
 * Offline unit tests for OpenRouterProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs OpenRouterProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. OpenRouter is OpenAI-compatible, so the OpenAI SDK is mocked
 * at the module boundary; the model catalog is fetched via `axios`
 * which is mocked at its module boundary too. Both are the real
 * network egress points. Each test clears the kv-cached model list.
 * The companion integration test (OpenRouterProvider.integration.test.ts)
 * exercises the real OpenRouter endpoint.
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

import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { kv } from '../../../../util/kvSingleton.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { createMock, openAICtor } = vi.hoisted(() => ({
    createMock: vi.fn(),
    openAICtor: vi.fn(),
}));

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

// ── axios mock (model catalog endpoint) ─────────────────────────────

const { axiosRequestMock } = vi.hoisted(() => ({
    axiosRequestMock: vi.fn(),
}));

vi.mock('axios', () => ({
    default: { request: axiosRequestMock },
    request: axiosRequestMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

const KV_KEY = 'openrouterChat:models';

const SAMPLE_API_MODELS = [
    {
        id: 'openai/gpt-5-nano',
        name: 'GPT-5 Nano',
        context_length: 128000,
        pricing: { prompt: 0.00001, completion: 0.00003 },
        top_provider: { max_completion_tokens: 16000 },
    },
    {
        id: 'anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        context_length: 200000,
        pricing: { prompt: 0.000002, completion: 0.00001 },
        top_provider: { max_completion_tokens: 8192 },
    },
    {
        // 'openrouter/auto' is filtered out — disallowed.
        id: 'openrouter/auto',
        name: 'Auto',
        context_length: 32768,
        pricing: { prompt: 0, completion: 0 },
        top_provider: { max_completion_tokens: 4096 },
    },
];

const seedModelsCache = () =>
    axiosRequestMock.mockResolvedValue({ data: { data: SAMPLE_API_MODELS } });

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () => {
    const provider = new OpenRouterProvider(
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
    axiosRequestMock.mockReset();
    seedModelsCache();
    kv.del(KV_KEY);
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
    kv.del(KV_KEY);
});

// ── Construction ────────────────────────────────────────────────────

describe('OpenRouterProvider construction', () => {
    it('points the OpenAI SDK at the OpenRouter base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://openrouter.ai/api/v1',
        });
    });

    it('honours an apiBaseUrl override', () => {
        new OpenRouterProvider(
            {
                apiKey: 'test-key',
                apiBaseUrl: 'https://custom.openrouter.example/api/v1',
            },
            server.services.metering,
        );
        expect(openAICtor).toHaveBeenLastCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://custom.openrouter.example/api/v1',
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('OpenRouterProvider model catalog', () => {
    it('returns the openrouter-prefixed default model id', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('openrouter:openai/gpt-5-nano');
    });

    it('list() prefixes ids with openrouter: and filters out openrouter/auto', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        expect(ids).toContain('openrouter:openai/gpt-5-nano');
        expect(ids).toContain('openrouter:anthropic/claude-haiku-4.5');
        expect(ids).not.toContain('openrouter:openrouter/auto');
    });

    it('caches the coerced model list in kv after the first axios round-trip', async () => {
        const { provider } = makeProvider();
        await provider.models();
        await provider.models();
        // Second call should be a cache hit, not a second axios request.
        expect(axiosRequestMock).toHaveBeenCalledTimes(1);
    });
});

// ── Disallowed model gate ───────────────────────────────────────────

describe('OpenRouterProvider disallowed models', () => {
    it('throws 400 when the caller asks for openrouter/auto explicitly', async () => {
        const { provider } = makeProvider();

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'openrouter/auto',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        // We should never have reached the SDK.
        expect(createMock).not.toHaveBeenCalled();
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Request shape ──────────────────────────────────────────────────

describe('OpenRouterProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
    };

    it('strips the openrouter: prefix from the wire model id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // openrouter: prefix is dropped before the SDK call.
        expect(args.model).toBe('openai/gpt-5-nano');
        // OpenRouter requires `usage: { include: true }` to surface the
        // cost field — the provider always sets this.
        expect(args.usage).toEqual({ include: true });
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect(createMock.mock.calls[0]![0].stream).toBe(false);
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });

    it('retries without max_tokens when OpenRouter rejects with a context-length error', async () => {
        const { provider } = makeProvider();

        // First call: simulate the OpenRouter "context length" rejection
        // shape the provider catches by message prefix.
        const ctxErr = {
            error: {
                message:
                    "This endpoint's maximum context length is 4096 tokens.",
            },
        };
        createMock
            .mockRejectedValueOnce(ctxErr)
            .mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 9999999,
            }),
        );

        // Provider mutates a single completionParams object across both calls
        // (`delete completionParams.max_tokens` after the first throw), so we
        // can only assert that two calls happened and the surviving shape no
        // longer carries max_tokens.
        expect(createMock).toHaveBeenCalledTimes(2);
        expect('max_tokens' in createMock.mock.calls[1]![0]).toBe(false);
    });

    it('rethrows non-context-length errors without retrying', async () => {
        const { provider } = makeProvider();
        const apiError = { error: { message: 'Some other failure' } };
        createMock.mockRejectedValueOnce(apiError);
        // Provider logs before rethrowing — silence the noise.
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'openrouter:openai/gpt-5-nano',
                    messages: [{ role: 'user', content: 'boom' }],
                    max_tokens: 100,
                }),
            ),
        ).rejects.toBe(apiError);

        // Only one attempt was made.
        expect(createMock).toHaveBeenCalledTimes(1);
        expect(recordSpy).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
    });
});

// ── Non-stream completion: cost calculator branches ─────────────────

describe('OpenRouterProvider.complete non-stream output', () => {
    it('uses the cost-bearing branch when usage.cost is present', async () => {
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
                cost: 0.0001,
            },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number> };

        // The cost-bearing branch zeroes per-token costs and bills via a
        // single `billedUsage` line item priced at usage.cost * 1e8.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('openrouter:openai/gpt-5-nano');
        expect(usage).toMatchObject({
            prompt: 100 - 10, // prompt_tokens - cached
            completion: 50,
            input_cache_read: 10,
            billedUsage: 1,
        });
        // All per-token costs are zeroed so OpenRouter's authoritative
        // cost is the only thing that bills.
        expect(overrides.prompt).toBe(0);
        expect(overrides.completion).toBe(0);
        expect(overrides.input_cache_read).toBe(0);
        expect(overrides.billedUsage).toBe(0.0001 * 100_000_000);
        // The returned usage exposes usd_cents derived from cost.
        expect(result.usage.usd_cents).toBe(0.0001 * 100);
    });

    it('falls back to per-token pricing when usage.cost is absent', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            // No `cost` on usage → fallback branch.
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 10 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // gpt-5-nano API pricing converted to microcents per token:
        // prompt=0.00001 → 0.00001 * 1_000_000 * 100 = 1000
        // completion=0.00003 → 3000
        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toMatchObject({
            prompt: 90,
            completion: 50,
            input_cache_read: 10,
        });
        expect(overrides.prompt).toBe(90 * 1000);
        expect(overrides.completion).toBe(50 * 3000);
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('OpenRouterProvider.complete streaming', () => {
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
                        cost: 0.00005,
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'openrouter:openai/gpt-5-nano',
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

        // Cost-branch metering on the final chunk.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('openrouter:openai/gpt-5-nano');
        expect(overrides.billedUsage).toBe(0.00005 * 100_000_000);
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('OpenRouterProvider.checkModeration', () => {
    it('throws — OpenRouter provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
