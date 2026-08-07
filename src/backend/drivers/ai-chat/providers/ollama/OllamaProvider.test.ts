/**
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
 * Offline unit tests for OllamaChatProvider.
 *
 * Ollama is a locally-hosted server; the provider talks to it over two channels
 * — axios for `/api/tags` (model discovery) and the OpenAI SDK for the
 * OpenAI-compatible `/v1` chat endpoint. Both are stubbed at the module
 * boundary. Everything else, including the shared in-process model cache, is
 * the real thing.
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
import { OllamaChatProvider } from './OllamaProvider.js';

// -- External boundaries ---------------------------------------------

const { createMock, openAICtor, axiosRequestMock } = vi.hoisted(() => ({
    createMock: vi.fn(),
    openAICtor: vi.fn(),
    axiosRequestMock: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
        this.moderations = { create: vi.fn() };
        this.responses = { create: vi.fn() };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

vi.mock('axios', () => ({
    default: { request: axiosRequestMock },
    request: axiosRequestMock,
}));

const MODELS_CACHE_KEY = 'ollamaChat:models';

// -- Test harness ----------------------------------------------------

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (config?: { apiBaseUrl?: string }) =>
    new OllamaChatProvider(config, server.services.metering);

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
    return {
        chatStream: new AIChatStream({ stream: sink }),
        events: () =>
            chunks
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
    };
};

const okCompletion = {
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
    axiosRequestMock.mockReset();
    // The catalog cache is a process-wide singleton — clear it so each test
    // controls whether discovery hits the Ollama server.
    kv.del(MODELS_CACHE_KEY);
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    kv.del(MODELS_CACHE_KEY);
    vi.restoreAllMocks();
});

// -- Construction ----------------------------------------------------

describe('OllamaChatProvider construction', () => {
    it('defaults to the local Ollama server and the placeholder API key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'ollama',
            baseURL: 'http://localhost:11434/v1',
        });
    });

    it('honours a configured base URL', () => {
        makeProvider({ apiBaseUrl: 'http://ollama.internal:9999' });
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'ollama',
            baseURL: 'http://ollama.internal:9999/v1',
        });
    });

    it('exposes gpt-oss:20b as the default model', () => {
        expect(makeProvider().getDefaultModel()).toBe('gpt-oss:20b');
    });

    it('does not implement moderation', () => {
        expect(() => makeProvider().checkModeration('x')).toThrow(
            'Method not implemented.',
        );
    });
});

// -- Model discovery -------------------------------------------------

describe('OllamaChatProvider model discovery', () => {
    it('coerces /api/tags entries into the driver model shape and caches them', async () => {
        axiosRequestMock.mockResolvedValueOnce({
            data: { models: [{ name: 'llama3.2', size: 4096 }] },
        });
        const provider = makeProvider({
            apiBaseUrl: 'http://ollama.internal:11434',
        });

        const models = await provider.models();

        expect(axiosRequestMock).toHaveBeenCalledWith({
            method: 'GET',
            url: 'http://ollama.internal:11434/api/tags',
        });
        expect(models).toEqual([
            {
                id: 'ollama:ollama/llama3.2',
                name: 'llama3.2 (Ollama)',
                max_tokens: 4096,
                costs_currency: 'usd-cents',
                costs: { tokens: 1_000_000, input_token: 0, output_token: 0 },
            },
        ]);

        // Second call is served from the cache — no second HTTP round trip.
        await provider.models();
        expect(axiosRequestMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the `model` field and a default context size', async () => {
        axiosRequestMock.mockResolvedValueOnce({
            data: { models: [{ model: 'mistral' }, {}] },
        });

        const models = await makeProvider().models();

        expect(models.map((m) => m.id)).toEqual([
            'ollama:ollama/mistral',
            'ollama:ollama/unknown',
        ]);
        expect(models[0]!.max_tokens).toBe(8192);
    });

    it('returns an empty catalog when the Ollama server is unreachable', async () => {
        axiosRequestMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        expect(await makeProvider().models()).toEqual([]);
        // A failed probe must not be cached as a valid catalog.
        expect(kv.get(MODELS_CACHE_KEY)).toBeFalsy();
    });

    it('returns an empty catalog — and caches nothing — when Ollama has no models', async () => {
        axiosRequestMock.mockResolvedValueOnce({ data: {} });
        expect(await makeProvider().models()).toEqual([]);
        expect(kv.get(MODELS_CACHE_KEY)).toBeFalsy();
    });

    it('list() returns just the namespaced model ids', async () => {
        axiosRequestMock.mockResolvedValueOnce({
            data: { models: [{ name: 'llama3.2' }, { name: 'qwen3' }] },
        });
        expect(await makeProvider().list()).toEqual([
            'ollama:ollama/llama3.2',
            'ollama:ollama/qwen3',
        ]);
    });
});

// -- Completion ------------------------------------------------------

describe('OllamaChatProvider.complete', () => {
    it('strips the `ollama:` namespace before calling the local server', async () => {
        axiosRequestMock.mockResolvedValue({
            data: { models: [{ name: 'llama3.2' }] },
        });
        createMock.mockResolvedValueOnce(okCompletion);
        const provider = makeProvider();

        await withTestActor(() =>
            provider.complete({
                model: 'ollama:ollama/llama3.2',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 64,
                temperature: 0.5,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('ollama/llama3.2');
        expect(args.messages).toEqual([{ role: 'user', content: 'hi' }]);
        expect(args.max_tokens).toBe(64);
        expect(args.temperature).toBe(0.5);
        expect(args.stream).toBe(false);
        expect('stream_options' in args).toBe(false);
    });

    it('meters against the discovered catalog id at zero cost', async () => {
        axiosRequestMock.mockResolvedValue({
            data: { models: [{ name: 'llama3.2' }] },
        });
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hey', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 40,
                completion_tokens: 12,
                prompt_tokens_details: { cached_tokens: 5 },
            },
        });

        await withTestActor(() =>
            makeProvider().complete({
                model: 'ollama:ollama/llama3.2',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, , modelId, overrides] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt: 35,
            completion: 12,
            input_cache_read: 5,
        });
        expect(modelId).toBe('ollama:ollama/llama3.2');
        // Local inference is free — every cost line is explicitly zeroed.
        expect(overrides).toEqual({
            prompt: 0,
            completion: 0,
            input_cache_read: 0,
        });
    });

    it('namespaces an undiscovered bare model name for metering', async () => {
        axiosRequestMock.mockResolvedValue({ data: { models: [] } });
        createMock.mockResolvedValueOnce(okCompletion);

        await withTestActor(() =>
            makeProvider().complete({
                model: 'phi4',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy.mock.calls[0]![2]).toBe('ollama:ollama/phi4');
    });

    it('keeps an already-namespaced `ollama/` model id intact for metering', async () => {
        axiosRequestMock.mockResolvedValue({ data: { models: [] } });
        createMock.mockResolvedValueOnce(okCompletion);

        await withTestActor(() =>
            makeProvider().complete({
                model: 'ollama/phi4',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy.mock.calls[0]![2]).toBe('ollama:ollama/phi4');
    });

    it('forwards tools and requests usage frames when streaming', async () => {
        axiosRequestMock.mockResolvedValue({ data: { models: [] } });
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'ha' } }] },
                { choices: [{ delta: { content: 'i' } }] },
                {
                    choices: [{ delta: {} }],
                    usage: { prompt_tokens: 3, completion_tokens: 2 },
                },
            ]),
        );
        const tools = [
            { type: 'function', function: { name: 'noop', parameters: {} } },
        ];

        const result = await withTestActor(() =>
            makeProvider().complete({
                model: 'ollama:llama3.2',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
                tools: tools as never,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.tools).toEqual(tools);
        expect(args.stream_options).toEqual({ include_usage: true });

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        expect(
            events.filter((e) => e.type === 'text').map((e) => e.text),
        ).toEqual(['ha', 'i']);
        expect(events.find((e) => e.type === 'usage')?.usage).toEqual({
            prompt: 3,
            completion: 2,
            input_cache_read: 0,
        });
    });

    it('rethrows a failure from the local Ollama server without metering it', async () => {
        axiosRequestMock.mockResolvedValue({ data: { models: [] } });
        const boom = new Error('ollama refused the connection');
        createMock.mockRejectedValueOnce(boom);

        await expect(
            withTestActor(() =>
                makeProvider().complete({
                    model: 'ollama:llama3.2',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toBe(boom);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});
