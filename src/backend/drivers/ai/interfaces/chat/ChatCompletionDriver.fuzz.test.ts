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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Seeded fuzzing of `ChatCompletionDriver.complete` through every registered
 * provider. The vendors are played at the HTTP boundary, so the real SDKs and
 * the providers' own request and response code run.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { isHttpError } from '../../../../core/http/HttpError.js';
import type { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { kv } from '../../../../util/kvSingleton.js';
import { isDriverStreamResult } from '../../../meta.js';
import {
    caseRandom,
    corruptReply,
    Findings,
    fuzzCases,
    hostileValue,
    mutate,
    pick,
    pickStable,
    type Random,
    unclassifiedFailure,
    upstream,
    type UpstreamReply,
    type UpstreamRequest,
} from '../../shared/fuzzTestUtil.js';
import {
    readStreamResult,
    withTestActor,
} from '../../shared/integrationTestUtil.js';
import {
    anthropicToolStream,
    chatCompletionsToolStream,
    chatToolCallDeltas,
    responsesToolStream,
} from '../../shared/toolCallStreamTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import type { ICompleteArguments } from './types.js';
import { clearUnhealthyRoutes } from './utils/providerHealth.js';

vi.mock('undici', async (importOriginal) => ({
    ...(await importOriginal<typeof import('undici')>()),
    fetch: (input: unknown, init?: RequestInit) => upstream.fetch(input, init),
}));

// groq-sdk brings its own HTTP client. Groq's API is OpenAI-compatible, so the
// OpenAI SDK stands in for it and the requests reach the stub like the rest.
vi.mock('groq-sdk', async () => ({ default: (await import('openai')).OpenAI }));

vi.mock('axios', () => {
    const request = (config: Parameters<typeof upstream.axios>[0]) =>
        upstream.axios(config);
    const get = (url: string, config?: object) =>
        upstream.axios({ ...config, url, method: 'GET' });
    return { default: { request, get }, request, get };
});

// -- The vendors, played at the HTTP boundary --

const TEXT = 'pong';
const chatUsage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 };
const chatChunk = (delta: object, finish: string | null) => ({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
});
const responsesMessage = {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: TEXT, annotations: [] }],
};
const responsesBody = {
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    model: 'm',
    output: [responsesMessage],
    usage: {
        input_tokens: 3,
        output_tokens: 5,
        total_tokens: 8,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
    },
};
const anthropicUsage = { input_tokens: 3, output_tokens: 5 };
const geminiBody = {
    candidates: [
        {
            index: 0,
            content: { role: 'model', parts: [{ text: TEXT }] },
            finishReason: 'STOP',
        },
    ],
    usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 5,
        totalTokenCount: 8,
    },
};

const anthropicEvents = [
    {
        type: 'message_start',
        message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'm',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 3, output_tokens: 1 },
        },
    },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: TEXT },
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
];

const responsesEvents = [
    {
        type: 'response.created',
        response: { ...responsesBody, status: 'in_progress', output: [] },
    },
    {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...responsesMessage, status: 'in_progress', content: [] },
    },
    {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: TEXT,
    },
    {
        type: 'response.output_item.done',
        output_index: 0,
        item: responsesMessage,
    },
    { type: 'response.completed', response: responsesBody },
];

// Counts the tool-call replies served, so a run that stops reaching them fails.
let toolRepliesServed = 0;

/** A well-formed answer from whichever vendor API the request went to. */
const healthyUpstream = ({
    url,
    json,
}: UpstreamRequest): UpstreamReply | undefined => {
    const path = url.pathname;
    if (path.endsWith('/api/tags'))
        return { body: { models: [{ name: 'gpt-oss:20b', size: 8192 }] } };
    if (path.endsWith('/quota'))
        return { body: { accounting_method: 'token' } };
    if (path.endsWith('/endpoints'))
        return { body: { data: { endpoints: [] } } };
    if (path.endsWith('/models')) {
        if (url.hostname.includes('together'))
            return {
                body: [
                    {
                        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
                        type: 'chat',
                        display_name: 'Llama',
                        context_length: 8192,
                        pricing: { input: 1, output: 2 },
                    },
                ],
            };
        return {
            body: {
                data: [
                    {
                        id: 'fuzz/model',
                        name: 'Fuzz',
                        category_type: 'LLM',
                        supported_endpoint_types: ['openai'],
                        min_prompt_price: 1,
                        min_completion_price: 2,
                        context_length: 8192,
                        pricing: { prompt: '0.000001', completion: '0.000002' },
                        metadata: {
                            pricing: {
                                currency: 'USD',
                                input_per_million: 1,
                                output_per_million: 2,
                            },
                        },
                    },
                ],
            },
        };
    }
    // A caller-supplied media link that leads nowhere.
    if (url.hostname === 'upstream.test') return { status: 404, body: '' };
    if (url.hostname === 'media.upstream.test') {
        return { body: 'video-bytes', contentType: 'video/mp4' };
    }
    const streaming = (json as { stream?: unknown } | undefined)?.stream;
    const tools = (json as { tools?: unknown } | undefined)?.tools;
    if (streaming && Array.isArray(tools) && tools.length) {
        const sse = path.endsWith('/chat/completions')
            ? chatCompletionsToolStream(
                  chatToolCallDeltas({ interleave: true }),
              )
            : path.endsWith('/responses')
              ? responsesToolStream()
              : path.endsWith('/messages')
                ? anthropicToolStream()
                : undefined;
        if (sse) {
            toolRepliesServed++;
            return { sse };
        }
    }
    if (path.endsWith('/chat/completions')) {
        if (!streaming) {
            return {
                body: {
                    id: 'chatcmpl-1',
                    object: 'chat.completion',
                    created: 1,
                    model: 'm',
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: TEXT },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: chatUsage,
                },
            };
        }
        return {
            sse: [
                { data: chatChunk({ role: 'assistant', content: TEXT }, null) },
                { data: chatChunk({}, 'stop') },
                {
                    data: {
                        ...chatChunk({}, null),
                        choices: [],
                        usage: chatUsage,
                    },
                },
                { data: '[DONE]' },
            ],
        };
    }
    if (path.endsWith('/responses')) {
        return streaming
            ? {
                  sse: responsesEvents.map((data) => ({
                      event: data.type,
                      data,
                  })),
              }
            : { body: responsesBody };
    }
    if (path.endsWith('/messages/count_tokens')) {
        return { body: { input_tokens: 3 } };
    }
    if (path.endsWith('/messages')) {
        return streaming
            ? {
                  sse: anthropicEvents.map((data) => ({
                      event: data.type,
                      data,
                  })),
              }
            : {
                  body: {
                      id: 'msg_1',
                      type: 'message',
                      role: 'assistant',
                      model: 'm',
                      content: [{ type: 'text', text: TEXT }],
                      stop_reason: 'end_turn',
                      stop_sequence: null,
                      usage: anthropicUsage,
                  },
              };
    }
    if (path.endsWith(':generateContent')) return { body: geminiBody };
    if (path.endsWith(':streamGenerateContent')) {
        return { sse: [{ data: geminiBody }] };
    }
    if (path.endsWith(':countTokens')) return { body: { totalTokens: 3 } };
    if (path.endsWith('/moderations')) {
        return {
            body: {
                id: 'modr_1',
                model: 'm',
                results: [
                    { flagged: false, categories: {}, category_scores: {} },
                ],
            },
        };
    }
    return undefined;
};

// -- Requests to mutate --

const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const weatherTool = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Get the weather for a city',
        parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
        },
    },
};

const CORPUS: Record<string, unknown>[] = [
    { messages: [{ role: 'user', content: 'hi' }] },
    {
        messages: [
            { role: 'system', content: 'Be brief.' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is this?' },
                    { type: 'image_url', image_url: { url: PNG } },
                ],
            },
        ],
        max_tokens: 64,
        temperature: 0.5,
        top_p: 0.9,
        stream: true,
    },
    {
        messages: [
            { role: 'user', content: 'Weather in Paris?' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            arguments: '{"city":"Paris"}',
                        },
                    },
                ],
            },
            { role: 'tool', tool_call_id: 'call_1', content: 'Sunny' },
        ],
        tools: [weatherTool],
        tool_choice: 'auto',
        parallel_tool_calls: false,
    },
    {
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Weather in Paris?',
                        cache_control: { type: 'ephemeral' },
                    },
                ],
            },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Checking.' },
                    {
                        type: 'tool_use',
                        id: 'toolu_1',
                        name: 'get_weather',
                        input: { city: 'Paris' },
                    },
                ],
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'toolu_1',
                        content: 'Sunny',
                    },
                ],
            },
        ],
        tools: [weatherTool, { type: 'web_search' }],
        tool_choice: { type: 'function', function: { name: 'get_weather' } },
        stream: true,
        streamToolInput: true,
    },
    {
        messages: [{ role: 'user', content: 'Reply in JSON.' }],
        outputFormat: {
            type: 'json_schema',
            schema: { type: 'object', properties: { a: { type: 'string' } } },
        },
        reasoning: { effort: 'low' },
        reasoning_effort: 'low',
        thinking: { type: 'enabled', budget_tokens: 1024 },
        text: { verbosity: 'low' },
        verbosity: 'low',
        stopSequences: ['END'],
        topK: 5,
        normalize: true,
    },
    {
        messages: [{ role: 'user', content: 'hi' }],
        instructions: 'Be brief.',
        compaction: { trigger_tokens: 150000 },
        context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
        cacheControl: { type: 'ephemeral', ttl: '1h' },
        prompt_cache_key: 'k',
        prompt_cache_retention: '24h',
        serviceSpeed: 'fast',
        service_tier: 'flex',
        speed: 'fast',
        metadata: { trace: 't' },
        include: ['reasoning.encrypted_content'],
        store: false,
        truncation: 'auto',
        taskBudget: { total: 1000, remaining: 500 },
        safeguards: [{ type: 'prompt_injection' }],
        anthropicBetas: ['context-management-2025-06-27'],
        moderation: true,
        response: { normalize: true },
        fallback: false,
    },
];

CORPUS.push(
    {
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe these.' },
                    { type: 'image_url', image_url: PNG },
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: PNG.split(',')[1],
                        },
                    },
                    {
                        type: 'video_url',
                        video_url: { url: 'data:video/mp4;base64,AAAA' },
                    },
                    {
                        type: 'file',
                        file: {
                            filename: 'a.pdf',
                            file_data: 'data:application/pdf;base64,JVBERi0=',
                        },
                    },
                    {
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: 'JVBERi0=',
                        },
                    },
                ],
            },
        ],
    },
    {
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Read it.' },
                    { puter_path: '~/Documents/a.png' },
                ],
            },
        ],
    },
    // Audio and video, as their own parts and inside an image part.
    {
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'input_audio',
                        input_audio: { data: 'UklGRg==', format: 'wav' },
                    },
                    {
                        type: 'input_audio',
                        input_audio: {
                            data: 'data:audio/mpeg;base64,SUQz',
                            format: 'mpeg',
                        },
                    },
                    {
                        type: 'image_url',
                        image_url: { url: 'data:audio/wav;base64,UklGRg==' },
                    },
                    {
                        type: 'image_url',
                        image_url: { url: 'data:video/mp4;base64,AAAA' },
                    },
                    {
                        type: 'video_url',
                        video_url: {
                            url: 'https://media.upstream.test/a.mp4',
                        },
                    },
                ],
            },
            { role: 'assistant', content: 'Noted.' },
            { role: 'user', content: 'What was in them?' },
        ],
    },
    // Model output sent back, in each vendor's shape.
    {
        messages: [
            { role: 'user', content: 'Think, then search.' },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'Hm.', signature: 'sig' },
                    { type: 'redacted_thinking', data: 'x' },
                    {
                        type: 'reasoning',
                        id: 'rs_1',
                        summary: [{ type: 'summary_text', text: 'Hm.' }],
                        encrypted_content: 'enc',
                    },
                    { type: 'text', text: 'Searching.' },
                    {
                        type: 'server_tool_use',
                        id: 'srvtoolu_1',
                        name: 'web_search',
                        input: { query: 'x' },
                    },
                    {
                        type: 'web_search_tool_result',
                        tool_use_id: 'srvtoolu_1',
                        content: [],
                    },
                    {
                        type: 'compaction',
                        id: 'cmp_1',
                        encrypted_content: 'enc',
                    },
                ],
                reasoning: 'Hm.',
                refusal: null,
            },
            { type: 'compaction', id: 'cmp_2', encrypted_content: 'enc' },
            { role: 'user', content: 'Go on.' },
        ],
        tools: [
            { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
            {
                type: 'function',
                function: {
                    name: 'strict_tool',
                    strict: true,
                    parameters: {
                        type: 'object',
                        properties: {},
                        additionalProperties: false,
                    },
                },
            },
            {
                name: 'anthropic_style',
                description: 'x',
                input_schema: { type: 'object', properties: {} },
            },
        ],
        tool_choice: 'required',
        thinking: { type: 'adaptive' },
        prompt_cache_options: { ttl: '30m' },
        instructions: [{ role: 'system', content: 'Be brief.' }],
    },
);

const OPTION_NAMES = [
    ...new Set(CORPUS.flatMap((request) => Object.keys(request))),
    'previous_response_id',
    'conversation',
    'prompt',
    'prompt_cache_options',
    'background',
    'custom',
    'customLimitMessage',
    'test_mode',
];

// -- Harness --

const key = { apiKey: 'fuzz-key' };
const providers = {
    claude: key,
    'azure-openai': { ...key, apiURL: 'https://azure.upstream.test/openai' },
    'openai-completion': key,
    gemini: key,
    meta: key,
    groq: key,
    deepseek: key,
    mistral: key,
    xai: key,
    moonshot: key,
    minimax: key,
    zai: key,
    alibaba: key,
    byteplus: key,
    hoonify: key,
    infron: key,
    openrouter: key,
    neuralwatt: key,
    'together-ai': key,
    ollama: { apiBaseUrl: 'https://ollama.upstream.test' },
};

let server: PuterServer;
let driver: ChatCompletionDriver;
// Charges no vendor answer should be able to cause.
const charges: string[] = [];
const isCatalogRequest = (path: string) =>
    /\/(models|api\/tags|quota|endpoints)$/.test(path);
// Every provider gets the same share of cases, whatever its catalog size.
let routes: Map<string, { provider: string; id: string }[]>;

beforeAll(async () => {
    upstream.install();
    upstream.respond = healthyUpstream;
    server = await setupTestServer();
    const metering = server.services.metering as unknown as Record<string, any>;
    const realBatch = metering.batchIncrementUsages.bind(metering);
    metering.batchIncrementUsages = (who: unknown, usages: any[]) => {
        for (const usage of usages ?? []) {
            // The ledger skips a zero amount.
            if (usage?.usageAmount === 0) continue;
            for (const [name, value] of [
                ['amount', usage?.usageAmount],
                ['cost', usage?.costOverride],
            ] as const) {
                if (value === undefined || value === null) continue;
                const kind =
                    typeof value !== 'number'
                        ? 'non-number'
                        : !Number.isFinite(value)
                          ? 'non-finite'
                          : value < 0
                            ? 'negative'
                            : value > 1e15
                              ? 'huge'
                              : !Number.isInteger(value) && name === 'amount'
                                ? ''
                                : '';
                if (kind)
                    charges.push(
                        `${kind} ${name} ${usage?.usageType} ${String(value)}`,
                    );
            }
        }
        return realBatch(who, usages);
    };
    driver = new ChatCompletionDriver(
        { providers } as never,
        server.clients,
        server.stores,
        server.services,
    );
    await driver.onServerStart();
    routes = new Map();
    for (const model of await driver.models()) {
        if (!model.provider || model.provider === 'fake-chat') continue;
        const route = { provider: model.provider, id: model.id };
        routes.set(route.provider, [
            ...(routes.get(route.provider) ?? []),
            route,
        ]);
    }
}, 120_000);

afterAll(async () => {
    await server?.shutdown();
    upstream.uninstall();
});

const pickRoute = (random: Random) =>
    pickStable(
        random,
        routes.get(pickStable(random, [...routes.keys()], (name) => name))!,
        (route) => route.id,
    );

/** Runs one completion to its end, stream included, and returns its failure. */
const complete = async (args: Record<string, unknown>): Promise<unknown> => {
    try {
        const result = await withTestActor(() =>
            driver.complete(
                structuredClone(args) as unknown as ICompleteArguments,
            ),
        );
        if (isDriverStreamResult(result)) await readStreamResult(result);
        return undefined;
    } catch (error) {
        return error;
    }
};

describe('ChatCompletionDriver seeded fuzzing', () => {
    it('covers every configured provider', () => {
        expect([...routes.keys()].sort()).toEqual([
            'alibaba',
            'azure-openai',
            'azure-openai-responses',
            'byteplus',
            'claude',
            'deepseek',
            'gemini',
            'groq',
            'hoonify',
            'infron',
            'meta',
            'minimax',
            'mistral',
            'moonshotai',
            'neuralwatt',
            'ollama',
            'openai-completion',
            'openai-responses',
            'openrouter',
            'together-ai',
            'xai',
            'zai',
        ]);
    });

    it('answers or rejects a malformed request without failing a healthy route', async () => {
        upstream.respond = healthyUpstream;
        upstream.unanswered.clear();
        clearUnhealthyRoutes();
        const findings = new Findings();
        let answered = 0;
        const toolRepliesBefore = toolRepliesServed;

        for (let index = 0; index < fuzzCases(3000); index++) {
            const random = caseRandom(0xc4a7, index);
            const route = pickRoute(random);
            const args: Record<string, unknown> = {
                ...mutate(pick(random, CORPUS), random, OPTION_NAMES),
                provider: route.provider,
                model: route.id,
            };
            // Now and then the route itself is the malformed part.
            if (random() < 0.05) {
                args[pick(random, ['provider', 'model'])] =
                    hostileValue(random);
            }
            const label = `${route.provider}:${route.id}`;
            const error = await complete(args);
            if (!error) answered++;
            const unclassified = error && unclassifiedFailure(error);
            if (unclassified) findings.add(unclassified, index, label, args);
            else if (isHttpError(error) && error.statusCode >= 500) {
                const attempts = (error.fields?.attempts ?? []) as {
                    status?: number;
                    error: string;
                }[];
                findings.add(
                    `${error.statusCode} ${error.legacyCode}: ${error.message} [${attempts.map((a) => `${a.status ?? 'no status'} ${a.error}`).join(' | ')}]`,
                    index,
                    label,
                    args,
                );
            }
            // The vendors answered every request, so no route failed.
            for (const marked of kv.keys('aiChat:unhealthyRoute:*')) {
                findings.add(`marked unhealthy ${marked}`, index, label, args);
            }
            clearUnhealthyRoutes();
        }

        for (const request of upstream.unanswered) {
            findings.add(`no upstream fixture for ${request}`, -1, '', {});
        }
        findings.assertNone();
        // A run where nothing is answered has stopped reaching the providers.
        expect(answered).toBeGreaterThan(0);
        expect(toolRepliesServed).toBeGreaterThan(toolRepliesBefore);
    }, 600_000);

    it('ends every request with an answer or a classified error when the upstream misbehaves', async () => {
        const findings = new Findings();
        const askedBefore = upstream.asked;
        const toolRepliesBefore = toolRepliesServed;

        for (let index = 0; index < fuzzCases(2000); index++) {
            const random = caseRandom(0x0b5e, index);
            const route = pickRoute(random);
            const replies: unknown[] = [];
            upstream.respond = (request) => {
                const healthy = healthyUpstream(request);
                const reply = healthy && corruptReply(healthy, random);
                replies.push(reply);
                return reply;
            };
            const error = await complete({
                messages: [{ role: 'user', content: 'hi' }],
                provider: route.provider,
                model: route.id,
                stream: random() < 0.5,
                fallback: random() < 0.5,
                tools: random() < 0.5 ? [weatherTool] : undefined,
            });
            const unclassified = error && unclassifiedFailure(error);
            if (unclassified) {
                findings.add(
                    unclassified,
                    index,
                    `${route.provider}:${route.id}`,
                    replies,
                );
            }
            for (const charge of charges.splice(0)) {
                findings.add(
                    `${route.provider} metering ${charge.split(' ').slice(0, 2).join(' ')}`,
                    index,
                    `${route.id} ${charge}`,
                    replies,
                );
            }
            clearUnhealthyRoutes();
        }
        findings.assertNone();
        expect(upstream.asked).toBeGreaterThan(askedBefore);
        expect(toolRepliesServed).toBeGreaterThan(toolRepliesBefore);
    }, 1_800_000);

    it('classifies a 200 whose JSON body is cut short, on every provider', async () => {
        const findings = new Findings();
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown) => rejections.push(reason);
        process.on('unhandledRejection', onRejection);
        const bodies = [
            '{"id":"x","choices":[{"mess',
            '',
            '<html>502</html>',
            'null',
            '[]',
            '"ok"',
            '0',
        ];
        for (const [provider, list] of routes) {
            for (const body of bodies) {
                for (const stream of [false, true]) {
                    upstream.respond = (request) =>
                        isCatalogRequest(request.url.pathname)
                            ? healthyUpstream(request)
                            : { body, contentType: 'application/json' };
                    const error = await complete({
                        messages: [{ role: 'user', content: 'hi' }],
                        provider,
                        model: list[0]!.id,
                        stream,
                        fallback: false,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    const label = `${provider} stream=${stream} body=${JSON.stringify(body)}`;
                    const unclassified = error && unclassifiedFailure(error);
                    if (unclassified)
                        findings.add(
                            `${provider} ${unclassified.slice(0, 160)}`,
                            0,
                            label,
                            body,
                        );
                    // A stream reports its failure in-band, so only a unary answer counts.
                    if (!error && !stream)
                        findings.add(
                            `${provider} answered a request the vendor did not answer (stream=${stream})`,
                            0,
                            label,
                            body,
                        );
                    for (const reason of rejections.splice(0))
                        findings.add(
                            `${provider} unhandled rejection ${(reason as Error)?.name}`,
                            0,
                            label,
                            String((reason as Error)?.stack).slice(0, 500),
                        );
                    clearUnhealthyRoutes();
                }
            }
        }
        process.off('unhandledRejection', onRejection);
        upstream.respond = healthyUpstream;
        findings.assertNone();
    }, 600_000);

    it('builds a sane catalog from a malformed vendor model list', async () => {
        const findings = new Findings();
        const dynamic = [
            'infron',
            'openrouter',
            'neuralwatt',
            'together-ai',
            'ollama',
        ];
        for (let index = 0; index < fuzzCases(300); index++) {
            const random = caseRandom(0xca7a, index);
            const replies: unknown[] = [];
            upstream.respond = (request) => {
                const healthy = healthyUpstream(request);
                if (!healthy || !isCatalogRequest(request.url.pathname))
                    return healthy;
                const reply = corruptReply(healthy, random);
                replies.push(
                    request.url.hostname + request.url.pathname,
                    reply.body,
                );
                return reply;
            };
            const fresh = new ChatCompletionDriver(
                {
                    providers: Object.fromEntries(
                        Object.entries(providers).filter(([name]) =>
                            dynamic.includes(name),
                        ),
                    ),
                } as never,
                server.clients,
                server.stores,
                server.services,
            );
            try {
                await fresh.onServerStart();
                const models = await fresh.models();
                for (const model of models as unknown as Record<
                    string,
                    any
                >[]) {
                    if (model.provider === 'fake-chat') continue;
                    const bad: string[] = [];
                    if (
                        typeof model.id !== 'string' ||
                        !model.id.trim() ||
                        /undefined|\[object/.test(model.id)
                    )
                        bad.push(`id ${JSON.stringify(model.id)}`);
                    for (const alias of model.aliases ?? [])
                        if (typeof alias !== 'string')
                            bad.push(`alias ${JSON.stringify(alias)}`);
                    for (const [k, v] of Object.entries(model.costs ?? {}))
                        if (
                            typeof v !== 'number' ||
                            !Number.isFinite(v) ||
                            v < 0
                        )
                            bad.push(`cost ${k}=${String(v)}`);
                    // A catalog writes 0 for a model that declares no output cap.
                    for (const k of ['max_tokens', 'context'])
                        if (
                            model[k] !== undefined &&
                            model[k] !== null &&
                            (typeof model[k] !== 'number' ||
                                !Number.isFinite(model[k]) ||
                                model[k] < 0 ||
                                (k === 'context' && model[k] === 0))
                        )
                            bad.push(`${k}=${JSON.stringify(model[k])}`);
                    if (
                        model.name !== undefined &&
                        typeof model.name !== 'string'
                    )
                        bad.push(`name ${JSON.stringify(model.name)}`);
                    for (const b of bad)
                        findings.add(
                            `${model.provider} catalog ${b.split(/[ =]/)[0]}`,
                            index,
                            `${b}`,
                            replies,
                        );
                }
                JSON.stringify(models);
                // One request per listed provider, answered healthily.
                upstream.respond = healthyUpstream;
                const seen = new Set<string>();
                for (const model of models) {
                    if (
                        !model.provider ||
                        model.provider === 'fake-chat' ||
                        seen.has(model.provider)
                    )
                        continue;
                    seen.add(model.provider);
                    try {
                        const result = await withTestActor(() =>
                            fresh.complete({
                                messages: [{ role: 'user', content: 'hi' }],
                                provider: model.provider,
                                model: model.id,
                                fallback: false,
                            } as unknown as ICompleteArguments),
                        );
                        if (isDriverStreamResult(result))
                            await readStreamResult(result);
                    } catch (error) {
                        const unclassified = unclassifiedFailure(error);
                        if (unclassified)
                            findings.add(
                                `${model.provider} ${unclassified}`,
                                index,
                                String(model.id),
                                replies,
                            );
                    }
                    for (const charge of charges.splice(0))
                        findings.add(
                            `${model.provider} metering ${charge.split(' ').slice(0, 2).join(' ')}`,
                            index,
                            `${String(model.id)} ${charge} MODEL ${JSON.stringify(model)}`,
                            [],
                        );
                }
            } catch (error) {
                findings.add(
                    `catalog build threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 150)} ${(
                        error as Error
                    )?.stack
                        ?.split('\n')
                        .filter((l) => l.includes('/src/'))
                        .slice(0, 4)
                        .join(' <- ')}`,
                    index,
                    '',
                    replies,
                );
            }
            clearUnhealthyRoutes();
        }
        upstream.respond = healthyUpstream;
        findings.assertNone();
    }, 1_800_000);
});
