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
 * Offline unit tests for InfronProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs InfronProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. Infron is OpenAI-compatible, so the OpenAI SDK is mocked at
 * the module boundary; the model catalog is fetched via `axios`
 * which is mocked at its module boundary too. Both are the real
 * network egress points. Each test clears the kv-cached model list.
 * The companion integration test (InfronProvider.integration.test.ts)
 * exercises the real Infron endpoint.
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
import { InfronProvider } from './InfronProvider.js';

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

const KV_KEY = 'infronChat:models';

// Prices are USD per million tokens (Infron catalog convention).
const SAMPLE_API_MODELS = [
    {
        id: 'deepseek/deepseek-v4-flash',
        display_name: 'DeepSeek: DeepSeek V4 Flash',
        category_type: 'LLM',
        supported_endpoint_types: ['openai'],
        context_length: 1000000,
        max_output_tokens: 384000,
        min_prompt_price: 10,
        min_completion_price: 30,
    },
    {
        id: 'anthropic/claude-haiku-4.5',
        display_name: 'Anthropic: Claude Haiku 4.5',
        category_type: 'LLM',
        supported_endpoint_types: ['openai'],
        context_length: 200000,
        max_output_tokens: 8192,
        min_prompt_price: 2,
        min_completion_price: 10,
    },
    {
        // Non-chat modality — filtered out.
        id: 'black-forest-labs/flux-2.1',
        display_name: 'FLUX 2.1',
        category_type: 'Text to Image',
        supported_endpoint_types: ['openai'],
        min_request_price: 0.04,
    },
    {
        // Display-only entries are not callable — filtered out.
        id: 'example/display-only-model',
        display_name: 'Display Only',
        category_type: 'LLM',
        is_display_only: true,
        supported_endpoint_types: ['openai'],
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
    const provider = new InfronProvider(
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

describe('InfronProvider construction', () => {
    it('points the OpenAI SDK at the Infron base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://llm.onerouter.pro/v1',
        });
    });

    it('honours an apiBaseUrl override', () => {
        new InfronProvider(
            {
                apiKey: 'test-key',
                apiBaseUrl: 'https://custom.infron.example/v1',
            },
            server.services.metering,
        );
        expect(openAICtor).toHaveBeenLastCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://custom.infron.example/v1',
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('InfronProvider model catalog', () => {
    it('returns the infron-prefixed default model id', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            'infron:deepseek/deepseek-v4-flash',
        );
    });

    it('sends the API key as a bearer token on the catalog fetch', async () => {
        const { provider } = makeProvider();
        await provider.models();
        const [args] = axiosRequestMock.mock.calls[0]!;
        expect(args.url).toBe('https://llm.onerouter.pro/v1/models');
        expect(args.headers).toMatchObject({
            Authorization: 'Bearer test-key',
        });
    });

    it('list() prefixes ids with infron: and filters non-chat and display-only entries', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        expect(ids).toContain('infron:deepseek/deepseek-v4-flash');
        expect(ids).toContain('infron:anthropic/claude-haiku-4.5');
        expect(ids).not.toContain('infron:black-forest-labs/flux-2.1');
        expect(ids).not.toContain('infron:example/display-only-model');
    });

    it('caches the model list in kv after the first axios round-trip', async () => {
        const { provider } = makeProvider();
        await provider.models();
        await provider.models();
        // Second call should be a cache hit, not a second axios request.
        expect(axiosRequestMock).toHaveBeenCalledTimes(1);
    });

    it('converts USD-per-million-token prices to microcents per token', async () => {
        const { provider } = makeProvider();
        const models = await provider.models();
        // $10/M tokens → 10 * 100 = 1000 microcents per token.
        expect(models).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'infron:deepseek/deepseek-v4-flash',
                    costs: expect.objectContaining({
                        tokens: 1_000_000,
                        prompt: 1000,
                        completion: 3000,
                    }),
                }),
            ]),
        );
    });
});

// ── Request shape ──────────────────────────────────────────────────

describe('InfronProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        cost: 0,
    };

    it('strips the infron: prefix from the wire model id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'infron:deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // infron: prefix is dropped before the SDK call.
        expect(args.model).toBe('deepseek/deepseek-v4-flash');
        // Infron requires `usage: { include: true }` to surface the
        // cost field — the provider always sets this.
        expect(args.usage).toEqual({ include: true });
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'infron:deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect(createMock.mock.calls[0]![0].stream).toBe(false);
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'infron:deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });
});

// ── Non-stream completion: cost calculator branches ─────────────────

describe('InfronProvider.complete non-stream output', () => {
    it('uses the cost-bearing branch when the top-level cost is present', async () => {
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
            // Infron reports cost at the top level of the completion,
            // not inside `usage`.
            cost: 0.0001,
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'infron:deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number> };

        // The cost-bearing branch zeroes per-token costs and bills via a
        // single `billedUsage` line item priced at cost * 1e8.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('infron:deepseek/deepseek-v4-flash');
        expect(usage).toMatchObject({
            prompt: 100 - 10, // prompt_tokens - cached
            completion: 50,
            input_cache_read: 10,
            billedUsage: 1,
        });
        // All per-token costs are zeroed so Infron's authoritative
        // cost is the only thing that bills.
        expect(overrides.prompt).toBe(0);
        expect(overrides.completion).toBe(0);
        expect(overrides.input_cache_read).toBe(0);
        expect(overrides.billedUsage).toBe(0.0001 * 100_000_000);
        // The returned usage exposes usd_cents derived from cost.
        expect(result.usage.usd_cents).toBe(0.0001 * 100);
    });

    it('falls back to per-token pricing when cost is absent', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            // No top-level `cost` → fallback branch.
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 10 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'infron:deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // deepseek-v4-flash catalog pricing converted to microcents per
        // token: prompt=$10/M → 1000, completion=$30/M → 3000; cache
        // reads fall back to the full prompt rate.
        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toMatchObject({
            prompt: 90,
            completion: 50,
            input_cache_read: 10,
        });
        expect(overrides.prompt).toBe(90 * 1000);
        expect(overrides.completion).toBe(50 * 3000);
        expect(overrides.input_cache_read).toBe(10 * 1000);
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('InfronProvider.complete streaming', () => {
    it('streams text deltas through to text events and meters the final-chunk cost', async () => {
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
                    },
                    // Cost rides at the top level of the final chunk.
                    cost: 0.00005,
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'infron:deepseek/deepseek-v4-flash',
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
        expect(prefix).toBe('infron:deepseek/deepseek-v4-flash');
        expect(overrides.billedUsage).toBe(0.00005 * 100_000_000);
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('InfronProvider.checkModeration', () => {
    it('throws — Infron provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
