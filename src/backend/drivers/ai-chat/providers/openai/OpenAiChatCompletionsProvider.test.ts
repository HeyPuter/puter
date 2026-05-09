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
 * Offline unit tests for OpenAiChatProvider (Chat Completions API).
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs OpenAiChatProvider directly against the live
 * wired `MeteringService`, `stores`, and `FSService`. The OpenAI SDK
 * is mocked at the module boundary; that's the real network egress
 * point. The companion integration test
 * (OpenAiChatCompletionsProvider.integration.test.ts) exercises the
 * real OpenAI endpoint.
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
import { OPEN_AI_MODELS } from './models.js';
import { OpenAiChatProvider } from './OpenAiChatCompletionsProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { createMock, moderationsCreateMock, openAICtor } = vi.hoisted(() => ({
    createMock: vi.fn(),
    moderationsCreateMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
        this.moderations = { create: moderationsCreateMock };
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
    const provider = new OpenAiChatProvider(
        server.services.metering,
        {
            fsEntry: server.stores.fsEntry,
            s3Object: server.stores.s3Object,
        },
        server.services.fs,
        { apiKey: 'test-key' },
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
    moderationsCreateMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('OpenAiChatProvider construction', () => {
    it('constructs the OpenAI SDK with the configured API key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('OpenAiChatProvider model catalog', () => {
    it('returns gpt-5-nano as the default', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('gpt-5-nano');
    });

    it('models() filters out responses_api_only entries', () => {
        const { provider } = makeProvider();
        const ids = provider.models().map((m) => m.id);
        const responsesOnly = OPEN_AI_MODELS.filter(
            (m) => m.responses_api_only,
        ).map((m) => m.id);
        for (const id of responsesOnly) {
            expect(ids).not.toContain(id);
        }
        // gpt-5-nano is a Chat-Completions model, must be present.
        expect(ids).toContain('gpt-5-nano-2025-08-07');
    });

    it('list() flattens canonical ids and aliases', () => {
        const { provider } = makeProvider();
        const ids = provider.list();
        expect(ids).toContain('gpt-5-nano-2025-08-07');
        expect(ids).toContain('gpt-5-nano');
        expect(ids).toContain('openai/gpt-5-nano');
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('OpenAiChatProvider.complete argument validation', () => {
    it('throws 400 when messages is not an array', async () => {
        const { provider } = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-5-nano',
                    messages: 'hello' as unknown as never,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(createMock).not.toHaveBeenCalled();
    });

    it('throws 400 when web_search is requested without a Responses sibling provider', async () => {
        const { provider } = makeProvider();

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-5-nano',
                    messages: [{ role: 'user', content: 'search' }],
                    tools: [{ type: 'web_search' }] as never,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(createMock).not.toHaveBeenCalled();
    });

    it('delegates to the Responses provider when web_search is requested and one is wired', async () => {
        const { provider } = makeProvider();
        const sibling = {
            complete: vi.fn().mockResolvedValue({ delegated: true }),
        };
        provider.setResponsesProvider(
            sibling as unknown as Parameters<
                typeof provider.setResponsesProvider
            >[0],
        );

        const params = {
            model: 'gpt-5-nano',
            messages: [{ role: 'user', content: 'search' }],
            tools: [{ type: 'web_search' }] as never,
        };
        const result = await withTestActor(() => provider.complete(params));

        // The Completions provider should have handed off entirely — no
        // chat.completions.create call, and the sibling sees the same args.
        expect(createMock).not.toHaveBeenCalled();
        expect(sibling.complete).toHaveBeenCalledWith(params);
        expect(result).toEqual({ delegated: true });
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('OpenAiChatProvider.complete request shape', () => {
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
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
                temperature: 0.4,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        // alias gpt-5-nano resolves to its canonical id.
        expect(args.model).toBe('gpt-5-nano-2025-08-07');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_completion_tokens).toBe(256);
        expect(args.temperature).toBe(0.4);
    });

    it('drops reasoning_effort and verbosity for gpt-5-prefixed models (they manage these themselves)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'high',
                verbosity: 'high',
            } as never),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('reasoning_effort' in args).toBe(false);
        expect('verbosity' in args).toBe(false);
    });

    it('forwards reasoning_effort and verbosity for non-gpt-5 reasoning models (e.g. o3)', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce(baseCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'o3',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'medium',
                verbosity: 'low',
            } as never),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.reasoning_effort).toBe('medium');
        expect(args.verbosity).toBe('low');
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const { provider } = makeProvider();

        createMock.mockResolvedValueOnce(baseCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });
});

// ── Non-stream completion ───────────────────────────────────────────

describe('OpenAiChatProvider.complete non-stream output', () => {
    it('returns the first choice and meters usage with cached-token splitting', async () => {
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
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        // prompt_tokens is reduced by cached_tokens — they are billed as a
        // separate line item.
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        const nano = OPEN_AI_MODELS.find(
            (m) => m.id === 'gpt-5-nano-2025-08-07',
        )!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('openai:gpt-5-nano-2025-08-07');
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(overrides).toEqual({
            prompt_tokens: 90 * Number(nano.costs.prompt_tokens),
            completion_tokens: 50 * Number(nano.costs.completion_tokens),
            cached_tokens: 10 * Number(nano.costs.cached_tokens ?? 0),
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
                model: 'gpt-5-nano',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage] = recordSpy.mock.calls[0]!;
        expect(usage.cached_tokens).toBe(0);
        expect(usage.prompt_tokens).toBe(7);
    });
});

// ── Streaming deltas ────────────────────────────────────────────────

describe('OpenAiChatProvider.complete streaming', () => {
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
                model: 'gpt-5-nano',
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
            prompt_tokens: 3,
            completion_tokens: 2,
            cached_tokens: 1,
        });

        const nano = OPEN_AI_MODELS.find(
            (m) => m.id === 'gpt-5-nano-2025-08-07',
        )!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('openai:gpt-5-nano-2025-08-07');
        expect(overrides).toEqual({
            prompt_tokens: 3 * Number(nano.costs.prompt_tokens),
            completion_tokens: 2 * Number(nano.costs.completion_tokens),
            cached_tokens: 1 * Number(nano.costs.cached_tokens ?? 0),
        });
    });
});

// ── Moderation ──────────────────────────────────────────────────────

describe('OpenAiChatProvider.checkModeration', () => {
    it('flags content when any category score exceeds 0.8', async () => {
        const { provider } = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({
            results: [
                {
                    category_scores: { violence: 0.9, hate: 0.1 },
                },
            ],
        });

        const result = await provider.checkModeration('something risky');

        expect(moderationsCreateMock).toHaveBeenCalledWith({
            model: 'omni-moderation-latest',
            input: 'something risky',
        });
        expect(result.flagged).toBe(true);
    });

    it('does NOT flag when all category scores are at/under 0.8', async () => {
        const { provider } = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({
            results: [
                {
                    // 0.8 is at the threshold — provider only flags >0.8.
                    category_scores: { violence: 0.8, hate: 0.5 },
                },
            ],
        });

        const result = await provider.checkModeration('borderline');
        expect(result.flagged).toBe(false);
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('OpenAiChatProvider.complete error mapping', () => {
    it('rethrows errors raised by the OpenAI client unchanged', async () => {
        const { provider } = makeProvider();
        const apiError = new Error('OpenAI exploded');
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-5-nano',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});
