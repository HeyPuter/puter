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
 * Offline unit tests for NeuralwattProvider.
 *
 * Boots a real PuterServer and constructs NeuralwattProvider against the
 * live MeteringService. The OpenAI SDK and axios (catalog + quota) are
 * mocked at their module boundaries.
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
import {
    mapNeuralwattApiModel,
    NEURALWATT_DEFAULT_MODEL,
    stripNeuralwattPrefix,
} from './models.js';
import { NeuralwattProvider } from './NeuralwattProvider.js';

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

// ── axios mock (models + quota) ─────────────────────────────────────

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

const KV_MODELS_KEY = 'neuralwattChat:models';
const KV_QUOTA_KEY = 'neuralwattChat:quota';

const SAMPLE_API_MODELS = [
    {
        id: 'deepseek-v4-flash',
        created: 1_700_000_000,
        max_model_len: 1_000_000,
        metadata: {
            display_name: 'DeepSeek V4 Flash',
            description: 'Fast tool-calling model',
            pricing: {
                input_per_million: 0.14,
                output_per_million: 0.28,
                cached_input_per_million: 0.014,
                pricing_tbd: false,
            },
            capabilities: {
                tools: true,
                vision: false,
                streaming: true,
            },
            limits: {
                max_context_length: 1_000_000,
                max_output_tokens: 384_000,
            },
        },
    },
    {
        id: 'zai-org/GLM-5.1-FP8',
        metadata: {
            display_name: 'GLM 5.1',
            pricing: {
                input_per_million: 0.35,
                output_per_million: 1.38,
                cached_input_per_million: 0.035,
                pricing_tbd: false,
            },
            capabilities: {
                tools: true,
                vision: false,
                reasoning: true,
            },
            limits: {
                max_context_length: 202_752,
                max_output_tokens: 16_384,
            },
        },
    },
    {
        id: 'coming-soon-model',
        metadata: {
            display_name: 'Coming Soon',
            pricing: {
                input_per_million: 0,
                output_per_million: 0,
                pricing_tbd: true,
            },
            capabilities: { tools: true },
            limits: { max_context_length: 8_000, max_output_tokens: 1_000 },
        },
    },
    {
        id: 'deprecated-model',
        metadata: {
            display_name: 'Old',
            deprecated: true,
            pricing: {
                input_per_million: 1,
                output_per_million: 2,
                pricing_tbd: false,
            },
            capabilities: { tools: true },
            limits: { max_context_length: 8_000, max_output_tokens: 1_000 },
        },
    },
];

const mockCatalogAndQuota = (
    accountingMethod: 'energy' | 'token' = 'energy',
) => {
    axiosRequestMock.mockImplementation(async (opts: { url?: string }) => {
        if (opts.url?.endsWith('/quota')) {
            return {
                data: {
                    balance: { accounting_method: accountingMethod },
                },
            };
        }
        return { data: { data: SAMPLE_API_MODELS } };
    });
};

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (config?: { apiBaseUrl?: string }) => {
    const provider = new NeuralwattProvider(
        { apiKey: 'test-key', ...config },
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
    mockCatalogAndQuota('energy');
    kv.del(KV_MODELS_KEY);
    kv.del(KV_QUOTA_KEY);
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
    kv.del(KV_MODELS_KEY);
    kv.del(KV_QUOTA_KEY);
});

// ── Mapping helpers ─────────────────────────────────────────────────

describe('Neuralwatt model mapping helpers', () => {
    it('strips the neuralwatt: prefix for upstream ids', () => {
        expect(stripNeuralwattPrefix('neuralwatt:deepseek-v4-flash')).toBe(
            'deepseek-v4-flash',
        );
        expect(stripNeuralwattPrefix('deepseek-v4-flash')).toBe(
            'deepseek-v4-flash',
        );
    });

    it('maps catalog pricing into usd-cents cost keys and skips pricing_tbd', () => {
        const mapped = mapNeuralwattApiModel(SAMPLE_API_MODELS[0]!);
        expect(mapped).toMatchObject({
            id: 'neuralwatt:deepseek-v4-flash',
            costs_currency: 'usd-cents',
            input_cost_key: 'prompt_tokens',
            output_cost_key: 'completion_tokens',
            costs: {
                tokens: 1_000_000,
                prompt_tokens: 0.14 * 100,
                completion_tokens: 0.28 * 100,
                cached_tokens: 0.014 * 100,
            },
            tool_call: true,
            max_tokens: 384_000,
            modalities: { input: ['text'], output: ['text'] },
        });
        expect(mapNeuralwattApiModel(SAMPLE_API_MODELS[2]!)).toBeNull();
    });

    it('marks vision models from capabilities.vision', () => {
        const mapped = mapNeuralwattApiModel({
            id: 'gemma-4-31b',
            metadata: {
                display_name: 'Gemma 4 31B',
                pricing: {
                    input_per_million: 0.1,
                    output_per_million: 0.2,
                    pricing_tbd: false,
                },
                capabilities: { tools: true, vision: true },
                limits: {
                    max_context_length: 256_000,
                    max_output_tokens: 16_384,
                    max_images: 8,
                },
            },
        });
        expect(mapped).toMatchObject({
            id: 'neuralwatt:gemma-4-31b',
            modalities: { input: ['text', 'image'], output: ['text'] },
            max_images: 8,
        });
    });
});

// ── Construction ────────────────────────────────────────────────────

describe('NeuralwattProvider construction', () => {
    it('points the OpenAI SDK at the Neuralwatt base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.neuralwatt.com/v1',
        });
    });

    it('honours an apiBaseUrl override', () => {
        makeProvider({ apiBaseUrl: 'https://custom.neuralwatt.example/v1' });
        expect(openAICtor).toHaveBeenLastCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://custom.neuralwatt.example/v1',
        });
    });
});

// ── Model catalog + quota ───────────────────────────────────────────

describe('NeuralwattProvider model catalog', () => {
    it('returns the neuralwatt-prefixed default model id', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe(NEURALWATT_DEFAULT_MODEL);
    });

    it('sends the API key as a bearer token on the catalog fetch', async () => {
        const { provider } = makeProvider();
        await provider.models();
        const modelsCall = axiosRequestMock.mock.calls.find(
            ([args]) =>
                typeof args?.url === 'string' && args.url.endsWith('/models'),
        );
        expect(modelsCall?.[0]).toMatchObject({
            url: 'https://api.neuralwatt.com/v1/models',
            headers: { Authorization: 'Bearer test-key' },
        });
    });

    it('list() prefixes ids and skips deprecated / pricing_tbd entries', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        expect(ids).toContain('neuralwatt:deepseek-v4-flash');
        expect(ids).toContain('neuralwatt:zai-org/GLM-5.1-FP8');
        expect(ids).toContain('GLM-5.1-FP8');
        expect(ids).not.toContain('neuralwatt:coming-soon-model');
        expect(ids).not.toContain('neuralwatt:deprecated-model');
    });

    it('caches the model list in kv after the first axios round-trip', async () => {
        const { provider } = makeProvider();
        await provider.models();
        await provider.models();
        const modelsCalls = axiosRequestMock.mock.calls.filter(
            ([args]) =>
                typeof args?.url === 'string' && args.url.endsWith('/models'),
        );
        expect(modelsCalls).toHaveLength(1);
    });

    it('caches accounting_method from /quota', async () => {
        const { provider } = makeProvider();
        await expect(provider.getAccountingMethod()).resolves.toBe('energy');
        await expect(provider.getAccountingMethod()).resolves.toBe('energy');
        const quotaCalls = axiosRequestMock.mock.calls.filter(
            ([args]) =>
                typeof args?.url === 'string' && args.url.endsWith('/quota'),
        );
        expect(quotaCalls).toHaveLength(1);
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('NeuralwattProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        cost: { request_cost_usd: 0 },
        energy: {
            energy_kwh: 0.000001,
            energy_joules: 3.6,
            measurement_available: true,
        },
    };

    it('strips the neuralwatt: prefix from the wire model id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'neuralwatt:deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('deepseek-v4-flash');
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'neuralwatt:deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect(createMock.mock.calls[0]![0].stream).toBe(false);
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'neuralwatt:deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });

    it('rejects image content on a text-only catalog model', async () => {
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'neuralwatt:deepseek-v4-flash',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: 'https://example.com/cat.png',
                                    },
                                },
                            ],
                        },
                    ],
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('does not support image input'),
        });
        expect(createMock).not.toHaveBeenCalled();
    });

    it('prefers a vision catalog model when the prompt has images and no model was named', async () => {
        // Seed a vision model into the catalog payload.
        axiosRequestMock.mockImplementation(async (opts: { url?: string }) => {
            if (opts.url?.endsWith('/quota')) {
                return {
                    data: { balance: { accounting_method: 'energy' } },
                };
            }
            return {
                data: {
                    data: [
                        ...SAMPLE_API_MODELS,
                        {
                            id: 'gemma-4-31b',
                            metadata: {
                                display_name: 'Gemma 4 31B',
                                pricing: {
                                    input_per_million: 0.1,
                                    output_per_million: 0.2,
                                    pricing_tbd: false,
                                },
                                capabilities: {
                                    tools: true,
                                    vision: true,
                                },
                                limits: {
                                    max_context_length: 256_000,
                                    max_output_tokens: 16_384,
                                },
                            },
                        },
                    ],
                },
            };
        });

        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'a cat', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            cost: { request_cost_usd: 0 },
        });

        await withTestActor(() =>
            provider.complete({
                model: '',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: {
                                    url: 'data:image/png;base64,abc',
                                },
                            },
                        ],
                    },
                ],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('gemma-4-31b');
    });
});

// ── Non-stream metering ─────────────────────────────────────────────

describe('NeuralwattProvider.complete non-stream output', () => {
    it('bills from cost.request_cost_usd and records energy units at zero cost', async () => {
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
            cost: { request_cost_usd: 0.0001 },
            energy: {
                energy_kwh: 0.00000145,
                energy_joules: 5.23,
                measurement_available: true,
            },
        });

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'neuralwatt:deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number | string> };

        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('neuralwatt:deepseek-v4-flash');
        expect(usage).toMatchObject({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
            energy_kwh: 0.00000145,
            energy_joules: 5.23,
            billedUsage: 1,
        });
        expect(overrides).toMatchObject({
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
            energy_kwh: 0,
            energy_joules: 0,
            billedUsage: 0.0001 * 100_000_000,
        });
        expect(result.usage.usd_cents).toBe(0.0001 * 100);
        expect(result.usage.accounting_method).toBe('energy');
    });

    it('falls back to catalog token pricing when request_cost_usd is absent', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'ok', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 10 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'neuralwatt:deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // usdPerMToken: $0.14/M → 14 cents per MTok unit in costs map
        const promptRate = 0.14 * 100;
        const completionRate = 0.28 * 100;
        const cachedRate = 0.014 * 100;
        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toMatchObject({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(overrides).toMatchObject({
            prompt_tokens: 100 * promptRate,
            completion_tokens: 50 * completionRate,
            cached_tokens: 10 * cachedRate,
        });
    });
});

// ── Streaming ───────────────────────────────────────────────────────

describe('NeuralwattProvider.complete streaming', () => {
    it('streams text deltas and meters final-chunk cost + energy', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                {
                    choices: [
                        {
                            delta: { content: 'Hello' },
                            finish_reason: null,
                        },
                    ],
                },
                {
                    choices: [
                        {
                            delta: { content: '!' },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 2,
                    },
                    cost: { request_cost_usd: 0.00005 },
                    energy: {
                        energy_kwh: 0.000002,
                        energy_joules: 7.2,
                        measurement_available: true,
                    },
                },
            ]),
        );

        const result = (await withTestActor(() =>
            provider.complete({
                model: 'neuralwatt:deepseek-v4-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        )) as {
            stream: true;
            init_chat_stream: (p: {
                chatStream: AIChatStream;
            }) => Promise<void>;
        };

        const { chatStream, events } = makeCapturingChatStream();
        await result.init_chat_stream({ chatStream });

        const textEvents = events().filter((e) => e.type === 'text');
        expect(textEvents.map((e) => e.text).join('')).toBe('Hello!');

        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, , , overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toMatchObject({
            prompt_tokens: 10,
            completion_tokens: 2,
            energy_kwh: 0.000002,
            energy_joules: 7.2,
            billedUsage: 1,
        });
        expect(overrides).toMatchObject({
            billedUsage: 0.00005 * 100_000_000,
            energy_kwh: 0,
        });
    });
});
