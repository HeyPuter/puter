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
 * The chat / image / video drivers are stubbed at the constructor
 * boundary so the controller never touches real provider code or the
 * network. Tests exercise the OpenAI-, Anthropic-, and Responses-
 * compatible HTTP shells: route registration, request validation,
 * actor gating (app-actors are forbidden), driver delegation, response
 * shaping (non-stream and SSE), error responses, and the model-listing
 * endpoints.
 *
 * End-to-end coverage that needs the live driver wiring belongs in a
 * future *.integration.test.ts harness.
 */

import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import type { Actor } from '../../core/actor.js';
import type { ChatCompletionDriver } from '../../drivers/ai-chat/ChatCompletionDriver.js';
import { PuterAIController } from './PuterAIController.js';

// ── Driver / route stubs ────────────────────────────────────────────

type CompleteFn = MockInstance<ChatCompletionDriver['complete']>;

const makeStubDriver = (overrides: {
    list?: () => Promise<string[]>;
    models?: () => Promise<Array<{ id: string }>>;
} = {}) => {
    const complete = vi.fn() as CompleteFn;
    return {
        complete,
        list: overrides.list,
        models: overrides.models,
    };
};

const makeController = (params: {
    chatDriver?: ReturnType<typeof makeStubDriver>;
    imageDriver?: { list?: () => Promise<string[]>; models?: () => Promise<Array<{ id: string }>> };
    videoDriver?: { list?: () => Promise<string[]>; models?: () => Promise<Array<{ id: string }>> };
    config?: Record<string, unknown>;
} = {}) => {
    const chatDriver = params.chatDriver ?? makeStubDriver();
    const drivers = {
        aiChat: chatDriver,
        ...(params.imageDriver ? { aiImage: params.imageDriver } : {}),
        ...(params.videoDriver ? { aiVideo: params.videoDriver } : {}),
    };
    // PuterController's constructor expects all four DI bags. We only
    // need `drivers` for these tests — the rest can be empty stand-ins.
    const controller = new PuterAIController(
        (params.config ?? {}) as never,
        {} as never,
        {} as never,
        {} as never,
        drivers as never,
    );
    return { controller, chatDriver };
};

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

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Route registration ──────────────────────────────────────────────

describe('PuterAIController.registerRoutes', () => {
    it('registers all OpenAI-/Anthropic-/Responses-compatible routes plus model listing and video proxy', () => {
        const { controller } = makeController();

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

        // Auth-gated routes use { subdomain: 'api', requireAuth: true }.
        const chatRoute = calls.find(
            (c) => c.path === '/puterai/openai/v1/chat/completions',
        );
        expect(chatRoute?.opts).toEqual({
            subdomain: 'api',
            requireAuth: true,
        });
        // Model listing routes are public.
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
        const { controller } = makeController();
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
        const { controller } = makeController();
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

    it('500s when the chat driver is not registered', async () => {
        // Build a controller with no aiChat driver wired in.
        const controller = new PuterAIController(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const { res } = makeRes();
        await expect(
            controller.openaiChatCompletions(
                makeReq({
                    body: {
                        messages: [{ role: 'user', content: 'hi' }],
                        model: 'gpt-test',
                    },
                    actor: makeUserActor(),
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 500 });
    });

    it('shapes a non-stream completion as an OpenAI chat.completion response', async () => {
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
            message: { role: 'assistant', content: 'hi there' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 4, completion_tokens: 2 },
        } as never);

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
        expect(chatDriver.complete).toHaveBeenCalledTimes(1);
        const completeArgs = chatDriver.complete.mock.calls[0]![0];
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
        expect((body.choices as Array<Record<string, unknown>>)[0]).toMatchObject({
            index: 0,
            message: { role: 'assistant', content: 'hi there' },
            finish_reason: 'stop',
        });
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
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
            // The controller's expectStream() helper checks for the
            // DriverStreamResult discriminant via isDriverStreamResult.
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
        } as never);

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
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
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
        } as never);

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
        const { controller } = makeController();
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
        const { controller } = makeController();
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
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
            message: { role: 'assistant', content: 'response' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        } as never);

        const { res, captured } = makeRes();
        await controller.openaiCompletions(
            makeReq({
                body: { model: 'gpt-test', prompt: 'hello there' },
                actor: makeUserActor(),
            }),
            res,
        );

        const completeArgs = chatDriver.complete.mock.calls[0]![0];
        // The legacy /v1/completions endpoint is reshaped into a single
        // user-role chat message before being dispatched.
        expect(completeArgs.messages).toEqual([
            { role: 'user', content: 'hello there' },
        ]);

        const body = captured.body as Record<string, unknown>;
        expect(body.object).toBe('text_completion');
        expect((body.choices as Array<Record<string, unknown>>)[0]).toMatchObject({
            text: 'response',
            index: 0,
            finish_reason: 'stop',
        });
        expect((body.id as string).startsWith('cmpl-')).toBe(true);
    });
});

// ── /openai/v1/responses ────────────────────────────────────────────

describe('PuterAIController.openaiResponses', () => {
    it('rejects app actors with HttpError 403', async () => {
        const { controller } = makeController();
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
        const { controller } = makeController();
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
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
            message: { role: 'assistant', content: 'final answer' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 5, completion_tokens: 3 },
        } as never);

        const { res, captured } = makeRes();
        await controller.openaiResponses(
            makeReq({
                body: { model: 'gpt-test', input: 'hi', instructions: 'be brief' },
                actor: makeUserActor(),
            }),
            res,
        );

        const completeArgs = chatDriver.complete.mock.calls[0]![0];
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
        const { controller } = makeController();
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
        const { controller } = makeController();
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
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
            message: { role: 'assistant', content: 'hi there' },
            finish_reason: 'stop',
            usage: { prompt_tokens: 4, completion_tokens: 2 },
        } as never);

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

        const completeArgs = chatDriver.complete.mock.calls[0]![0];
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
        const { controller, chatDriver } = makeController();
        chatDriver.complete.mockResolvedValueOnce({
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
        } as never);

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
    it('exposes #listModels via /puterai/chat/models, filtering hidden ids', () => {
        const chatDriver = makeStubDriver({
            list: async () => [
                'gpt-test',
                'fake', // HIDDEN — should be filtered.
                'abuse', // HIDDEN.
                'gpt-other',
            ],
        });
        const { controller } = makeController({ chatDriver });

        // registerRoutes hands the closure to the router. Capture it.
        let listHandler: ((req: Request, res: Response) => Promise<void>) | null = null;
        const router = {
            post: vi.fn(),
            get: vi.fn((path: string, _opts: unknown, handler: never) => {
                if (path === '/puterai/chat/models') {
                    listHandler = handler;
                }
            }),
        };
        controller.registerRoutes(router as never);
        expect(listHandler).not.toBeNull();

        return (async () => {
            const { res, captured } = makeRes();
            await listHandler!(makeReq({}), res);
            expect(captured.body).toEqual({
                models: ['gpt-test', 'gpt-other'],
            });
        })();
    });

    it('501s when the driver does not implement list()', () => {
        const chatDriver = makeStubDriver(); // no list()
        const { controller } = makeController({ chatDriver });

        let listHandler: ((req: Request, res: Response) => Promise<void>) | null = null;
        const router = {
            post: vi.fn(),
            get: vi.fn((path: string, _opts: unknown, handler: never) => {
                if (path === '/puterai/chat/models') {
                    listHandler = handler;
                }
            }),
        };
        controller.registerRoutes(router as never);

        return (async () => {
            const { res } = makeRes();
            await expect(listHandler!(makeReq({}), res)).rejects.toMatchObject({
                statusCode: 501,
            });
        })();
    });
});

// ── Video proxy (HMAC-gated) ────────────────────────────────────────

describe('PuterAIController videoProxy', () => {
    const captureProxyHandler = (
        controller: PuterAIController,
    ): ((req: Request, res: Response) => Promise<void>) => {
        let handler: ((req: Request, res: Response) => Promise<void>) | null =
            null;
        const router = {
            post: vi.fn(),
            get: vi.fn(
                (path: string, _opts: unknown, h: never) => {
                    if (path === '/puterai/video/proxy') {
                        handler = h;
                    }
                },
            ),
        };
        controller.registerRoutes(router as never);
        if (!handler)
            throw new Error('did not capture /puterai/video/proxy handler');
        return handler;
    };

    it('rejects requests with an invalid fileId character', async () => {
        const { controller } = makeController();
        const handler = captureProxyHandler(controller);
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
        const { controller } = makeController();
        const handler = captureProxyHandler(controller);
        const { res, captured } = makeRes();
        await handler(
            makeReq({ query: { fileId: 'abc' } }),
            res,
        );
        expect(captured.statusCode).toBe(403);
    });

    it('rejects expired signatures with 403', async () => {
        const { controller } = makeController();
        const handler = captureProxyHandler(controller);
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

    it('500s when the URL signature secret is not configured', async () => {
        // Default config has no url_signature_secret.
        const { controller } = makeController();
        const handler = captureProxyHandler(controller);
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
    });
});
