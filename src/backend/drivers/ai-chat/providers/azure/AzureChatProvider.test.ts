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
 * Offline unit tests for AzureChatProvider (Chat Completions over Azure AI
 * Foundry).
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs the provider against the live wired `MeteringService`, `stores`,
 * and `FSService`. The OpenAI SDK is mocked at the module boundary — that's the
 * real network egress point. The companion integration test
 * (AzureChatProvider.integration.test.ts) exercises the real Azure endpoint.
 *
 * Azure-specific behaviour under test: the client is pointed at a configurable
 * `baseURL`, the catalog is AZURE_MODELS (which fronts xAI's Grok as well as
 * OpenAI), `safety_identifier` is stripped for Grok deployments, and Grok's
 * `prompt_tokens` are metered as-reported rather than net of cached tokens.
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
import { AzureChatProvider } from './AzureChatProvider.js';
import { AZURE_MODELS } from './models.js';

// -- OpenAI SDK mock -------------------------------------------------

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
        this.moderations = { create: vi.fn() };
        this.responses = { create: vi.fn() };
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
    new AzureChatProvider(
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
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Construction ----------------------------------------------------

describe('AzureChatProvider construction', () => {
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

describe('AzureChatProvider model catalog', () => {
    it('returns gpt-5.4-nano as the default model', () => {
        expect(makeProvider().getDefaultModel()).toBe('gpt-5.4-nano');
    });

    it('models() drops responses_api_only entries but keeps Chat Completions ones', () => {
        const ids = makeProvider()
            .models()
            .map((m) => m.id);
        for (const responsesOnly of AZURE_MODELS.filter(
            (m) => m.responses_api_only,
        )) {
            expect(ids).not.toContain(responsesOnly.id);
        }
        expect(ids).toContain('gpt-5.4-nano');
        // Azure also fronts xAI Grok deployments.
        expect(ids).toContain('grok-4-20-non-reasoning');
    });

    it('list() flattens canonical ids and aliases', () => {
        const ids = makeProvider().list();
        expect(ids).toContain('gpt-4o');
        expect(ids).toContain('openai/gpt-4o');
        expect(ids).toContain('x-ai/grok-4-20-non-reasoning');
        // Codex is Responses-only and must not be advertised here.
        expect(ids).not.toContain('gpt-5-codex');
    });
});

// -- Argument validation and delegation ------------------------------

describe('AzureChatProvider.complete argument validation', () => {
    it('throws 400 when messages is not an array', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-4o',
                    messages: 'hello' as unknown as never,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });

    it('throws 400 when web_search is requested without a Responses sibling', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-4o',
                    messages: [{ role: 'user', content: 'search' }],
                    tools: [{ type: 'web_search' }] as never,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });

    it('delegates the whole call to the Responses provider for web_search', async () => {
        const provider = makeProvider();
        const sibling = {
            complete: vi.fn().mockResolvedValue({ delegated: 'web_search' }),
        };
        provider.setResponsesProvider(sibling as never);

        const params = {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'search' }],
            tools: [{ type: 'web_search' }] as never,
        };
        const result = await withTestActor(() => provider.complete(params));

        expect(createMock).not.toHaveBeenCalled();
        expect(sibling.complete).toHaveBeenCalledWith(params);
        expect(result).toEqual({ delegated: 'web_search' });
    });

    it('throws 400 when compaction is requested without a Responses sibling', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-4o',
                    messages: [{ role: 'user', content: 'hi' }],
                    compaction: true,
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createMock).not.toHaveBeenCalled();
    });

    it('delegates when the messages carry a round-tripped compaction block', async () => {
        const provider = makeProvider();
        const sibling = {
            complete: vi.fn().mockResolvedValue({ delegated: 'compaction' }),
        };
        provider.setResponsesProvider(sibling as never);

        const params = {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'assistant',
                    content: [{ type: 'compaction', text: 'summary' }],
                },
            ],
        } as never;
        const result = await withTestActor(() => provider.complete(params));

        expect(createMock).not.toHaveBeenCalled();
        expect(sibling.complete).toHaveBeenCalledWith(params);
        expect(result).toEqual({ delegated: 'compaction' });
    });

    it('checkModeration is not implemented on the Azure deployment', () => {
        expect(() => makeProvider().checkModeration('anything')).toThrow(
            'Method not implemented.',
        );
    });
});

// -- Request shape ---------------------------------------------------

describe('AzureChatProvider.complete request shape', () => {
    it('resolves an alias to its canonical id and renames max_tokens', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(okCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'openai/gpt-4o',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 128,
                temperature: 0.25,
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect(args.model).toBe('gpt-4o');
        expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(args.max_completion_tokens).toBe(128);
        expect(args.temperature).toBe(0.25);
        expect(args.stream).toBe(false);
    });

    it('falls back to the default model when the requested id is unknown', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(okCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'not-a-real-azure-model',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls[0]![0].model).toBe('gpt-5.4-nano');
    });

    it('sends safety_identifier for OpenAI deployments', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(okCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('safety_identifier' in args).toBe(true);
        expect(args.safety_identifier).toBe(args.user);
    });

    it('strips safety_identifier for Grok deployments, which 400 on unknown args', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(okCompletion);

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4-20-non-reasoning',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [args] = createMock.mock.calls[0]!;
        expect('safety_identifier' in args).toBe(false);
        expect(args.model).toBe('grok-4-20-non-reasoning');
    });

    it('drops reasoning_effort/verbosity for gpt-5 models and forwards them otherwise', async () => {
        const provider = makeProvider();

        createMock.mockResolvedValueOnce(okCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-5.4-nano',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning_effort: 'high',
                verbosity: 'high',
            } as never),
        );
        const [gpt5Args] = createMock.mock.calls[0]!;
        expect('reasoning_effort' in gpt5Args).toBe(false);
        expect('verbosity' in gpt5Args).toBe(false);

        createMock.mockResolvedValueOnce(okCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'grok-4-20-non-reasoning',
                messages: [{ role: 'user', content: 'hi' }],
                reasoning: { effort: 'medium' },
                text: { verbosity: 'low' },
            } as never),
        );
        const [grokArgs] = createMock.mock.calls[1]!;
        expect(grokArgs.reasoning_effort).toBe('medium');
        expect(grokArgs.verbosity).toBe('low');
    });

    it('only sets stream_options.include_usage when streaming', async () => {
        const provider = makeProvider();

        createMock.mockResolvedValueOnce(okCompletion);
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
            }),
        );
        expect('stream_options' in createMock.mock.calls[0]![0]).toBe(false);

        createMock.mockReturnValueOnce(asAsyncIterable([]));
        await withTestActor(() =>
            provider.complete({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true,
            }),
        );
        expect(createMock.mock.calls[1]![0].stream_options).toEqual({
            include_usage: true,
        });
    });

    it('forwards tools through untouched when they are not web_search', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(okCompletion);
        const tools = [
            {
                type: 'function',
                function: { name: 'lookup', parameters: { type: 'object' } },
            },
        ];

        await withTestActor(() =>
            provider.complete({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }],
                tools: tools as never,
            }),
        );

        expect(createMock.mock.calls[0]![0].tools).toEqual(tools);
    });
});

// -- Usage accounting ------------------------------------------------

describe('AzureChatProvider usage accounting', () => {
    it('meters an OpenAI deployment with cached tokens split out of prompt_tokens', async () => {
        const provider = makeProvider();
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
                model: 'gpt-4o',
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

        const gpt4o = AZURE_MODELS.find((m) => m.id === 'gpt-4o')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('azure-openai:gpt-4o');
        expect(usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 50,
            cached_tokens: 10,
        });
        expect(overrides).toEqual({
            prompt_tokens: 90 * Number(gpt4o.costs.prompt_tokens),
            completion_tokens: 50 * Number(gpt4o.costs.completion_tokens),
            cached_tokens: 10 * Number(gpt4o.costs.cached_tokens ?? 0),
        });
    });

    it('takes Grok prompt_tokens as reported — cached tokens are additive there, not a subset', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'yo', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 20,
                completion_tokens: 5,
                prompt_tokens_details: { cached_tokens: 30 },
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'grok-4-20-non-reasoning',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage, , prefix] = recordSpy.mock.calls[0]!;
        // Subtracting here would underflow to -10 and bill a negative cost.
        expect(usage).toEqual({
            prompt_tokens: 20,
            completion_tokens: 5,
            cached_tokens: 30,
        });
        expect(prefix).toBe('azure-openai:grok-4-20-non-reasoning');
    });

    it('treats a missing prompt_tokens_details as zero cached tokens', async () => {
        const provider = makeProvider();
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
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        const [usage] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 7,
            completion_tokens: 3,
            cached_tokens: 0,
        });
    });
});

// -- Streaming -------------------------------------------------------

describe('AzureChatProvider.complete streaming', () => {
    it('streams text deltas and meters the final usage frame once', async () => {
        const provider = makeProvider();
        createMock.mockReturnValueOnce(
            asAsyncIterable([
                { choices: [{ delta: { content: 'he' } }] },
                { choices: [{ delta: { content: 'llo' } }] },
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
                model: 'gpt-4o',
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
        ).toEqual(['he', 'llo']);
        expect(events.find((e) => e.type === 'usage')?.usage).toEqual({
            prompt_tokens: 3,
            completion_tokens: 2,
            cached_tokens: 1,
        });

        const gpt4o = AZURE_MODELS.find((m) => m.id === 'gpt-4o')!;
        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [, , prefix, overrides] = recordSpy.mock.calls[0]!;
        expect(prefix).toBe('azure-openai:gpt-4o');
        expect(overrides).toEqual({
            prompt_tokens: 3 * Number(gpt4o.costs.prompt_tokens),
            completion_tokens: 2 * Number(gpt4o.costs.completion_tokens),
            cached_tokens: 1 * Number(gpt4o.costs.cached_tokens ?? 0),
        });
    });
});

// -- Error mapping ---------------------------------------------------

describe('AzureChatProvider.complete error mapping', () => {
    it('rethrows upstream Azure errors unchanged and records no usage', async () => {
        const provider = makeProvider();
        const apiError = Object.assign(new Error('Azure said no'), {
            status: 429,
        });
        createMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.complete({
                    model: 'gpt-4o',
                    messages: [{ role: 'user', content: 'boom' }],
                }),
            ),
        ).rejects.toBe(apiError);

        expect(recordSpy).not.toHaveBeenCalled();
    });
});
