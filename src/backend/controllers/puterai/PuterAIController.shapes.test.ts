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
 * Wire-shape translation coverage for PuterAIController.
 *
 * The sibling PuterAIController.test.ts covers routing, gating, and the happy
 * paths. This file pins the translation edges the vendor SDKs actually hit:
 * every optional parameter on the Responses body, each `input` content-part
 * variant, the usage-field aliases, and the Anthropic message/tool
 * normalizations. As there, the chat driver's `complete` is the seam — the
 * controller is the unit under test and provider internals are covered by their
 * own suites.
 */

import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import type { Actor } from '../../core/actor.js';
import type { ChatCompletionDriver } from '../../drivers/ai-chat/ChatCompletionDriver.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { PuterAIController } from './PuterAIController.js';

let server: PuterServer;
let controller: PuterAIController;

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.puterAi as unknown as PuterAIController;
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Harness ---------------------------------------------------------

const actor: Actor = { user: { id: 7, uuid: 'u-7', username: 'alice' } };

const makeReq = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
}): Request =>
    ({
        body: init.body ?? {},
        query: init.query ?? {},
        headers: {},
        actor,
    }) as unknown as Request;

interface Captured {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    written: string[];
    ended: boolean;
    piped: unknown;
}

const makeRes = () => {
    const captured: Captured = {
        statusCode: 200,
        body: undefined,
        headers: {},
        written: [],
        ended: false,
        piped: undefined,
    };
    const res = {
        json: vi.fn((v: unknown) => {
            captured.body = v;
            return res;
        }),
        status: vi.fn((c: number) => {
            captured.statusCode = c;
            return res;
        }),
        send: vi.fn((v: unknown) => {
            captured.body = v;
            return res;
        }),
        setHeader: vi.fn((k: string, v: string) => {
            captured.headers[k] = v;
            return res;
        }),
        write: vi.fn((chunk: string | Buffer) => {
            captured.written.push(
                typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
            );
            return true;
        }),
        end: vi.fn(() => {
            captured.ended = true;
            return res;
        }),
        on: vi.fn(() => res),
        once: vi.fn(() => res),
        emit: vi.fn(() => true),
    };
    return { res: res as unknown as Response, captured };
};

const stubChatComplete = (result: unknown) =>
    vi
        .spyOn(
            server.drivers.aiChat as unknown as ChatCompletionDriver,
            'complete',
        )
        .mockResolvedValueOnce(result as never);

const ndjsonStreamFrom = (events: unknown[]): NodeJS.ReadableStream =>
    Readable.from(events.map((e) => `${JSON.stringify(e)}\n`));

const streamResult = (events: unknown[]) => ({
    dataType: 'stream',
    content_type: 'application/x-ndjson',
    stream: ndjsonStreamFrom(events),
});

/** Wait for the NDJSON pipe to drain — SSE writes happen off the promise. */
const settleStream = () => new Promise((r) => setTimeout(r, 20));

const captureGet = (
    path: string,
): ((req: Request, res: Response) => Promise<void>) => {
    let handler: ((req: Request, res: Response) => Promise<void>) | null = null;
    controller.registerRoutes({
        post: vi.fn(),
        get: vi.fn((p: string, _o: unknown, h: never) => {
            if (p === path) handler = h;
        }),
    } as never);
    if (!handler) throw new Error(`did not capture ${path}`);
    return handler;
};

// -- /openai/v1/responses: full parameter surface --------------------

describe('PuterAIController.openaiResponses parameter forwarding', () => {
    it('forwards every optional Responses parameter to the driver', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: {
                    model: 'gpt-test',
                    input: 'hello',
                    instructions: 'be brief',
                    tools: [
                        {
                            type: 'function',
                            function: { name: 'lookup', parameters: {} },
                        },
                    ],
                    tool_choice: 'auto',
                    parallel_tool_calls: true,
                    temperature: 0.2,
                    max_output_tokens: 512,
                    top_p: 0.8,
                    reasoning: { effort: 'high' },
                    text: { verbosity: 'low' },
                    include: ['file_search_call.results'],
                    metadata: { trace: 'abc' },
                    conversation: 'conv_1',
                    context_management: [{ type: 'compaction' }],
                    previous_response_id: 'resp_prev',
                    prompt: { id: 'p_1' },
                    prompt_cache_key: 'ck',
                    prompt_cache_retention: '24h',
                    store: true,
                    truncation: 'auto',
                    background: false,
                    service_tier: 'default',
                },
            }),
            res,
        );

        const args = completeSpy.mock.calls[0]![0] as Record<string, unknown>;
        expect(args).toMatchObject({
            model: 'gpt-test',
            tool_choice: 'auto',
            parallel_tool_calls: true,
            temperature: 0.2,
            max_tokens: 512,
            top_p: 0.8,
            reasoning: { effort: 'high' },
            text: { verbosity: 'low' },
            include: ['file_search_call.results'],
            metadata: { trace: 'abc' },
            conversation: 'conv_1',
            context_management: [{ type: 'compaction' }],
            previous_response_id: 'resp_prev',
            prompt: { id: 'p_1' },
            prompt_cache_key: 'ck',
            prompt_cache_retention: '24h',
            store: true,
            truncation: 'auto',
            background: false,
            service_tier: 'default',
            provider: 'openai-responses',
        });
        // `instructions` becomes a leading system message AND is forwarded.
        expect(args.instructions).toBe('be brief');
        expect((args.messages as unknown[])[0]).toEqual({
            role: 'system',
            content: 'be brief',
        });
    });

    it('echoes the request knobs back in the response shell', async () => {
        stubChatComplete({ message: { role: 'assistant', content: 'ok' } });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: {
                    model: 'gpt-test',
                    input: 'hi',
                    instructions: 'be brief',
                    metadata: { trace: 'abc' },
                    temperature: 0.2,
                    top_p: 0.8,
                    tool_choice: 'required',
                    parallel_tool_calls: true,
                    max_output_tokens: 512,
                    previous_response_id: 'resp_prev',
                    store: false,
                    text: { verbosity: 'low' },
                    truncation: 'disabled',
                    tools: [
                        {
                            type: 'function',
                            function: { name: 'lookup', parameters: {} },
                        },
                        { type: 'web_search' },
                    ],
                },
            }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        expect(body).toMatchObject({
            object: 'response',
            status: 'completed',
            instructions: 'be brief',
            metadata: { trace: 'abc' },
            temperature: 0.2,
            top_p: 0.8,
            tool_choice: 'required',
            parallel_tool_calls: true,
            max_output_tokens: 512,
            previous_response_id: 'resp_prev',
            store: false,
            text: { verbosity: 'low' },
            truncation: 'disabled',
        });
        // Function tools are flattened; other tool types pass through.
        expect(body.tools).toEqual([
            { name: 'lookup', parameters: {}, type: 'function' },
            { type: 'web_search' },
        ]);
        expect(body.output_text).toBe('ok');
    });

    it('defaults the shell knobs to null/empty when the request omits them', async () => {
        stubChatComplete({ message: { role: 'assistant', content: '' } });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({ body: { model: 'gpt-test', input: 'hi' } }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.instructions).toBeNull();
        expect(body.metadata).toBeNull();
        expect(body.temperature).toBeNull();
        expect(body.top_p).toBeNull();
        expect(body.tool_choice).toBe('auto');
        expect(body.parallel_tool_calls).toBe(false);
        expect(body.tools).toEqual([]);
        expect('max_output_tokens' in body).toBe(false);
        expect('store' in body).toBe(false);
        expect(body.output).toEqual([]);
        expect(body.output_text).toBe('');
    });
});

// -- /openai/v1/responses: input normalization -----------------------

describe('PuterAIController.openaiResponses input normalization', () => {
    const captureMessages = async (input: unknown) => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });
        const { res } = makeRes();
        await controller.openaiResponses(
            makeReq({ body: { model: 'gpt-test', input } }),
            res,
        );
        return (completeSpy.mock.calls[0]![0] as { messages: unknown[] })
            .messages;
    };

    it('returns no messages for a null input', async () => {
        expect(await captureMessages(null)).toEqual([]);
    });

    it('wraps bare strings in the array into user messages', async () => {
        expect(await captureMessages(['first', 'second'])).toEqual([
            { role: 'user', content: 'first' },
            { role: 'user', content: 'second' },
        ]);
    });

    it('skips non-object, non-string entries', async () => {
        expect(await captureMessages([null, 42, 'kept'])).toEqual([
            { role: 'user', content: 'kept' },
        ]);
    });

    it('translates every documented content-part type', async () => {
        const messages = await captureMessages([
            {
                role: 'user',
                content: [
                    'a bare string part',
                    { type: 'input_text', text: 'typed text' },
                    { type: 'output_text', text: 'echoed text' },
                    {
                        type: 'input_image',
                        detail: 'high',
                        image_url: 'https://img.test/a.png',
                        file_id: 'file_img',
                    },
                    { type: 'input_audio', input_audio: { data: 'AAA' } },
                    {
                        type: 'input_file',
                        file_data: 'ZGF0YQ==',
                        file_id: 'file_1',
                        file_url: 'https://f.test/a.pdf',
                        filename: 'a.pdf',
                    },
                    { type: 'something_else', keep: true },
                    null,
                ],
            },
        ]);

        expect(messages).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'a bare string part' },
                    { type: 'text', text: 'typed text' },
                    { type: 'text', text: 'echoed text' },
                    {
                        type: 'image_url',
                        detail: 'high',
                        image_url: { url: 'https://img.test/a.png' },
                        file_id: 'file_img',
                    },
                    { type: 'input_audio', input_audio: { data: 'AAA' } },
                    {
                        type: 'input_file',
                        file_data: 'ZGF0YQ==',
                        file_id: 'file_1',
                        file_url: 'https://f.test/a.pdf',
                        filename: 'a.pdf',
                    },
                    { type: 'something_else', keep: true },
                    { type: 'text', text: '' },
                ],
            },
        ]);
    });

    it('omits absent optional fields on image and file parts', async () => {
        const messages = await captureMessages([
            {
                role: 'user',
                content: [{ type: 'input_image' }, { type: 'input_file' }],
            },
        ]);
        expect(messages).toEqual([
            {
                role: 'user',
                content: [{ type: 'image_url' }, { type: 'input_file' }],
            },
        ]);
    });

    it('normalizes a non-array message content into a single-part array', async () => {
        const messages = await captureMessages([
            { role: 'user', content: { type: 'input_text', text: 'solo' } },
        ]);
        expect(messages).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'solo' }] },
        ]);
    });

    it('treats a missing content as an empty string and a missing role as user', async () => {
        const messages = await captureMessages([{ type: 'message' }]);
        expect(messages).toEqual([{ role: 'user', content: '' }]);
    });

    it('wraps a bare object with no role or known type as user content', async () => {
        const messages = await captureMessages([{ text: 'loose' }]);
        expect(messages).toEqual([
            { role: 'user', content: [{ text: 'loose' }] },
        ]);
    });

    it('keeps malformed function_call arguments as a raw string', async () => {
        const messages = await captureMessages([
            {
                type: 'function_call',
                call_id: 'call_1',
                id: 'fc_1',
                name: 'lookup',
                arguments: 'not json at all',
            },
        ]);
        expect(messages).toEqual([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'call_1',
                        canonical_id: 'fc_1',
                        name: 'lookup',
                        input: 'not json at all',
                    },
                ],
            },
        ]);
    });

    it('falls back to the item id, then a generated id, when call_id is absent', async () => {
        const messages = (await captureMessages([
            { type: 'function_call', id: 'fc_1', name: 'a' },
            { type: 'function_call', name: 'b' },
        ])) as Array<{ content: Array<{ id: string; input: unknown }> }>;

        expect(messages[0]!.content[0]!.id).toBe('fc_1');
        // No arguments at all normalizes to an empty object.
        expect(messages[0]!.content[0]!.input).toEqual({});
        expect(messages[1]!.content[0]!.id).toMatch(/^call_[0-9a-f]{32}$/);
    });

    it('serialises a non-string function_call_output payload', async () => {
        const messages = await captureMessages([
            {
                type: 'function_call_output',
                call_id: 'call_1',
                output: { ok: true },
            },
            { type: 'function_call_output', call_id: 'call_2' },
        ]);
        expect(messages).toEqual([
            { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
            { role: 'tool', tool_call_id: 'call_2', content: '{}' },
        ]);
    });
});

// -- /openai/v1/responses: result → output items ---------------------

describe('PuterAIController.openaiResponses output items', () => {
    it('emits a function_call item per tool call, preferring canonical_id', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'part-one ' },
                    { type: 'image_url', image_url: { url: 'x' } },
                    { type: 'text', text: 'part-two' },
                ],
                tool_calls: [
                    {
                        id: 'call_1',
                        canonical_id: 'fc_canon',
                        function: { name: 'lookup', arguments: '{"q":1}' },
                    },
                    { id: 'call_2' },
                    null,
                ],
            },
            usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                cached_tokens: 3,
                output_tokens_details: { reasoning_tokens: 2 },
            },
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({ body: { model: 'gpt-test', input: 'hi' } }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        const output = body.output as Array<Record<string, unknown>>;
        // Only `type: 'text'` parts contribute to the message item.
        expect(output[0]).toMatchObject({
            type: 'message',
            content: [
                {
                    type: 'output_text',
                    text: 'part-one part-two',
                    annotations: [],
                },
            ],
        });
        expect(output[1]).toMatchObject({
            id: 'fc_canon',
            type: 'function_call',
            call_id: 'call_1',
            name: 'lookup',
            arguments: '{"q":1}',
        });
        // A tool call with no function block still emits, with '{}' args.
        expect(output[2]).toMatchObject({
            type: 'function_call',
            call_id: 'call_2',
            arguments: '{}',
        });
        expect((output[2] as { id: string }).id).toMatch(/^fc_[0-9a-f]{32}$/);
        expect(output).toHaveLength(3);

        expect(body.usage).toEqual({
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens: 4,
            output_tokens_details: { reasoning_tokens: 2 },
            total_tokens: 14,
        });
    });

    it('reads the cached-token count from input_tokens_details when present', async () => {
        stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
            usage: {
                input_tokens: 8,
                output_tokens: 2,
                input_tokens_details: { cached_tokens: 5 },
            },
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({ body: { model: 'gpt-test', input: 'hi' } }),
            res,
        );

        expect((captured.body as Record<string, unknown>).usage).toEqual({
            input_tokens: 8,
            input_tokens_details: { cached_tokens: 5 },
            output_tokens: 2,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 10,
        });
    });

    it('generates a compaction item id when the driver omits one', async () => {
        stubChatComplete({
            message: { role: 'assistant', content: '' },
            compaction: { encrypted_content: 'blob' },
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({ body: { model: 'gpt-test', input: 'hi' } }),
            res,
        );

        const output = (captured.body as { output: Array<{ id: string }> })
            .output;
        expect(output[0]).toMatchObject({
            type: 'compaction',
            encrypted_content: 'blob',
        });
        expect(output[0]!.id).toMatch(/^cmpct_[0-9a-f]{32}$/);
    });
});

// -- /openai/v1/chat/completions edges -------------------------------

describe('PuterAIController.openaiChatCompletions translation edges', () => {
    it('derives tool_calls from tool_use content blocks when the message has none', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'calling' },
                    {
                        type: 'tool_use',
                        id: 'tu_1',
                        name: 'lookup',
                        input: { q: 'puter' },
                    },
                    {
                        type: 'tool_use',
                        id: 'tu_2',
                        name: 'raw',
                        input: '{"already":"json"}',
                    },
                    { type: 'text', text: '' },
                    null,
                ],
            },
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        const choice = (
            captured.body as { choices: Array<Record<string, unknown>> }
        ).choices[0]!;
        expect(choice.message).toMatchObject({
            role: 'assistant',
            content: 'calling',
            tool_calls: [
                {
                    id: 'tu_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"q":"puter"}' },
                },
                {
                    id: 'tu_2',
                    type: 'function',
                    function: { name: 'raw', arguments: '{"already":"json"}' },
                },
            ],
        });
    });

    it('omits tool_calls entirely when no content part is a tool_use', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'plain' }],
            },
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        const message = (
            captured.body as { choices: Array<{ message: object }> }
        ).choices[0]!.message;
        expect('tool_calls' in message).toBe(false);
    });

    it('accepts the Responses-style usage aliases and defaults the role', async () => {
        stubChatComplete({
            message: { content: { text: 'object content' } },
            usage: { input_tokens: 11, output_tokens: 5 },
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: '',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.model).toBe('');
        expect(body.usage).toEqual({
            prompt_tokens: 11,
            completion_tokens: 5,
            total_tokens: 16,
        });
        const choice = (body.choices as Array<Record<string, unknown>>)[0]!;
        // A missing role defaults to assistant; `{ text }` content is read.
        expect(choice.message).toMatchObject({
            role: 'assistant',
            content: 'object content',
        });
        // A missing finish_reason defaults to stop.
        expect(choice.finish_reason).toBe('stop');
    });

    it('extracts text from `{ content: "..." }` shaped parts and objects', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [
                    { content: 'from-content-key' },
                    { neither: true },
                    'raw string part',
                ],
            },
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        expect(
            (
                captured.body as {
                    choices: Array<{ message: { content: string } }>;
                }
            ).choices[0]!.message.content,
        ).toBe('from-content-keyraw string part');
    });

    it('reports an empty string when the driver returns no message at all', async () => {
        stubChatComplete({});

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        expect(
            (
                captured.body as {
                    choices: Array<{ message: { content: string } }>;
                }
            ).choices[0]!.message.content,
        ).toBe('');
        expect((captured.body as { usage: unknown }).usage).toEqual({
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        });
    });

    it('honours an explicit provider override', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    provider: 'xai',
                    temperature: 0.1,
                    max_tokens: 32,
                    tools: [{ type: 'function' }],
                },
            }),
            res,
        );

        expect(completeSpy.mock.calls[0]![0]).toMatchObject({
            provider: 'xai',
            temperature: 0.1,
            max_tokens: 32,
            tools: [{ type: 'function' }],
        });
    });

    it('marks a streamed run that emitted tool calls with finish_reason=tool_calls', async () => {
        stubChatComplete(
            streamResult([
                { type: 'text', text: 'thinking' },
                {
                    type: 'tool_use',
                    id: 'tu_1',
                    name: 'lookup',
                    input: { q: 1 },
                },
                { type: 'tool_use', id: 'tu_2', name: 'raw', input: '{"a":1}' },
                {
                    type: 'usage',
                    usage: { prompt_tokens: 3, completion_tokens: 1 },
                },
            ]),
        );

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    stream: true,
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );
        await settleStream();

        const frames = captured.written
            .join('')
            .split('\n\n')
            .filter((f) => f.startsWith('data: ') && !f.includes('[DONE]'))
            .map((f) => JSON.parse(f.slice(6)));

        const toolFrames = frames.filter(
            (f) => f.choices[0].delta.tool_calls !== undefined,
        );
        expect(toolFrames.map((f) => f.choices[0].delta.tool_calls[0])).toEqual(
            [
                {
                    index: 0,
                    id: 'tu_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"q":1}' },
                },
                {
                    index: 1,
                    id: 'tu_2',
                    type: 'function',
                    function: { name: 'raw', arguments: '{"a":1}' },
                },
            ],
        );

        const last = frames[frames.length - 1]!;
        expect(last.choices[0].finish_reason).toBe('tool_calls');
        expect(last.usage).toEqual({
            prompt_tokens: 3,
            completion_tokens: 1,
            total_tokens: 4,
        });
        expect(captured.ended).toBe(true);
    });

    it('emits a stream_error frame then [DONE] when the source stream fails', async () => {
        const stream = new Readable({ read() {} });
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream,
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    stream: true,
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );
        stream.destroy(new Error('upstream died'));
        await settleStream();

        const all = captured.written.join('');
        expect(all).toContain('"type":"stream_error"');
        expect(all).toContain('upstream died');
        expect(all).toContain('data: [DONE]');
        expect(captured.ended).toBe(true);
    });

    it('500s when stream=true but the driver returned a non-stream result', async () => {
        stubChatComplete({ message: { role: 'assistant', content: 'oops' } });

        const { res } = makeRes();
        await expect(
            controller.openaiChatCompletions(
                makeReq({
                    body: {
                        model: 'gpt-test',
                        stream: true,
                        messages: [{ role: 'user', content: 'hi' }],
                    },
                }),
                res,
            ),
        ).rejects.toMatchObject({
            statusCode: 500,
            legacyCode: 'internal_error',
        });
    });
});

// -- /openai/v1/completions edges ------------------------------------

describe('PuterAIController.openaiCompletions translation edges', () => {
    it('uses a caller-supplied messages array instead of synthesising from prompt', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.openaiCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'direct' }],
                    provider: 'xai',
                    temperature: 0.9,
                    max_tokens: 5,
                },
            }),
            res,
        );

        expect(completeSpy.mock.calls[0]![0]).toMatchObject({
            messages: [{ role: 'user', content: 'direct' }],
            provider: 'xai',
            temperature: 0.9,
            max_tokens: 5,
        });
    });

    it('treats a missing prompt as an empty user message', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: '' },
        });

        const { res, captured } = makeRes();
        await controller.openaiCompletions(
            makeReq({ body: { model: 'gpt-test' } }),
            res,
        );

        expect(
            (completeSpy.mock.calls[0]![0] as { messages: unknown[] }).messages,
        ).toEqual([{ role: 'user', content: '' }]);
        expect((captured.body as { object: string }).object).toBe(
            'text_completion',
        );
    });

    it('accepts an empty prompt array', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: '' },
        });

        const { res } = makeRes();
        await controller.openaiCompletions(
            makeReq({ body: { model: 'gpt-test', prompt: [] } }),
            res,
        );

        expect(
            (completeSpy.mock.calls[0]![0] as { messages: unknown[] }).messages,
        ).toEqual([{ role: 'user', content: '' }]);
    });

    it('carries the driver finish_reason through to the completion choice', async () => {
        stubChatComplete({
            message: { role: 'assistant', content: 'trimmed' },
            finish_reason: 'length',
        });

        const { res, captured } = makeRes();
        await controller.openaiCompletions(
            makeReq({ body: { model: 'gpt-test', prompt: 'hi' } }),
            res,
        );

        expect(
            (captured.body as { choices: Array<Record<string, unknown>> })
                .choices[0],
        ).toMatchObject({ text: 'trimmed', finish_reason: 'length' });
    });
});

// -- /anthropic/v1/messages edges ------------------------------------

describe('PuterAIController.anthropicMessages translation edges', () => {
    it('forwards every optional Anthropic parameter to the driver', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    temperature: 0.4,
                    max_tokens: 100,
                    context_management: { edits: [] },
                    compaction: true,
                    provider: 'claude-alt',
                    tools: [
                        {
                            type: 'function',
                            function: { name: 'already', parameters: {} },
                        },
                        {
                            name: 'shorthand',
                            input_schema: { type: 'object' },
                        },
                        { name: 'bare' },
                        null,
                    ],
                },
            }),
            res,
        );

        const args = completeSpy.mock.calls[0]![0] as Record<string, unknown>;
        expect(args).toMatchObject({
            temperature: 0.4,
            max_tokens: 100,
            context_management: { edits: [] },
            compaction: true,
            provider: 'claude-alt',
        });
        expect(args.tools).toEqual([
            {
                type: 'function',
                function: { name: 'already', parameters: {} },
            },
            {
                type: 'function',
                function: {
                    name: 'shorthand',
                    description: '',
                    parameters: { type: 'object' },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'bare',
                    description: '',
                    parameters: { type: 'object', properties: {} },
                },
            },
            null,
        ]);
    });

    it('omits tools entirely for an empty tools array', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    tools: [],
                },
            }),
            res,
        );

        expect('tools' in completeSpy.mock.calls[0]![0]).toBe(false);
    });

    it('drops a system array that yields no text and skips non-object messages', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    system: [{ notText: true }],
                    messages: [null, 'nope', { role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        expect(
            (completeSpy.mock.calls[0]![0] as { messages: unknown[] }).messages,
        ).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('ignores a non-string, non-array system value', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    system: { unexpected: 'shape' },
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        expect(
            (completeSpy.mock.calls[0]![0] as { messages: unknown[] }).messages,
        ).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('keeps non-tool_result parts alongside hoisted tool results', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });

        const { res } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: 'and also' },
                                {
                                    type: 'tool_result',
                                    tool_use_id: 'tu_1',
                                    content: [
                                        { type: 'text', text: 'part-a' },
                                        'part-b',
                                        { notText: true },
                                    ],
                                },
                                {
                                    type: 'tool_result',
                                    tool_use_id: 'tu_2',
                                    content: 42,
                                },
                            ],
                        },
                    ],
                },
            }),
            res,
        );

        expect(
            (completeSpy.mock.calls[0]![0] as { messages: unknown[] }).messages,
        ).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'and also' }] },
            { role: 'tool', tool_call_id: 'tu_1', content: 'part-apart-b' },
            { role: 'tool', tool_call_id: 'tu_2', content: '' },
        ]);
    });

    it('leaves an assistant array message untouched', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
        });
        const assistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: 'prior turn' }],
        };

        const { res } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [assistantMessage],
                },
            }),
            res,
        );

        expect(
            (completeSpy.mock.calls[0]![0] as { messages: unknown[] }).messages,
        ).toEqual([assistantMessage]);
    });

    it('parses string tool_call arguments and falls back to {} on bad JSON', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                tool_calls: [
                    { id: 'c1', function: { name: 'a', arguments: '{"x":1}' } },
                    { id: 'c2', function: { name: 'b', arguments: 'nope' } },
                    { id: 'c3', function: { name: 'c', arguments: { y: 2 } } },
                    { id: 'c4' },
                    null,
                ],
            },
            usage: { input_tokens: 3, output_tokens: 1 },
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.content).toEqual([
            { type: 'tool_use', id: 'c1', name: 'a', input: { x: 1 } },
            { type: 'tool_use', id: 'c2', name: 'b', input: {} },
            { type: 'tool_use', id: 'c3', name: 'c', input: { y: 2 } },
            { type: 'tool_use', id: 'c4', name: '', input: {} },
        ]);
        expect(body.stop_reason).toBe('tool_use');
        expect(body.usage).toEqual({ input_tokens: 3, output_tokens: 1 });
    });

    it('parses a string `input` on a tool_use content block', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tu_1',
                        name: 'lookup',
                        input: '{"q":"puter"}',
                    },
                    { type: 'tool_use', id: 'tu_2', name: 'bad', input: '{{' },
                    { type: 'text', text: 'trailing' },
                ],
            },
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        expect((captured.body as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'trailing' },
            {
                type: 'tool_use',
                id: 'tu_1',
                name: 'lookup',
                input: { q: 'puter' },
            },
            { type: 'tool_use', id: 'tu_2', name: 'bad', input: {} },
        ]);
    });

    it('reads the OpenAI-style usage aliases', async () => {
        stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
            usage: { prompt_tokens: 9, completion_tokens: 4 },
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
            }),
            res,
        );

        expect((captured.body as { usage: unknown }).usage).toEqual({
            input_tokens: 9,
            output_tokens: 4,
        });
    });
});

// -- Video proxy: success and upstream failures ----------------------

describe('PuterAIController videoProxy upstream handling', () => {
    const signedQuery = (fileId: string) => {
        const cfg = (
            controller as unknown as { config: Record<string, unknown> }
        ).config;
        const secret = cfg.url_signature_secret as string;
        const expires = String(Math.floor(Date.now() / 1000) + 60);
        const signature = crypto
            .createHash('sha256')
            .update(`${fileId}/video-proxy/${secret}/${expires}`)
            .digest('hex');
        return { fileId, expires, signature, provider: 'gemini' };
    };

    const withGeminiKey = async <T>(fn: () => Promise<T>): Promise<T> => {
        const cfg = (
            controller as unknown as {
                config: Record<string, unknown> & {
                    providers?: Record<string, Record<string, unknown>>;
                };
            }
        ).config;
        const orig = cfg.providers;
        cfg.providers = {
            ...(orig ?? {}),
            'gemini-video-generation': {
                ...(orig?.['gemini-video-generation'] ?? {}),
                apiKey: 'gemini-test-key',
            },
        };
        try {
            return await fn();
        } finally {
            cfg.providers = orig;
        }
    };

    it('streams the upstream body through and forwards its content-type', async () => {
        await withGeminiKey(async () => {
            const bodyStream = new ReadableStream<Uint8Array>({
                start(c) {
                    c.enqueue(new TextEncoder().encode('video-bytes'));
                    c.close();
                },
            });
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => 'video/mp4' },
                body: bodyStream,
            } as unknown as Response);

            const handler = captureGet('/puterai/video/proxy');
            const { res, captured } = makeRes();
            const sink: Buffer[] = [];
            (res as unknown as Record<string, unknown>).write = (
                chunk: Buffer,
            ) => {
                sink.push(Buffer.from(chunk));
                return true;
            };
            (res as unknown as Record<string, unknown>).emit = () => true;

            await handler(makeReq({ query: signedQuery('vid1') }), res);
            await settleStream();

            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    'vid1:download?alt=media&key=gemini-test-key',
                ),
            );
            expect(captured.headers['Content-Type']).toBe('video/mp4');
        });
    });

    it('mirrors the upstream status when the provider download fails', async () => {
        await withGeminiKey(async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: false,
                status: 404,
                headers: { get: () => null },
                body: null,
            } as unknown as Response);

            const handler = captureGet('/puterai/video/proxy');
            const { res, captured } = makeRes();
            await handler(makeReq({ query: signedQuery('vid2') }), res);

            expect(captured.statusCode).toBe(404);
            expect(captured.body).toBe('Failed to fetch video');
        });
    });

    it('500s when the upstream response carries no body', async () => {
        await withGeminiKey(async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                body: null,
            } as unknown as Response);

            const handler = captureGet('/puterai/video/proxy');
            const { res, captured } = makeRes();
            await handler(makeReq({ query: signedQuery('vid3') }), res);

            expect(captured.statusCode).toBe(500);
            expect(captured.body).toBe('Empty response body');
            // No content-type was advertised, so none is forwarded.
            expect(captured.headers['Content-Type']).toBeUndefined();
        });
    });

    it('rejects a request with no fileId at all', async () => {
        const handler = captureGet('/puterai/video/proxy');
        const { res, captured } = makeRes();
        await handler(makeReq({ query: {} }), res);
        expect(captured.statusCode).toBe(400);
        expect(captured.body).toBe('Invalid or missing fileId parameter');
    });
});

// -- Model detail listing --------------------------------------------

describe('PuterAIController model listing edges', () => {
    it('tolerates a driver that returns no model list', async () => {
        const handler = captureGet('/puterai/image/models');
        vi.spyOn(server.drivers.aiImage, 'list').mockResolvedValueOnce(
            undefined as never,
        );

        const { res, captured } = makeRes();
        await handler(makeReq({}), res);
        expect(captured.body).toEqual({ models: undefined });
    });

    it('filters hidden ids out of the video model details', async () => {
        const handler = captureGet('/puterai/video/models/details');
        vi.spyOn(server.drivers.aiVideo, 'models').mockResolvedValueOnce([
            { id: 'veo-test' },
            { id: 'fake' },
            { id: 'model-fallback-test-1' },
        ] as never);

        const { res, captured } = makeRes();
        await handler(makeReq({}), res);
        expect(captured.body).toEqual({ models: [{ id: 'veo-test' }] });
    });
});
