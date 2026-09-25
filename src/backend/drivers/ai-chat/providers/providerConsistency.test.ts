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
 * Cross-provider output-consistency contract.
 *
 * Every chat provider is driven through its real `complete()` against a
 * mocked upstream, and the result — after the same `normalizeResultToOpenAI`
 * pass the driver applies — must be shaped identically regardless of which
 * vendor served it:
 *
 *   - `message.role === 'assistant'`, `message.content` string (or null for
 *     tool-only turns), OpenAI-shaped `message.tool_calls`
 *   - `finish_reason` from the OpenAI vocabulary (`stop`, `length`,
 *     `tool_calls`, `content_filter`)
 *   - reasoning exposed as a `reasoning` string, never `reasoning_content`
 *   - no camelCase wire leftovers (`toolCalls`, `finishReason`)
 *   - `usage` is an object of numbers (key names are metering-specific and
 *     intentionally NOT part of this contract)
 *
 * A provider that forwards its vendor's dialect unconverted fails here.
 */

import { describe, expect, it, vi } from 'vitest';

import type { MeteringService } from '../../../services/metering/MeteringService.js';
import { withTestActor } from '../../integrationTestUtil.js';
import type {
    IChatMessageResult,
    IChatModel,
    IChatProvider,
} from '../types.js';
import {
    needsOpenAICoercion,
    normalizeResultToOpenAI,
} from '../utils/normalizeToOpenAI.js';

import { AlibabaProvider } from './alibaba/AlibabaProvider.js';
import { AzureChatProvider } from './azure/AzureChatProvider.js';
import { AzureResponsesProvider } from './azure/AzureResponsesProvider.js';
import { BytePlusProvider } from './byteplus/BytePlusProvider.js';
import { ClaudeProvider } from './claude/ClaudeProvider.js';
import { DeepSeekProvider } from './deepseek/DeepSeekProvider.js';
import { FakeChatProvider } from './FakeChatProvider.js';
import { GeminiChatProvider } from './gemini/GeminiChatProvider.js';
import { GroqAIProvider } from './groq/GroqAIProvider.js';
import { HoonifyProvider } from './hoonify/HoonifyProvider.js';
import { InfronProvider } from './infron/InfronProvider.js';
import { MetaProvider } from './meta/MetaProvider.js';
import { MiniMaxProvider } from './minimax/MiniMaxProvider.js';
import { MistralAIProvider } from './mistral/MistralAiProvider.js';
import { MoonshotProvider } from './moonshot/MoonshotProvider.js';
import { NeuralwattProvider } from './neuralwatt/NeuralwattProvider.js';
import { OllamaChatProvider } from './ollama/OllamaProvider.js';
import { OpenAiChatProvider } from './openai/OpenAiChatCompletionsProvider.js';
import { OpenAiResponsesChatProvider } from './openai/OpenAiChatResponsesProvider.js';
import { OpenRouterProvider } from './openrouter/OpenRouterProvider.js';
import { TogetherAIProvider } from './together/TogetherAIProvider.js';
import { XAIProvider } from './xai/XAIProvider.js';
import { ZAIProvider } from './zai/ZAIProvider.js';

// ── Upstream SDK mocks ──────────────────────────────────────────────
// One create-mock per wire dialect; every provider speaking that dialect
// shares it, which is the point: same upstream bytes in, same Puter shape out.

const {
    chatCreateMock,
    responsesCreateMock,
    mistralCompleteMock,
    anthropicCreateMock,
} = vi.hoisted(() => ({
    chatCreateMock: vi.fn(),
    responsesCreateMock: vi.fn(),
    mistralCompleteMock: vi.fn(),
    anthropicCreateMock: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.chat = { completions: { create: chatCreateMock } };
        this.responses = { create: responsesCreateMock };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

vi.mock('groq-sdk', () => ({
    default: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.chat = { completions: { create: chatCreateMock } };
    }),
}));

vi.mock('together-ai', () => ({
    Together: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.chat = { completions: { create: chatCreateMock } };
    }),
}));

vi.mock('@mistralai/mistralai', () => ({
    Mistral: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.chat = { complete: mistralCompleteMock, stream: vi.fn() };
    }),
}));

vi.mock('@anthropic-ai/sdk', () => {
    const AnthropicCtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.messages = { create: anthropicCreateMock, stream: vi.fn() };
        this.beta = {
            messages: { create: anthropicCreateMock, stream: vi.fn() },
            files: { delete: vi.fn() },
        };
    });
    return { default: AnthropicCtor, Anthropic: AnthropicCtor };
});

// ── Harness ─────────────────────────────────────────────────────────

const TEXT = 'Hello from the model.';
const REASONING = 'Chain of thought summary.';
const TOOL_ARGS = '{"city":"Paris"}';

const metering = () =>
    ({ utilRecordUsageObject: vi.fn() }) as unknown as MeteringService;
const stores = { fsEntry: {}, s3Object: {} } as never;
const fsService = {} as never;

// Superset of every cost key any provider's usage calculator multiplies by,
// so the canonical catalog works for all of them.
const canonicalModel = (id: string): IChatModel => ({
    id,
    aliases: [],
    costs_currency: 'usd-cents',
    costs: {
        prompt: 1,
        completion: 1,
        input: 1,
        output: 1,
        prompt_tokens: 1,
        completion_tokens: 1,
        cached_tokens: 1,
        input_cache_read: 1,
        request: 1,
        'input-tokens': 1,
        'output-tokens': 1,
        input_tokens: 1,
        output_tokens: 1,
    },
    max_tokens: 1024,
});

type Dialect = 'chat' | 'responses' | 'mistral' | 'anthropic' | 'fake';

interface ProviderCase {
    name: string;
    dialect: Dialect;
    make: () => IChatProvider;
}

const PROVIDERS: ProviderCase[] = [
    {
        name: 'alibaba',
        dialect: 'chat',
        make: () =>
            new AlibabaProvider({ apiKey: 'k' } as never, metering()),
    },
    {
        name: 'azure-chat',
        dialect: 'chat',
        make: () =>
            new AzureChatProvider(metering(), stores, fsService, {
                apiKey: 'k',
                apiURL: 'https://azure.test',
            }),
    },
    {
        name: 'azure-responses',
        dialect: 'responses',
        make: () =>
            new AzureResponsesProvider(metering(), stores, fsService, {
                apiKey: 'k',
                apiURL: 'https://azure.test',
            }),
    },
    {
        name: 'byteplus',
        dialect: 'chat',
        make: () =>
            new BytePlusProvider({ apiKey: 'k' } as never, metering()),
    },
    {
        name: 'claude',
        dialect: 'anthropic',
        make: () =>
            new ClaudeProvider(metering(), stores, fsService, {
                apiKey: 'k',
            }),
    },
    {
        name: 'deepseek',
        dialect: 'chat',
        make: () => new DeepSeekProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'fake',
        dialect: 'fake',
        make: () => new FakeChatProvider(),
    },
    {
        name: 'gemini',
        dialect: 'chat',
        make: () => new GeminiChatProvider(metering(), { apiKey: 'k' }),
    },
    {
        name: 'groq',
        dialect: 'chat',
        make: () => new GroqAIProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'hoonify',
        dialect: 'chat',
        make: () =>
            new HoonifyProvider({ apiKey: 'k' } as never, metering()),
    },
    {
        name: 'infron',
        dialect: 'chat',
        make: () =>
            new InfronProvider(
                { apiKey: 'k', apiBaseUrl: 'https://infron.test' },
                metering(),
            ),
    },
    {
        name: 'meta',
        dialect: 'chat',
        make: () =>
            new MetaProvider(metering(), stores, fsService, {
                apiKey: 'k',
            } as never),
    },
    {
        name: 'minimax',
        dialect: 'chat',
        make: () =>
            new MiniMaxProvider({ apiKey: 'k' } as never, metering()),
    },
    {
        name: 'mistral',
        dialect: 'mistral',
        make: () => new MistralAIProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'moonshot',
        dialect: 'chat',
        make: () => new MoonshotProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'neuralwatt',
        dialect: 'chat',
        make: () =>
            new NeuralwattProvider(
                { apiKey: 'k', apiBaseUrl: 'https://neuralwatt.test' },
                metering(),
            ),
    },
    {
        name: 'ollama',
        dialect: 'chat',
        make: () =>
            new OllamaChatProvider(
                { apiBaseUrl: 'http://ollama.test' },
                metering(),
            ),
    },
    {
        name: 'openai-chat',
        dialect: 'chat',
        make: () =>
            new OpenAiChatProvider(metering(), stores, fsService, {
                apiKey: 'k',
            }),
    },
    {
        name: 'openai-responses',
        dialect: 'responses',
        make: () =>
            new OpenAiResponsesChatProvider(metering(), stores, fsService, {
                apiKey: 'k',
            }),
    },
    {
        name: 'openrouter',
        dialect: 'chat',
        make: () =>
            new OpenRouterProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'together',
        dialect: 'chat',
        make: () => new TogetherAIProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'xai',
        dialect: 'chat',
        make: () => new XAIProvider({ apiKey: 'k' }, metering()),
    },
    {
        name: 'zai',
        dialect: 'chat',
        make: () => new ZAIProvider({ apiKey: 'k' } as never, metering()),
    },
];

// ── Per-dialect upstream fixtures ───────────────────────────────────

const chatUsage = { prompt_tokens: 3, completion_tokens: 5 };

const fixtures: Record<
    Exclude<Dialect, 'fake'>,
    { text: () => unknown; tool: () => unknown; reasoning?: () => unknown }
> = {
    chat: {
        text: () => ({
            choices: [
                {
                    message: { role: 'assistant', content: TEXT, refusal: null },
                    finish_reason: 'stop',
                },
            ],
            usage: chatUsage,
        }),
        tool: () => ({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: null,
                        refusal: null,
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'get_weather',
                                    arguments: TOOL_ARGS,
                                },
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
            usage: chatUsage,
        }),
        // DeepSeek wire convention, spoken by several OpenAI-compatible
        // vendors: reasoning arrives as `reasoning_content`.
        reasoning: () => ({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: TEXT,
                        refusal: null,
                        reasoning_content: REASONING,
                    },
                    finish_reason: 'stop',
                },
            ],
            usage: chatUsage,
        }),
    },
    responses: {
        text: () => ({
            output_text: TEXT,
            output: [
                {
                    type: 'message',
                    id: 'msg_1',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: TEXT }],
                },
            ],
            usage: {
                input_tokens: 3,
                output_tokens: 5,
                input_tokens_details: { cached_tokens: 0 },
            },
        }),
        tool: () => ({
            output_text: '',
            output: [
                {
                    type: 'function_call',
                    id: 'fc_1',
                    call_id: 'call_1',
                    name: 'get_weather',
                    arguments: TOOL_ARGS,
                },
            ],
            usage: {
                input_tokens: 3,
                output_tokens: 5,
                input_tokens_details: { cached_tokens: 0 },
            },
        }),
        reasoning: () => ({
            output_text: TEXT,
            output: [
                {
                    type: 'reasoning',
                    id: 'rs_1',
                    summary: [{ type: 'summary_text', text: REASONING }],
                },
                {
                    type: 'message',
                    id: 'msg_1',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: TEXT }],
                },
            ],
            usage: {
                input_tokens: 3,
                output_tokens: 5,
                input_tokens_details: { cached_tokens: 0 },
            },
        }),
    },
    mistral: {
        text: () => ({
            choices: [
                {
                    message: { role: 'assistant', content: TEXT },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 3, completionTokens: 5 },
        }),
        tool: () => ({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: '',
                        toolCalls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'get_weather',
                                    // Mistral's SDK can hand arguments back
                                    // as a parsed object.
                                    arguments: { city: 'Paris' },
                                },
                            },
                        ],
                    },
                    finishReason: 'tool_calls',
                },
            ],
            usage: { promptTokens: 3, completionTokens: 5 },
        }),
        // Mistral's reasoning models (magistral) return `content` as a chunk
        // array, with the thinking text nested one level deeper inside
        // `thinking` chunks. Without the provider's flattening this reaches
        // the caller as an array with no `reasoning` at all.
        reasoning: () => ({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'thinking',
                                thinking: [{ type: 'text', text: REASONING }],
                            },
                            { type: 'text', text: TEXT },
                        ],
                    },
                    finishReason: 'stop',
                },
            ],
            usage: { promptTokens: 3, completionTokens: 5 },
        }),
    },
    anthropic: {
        text: () => ({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: TEXT }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 3, output_tokens: 5 },
        }),
        tool: () => ({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [
                {
                    type: 'tool_use',
                    id: 'call_1',
                    name: 'get_weather',
                    input: { city: 'Paris' },
                },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 3, output_tokens: 5 },
        }),
        reasoning: () => ({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [
                { type: 'thinking', thinking: REASONING, signature: 'sig' },
                { type: 'text', text: TEXT },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 3, output_tokens: 5 },
        }),
    },
};

const armUpstream = (dialect: Dialect, kind: 'text' | 'tool' | 'reasoning') => {
    if (dialect === 'fake') return;
    const fixture = fixtures[dialect][kind];
    if (!fixture) throw new Error(`${dialect} has no ${kind} fixture`);
    const value = fixture();
    if (dialect === 'responses') responsesCreateMock.mockResolvedValueOnce(value);
    else if (dialect === 'mistral') mistralCompleteMock.mockResolvedValueOnce(value);
    else if (dialect === 'anthropic') anthropicCreateMock.mockResolvedValueOnce(value);
    else chatCreateMock.mockResolvedValueOnce(value);
};

const run = async (pc: ProviderCase, kind: 'text' | 'tool' | 'reasoning') => {
    const provider = pc.make();
    const model = provider.getDefaultModel();
    if (pc.dialect !== 'fake') {
        vi.spyOn(provider, 'models').mockImplementation(
            () => [canonicalModel(model)] as never,
        );
    }
    armUpstream(pc.dialect, kind);
    // `normalize: true` is the contract under test: what a caller who asked
    // for the OpenAI shape receives. Providers whose dialect remap is gated on
    // the policy (Mistral) need it set, and for every other provider it is a
    // no-op — so stating it makes the matrix's premise explicit instead of
    // relying on providers equalizing unconditionally.
    const res = (await withTestActor(() =>
        provider.complete({
            messages: [{ role: 'user', content: 'hi' }],
            model,
            stream: false,
            normalize: true,
        } as never),
    )) as IChatMessageResult;
    // The same pass ChatCompletionDriver applies with `normalize: true`.
    return normalizeResultToOpenAI(res);
};

// The equalized contract every provider must satisfy, whatever its vendor
// dialect was.
const expectEqualized = (res: IChatMessageResult) => {
    expect(res.message).toBeTruthy();
    const message = res.message as Record<string, unknown>;

    expect(needsOpenAICoercion(message)).toBe(false);
    expect(message.role).toBe('assistant');
    expect(
        typeof message.content === 'string' || message.content === null,
    ).toBe(true);

    // No vendor-dialect leftovers on the result or the message.
    for (const leftover of ['toolCalls', 'finishReason', 'reasoning_content']) {
        expect(leftover in message, `message.${leftover} leaked`).toBe(false);
        expect(
            leftover in (res as unknown as Record<string, unknown>),
            `result.${leftover} leaked`,
        ).toBe(false);
    }

    expect(['stop', 'length', 'tool_calls', 'content_filter']).toContain(
        res.finish_reason,
    );

    if (message.reasoning !== undefined) {
        expect(typeof message.reasoning).toBe('string');
    }

    expect(res.usage).toBeTypeOf('object');
    for (const [key, value] of Object.entries(
        res.usage as Record<string, unknown>,
    )) {
        expect(typeof value, `usage.${key} must be a number`).toBe('number');
    }
};

// ── The matrix ──────────────────────────────────────────────────────

describe.each(PROVIDERS)('provider consistency: $name', (pc) => {
    it('equalizes a plain text completion', async () => {
        const res = await run(pc, 'text');
        expectEqualized(res);
        if (pc.dialect !== 'fake') {
            expect(res.message.content).toBe(TEXT);
            expect(res.finish_reason).toBe('stop');
        } else {
            expect(typeof res.message.content).toBe('string');
            expect((res.message.content as string).length).toBeGreaterThan(0);
        }
    });

    if (pc.dialect !== 'fake') {
        it('equalizes a tool-call completion', async () => {
            const res = await run(pc, 'tool');
            expectEqualized(res);
            expect(res.finish_reason).toBe('tool_calls');
            // Tool-only turns carry no text; OpenAI uses null, some
            // vendors an empty string — both read as "no content".
            expect(
                res.message.content === null || res.message.content === '',
            ).toBe(true);
            const toolCalls = res.message.tool_calls as unknown[];
            expect(toolCalls).toHaveLength(1);
            // `canonical_id` (Responses round-trip handle) is the one
            // permitted extra attribute.
            expect(toolCalls[0]).toMatchObject({
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: TOOL_ARGS },
            });
        });
    }

    if (pc.dialect !== 'fake' && fixtures[pc.dialect].reasoning) {
        it('exposes reasoning as a plain `reasoning` string', async () => {
            const res = await run(pc, 'reasoning');
            expectEqualized(res);
            expect(res.message.content).toBe(TEXT);
            expect(res.message.reasoning).toBe(REASONING);
        });
    }
});
