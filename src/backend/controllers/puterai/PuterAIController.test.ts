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
 * Offline unit tests for PuterAIController.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and drives the live wired controller from
 * `server.controllers.puterAi`. The chat driver's `complete` method
 * is spied per-test to inject canned results; that's the seam between
 * controller (the unit under test) and provider/driver internals
 * (which have their own tests). Tests cover route registration,
 * actor gating, body validation, response shape (non-stream and SSE),
 * model-listing endpoints, and the HMAC-gated video proxy guards.
 */

import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
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

// ── Test harness ────────────────────────────────────────────────────

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

// ── Test req/res helpers ────────────────────────────────────────────

const makeUserActor = (): Actor => ({
    user: { id: 7, uuid: 'u-7', username: 'alice' },
});

const makeAppActor = (): Actor => ({
    user: { id: 7, uuid: 'u-7', username: 'alice' },
    app: { id: 1, uid: 'app-uid' },
});

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    written: string[];
    ended: boolean;
}

const makeReq = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
    actor?: Actor;
}): Request =>
    ({
        body: init.body ?? {},
        query: init.query ?? {},
        headers: {},
        actor: init.actor,
    }) as unknown as Request;

const makeRes = () => {
    const captured: CapturedResponse = {
        statusCode: 200,
        body: undefined,
        headers: {},
        written: [],
        ended: false,
    };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
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
    };
    return { res: res as unknown as Response, captured };
};

const ndjsonStreamFrom = (events: unknown[]): NodeJS.ReadableStream => {
    const lines = events.map((e) => `${JSON.stringify(e)}\n`);
    return Readable.from(lines);
};

const stubChatComplete = (result: unknown) => {
    // Spy on the wired chat driver so the controller's `this.#driver()
    // .complete(args)` returns our canned shape — keeps the test focused
    // on the controller surface (validation, response shaping) without
    // dragging in provider model resolution / credit checks.
    return vi
        .spyOn(
            server.drivers.aiChat as unknown as ChatCompletionDriver,
            'complete',
        )
        .mockResolvedValueOnce(result as never);
};

// ── Route registration ──────────────────────────────────────────────

describe('PuterAIController.registerRoutes', () => {
    it('registers all OpenAI-/Anthropic-/Responses-compatible routes plus model listing and video proxy', () => {
        const calls: Array<{ method: string; path: string; opts: unknown }> =
            [];
        const router = {
            post: vi.fn((path: string, opts: unknown) => {
                calls.push({ method: 'post', path, opts });
                return router;
            }),
            get: vi.fn((path: string, opts: unknown) => {
                calls.push({ method: 'get', path, opts });
                return router;
            }),
        };

        controller.registerRoutes(router as never);

        const paths = calls.map((c) => `${c.method} ${c.path}`);
        // Compatibility surface — every path lives under /puterai for
        // wire compatibility with puter-js and existing API tests.
        expect(paths).toEqual(
            expect.arrayContaining([
                'post /puterai/openai/v1/chat/completions',
                'post /puterai/openai/v1/completions',
                'post /puterai/openai/v1/responses',
                'post /puterai/anthropic/v1/messages',
                'get /puterai/chat/models',
                'get /puterai/chat/models/details',
                'get /puterai/image/models',
                'get /puterai/image/models/details',
                'get /puterai/video/models',
                'get /puterai/video/models/details',
                'get /puterai/video/proxy',
            ]),
        );

        const chatRoute = calls.find(
            (c) => c.path === '/puterai/openai/v1/chat/completions',
        );
        expect(chatRoute?.opts).toEqual({
            subdomain: 'api',
            requireAuth: true,
        });
        const modelsRoute = calls.find(
            (c) => c.path === '/puterai/chat/models',
        );
        expect(modelsRoute?.opts).toEqual({
            subdomain: 'api',
            requireAuth: false,
        });
    });
});

// ── /openai/v1/chat/completions ─────────────────────────────────────

describe('PuterAIController.openaiChatCompletions', () => {
    it('rejects app actors with HttpError 403', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiChatCompletions(
                makeReq({
                    body: { messages: [], model: 'gpt-test' },
                    actor: makeAppActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects bodies missing a messages array with HttpError 400', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiChatCompletions(
                makeReq({
                    body: { model: 'gpt-test' },
                    actor: makeUserActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('shapes a non-stream completion as an OpenAI chat.completion response', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'hi there' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 4, completion_tokens: 2 },
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
                actor: makeUserActor(),
            }),
            res,
        );

        // Driver was given the user's messages and the default chat provider.
        expect(completeSpy).toHaveBeenCalledTimes(1);
        const completeArgs = completeSpy.mock.calls[0]![0];
        expect(completeArgs.model).toBe('gpt-test');
        expect(completeArgs.messages).toEqual([
            { role: 'user', content: 'hi' },
        ]);
        expect(completeArgs.stream).toBe(false);
        expect(completeArgs.provider).toBe('openai-completion');

        // Response shape matches OpenAI's /v1/chat/completions wire format.
        const body = captured.body as Record<string, unknown>;
        expect(body.object).toBe('chat.completion');
        expect(body.model).toBe('gpt-test');
        expect((body.choices as Array<Record<string, unknown>>)[0]).toMatchObject(
            {
                index: 0,
                message: { role: 'assistant', content: 'hi there' },
                finish_reason: 'stop',
            },
        );
        // total_tokens is computed from prompt + completion.
        expect(body.usage).toEqual({
            prompt_tokens: 4,
            completion_tokens: 2,
            total_tokens: 6,
        });
        // id is generated as `chatcmpl-<hex>`; just sanity-check the prefix.
        expect(typeof body.id).toBe('string');
        expect((body.id as string).startsWith('chatcmpl-')).toBe(true);
    });

    it('streams chat completion deltas as SSE chunks ending with [DONE]', async () => {
        stubChatComplete({
            // The controller's expectStream() checks the DriverStreamResult
            // discriminant via isDriverStreamResult.
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: ndjsonStreamFrom([
                { type: 'text', text: 'he' },
                { type: 'text', text: 'llo' },
                {
                    type: 'usage',
                    usage: { prompt_tokens: 2, completion_tokens: 2 },
                },
            ]),
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    stream: true,
                },
                actor: makeUserActor(),
            }),
            res,
        );

        // Wait a tick for the stream's `end` event to flush.
        await new Promise<void>((resolve) => setImmediate(resolve));

        // SSE headers were set.
        expect(captured.headers['Content-Type']).toBe(
            'text/event-stream; charset=utf-8',
        );
        // Wire output: every chunk is `data: {...}\n\n`, last is `data: [DONE]`.
        const out = captured.written.join('');
        expect(out).toContain('"content":"he"');
        expect(out).toContain('"content":"llo"');
        expect(out).toContain('"finish_reason":"stop"');
        expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
        expect(captured.ended).toBe(true);
    });

    it('returns tool_calls in the OpenAI shape on the assistant message', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: '{"q":"puter"}',
                        },
                    },
                ],
            },
            finish_reason: 'tool_calls',
        });

        const { res, captured } = makeRes();
        await controller.openaiChatCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    messages: [{ role: 'user', content: 'do a tool call' }],
                    tools: [
                        {
                            type: 'function',
                            function: { name: 'lookup', parameters: {} },
                        },
                    ],
                },
                actor: makeUserActor(),
            }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        const choice = (body.choices as Array<Record<string, unknown>>)[0];
        expect(choice.finish_reason).toBe('tool_calls');
        const message = choice.message as Record<string, unknown>;
        expect(message.tool_calls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                function: {
                    name: 'lookup',
                    arguments: '{"q":"puter"}',
                },
            },
        ]);
    });
});

// ── /openai/v1/completions ──────────────────────────────────────────

describe('PuterAIController.openaiCompletions', () => {
    it('rejects app actors with HttpError 403', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiCompletions(
                makeReq({
                    body: { prompt: 'hi', model: 'gpt-test' },
                    actor: makeAppActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a non-string prompt with HttpError 400', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiCompletions(
                makeReq({
                    body: { prompt: { foo: 'bar' }, model: 'gpt-test' },
                    actor: makeUserActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('synthesises a single user message from the prompt and returns a text_completion shape', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'response' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        });

        const { res, captured } = makeRes();
        await controller.openaiCompletions(
            makeReq({
                body: { model: 'gpt-test', prompt: 'hello there' },
                actor: makeUserActor(),
            }),
            res,
        );

        const completeArgs = completeSpy.mock.calls[0]![0];
        // The legacy /v1/completions endpoint is reshaped into a single
        // user-role chat message before being dispatched.
        expect(completeArgs.messages).toEqual([
            { role: 'user', content: 'hello there' },
        ]);

        const body = captured.body as Record<string, unknown>;
        expect(body.object).toBe('text_completion');
        expect((body.choices as Array<Record<string, unknown>>)[0]).toMatchObject(
            {
                text: 'response',
                index: 0,
                finish_reason: 'stop',
            },
        );
        expect((body.id as string).startsWith('cmpl-')).toBe(true);
    });
});

// ── /openai/v1/responses ────────────────────────────────────────────

describe('PuterAIController.openaiResponses', () => {
    it('rejects app actors with HttpError 403', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiResponses(
                makeReq({
                    body: { input: 'hi', model: 'gpt-test' },
                    actor: makeAppActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects providers other than openai-responses with HttpError 400', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiResponses(
                makeReq({
                    body: {
                        input: 'hi',
                        model: 'gpt-test',
                        provider: 'claude',
                    },
                    actor: makeUserActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('shapes a non-stream completion as an OpenAI Responses object with output_text', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'final answer' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 5, completion_tokens: 3 },
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: {
                    model: 'gpt-test',
                    input: 'hi',
                    instructions: 'be brief',
                },
                actor: makeUserActor(),
            }),
            res,
        );

        const completeArgs = completeSpy.mock.calls[0]![0];
        // `instructions` becomes a leading system message.
        expect(completeArgs.messages[0]).toEqual({
            role: 'system',
            content: 'be brief',
        });
        // `input` becomes a user message after the system one.
        expect(completeArgs.messages[1]).toEqual({
            role: 'user',
            content: 'hi',
        });
        expect(completeArgs.provider).toBe('openai-responses');

        const body = captured.body as Record<string, unknown>;
        expect(body.object).toBe('response');
        expect(body.status).toBe('completed');
        // `output_text` is the joined assistant text content.
        expect(body.output_text).toBe('final answer');
        // Usage is in Responses-API shape: input_tokens / output_tokens.
        expect(body.usage).toMatchObject({
            input_tokens: 5,
            output_tokens: 3,
            total_tokens: 8,
        });
    });
});

// ── /anthropic/v1/messages ──────────────────────────────────────────

describe('PuterAIController.anthropicMessages', () => {
    it('rejects app actors with HttpError 403', async () => {
        const { res } = makeRes();
        await expect(
            controller.anthropicMessages(
                makeReq({
                    body: { messages: [], model: 'claude-test' },
                    actor: makeAppActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects bodies missing a messages array with HttpError 400', async () => {
        const { res } = makeRes();
        await expect(
            controller.anthropicMessages(
                makeReq({
                    body: { model: 'claude-test' },
                    actor: makeUserActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('shapes a non-stream completion as an Anthropic message envelope', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'hi there' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 4, completion_tokens: 2 },
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    system: 'be helpful',
                    messages: [{ role: 'user', content: 'hi' }],
                },
                actor: makeUserActor(),
            }),
            res,
        );

        const completeArgs = completeSpy.mock.calls[0]![0];
        // Anthropic-style `system` is hoisted into a system-role message.
        expect(completeArgs.messages[0]).toEqual({
            role: 'system',
            content: 'be helpful',
        });
        expect(completeArgs.provider).toBe('claude');

        const body = captured.body as Record<string, unknown>;
        expect(body.type).toBe('message');
        expect(body.role).toBe('assistant');
        expect(body.stop_reason).toBe('end_turn');
        // Anthropic content is an array of typed blocks.
        expect(body.content).toEqual([{ type: 'text', text: 'hi there' }]);
        // Anthropic usage: input_tokens / output_tokens (not prompt/completion).
        expect(body.usage).toEqual({
            input_tokens: 4,
            output_tokens: 2,
        });
        expect((body.id as string).startsWith('msg_')).toBe(true);
    });

    it('translates assistant tool_calls into Anthropic tool_use blocks and stop_reason=tool_use', async () => {
        stubChatComplete({
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: '{"q":"puter"}',
                        },
                    },
                ],
            },
            finish_reason: 'tool_calls',
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'do a tool call' }],
                },
                actor: makeUserActor(),
            }),
            res,
        );

        const body = captured.body as Record<string, unknown>;
        expect(body.stop_reason).toBe('tool_use');
        expect(body.content).toEqual([
            {
                type: 'tool_use',
                id: 'call_1',
                name: 'lookup',
                input: { q: 'puter' },
            },
        ]);
    });
});

// ── Model listing ───────────────────────────────────────────────────

describe('PuterAIController model listing', () => {
    const captureGetHandler = (
        path: string,
    ): ((req: Request, res: Response) => Promise<void>) => {
        let handler:
            | ((req: Request, res: Response) => Promise<void>)
            | null = null;
        const router = {
            post: vi.fn(),
            get: vi.fn((p: string, _opts: unknown, h: never) => {
                if (p === path) handler = h;
            }),
        };
        controller.registerRoutes(router as never);
        if (!handler) throw new Error(`did not capture ${path} handler`);
        return handler;
    };

    it('exposes #listModels via /puterai/chat/models, filtering hidden ids', async () => {
        const handler = captureGetHandler('/puterai/chat/models');
        // Patch the wired aiChat.list to return a known mix.
        vi.spyOn(server.drivers.aiChat, 'list').mockResolvedValueOnce([
            'gpt-test',
            'fake', // HIDDEN — should be filtered.
            'abuse', // HIDDEN.
            'gpt-other',
        ] as never);

        const { res, captured } = makeRes();
        await handler(makeReq({}), res);
        expect(captured.body).toEqual({
            models: ['gpt-test', 'gpt-other'],
        });
    });

    it('501s when the driver does not implement list()', async () => {
        const handler = captureGetHandler('/puterai/chat/models');
        // The wired driver's prototype defines `list`. Shadow it with an
        // own undefined property so `if (!driver?.list)` in the handler
        // takes the 501 branch, then restore.
        const driver = server.drivers.aiChat as unknown as Record<
            string,
            unknown
        >;
        Object.defineProperty(driver, 'list', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        try {
            const { res } = makeRes();
            await expect(handler(makeReq({}), res)).rejects.toMatchObject({
                statusCode: 501,
            });
        } finally {
            // Drop the own property so the prototype impl shows through again.
            Reflect.deleteProperty(driver, 'list');
        }
    });
});

// ── Video proxy (HMAC-gated) ────────────────────────────────────────

describe('PuterAIController videoProxy', () => {
    const captureProxyHandler = (): ((
        req: Request,
        res: Response,
    ) => Promise<void>) => {
        let handler:
            | ((req: Request, res: Response) => Promise<void>)
            | null = null;
        const router = {
            post: vi.fn(),
            get: vi.fn((path: string, _opts: unknown, h: never) => {
                if (path === '/puterai/video/proxy') {
                    handler = h;
                }
            }),
        };
        controller.registerRoutes(router as never);
        if (!handler)
            throw new Error('did not capture /puterai/video/proxy handler');
        return handler;
    };

    it('rejects requests with an invalid fileId character', async () => {
        const handler = captureProxyHandler();
        const { res, captured } = makeRes();
        await handler(
            makeReq({
                query: {
                    fileId: 'has spaces!',
                    expires: '9999999999',
                    signature: 'abc',
                },
            }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('rejects requests missing expires/signature with 403', async () => {
        const handler = captureProxyHandler();
        const { res, captured } = makeRes();
        await handler(makeReq({ query: { fileId: 'abc' } }), res);
        expect(captured.statusCode).toBe(403);
    });

    it('rejects expired signatures with 403', async () => {
        const handler = captureProxyHandler();
        const { res, captured } = makeRes();
        await handler(
            makeReq({
                query: {
                    fileId: 'abc',
                    expires: '1',
                    signature: '00',
                },
            }),
            res,
        );
        expect(captured.statusCode).toBe(403);
    });

    it('rejects an invalid signature with 403 once expiry/format checks pass', async () => {
        const handler = captureProxyHandler();
        // The default test config provides a signature secret, so a
        // bogus signature with a future expiry should reach the
        // timingSafeEqual gate and fail with 403. (The secret-missing
        // 500 branch is unreachable when running against the default
        // wired config.)
        const { res, captured } = makeRes();
        await handler(
            makeReq({
                query: {
                    fileId: 'abc',
                    expires: String(Math.floor(Date.now() / 1000) + 60),
                    signature: 'deadbeef',
                },
            }),
            res,
        );
        expect(captured.statusCode).toBe(403);
    });

    it('500s when url_signature_secret is not configured', async () => {
        // Temporarily blank the secret so the controller hits the
        // 500 branch instead of the constant-time-compare gate.
        const cfg = (controller as unknown as { config: Record<string, unknown> })
            .config;
        const orig = cfg.url_signature_secret;
        cfg.url_signature_secret = undefined;
        try {
            const handler = captureProxyHandler();
            const { res, captured } = makeRes();
            await handler(
                makeReq({
                    query: {
                        fileId: 'abc',
                        expires: String(Math.floor(Date.now() / 1000) + 60),
                        signature: 'deadbeef',
                    },
                }),
                res,
            );
            expect(captured.statusCode).toBe(500);
        } finally {
            cfg.url_signature_secret = orig;
        }
    });

    it('rejects unsupported providers with 400 after passing the HMAC gate', async () => {
        // Hit the post-signature `provider !== 'gemini'` branch by
        // computing a valid signature for a known fileId/expires combo
        // and then sending a different provider in the query.
        const cfg = (controller as unknown as { config: Record<string, unknown> })
            .config;
        const secret = cfg.url_signature_secret as string;
        const fileId = 'abc-123';
        const expires = String(Math.floor(Date.now() / 1000) + 60);
        const crypto = await import('node:crypto');
        const signature = crypto
            .createHash('sha256')
            .update(`${fileId}/video-proxy/${secret}/${expires}`)
            .digest('hex');

        const handler = captureProxyHandler();
        const { res, captured } = makeRes();
        await handler(
            makeReq({
                query: {
                    fileId,
                    expires,
                    signature,
                    provider: 'not-gemini',
                },
            }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('500s when provider=gemini but no Gemini API key is configured', async () => {
        const cfg = (controller as unknown as {
            config: Record<string, unknown> & {
                providers?: Record<string, Record<string, unknown> | undefined>;
            };
        }).config;
        const secret = cfg.url_signature_secret as string;
        const fileId = 'gemini-no-key';
        const expires = String(Math.floor(Date.now() / 1000) + 60);
        const crypto = await import('node:crypto');
        const signature = crypto
            .createHash('sha256')
            .update(`${fileId}/video-proxy/${secret}/${expires}`)
            .digest('hex');

        const origProviders = cfg.providers;
        // Wipe out the gemini-video-generation key for the call.
        cfg.providers = { ...(origProviders ?? {}) };
        delete cfg.providers['gemini-video-generation'];

        try {
            const handler = captureProxyHandler();
            const { res, captured } = makeRes();
            await handler(
                makeReq({
                    query: {
                        fileId,
                        expires,
                        signature,
                        provider: 'gemini',
                    },
                }),
                res,
            );
            expect(captured.statusCode).toBe(500);
        } finally {
            cfg.providers = origProviders;
        }
    });
});

// ── /openai/v1/completions streaming ────────────────────────────────

describe('PuterAIController.openaiCompletions streaming + edges', () => {
    it('streams text-completion deltas and a final [DONE] for stream=true', async () => {
        // Mirror the chat-completions streaming test but on the legacy
        // /v1/completions endpoint, which emits `text_completion` chunks.
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: ndjsonStreamFrom([
                { type: 'text', text: 'foo' },
                { type: 'text', text: 'bar' },
                {
                    type: 'usage',
                    usage: { prompt_tokens: 1, completion_tokens: 2 },
                },
            ]),
        });

        const { res, captured } = makeRes();
        await controller.openaiCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    prompt: 'hi',
                    stream: true,
                },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        expect(out).toContain('"text":"foo"');
        expect(out).toContain('"text":"bar"');
        expect(out).toContain('"finish_reason":"stop"');
        expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
        expect(captured.ended).toBe(true);
    });

    it('emits a stream_error event then [DONE] when the upstream stream errors', async () => {
        // pipeNdjsonStream forwards source errors to `onError`, which
        // writes a JSON error block + [DONE]. Build a Readable that
        // synchronously emits 'error' to exercise that branch.
        const errStream = new Readable({
            read() {
                this.emit('error', new Error('upstream blew'));
            },
        });
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: errStream as unknown as NodeJS.ReadableStream,
        });

        const { res, captured } = makeRes();
        await controller.openaiCompletions(
            makeReq({
                body: {
                    model: 'gpt-test',
                    prompt: 'hi',
                    stream: true,
                },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        expect(out).toContain('"stream_error"');
        expect(out).toContain('upstream blew');
        expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
    });

    it('rejects a multi-item prompt array with 400 via getPromptText', async () => {
        const { res } = makeRes();
        await expect(
            controller.openaiCompletions(
                makeReq({
                    body: {
                        model: 'gpt-test',
                        prompt: ['a', 'b'],
                    },
                    actor: makeUserActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('accepts a single-item string prompt array', async () => {
        // getPromptText special-cases a 1-element array → uses the item.
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
        });
        const { res } = makeRes();
        await controller.openaiCompletions(
            makeReq({
                body: { model: 'gpt-test', prompt: ['just one'] },
                actor: makeUserActor(),
            }),
            res,
        );
        expect(completeSpy.mock.calls[0]![0].messages[0]).toEqual({
            role: 'user',
            content: 'just one',
        });
    });
});

// ── /openai/v1/responses streaming ──────────────────────────────────

describe('PuterAIController.openaiResponses streaming + edges', () => {
    it('emits response.created → output_text deltas → response.completed for a text stream', async () => {
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: ndjsonStreamFrom([
                { type: 'text', text: 'he' },
                { type: 'text', text: 'llo' },
                {
                    type: 'usage',
                    usage: { prompt_tokens: 2, completion_tokens: 3 },
                },
            ]),
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: { model: 'gpt-test', input: 'hi', stream: true },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        // Each SSE frame is `event: <type>\ndata: {...}\n\n`. Smoke-check
        // that the key event types fired in the right order.
        const firstCreated = out.indexOf('event: response.created');
        const firstItemAdded = out.indexOf('event: response.output_item.added');
        const firstDelta = out.indexOf('event: response.output_text.delta');
        const completed = out.indexOf('event: response.completed');
        expect(firstCreated).toBeGreaterThanOrEqual(0);
        expect(firstItemAdded).toBeGreaterThan(firstCreated);
        expect(firstDelta).toBeGreaterThan(firstItemAdded);
        expect(completed).toBeGreaterThan(firstDelta);
        expect(out).toContain('"delta":"he"');
        expect(out).toContain('"delta":"llo"');
        expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
    });

    it('emits function_call events for tool_use in a stream', async () => {
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: ndjsonStreamFrom([
                {
                    type: 'tool_use',
                    id: 'call_42',
                    name: 'lookup',
                    input: { q: 'puter' },
                },
            ]),
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: { model: 'gpt-test', input: 'tool me', stream: true },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        expect(out).toContain('"type":"function_call"');
        expect(out).toContain('event: response.function_call_arguments.delta');
        expect(out).toContain('event: response.function_call_arguments.done');
        expect(out).toContain('"call_id":"call_42"');
        expect(out).toContain('"name":"lookup"');
    });

    it('emits a `response.error`-shaped SSE frame when the source stream errors', async () => {
        const errStream = new Readable({
            read() {
                this.emit('error', new Error('responses upstream broke'));
            },
        });
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: errStream as unknown as NodeJS.ReadableStream,
        });

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: { model: 'gpt-test', input: 'hi', stream: true },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        expect(out).toContain('event: error');
        expect(out).toContain('responses upstream broke');
        expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
    });

    it('translates function_call_output items in `input` into role=tool messages', async () => {
        // Exercises responseInputToMessages' function_call_output branch.
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ack' },
            finish_reason: 'stop',
        });
        await controller.openaiResponses(
            makeReq({
                body: {
                    model: 'gpt-test',
                    input: [
                        {
                            type: 'function_call_output',
                            call_id: 'call_x',
                            output: 'result data',
                        },
                    ],
                },
                actor: makeUserActor(),
            }),
            makeRes().res,
        );
        expect(completeSpy.mock.calls[0]![0].messages).toContainEqual({
            role: 'tool',
            tool_call_id: 'call_x',
            content: 'result data',
        });
    });

    it('translates function_call items in `input` into assistant messages with tool_use parts', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ack' },
            finish_reason: 'stop',
        });
        await controller.openaiResponses(
            makeReq({
                body: {
                    model: 'gpt-test',
                    input: [
                        {
                            type: 'function_call',
                            call_id: 'call_y',
                            id: 'fc_y',
                            name: 'tool_y',
                            arguments: '{"a":1}',
                        },
                    ],
                },
                actor: makeUserActor(),
            }),
            makeRes().res,
        );
        const msgs = completeSpy.mock.calls[0]![0].messages as Array<{
            role: string;
            content: unknown;
        }>;
        const assistant = msgs.find((m) => m.role === 'assistant');
        expect(assistant).toBeTruthy();
        expect(assistant!.content).toEqual([
            expect.objectContaining({
                type: 'tool_use',
                id: 'call_y',
                canonical_id: 'fc_y',
                name: 'tool_y',
                input: { a: 1 },
            }),
        ]);
    });

    it("maps the 'developer' role in input messages to 'system'", async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'k' },
            finish_reason: 'stop',
        });
        await controller.openaiResponses(
            makeReq({
                body: {
                    model: 'gpt-test',
                    input: [{ role: 'developer', content: 'be helpful' }],
                },
                actor: makeUserActor(),
            }),
            makeRes().res,
        );
        const msgs = completeSpy.mock.calls[0]![0].messages as Array<{
            role: string;
        }>;
        expect(msgs.some((m) => m.role === 'system')).toBe(true);
        expect(msgs.some((m) => m.role === 'developer')).toBe(false);
    });

    it("rejects when `input` isn't a string or array (400)", async () => {
        await expect(
            controller.openaiResponses(
                makeReq({
                    body: { model: 'gpt-test', input: { not: 'valid' } },
                    actor: makeUserActor(),
                }),
                makeRes().res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── /anthropic/v1/messages streaming ────────────────────────────────

describe('PuterAIController.anthropicMessages streaming + helpers', () => {
    it('emits message_start → content_block_delta → message_stop for a text stream', async () => {
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: ndjsonStreamFrom([
                { type: 'text', text: 'one' },
                { type: 'text', text: 'two' },
            ]),
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    stream: true,
                },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        // Anthropic uses `event: <type>\ndata: ...\n\n` per SSE frame.
        const start = out.indexOf('event: message_start');
        const blockStart = out.indexOf('event: content_block_start');
        const delta = out.indexOf('event: content_block_delta');
        const stop = out.indexOf('event: message_stop');
        expect(start).toBeGreaterThanOrEqual(0);
        expect(blockStart).toBeGreaterThan(start);
        expect(delta).toBeGreaterThan(blockStart);
        expect(stop).toBeGreaterThan(delta);
        expect(out).toContain('"text":"one"');
        expect(out).toContain('"text":"two"');
    });

    it('translates a streamed tool_use into content_block_start/delta/stop with type=tool_use', async () => {
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: ndjsonStreamFrom([
                {
                    type: 'tool_use',
                    id: 'tu_1',
                    name: 'lookup',
                    input: { q: 'x' },
                },
            ]),
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'tool me' }],
                    stream: true,
                },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        expect(out).toContain('"type":"tool_use"');
        expect(out).toContain('"id":"tu_1"');
        expect(out).toContain('"name":"lookup"');
        // Stop reason becomes tool_use when sawToolCalls flips true.
        expect(out).toContain('"stop_reason":"tool_use"');
    });

    it('emits an Anthropic-shaped error event when the upstream stream errors', async () => {
        const errStream = new Readable({
            read() {
                this.emit('error', new Error('claude died'));
            },
        });
        stubChatComplete({
            dataType: 'stream',
            content_type: 'application/x-ndjson',
            stream: errStream as unknown as NodeJS.ReadableStream,
        });

        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    stream: true,
                },
                actor: makeUserActor(),
            }),
            res,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        const out = captured.written.join('');
        expect(out).toContain('event: error');
        expect(out).toContain('"type":"api_error"');
        expect(out).toContain('claude died');
        expect(captured.ended).toBe(true);
    });

    it('joins an array `system` into a single system-role message', async () => {
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
        });
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    system: [
                        { type: 'text', text: 'first' },
                        { type: 'text', text: 'second' },
                    ],
                    messages: [{ role: 'user', content: 'hi' }],
                },
                actor: makeUserActor(),
            }),
            makeRes().res,
        );
        const msgs = completeSpy.mock.calls[0]![0].messages as Array<{
            role: string;
            content: unknown;
        }>;
        expect(msgs[0]).toEqual({
            role: 'system',
            content: 'first\nsecond',
        });
    });

    it('hoists Anthropic tool_result content parts into a role=tool message', async () => {
        // normalizeAnthropicMessages should split `user` messages whose
        // content has tool_result parts into a separate role=tool entry
        // with the joined content text.
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'thanks' },
            finish_reason: 'stop',
        });
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'tool_result',
                                    tool_use_id: 'tu_42',
                                    content: [
                                        { type: 'text', text: 'result-text' },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                actor: makeUserActor(),
            }),
            makeRes().res,
        );
        const msgs = completeSpy.mock.calls[0]![0].messages as Array<{
            role: string;
            tool_call_id?: string;
            content: unknown;
        }>;
        const toolMsg = msgs.find((m) => m.role === 'tool');
        expect(toolMsg).toBeTruthy();
        expect(toolMsg!.tool_call_id).toBe('tu_42');
        expect(toolMsg!.content).toBe('result-text');
    });

    it('normalizes shorthand Anthropic tools (name + input_schema) into the openai function shape', async () => {
        // normalizeAnthropicTools should wrap a tool spec lacking
        // `type: 'function'` into the canonical shape the chat driver
        // expects.
        const completeSpy = stubChatComplete({
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
        });
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    tools: [
                        {
                            name: 'lookup',
                            description: 'find things',
                            input_schema: {
                                type: 'object',
                                properties: { q: { type: 'string' } },
                            },
                        },
                    ],
                },
                actor: makeUserActor(),
            }),
            makeRes().res,
        );
        const tools = completeSpy.mock.calls[0]![0].tools as Array<{
            type: string;
            function: { name: string; description: string; parameters: unknown };
        }>;
        expect(tools[0]?.type).toBe('function');
        expect(tools[0]?.function.name).toBe('lookup');
        expect(tools[0]?.function.description).toBe('find things');
        expect(tools[0]?.function.parameters).toMatchObject({
            type: 'object',
        });
    });

    it('returns an empty-text content block when the assistant produced no content', async () => {
        // Non-stream branch: contentBlocks fallback when no text and no
        // tool_calls — driver returns an empty message.
        stubChatComplete({
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
        });
        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
                actor: makeUserActor(),
            }),
            res,
        );
        const body = captured.body as { content: Array<{ text: string }> };
        expect(body.content).toEqual([{ type: 'text', text: '' }]);
    });

    it('extracts text from an array-shaped `content` (extractTextContent array path)', async () => {
        // When the driver returns content as an array of parts, the
        // Anthropic shim joins the .text fields back into a single
        // plain-text content block.
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'hello ' },
                    { type: 'text', text: 'world' },
                ],
            },
            finish_reason: 'stop',
        });
        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
                actor: makeUserActor(),
            }),
            res,
        );
        const body = captured.body as { content: Array<{ text: string }> };
        expect(body.content).toEqual([
            { type: 'text', text: 'hello world' },
        ]);
    });

    it('reads tool_use blocks from message.content (not just message.tool_calls)', async () => {
        // extractToolUseBlocks reads BOTH `tool_calls` and content-array
        // tool_use parts; this exercises the latter path.
        stubChatComplete({
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tu_99',
                        name: 'lookup',
                        input: '{"q":"x"}',
                    },
                ],
            },
            finish_reason: 'tool_calls',
        });
        const { res, captured } = makeRes();
        await controller.anthropicMessages(
            makeReq({
                body: {
                    model: 'claude-test',
                    messages: [{ role: 'user', content: 'hi' }],
                },
                actor: makeUserActor(),
            }),
            res,
        );
        const body = captured.body as {
            content: Array<Record<string, unknown>>;
            stop_reason: string;
        };
        expect(body.stop_reason).toBe('tool_use');
        expect(body.content).toContainEqual({
            type: 'tool_use',
            id: 'tu_99',
            name: 'lookup',
            input: { q: 'x' },
        });
    });
});

// ── Model details listing ───────────────────────────────────────────

describe('PuterAIController model details', () => {
    const captureGetHandler = (
        path: string,
    ): ((req: Request, res: Response) => Promise<void>) => {
        let handler:
            | ((req: Request, res: Response) => Promise<void>)
            | null = null;
        const router = {
            post: vi.fn(),
            get: vi.fn((p: string, _opts: unknown, h: never) => {
                if (p === path) handler = h;
            }),
        };
        controller.registerRoutes(router as never);
        if (!handler) throw new Error(`did not capture ${path} handler`);
        return handler;
    };

    it('filters hidden ids out of /chat/models/details', async () => {
        const handler = captureGetHandler('/puterai/chat/models/details');
        vi.spyOn(server.drivers.aiChat, 'models').mockResolvedValueOnce([
            { id: 'gpt-test' },
            { id: 'fake' }, // hidden
            { id: 'abuse' }, // hidden
            { id: 'gpt-other' },
        ] as never);

        const { res, captured } = makeRes();
        await handler(makeReq({}), res);
        const body = captured.body as { models: Array<{ id: string }> };
        expect(body.models.map((m) => m.id)).toEqual(['gpt-test', 'gpt-other']);
    });

    it('501s when the driver lacks .models()', async () => {
        const handler = captureGetHandler('/puterai/chat/models/details');
        const driver = server.drivers.aiChat as unknown as Record<
            string,
            unknown
        >;
        Object.defineProperty(driver, 'models', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        try {
            const { res } = makeRes();
            await expect(handler(makeReq({}), res)).rejects.toMatchObject({
                statusCode: 501,
            });
        } finally {
            Reflect.deleteProperty(driver, 'models');
        }
    });
});
