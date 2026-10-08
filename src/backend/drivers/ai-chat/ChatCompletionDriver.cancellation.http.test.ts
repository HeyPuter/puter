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
    let onRequest: (res: ServerResponse) => void;

    beforeAll(async () => {
        upstream = createServer((req, res) => {
            if (req.url === '/api/tags') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ models: [{ name: 'cancel-test' }] }));
                return;
            }
            req.resume();
            req.once('end', () => onRequest(res));
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

    it.each(
        routes.flatMap((route) =>
            [false, true].map((stream) => ({ route, stream })),
        ),
    )(
        'cancels upstream while waiting for headers: $route (stream=$stream)',
        async ({ route, stream }) => {
            let upstreamClosed = false;
            let received!: () => void;
            const ready = new Promise<void>((resolve) => {
                received = resolve;
            });
            onRequest = (res) => {
                res.once('close', () => {
                    upstreamClosed = true;
                });
                received();
            };
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
                expect(
                    await env.server.services.metering.getOutstandingHolds(
                        actor,
                    ),
                ).toBeGreaterThan(0);
                abort.abort();
                expect(await request).toMatchObject({ name: 'AbortError' });
                await expect.poll(() => upstreamClosed).toBe(true);
                await expect
                    .poll(() =>
                        env.server.services.metering.getOutstandingHolds(actor),
                    )
                    .toBe(0);
            } finally {
                abort.abort();
                upstream.closeAllConnections();
            }
        },
    );

    it.each(routes)(
        'cancels an idle upstream after partial output: %s',
        async (route) => {
            let upstreamClosed = false;
            onRequest = (res) => {
                res.once('close', () => {
                    upstreamClosed = true;
                });
                writeText(res);
            };
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
                await expect.poll(() => upstreamClosed).toBe(true);
                await expect
                    .poll(() =>
                        env.server.services.metering.getOutstandingHolds(actor),
                    )
                    .toBe(0);
            } finally {
                abort.abort();
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
