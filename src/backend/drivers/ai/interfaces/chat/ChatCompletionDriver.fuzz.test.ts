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
    corruptReply,
    Findings,
    fuzzCases,
    hostileValue,
    mutate,
    pick,
    type Random,
    seededRandom,
    unclassifiedFailure,
    upstream,
    type UpstreamReply,
    type UpstreamRequest,
} from '../../shared/fuzzTestUtil.js';
import {
    readStreamResult,
    withTestActor,
} from '../../shared/integrationTestUtil.js';
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

/** A well-formed answer from whichever vendor API the request went to. */
const healthyUpstream = ({
    url,
    json,
}: UpstreamRequest): UpstreamReply | undefined => {
    const path = url.pathname;
    // A caller-supplied media link that leads nowhere.
    if (url.hostname === 'upstream.test') return { status: 404, body: '' };
    const streaming = (json as { stream?: unknown } | undefined)?.stream;
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
    ollama: { enabled: false },
};

let server: PuterServer;
let driver: ChatCompletionDriver;
// Every provider gets the same share of cases, whatever its catalog size.
let routes: Map<string, { provider: string; id: string }[]>;

beforeAll(async () => {
    upstream.install();
    server = await setupTestServer();
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
    pick(random, routes.get(pick(random, [...routes.keys()]))!);

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
            'meta',
            'minimax',
            'mistral',
            'moonshotai',
            'openai-completion',
            'openai-responses',
            'xai',
            'zai',
        ]);
    });

    it('answers or rejects a malformed request without failing a healthy route', async () => {
        upstream.respond = healthyUpstream;
        upstream.unanswered.clear();
        clearUnhealthyRoutes();
        const random = seededRandom(0xc4a7);
        const findings = new Findings();

        for (let index = 0; index < fuzzCases(3000); index++) {
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
    }, 600_000);

    it('ends every request with an answer or a classified error when the upstream misbehaves', async () => {
        const random = seededRandom(0x0b5e);
        const findings = new Findings();

        for (let index = 0; index < fuzzCases(2000); index++) {
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
            clearUnhealthyRoutes();
        }
        findings.assertNone();
    }, 600_000);
});
