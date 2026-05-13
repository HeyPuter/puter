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
 * Offline unit tests for GeminiChatProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs GeminiChatProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. Gemini speaks the OpenAI-compatible API so the OpenAI SDK is
 * mocked at the module boundary; that's the real network egress
 * point. The companion integration test
 * (GeminiChatProvider.integration.test.ts) exercises the real Gemini
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
import { withTestActor } from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { GEMINI_MODELS } from './models.js';
import { GeminiChatProvider } from './GeminiChatProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────
//
// GeminiChatProvider imports the openai default export and
// instantiates `openai.OpenAI` (not the named export), so the mock
// has to expose the constructor on the default export shape.

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
    const provider = new GeminiChatProvider(server.services.metering, {
        apiKey: 'test-key',
    });
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
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('GeminiChatProvider construction', () => {
    it('points the OpenAI SDK at the Gemini OpenAI-compat base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('GeminiChatProvider model catalog', () => {
    it('returns gemini-2.5-flash as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('gemini-2.5-flash');
    });

    it('exposes the static GEMINI_MODELS list verbatim from models()', async () => {
        const { provider } = makeProvider();
        // models() is async on this provider.
        expect(await provider.models()).toBe(GEMINI_MODELS);
    });

    it('list() flattens canonical ids and aliases', async () => {
        const { provider } = makeProvider();
        const ids = await provider.list();
        for (const m of GEMINI_MODELS) {
            expect(ids).toContain(m.id);
            for (const a of m.aliases ?? []) {
                expect(ids).toContain(a);
            }
        }
        expect(ids).toContain('gemini-2.5-flash');
        expect(ids).toContain('google/gemini-2.5-flash');
    });
});

// ── Request shape ──────────────────────────────────────────────────

describe('GeminiChatProvider.complete request shape', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'hi', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('forwards model + messages and renames max_tokens to max_completion_tokens', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
                temperature: 0.4,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('gemini-2.5-flash');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_completion_tokens).toBe(256);
        expect(args.temperature).toBe(0.4);
    });

    it('omits max_completion_tokens and temperature when caller did not supply them', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('max_completion_tokens' in args).toBe(false);
        expect('temperature' in args).toBe(false);
    });

    it('strips cache_control from messages before sending (Gemini does not understand it)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'gemini-2.5-flash',
                messages: [
                    {
                        role: 'user',
                        content: 'hi',
                        cache_control: { type: 'ephemeral' },
                    } as never,
                ],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('cache_control' in args.messages[0]).toBe(false);
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('GeminiChatProvider model resolution', () => {
    const baseCompletion = {
        choices: [
            {
                message: { content: 'ok', role: 'assistant' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    it('resolves an alias to its canonical id', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                // `google/gemini-2.5-flash` is an alias of `gemini-2.5-flash`.
                model: 'google/gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('gemini-2.5-flash');
        expect(recordSpy).toHaveBeenCalledWith(
            expect.any(Object),
            expect.anything(),
            'gemini:gemini-2.5-flash',
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

        expect(createMock.mock.calls[0]![0].model).toBe('gemini-2.5-flash');
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('GeminiChatProvider.complete non-stream output', () => {
    it('returns the first choice and runs the metered usage calculator with cached-token splitting', async () => {
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
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        // Gemini's calculator subtracts cached_tokens from prompt_tokens
        // (hosted Gemini bills these line items separately).
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        // gemini-2.5-flash costs: prompt=30, completion=250, cached=3.
        const flash = GEMINI_MODELS.find((m) => m.id === 'gemini-2.5-flash')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('gemini:gemini-2.5-flash');
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(overrides).toEqual({
            prompt_tokens: 90 * Number(flash.costs.prompt_tokens),
            completion_tokens: 50 * Number(flash.costs.completion_tokens),
            cached_tokens: 10 * Number(flash.costs.cached_tokens ?? 0),
        });
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
            usage: { prompt_tokens: 7, completion_tokens: 3 },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage] = recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        // No cached_tokens to subtract → prompt stays at 7.
        expect(usage.prompt_tokens).toBe(7);
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('GeminiChatProvider.complete streaming', () => {
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
                model: 'gemini-2.5-flash',
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
            prompt_tokens: 3, // 4 - 1 cached
            completion_tokens: 2,
            cached_tokens: 1,
        });

        const flash = GEMINI_MODELS.find((m) => m.id === 'gemini-2.5-flash')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('gemini:gemini-2.5-flash');
        expect(overrides).toEqual({
            prompt_tokens: 3 * Number(flash.costs.prompt_tokens),
            completion_tokens: 2 * Number(flash.costs.completion_tokens),
            cached_tokens: 1 * Number(flash.costs.cached_tokens ?? 0),
        });
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('GeminiChatProvider.complete error mapping', () => {
    it('logs and rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('Gemini exploded');
        createMock.mockRejectedValueOnce(apiError);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gemini-2.5-flash',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(errSpy).toHaveBeenCalled();
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('GeminiChatProvider.checkModeration', () => {
    it('throws — Gemini provider does not implement moderation', () => {
        const { provider } = makeProvider();
        expect(() => provider.checkModeration('anything')).toThrow(
            /no moderation/i,
        );
    });
});
