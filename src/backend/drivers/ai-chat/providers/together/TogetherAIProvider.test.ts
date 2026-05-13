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
 * Offline unit tests for TogetherAIProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs TogetherAIProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. The Together SDK is mocked at the module boundary (the real
 * network egress point) so the provider never reaches the network.
 * Models are sourced through the SDK (`together.models.list()`) and
 * cached in the shared `kv` singleton — each test seeds/clears the
 * cache up front. The companion integration test
 * (TogetherAIProvider.integration.test.ts) exercises the real Together
 * endpoint.
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
import { kv } from '../../../../util/kvSingleton.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { TogetherAIProvider } from './TogetherAIProvider.js';

// ── Together SDK mock ───────────────────────────────────────────────

const { createMock, modelsListMock, togetherCtor } = vi.hoisted(() => {
    const createMock = vi.fn();
    const modelsListMock = vi.fn();
    const togetherCtor = vi.fn();
    return { createMock, modelsListMock, togetherCtor };
});

vi.mock('together-ai', () => {
    const TogetherCtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        togetherCtor(opts);
        this.chat = { completions: { create: createMock } };
        this.models = { list: modelsListMock };
    });
    return { Together: TogetherCtor, default: TogetherCtor };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

const KV_KEY = 'togetherai:models';
// Together's `models.list()` returns API-shaped rows; the provider
// coerces them to IChatModel and prepends a synthetic
// `model-fallback-test-1` row at the end. Costs (per million):
// Llama-3.1-8B: input=18, output=18; Qwen-7B: input=20, output=20.
const SAMPLE_API_MODELS = [
    {
        id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        type: 'chat',
        display_name: 'Llama 3.1 8B Instruct Turbo',
        context_length: 32768,
        pricing: { input: 18, output: 18 },
    },
    {
        id: 'Qwen/Qwen2.5-7B-Instruct-Turbo',
        type: 'chat',
        display_name: 'Qwen 2.5 7B Instruct Turbo',
        context_length: 32768,
        pricing: { input: 20, output: 20 },
    },
    {
        id: 'some/embedding-model',
        // Filtered out — only chat/code/language/moderation pass through.
        type: 'embedding',
        display_name: 'Some Embedding',
        context_length: 8192,
        pricing: { input: 1, output: 1 },
    },
];

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () => {
    const provider = new TogetherAIProvider(
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
    modelsListMock.mockReset();
    togetherCtor.mockReset();
    // Clear the cached model list from prior tests so each test
    // re-resolves through the mocked SDK (or the seeded value below).
    kv.del(KV_KEY);
    modelsListMock.mockResolvedValue(SAMPLE_API_MODELS);
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
    kv.del(KV_KEY);
});

// ── Construction ────────────────────────────────────────────────────

describe('TogetherAIProvider construction', () => {
    it('constructs the Together SDK with the configured API key', () => {
        makeProvider();
        expect(togetherCtor).toHaveBeenCalledTimes(1);
        expect(togetherCtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Model catalog ──────────────────────────────────────────────────

describe('TogetherAIProvider model catalog', () => {
    it('returns the togetherai-prefixed default model id', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            'togetherai:meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        );
    });

    it('list() flattens canonical ids and aliases for chat models only', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        // Embedding-typed models are filtered out.
        expect(ids).not.toContain('togetherai:some/embedding-model');
        // Canonical id is prefixed with togetherai:
        expect(ids).toContain(
            'togetherai:meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        );
        // Aliases include the bare id and the slash-separated tail.
        expect(ids).toContain('meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo');
        expect(ids).toContain(
            'togetherai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        );
        expect(ids).toContain('Meta-Llama-3.1-8B-Instruct-Turbo');
        // The synthetic fallback-test model is appended.
        expect(ids).toContain('model-fallback-test-1');
    });

    it('caches the coerced model list in kv after the first call', async () => {
        const { provider } = makeProvider();
        await provider.models();
        await provider.models();
        // Second call should be a cache hit, not a second SDK round-trip.
        expect(modelsListMock).toHaveBeenCalledTimes(1);
    });
});

// ── Request shape ──────────────────────────────────────────────────

describe('TogetherAIProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('strips the togetherai: prefix from the wire model id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // togetherai: prefix is dropped before the SDK call.
        expect(args.model).toBe('Qwen/Qwen2.5-7B-Instruct-Turbo');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('omits max_tokens when caller did not supply one (Together rejects garbage values)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect('max_tokens' in createMock.mock.calls[0]![0]).toBe(false);
    });

    it('passes tools through unchanged when supplied; omits the key when not', async () => {
        const { provider } = makeProvider();

        // No tools.
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );
        expect('tools' in createMock.mock.calls[0]![0]).toBe(false);

        // With tools.
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    parameters: { type: 'object', properties: {} },
                },
            },
        ];
        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
                tools,
            }),
        );
        expect(createMock.mock.calls[1]![0].tools).toBe(tools);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect(createMock.mock.calls[0]![0].stream).toBe(false);
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream).toBe(true);
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });

    it('throws synthetic model-fallback-test-1 BEFORE hitting the SDK', async () => {
        const { provider } = makeProvider();

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'model-fallback-test-1',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toThrow(/Model Fallback Test 1/);

        expect(createMock).not.toHaveBeenCalled();
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('TogetherAIProvider model resolution', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'ok', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('resolves a bare alias to its togetherai-prefixed canonical id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // alias: bare id without the togetherai: prefix.
                model: 'Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // Wire model is the bare id (prefix stripped).
        expect(createMock.mock.calls[0]![0].model).toBe(
            'Qwen/Qwen2.5-7B-Instruct-Turbo',
        );
        // Metering namespace uses the same bare id.
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
            expect.any(Object),
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

        expect(createMock.mock.calls[0]![0].model).toBe(
            'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        );
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('TogetherAIProvider.complete non-stream output', () => {
    it('returns the first choice and runs the metered usage calculator with input/output cost mapping', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hi there', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
        });

        // Together remaps prompt_tokens/completion_tokens cost lookup keys to
        // `input`/`output` per the model row's pricing schema.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo');
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 0,
        });
        // Qwen pricing: input=20, output=20 (per million).
        expect(overrides).toMatchObject({
            prompt_tokens: 100 * 20,
            completion_tokens: 50 * 20,
        });
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('TogetherAIProvider.complete streaming', () => {
    it('streams text deltas through to text events and meters final usage', async () => {
        const { provider } = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                {
                    choices: [{ delta: {} }],
                    usage: { prompt_tokens: 4, completion_tokens: 2 },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
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

        // Qwen pricing: input=20, output=20.
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo');
        expect(overrides).toMatchObject({
            prompt_tokens: 4 * 20,
            completion_tokens: 2 * 20,
        });
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('TogetherAIProvider.complete error mapping', () => {
    it('rethrows errors raised by the Together client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('Together exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'togetherai:Qwen/Qwen2.5-7B-Instruct-Turbo',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('TogetherAIProvider.checkModeration', () => {
    it('throws — Together provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /not implemented/i,
        );
    });
});
