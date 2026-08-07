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
 * Offline unit tests for AzureResponsesProvider (Responses API over Azure AI
 * Foundry). Boots a real PuterServer and mocks the OpenAI SDK at the module
 * boundary — the one external egress point. The companion integration test hits
 * the real Azure endpoint.
 *
 * This provider serves the `responses_api_only` slice of AZURE_MODELS (the
 * Codex family), which rejects the Chat Completions endpoint outright.
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
import { AzureResponsesProvider } from './AzureResponsesProvider.js';
import { AZURE_MODELS } from './models.js';

// -- OpenAI SDK mock -------------------------------------------------

const { responsesCreateMock, moderationsCreateMock, openAICtor } = vi.hoisted(
    () => ({
        responsesCreateMock: vi.fn(),
        moderationsCreateMock: vi.fn(),
        openAICtor: vi.fn(),
    }),
);

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.responses = { create: responsesCreateMock };
        this.moderations = { create: moderationsCreateMock };
        this.chat = { completions: { create: vi.fn() } };
    });
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

const makeProvider = () =>
    new AzureResponsesProvider(
        server.services.metering,
        { fsEntry: server.stores.fsEntry, s3Object: server.stores.s3Object },
        server.services.fs,
        {
            apiKey: 'azure-key',
            apiURL: 'https://example-foundry.test/openai/v1',
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

const okResponse = {
    output: [{ role: 'assistant' }],
    output_text: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
};

beforeEach(() => {
    responsesCreateMock.mockReset();
    moderationsCreateMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Construction ----------------------------------------------------

describe('AzureResponsesProvider construction', () => {
    it('points the OpenAI client at the configured Azure endpoint and key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'azure-key',
            baseURL: 'https://example-foundry.test/openai/v1',
        });
    });
});

// -- Model catalog ---------------------------------------------------

describe('AzureResponsesProvider model catalog', () => {
    it('returns gpt-5-codex as the default model', () => {
        expect(makeProvider().getDefaultModel()).toBe('gpt-5-codex');
    });

    it('models() exposes only the responses_api_only slice of the Azure catalog', () => {
        const ids = makeProvider()
            .models()
            .map((m) => m.id);
        expect(ids).toContain('gpt-5-codex');
        // Chat-Completions models belong to the sibling provider.
        expect(ids).not.toContain('gpt-4o');
    });

    it('models({ no_restrictions: true }) returns the whole catalog for model resolution', () => {
        const ids = makeProvider()
            .models({ no_restrictions: true })
            .map((m) => m.id);
        expect(ids).toContain('gpt-5-codex');
        expect(ids).toContain('gpt-4o');
        expect(ids).toHaveLength(AZURE_MODELS.length);
    });

    it('list() flattens responses-only ids and their aliases', () => {
        const ids = makeProvider().list();
        expect(ids).toContain('gpt-5-codex');
        expect(ids).toContain('openai/gpt-5-codex');
        expect(ids).not.toContain('gpt-4o');
    });
});

// -- Argument validation ---------------------------------------------

describe('AzureResponsesProvider.complete argument validation', () => {
    it('throws 400 when messages is not an array', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-5-codex',
                    messages: 'hello' as unknown as never,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(responsesCreateMock).not.toHaveBeenCalled();
    });
});

// -- Request shape ---------------------------------------------------

describe('AzureResponsesProvider.complete request shape', () => {
    it('sends messages as `input`, renames max_tokens, and always sets safety_identifier', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 256,
                temperature: 0.3,
            }),
        );

        const [args] = responsesCreateMock.mock.calls[0]!;
        expect(args.model).toBe('gpt-5-codex');
        expect(args.input).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_output_tokens).toBe(256);
        expect(args.temperature).toBe(0.3);
        expect(args.safety_identifier).toBe(args.user);
    });

    it('resolves an alias against the unrestricted catalog', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'openai/gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(responsesCreateMock.mock.calls[0]![0].model).toBe('gpt-5-codex');
    });

    it('falls back to the default model for an unknown id', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'nonexistent-deployment',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(responsesCreateMock.mock.calls[0]![0].model).toBe('gpt-5-codex');
    });

    it('flattens chat-style function tools into the Responses shape', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
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
                    { type: 'web_search' },
                ] as never,
            }),
        );

        expect(responsesCreateMock.mock.calls[0]![0].tools).toEqual([
            {
                type: 'function',
                name: 'lookup',
                parameters: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                },
            },
            // Non-function tools pass through untouched.
            { type: 'web_search' },
        ]);
    });

    it('omits every optional Responses knob that was not supplied', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = responsesCreateMock.mock.calls[0]!;
        for (const key of [
            'tools',
            'tool_choice',
            'parallel_tool_calls',
            'include',
            'context_management',
            'conversation',
            'previous_response_id',
            'instructions',
            'metadata',
            'prompt',
            'prompt_cache_key',
            'prompt_cache_retention',
            'store',
            'max_output_tokens',
            'temperature',
            'top_p',
            'truncation',
            'background',
            'service_tier',
            'stream',
            'text',
        ]) {
            expect(key in args).toBe(false);
        }
    });

    it('passes Responses-only knobs straight through', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
                tool_choice: 'auto',
                parallel_tool_calls: false,
                include: ['file_search_call.results'],
                conversation: 'conv_1',
                previous_response_id: 'resp_1',
                instructions: 'be terse',
                metadata: { trace: 'abc' },
                prompt_cache_key: 'key-1',
                prompt_cache_retention: '24h',
                store: true,
                top_p: 0.9,
                truncation: 'auto',
                background: false,
                service_tier: 'default',
            } as never),
        );

        const [args] = responsesCreateMock.mock.calls[0]!;
        expect(args.tool_choice).toBe('auto');
        expect(args.parallel_tool_calls).toBe(false);
        expect(args.include).toEqual(['file_search_call.results']);
        expect(args.conversation).toBe('conv_1');
        expect(args.previous_response_id).toBe('resp_1');
        expect(args.instructions).toBe('be terse');
        expect(args.metadata).toEqual({ trace: 'abc' });
        expect(args.prompt_cache_key).toBe('key-1');
        expect(args.prompt_cache_retention).toBe('24h');
        expect(args.store).toBe(true);
        expect(args.top_p).toBe(0.9);
        expect(args.truncation).toBe('auto');
        expect(args.background).toBe(false);
        expect(args.service_tier).toBe('default');
    });

    it('translates the neutral compaction opt-in into OpenAI context_management', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
                compaction: { trigger_tokens: 120_000 },
            } as never),
        );

        expect(
            responsesCreateMock.mock.calls[0]![0].context_management,
        ).toEqual([{ type: 'compaction', compact_threshold: 120_000 }]);
    });

    it('lets a raw context_management payload win over the neutral opt-in', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce(okResponse);
        const raw = [{ type: 'compaction', compact_threshold: 1 }];

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
                compaction: true,
                context_management: raw,
            } as never),
        );

        expect(responsesCreateMock.mock.calls[0]![0].context_management).toBe(
            raw,
        );
    });

    it('forwards the reasoning object for gpt-5 models and the flat knobs otherwise', async () => {
        const provider = makeProvider();

        responsesCreateMock.mockResolvedValueOnce(okResponse);
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning: { effort: 'high' },
                verbosity: 'high',
            } as never),
        );
        const [gpt5Args] = responsesCreateMock.mock.calls[0]!;
        expect(gpt5Args.reasoning).toEqual({ effort: 'high' });
        expect('reasoning_effort' in gpt5Args).toBe(false);
        expect('verbosity' in gpt5Args).toBe(false);

        responsesCreateMock.mockResolvedValueOnce(okResponse);
        await withTestActor(() =>
            provider.complete({
                model: 'grok-4-20-non-reasoning',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'low',
                verbosity: 'low',
            } as never),
        );
        const [grokArgs] = responsesCreateMock.mock.calls[1]!;
        expect(grokArgs.reasoning_effort).toBe('low');
        expect(grokArgs.verbosity).toBe('low');
        expect('reasoning' in grokArgs).toBe(false);
    });
});

// -- Usage accounting ------------------------------------------------

describe('AzureResponsesProvider usage accounting', () => {
    it('meters input/output tokens with the cached slice split out', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce({
            output: [{ role: 'assistant' }],
            output_text: 'hi there',
            usage: {
                input_tokens: 100,
                output_tokens: 50,
                input_tokens_details: { cached_tokens: 10 },
            },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hi there', role: 'assistant' },
            finish_reason: 'stop',
        });
        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });

        const codex = AZURE_MODELS.find((m) => m.id === 'gpt-5-codex')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('azure-openai:gpt-5-codex');
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(overrides).toEqual({
            prompt_tokens: 90 * Number(codex.costs.prompt_tokens),
            completion_tokens: 50 * Number(codex.costs.completion_tokens),
            cached_tokens: 10 * Number(codex.costs.cached_tokens ?? 0),
        });
    });

    it('defaults every usage counter to zero when the response omits them', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockResolvedValueOnce({
            output: [{ role: 'assistant' }],
            output_text: 'ok',
            usage: {},
        });

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(recordSpy.mock.calls[0]![0]).toEqual({
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
        });
    });
});

// -- Streaming -------------------------------------------------------

describe('AzureResponsesProvider.complete streaming', () => {
    it('streams output_text deltas and meters usage from response.completed', async () => {
        const provider = makeProvider();
        responsesCreateMock.mockReturnValueOnce(
            asAsyncIterable([
                { type: 'response.output_text.delta', delta: 'he' },
                { type: 'response.output_text.delta', delta: 'llo' },
                {
                    type: 'response.completed',
                    response: {
                        usage: {
                            input_tokens: 4,
                            output_tokens: 2,
                            input_tokens_details: { cached_tokens: 1 },
                        },
                    },
                },
            ]),
        );

        const result = await withTestActor(() =>
            provider.complete({
                model: 'gpt-5-codex',
                messages: [{ role: 'user', content: 'say hi' }],
                stream: true,
            }),
        );
        expect((result as { stream: boolean }).stream).toBe(true);
        expect(responsesCreateMock.mock.calls[0]![0].stream).toBe(true);

        const harness = makeCapturingChatStream();
        await (
            result as {
                init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
            }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        expect(
            events.filter((e) => e.type === 'text').map((e) => e.text),
        ).toEqual(['he', 'llo']);
        expect(events.find((e) => e.type === 'usage')?.usage).toEqual({
            prompt_tokens: 3,
            completion_tokens: 2,
            cached_tokens: 1,
        });
        expect(recordSpy.mock.calls[0]![2]).toBe('azure-openai:gpt-5-codex');
    });
});

// -- Moderation ------------------------------------------------------

describe('AzureResponsesProvider.checkModeration', () => {
    it('flags content when any category score exceeds 0.8', async () => {
        const provider = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({
            results: [{ category_scores: { violence: 0.9, hate: 0.1 } }],
        });

        const result = await provider.checkModeration('something risky');

        expect(moderationsCreateMock).toHaveBeenCalledWith({
            model: 'omni-moderation-latest',
            input: 'something risky',
        });
        expect(result.flagged).toBe(true);
    });

    it('does not flag when every score sits at or below the 0.8 threshold', async () => {
        const provider = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({
            results: [{ category_scores: { violence: 0.8, hate: 0.5 } }],
        });

        expect((await provider.checkModeration('borderline')).flagged).toBe(
            false,
        );
    });

    it('reports not-flagged when the moderation endpoint returns no results', async () => {
        const provider = makeProvider();
        moderationsCreateMock.mockResolvedValueOnce({});

        expect((await provider.checkModeration('empty')).flagged).toBe(false);
    });
});

// -- Error mapping ---------------------------------------------------

describe('AzureResponsesProvider.complete error mapping', () => {
    it('rethrows upstream errors unchanged and records no usage', async () => {
        const provider = makeProvider();
        const apiError = Object.assign(new Error('Azure exploded'), {
            status: 500,
        });
        responsesCreateMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-5-codex',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});
