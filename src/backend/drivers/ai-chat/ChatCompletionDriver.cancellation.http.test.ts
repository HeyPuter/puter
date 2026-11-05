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

import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

const routes = [
    '/drivers/call',
    '/puterai/openai/v1/chat/completions',
    '/puterai/openai/v1/completions',
    '/puterai/openai/v1/responses',
    '/puterai/anthropic/v1/messages',
];

describe('chat cancellation over HTTP', () => {
    let upstream: Server;
    let env: PuterTestEnv;
    let restoreFetch: () => void;
    let actor: Actor;
    let onRequest: (res: ServerResponse, body: string) => void;

    beforeAll(async () => {
        upstream = createServer((req, res) => {
            if (req.url === '/api/tags') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ models: [{ name: 'cancel-test' }] }));
                return;
            }
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (chunk: string) => {
                body += chunk;
            });
            req.once('end', () => onRequest(res, body));
        });
        await new Promise<void>((resolve) =>
            upstream.listen(0, '127.0.0.1', resolve),
        );
        const port = (upstream.address() as { port: number }).port;
        const realFetch = globalThis.fetch;
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation((input, init) => {
                const url = new URL(
                    input instanceof Request ? input.url : String(input),
                );
                if (url.hostname === 'api.openai.com') {
                    url.protocol = 'http:';
                    url.host = `127.0.0.1:${port}`;
                    return realFetch(
                        input instanceof Request
                            ? new Request(url, input)
                            : url,
                        init,
                    );
                }
                return realFetch(input, init);
            });
        restoreFetch = () => fetchSpy.mockRestore();
        env = await setupPuterTestEnv({
            providers: {
                ollama: { apiBaseUrl: `http://127.0.0.1:${port}` },
                'openai-completion': { apiKey: 'local-test-key' },
            },
            meteringEnforcement: { subscriptions: false },
        } as never);
        const user = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        actor = makeActor({ user: user! });
        await vi.waitFor(async () => {
            expect(
                (await env.server.drivers.aiChat.models()).some(
                    (model) => model.id === 'ollama:ollama/cancel-test',
                ),
            ).toBe(true);
        });
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
        restoreFetch?.();
        upstream?.closeAllConnections();
        if (upstream)
            await new Promise<void>((resolve) =>
                upstream.close(() => resolve()),
            );
    });

    const call = (route: string, signal?: AbortSignal, stream = true) => {
        const args = {
            model: route.endsWith('/responses')
                ? 'gpt-6.1-sol'
                : 'ollama:ollama/cancel-test',
            stream,
            ...(route.endsWith('/responses')
                ? { input: 'hi', max_output_tokens: 16 }
                : {
                      messages: [{ role: 'user', content: 'hi' }],
                      prompt: 'hi',
                      max_tokens: 16,
                  }),
        };
        return fetch(new URL(route, env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.users.user.apiToken}`,
                Origin: env.apiOrigin,
            },
            body: JSON.stringify(
                route === '/drivers/call'
                    ? {
                          interface: 'puter-chat-completion',
                          service: 'ai-chat',
                          method: 'complete',
                          args,
                      }
                    : args,
            ),
            signal,
        });
    };

    const writeText = (res: ServerResponse) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(
            `data: ${JSON.stringify(res.req.url === '/v1/responses' ? { type: 'response.output_text.delta', delta: 'partial' } : { choices: [{ delta: { content: 'partial' } }] })}\n\n`,
        );
    };

    const usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 };
    const responsesUsage = {
        input_tokens: 3,
        output_tokens: 5,
        total_tokens: 8,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
    };
    const response = {
        id: 'resp_1',
        object: 'response',
        status: 'completed',
        output: [
            {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [
                    { type: 'output_text', text: 'done', annotations: [] },
                ],
            },
        ],
        usage: responsesUsage,
    };
    const sse = (events: unknown[]) =>
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

    /**
     * A complete upstream answer, with usage, in the shape the request asked
     * for.
     */
    const finishAnswer = (res: ServerResponse, body: string) => {
        const stream = (JSON.parse(body) as { stream?: boolean }).stream;
        const responses = res.req.url === '/v1/responses';
        if (!stream) {
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify(
                    responses
                        ? response
                        : {
                              id: 'chatcmpl_1',
                              object: 'chat.completion',
                              created: 0,
                              model: 'cancel-test',
                              choices: [
                                  {
                                      index: 0,
                                      message: {
                                          role: 'assistant',
                                          content: 'done',
                                      },
                                      finish_reason: 'stop',
                                  },
                              ],
                              usage,
                          },
                ),
            );
            return;
        }
        if (!res.headersSent)
            res.setHeader('Content-Type', 'text/event-stream');
        res.end(
            responses
                ? sse([
                      { type: 'response.output_text.delta', delta: 'done' },
                      { type: 'response.completed', response },
                  ])
                : `${sse([
                      {
                          id: 'chatcmpl_1',
                          object: 'chat.completion.chunk',
                          choices: [
                              {
                                  index: 0,
                                  delta: { content: 'done' },
                                  finish_reason: 'stop',
                              },
                          ],
                      },
                      {
                          id: 'chatcmpl_1',
                          object: 'chat.completion.chunk',
                          choices: [],
                          usage,
                      },
                  ])}data: [DONE]\n\n`,
        );
    };

    /**
     * Whether a usage entry the upstream reported, not an estimate, was
     * recorded.
     */
    const meteredReportedUsage = (spy: ReturnType<typeof vi.spyOn>) =>
        spy.mock.calls
            .flatMap((call) => (call[1] as { usageType: string }[]) ?? [])
            .some(
                (u) =>
                    !u.usageType.includes('estimated_') &&
                    /completion|output_tokens/.test(u.usageType),
            );

    it.each(
        routes.flatMap((route) =>
            [false, true].map((stream) => ({ route, stream })),
        ),
    )(
        'bills an upstream the caller left while waiting for headers: $route (stream=$stream)',
        async ({ route, stream }) => {
            let upstreamRes!: ServerResponse;
            let upstreamBody = '';
            let upstreamClosedEarly = false;
            let received!: () => void;
            const ready = new Promise<void>((resolve) => {
                received = resolve;
            });
            onRequest = (res, body) => {
                upstreamRes = res;
                upstreamBody = body;
                res.once('close', () => {
                    if (!res.writableFinished) upstreamClosedEarly = true;
                });
                received();
            };
            const metered = vi.spyOn(
                env.server.services.metering,
                'batchIncrementUsages',
            );
            const abort = new AbortController();
            const request = call(route, abort.signal, stream).catch(
                (error: unknown) => error,
            );
            try {
                await Promise.race([
                    ready,
                    request.then(async (result) => {
                        throw new Error(
                            result instanceof Response
                                ? await result.text()
                                : String(result),
                        );
                    }),
                ]);
                abort.abort();
                expect(await request).toMatchObject({ name: 'AbortError' });
                await new Promise((resolve) => setTimeout(resolve, 100));
                expect(upstreamClosedEarly).toBe(false);
                expect(
                    await env.server.services.metering.getOutstandingHolds(
                        actor,
                    ),
                ).toBeGreaterThan(0);

                finishAnswer(upstreamRes, upstreamBody);
                await expect
                    .poll(() =>
                        env.server.services.metering.getOutstandingHolds(actor),
                    )
                    .toBe(0);
                expect(upstreamClosedEarly).toBe(false);
                expect(meteredReportedUsage(metered)).toBe(true);
            } finally {
                abort.abort();
                metered.mockRestore();
                upstream.closeAllConnections();
            }
        },
    );

    it.each(routes)(
        'bills an upstream the caller left after partial output: %s',
        async (route) => {
            let upstreamRes!: ServerResponse;
            let upstreamBody = '';
            let upstreamClosedEarly = false;
            onRequest = (res, body) => {
                upstreamRes = res;
                upstreamBody = body;
                res.once('close', () => {
                    if (!res.writableFinished) upstreamClosedEarly = true;
                });
                writeText(res);
            };
            const metered = vi.spyOn(
                env.server.services.metering,
                'batchIncrementUsages',
            );
            const abort = new AbortController();
            try {
                const response = await call(route, abort.signal);
                if (response.status !== 200)
                    throw new Error(await response.text());
                const reader = response.body!.getReader();
                let text = '';
                while (!text.includes('partial')) {
                    const chunk = await reader.read();
                    expect(chunk.done).toBe(false);
                    text += new TextDecoder().decode(chunk.value);
                }
                abort.abort();
                await new Promise((resolve) => setTimeout(resolve, 100));
                expect(upstreamClosedEarly).toBe(false);

                finishAnswer(upstreamRes, upstreamBody);
                await expect
                    .poll(() =>
                        env.server.services.metering.getOutstandingHolds(actor),
                    )
                    .toBe(0);
                expect(upstreamClosedEarly).toBe(false);
                expect(meteredReportedUsage(metered)).toBe(true);
            } finally {
                abort.abort();
                metered.mockRestore();
                upstream.closeAllConnections();
            }
        },
    );

    it.each(routes.slice(1))(
        'reports mid-stream failure without a successful stop: %s',
        async (route) => {
            onRequest = (res) => {
                writeText(res);
                res.end(
                    `data: ${JSON.stringify({ error: { message: 'upstream interrupted', type: 'server_error' } })}\n\n`,
                );
            };
            const response = await call(route);
            if (response.status !== 200) throw new Error(await response.text());
            const text = await response.text();
            expect(text).toContain('partial');
            expect(text).toContain('upstream interrupted');
            expect(text).not.toContain('"finish_reason":"stop"');
            expect(text).not.toContain('response.completed');
            expect(text).not.toContain('message_stop');
            await expect
                .poll(() =>
                    env.server.services.metering.getOutstandingHolds(actor),
                )
                .toBe(0);
        },
    );
    it.each(routes)(
        'reports an upstream EOF without a terminal event: %s',
        async (route) => {
            // Let the free-tier sliding window reset after the cancellation cases.
            if (route === routes[0])
                await new Promise((resolve) => setTimeout(resolve, 10_100));
            onRequest = (res) => {
                writeText(res);
                res.end();
            };
            const response = await call(route);
            expect(response.status).toBe(200);
            const text = await response.text();
            expect(text).toContain('partial');
            expect(text).toContain('Stream ended before completion');
            expect(text).not.toContain('"finish_reason":"stop"');
            expect(text).not.toContain('response.completed');
            expect(text).not.toContain('message_stop');
            await expect
                .poll(() =>
                    env.server.services.metering.getOutstandingHolds(actor),
                )
                .toBe(0);
        },
        20_000,
    );

    it.each(routes)('reports an upstream socket reset: %s', async (route) => {
        onRequest = (res) => {
            writeText(res);
            setTimeout(() => res.destroy(), 25);
        };
        const response = await call(route);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain('partial');
        expect(text).toContain('"error"');
        expect(text).not.toContain('"finish_reason":"stop"');
        expect(text).not.toContain('response.completed');
        expect(text).not.toContain('message_stop');
        await expect
            .poll(() => env.server.services.metering.getOutstandingHolds(actor))
            .toBe(0);
    });
    it('reports a native Responses failure event', async () => {
        onRequest = (res) => {
            writeText(res);
            res.end(
                `data: ${JSON.stringify({
                    type: 'response.failed',
                    response: {
                        status: 'failed',
                        error: { message: 'upstream failed' },
                    },
                })}\n\n`,
            );
        };
        const response = await call('/puterai/openai/v1/responses');
        const text = await response.text();
        expect(text).toContain('upstream failed');
        expect(text).not.toContain('response.completed');
    });
});
