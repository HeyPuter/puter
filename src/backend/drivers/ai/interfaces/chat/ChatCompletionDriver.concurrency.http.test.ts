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
import { setupPuterTestEnv, type PuterTestEnv } from '../../../../testUtil.js';

/**
 * A completion runs on to its usage report after the caller hangs up, so it
 * keeps counting against the caller's concurrency cap until it settles.
 */
describe('chat concurrency over HTTP after the caller hangs up', () => {
    let upstream: Server;
    let env: PuterTestEnv;
    let onRequest: (res: ServerResponse, body: string) => void;

    beforeAll(async () => {
        upstream = createServer((req, res) => {
            if (req.url === '/api/tags') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ models: [{ name: 'slot-test' }] }));
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
        env = await setupPuterTestEnv({
            providers: {
                ollama: { apiBaseUrl: `http://127.0.0.1:${port}` },
            },
            meteringEnforcement: { subscriptions: false },
        } as never);
        await vi.waitFor(async () => {
            expect(
                (await env.server.drivers.aiChat.models()).some(
                    (model) => model.id === 'ollama:ollama/slot-test',
                ),
            ).toBe(true);
        });
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
        upstream?.closeAllConnections();
        if (upstream)
            await new Promise<void>((resolve) =>
                upstream.close(() => resolve()),
            );
    });

    const call = (route: string, stream: boolean, signal?: AbortSignal) => {
        const args = {
            model: 'ollama:ollama/slot-test',
            stream,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 16,
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
                          method: 'complete',
                          args,
                      }
                    : args,
            ),
            signal,
        });
    };

    const usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 };
    const chunk = (delta: object, finish: string | null, extra = {}) =>
        `data: ${JSON.stringify({
            id: 'chatcmpl_1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...extra,
        })}\n\n`;

    const finishAnswer = (res: ServerResponse, body: string) => {
        if (!(JSON.parse(body) as { stream?: boolean }).stream) {
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify({
                    id: 'chatcmpl_1',
                    object: 'chat.completion',
                    created: 0,
                    model: 'slot-test',
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: 'done' },
                            finish_reason: 'stop',
                        },
                    ],
                    usage,
                }),
            );
            return;
        }
        if (!res.headersSent)
            res.setHeader('Content-Type', 'text/event-stream');
        res.end(
            `${chunk({ content: 'done' }, 'stop')}data: ${JSON.stringify({
                id: 'chatcmpl_1',
                object: 'chat.completion.chunk',
                choices: [],
                usage,
            })}\n\ndata: [DONE]\n\n`,
        );
    };

    /** Starts a completion, waits until it is generating, then hangs up. */
    const abandon = async (route: string, stream: boolean) => {
        let received!: () => void;
        const reached = new Promise<void>((resolve) => {
            received = resolve;
        });
        const pending: { res: ServerResponse; body: string }[] = [];
        onRequest = (res, body) => {
            pending.push({ res, body });
            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.write(chunk({ role: 'assistant', content: 'partial' }, null));
            }
            received();
        };
        const abort = new AbortController();
        const request = call(route, stream, abort.signal);
        const outcome = await Promise.race([
            reached.then(() => 'generating' as const),
            request.then((response) => response),
        ]);
        if (outcome !== 'generating') {
            return { refused: outcome, pending };
        }
        if (stream) {
            const response = await request;
            const reader = response.body!.getReader();
            let text = '';
            while (!text.includes('partial')) {
                const { value, done } = await reader.read();
                if (done) break;
                text += new TextDecoder().decode(value);
            }
        }
        abort.abort();
        await request.catch(() => undefined);
        return { refused: undefined, pending };
    };

    it.each([
        { route: '/drivers/call', stream: true },
        { route: '/drivers/call', stream: false },
        { route: '/puterai/openai/v1/chat/completions', stream: true },
        { route: '/puterai/openai/v1/chat/completions', stream: false },
        { route: '/puterai/anthropic/v1/messages', stream: true },
    ])(
        'counts an abandoned completion until it settles: $route (stream=$stream)',
        async ({ route, stream }) => {
            const running: { res: ServerResponse; body: string }[] = [];
            let refused: Response | undefined;
            try {
                for (let i = 0; i < 25 && !refused; i++) {
                    const attempt = await abandon(route, stream);
                    running.push(...attempt.pending);
                    refused = attempt.refused;
                    // Let the server see the hang-up before the next call.
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                expect(refused?.status).toBe(429);
                expect(await refused!.text()).toContain(
                    'Too many concurrent requests',
                );
                expect(running.length).toBeGreaterThan(0);

                for (const { res, body } of running.splice(0))
                    finishAnswer(res, body);
                onRequest = finishAnswer;
                await expect
                    .poll(async () => (await call(route, false)).status, {
                        timeout: 15_000,
                    })
                    .toBe(200);
            } finally {
                for (const { res, body } of running) finishAnswer(res, body);
                upstream.closeAllConnections();
                // The next case starts with a fresh rate-limit window.
                await new Promise((resolve) => setTimeout(resolve, 10_100));
            }
        },
        60_000,
    );
});
