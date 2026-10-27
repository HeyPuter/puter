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

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import { clearUnhealthyRoutes } from './utils/providerHealth.js';
import { makeActor } from '../../core/actor.js';

const policyMessage =
    'Policy Violation: this user has been blocked for a previous policy violation. Learn more: https://vendor.test/private';
const routes = [
    '/drivers/call',
    '/puterai/openai/v1/chat/completions',
    '/puterai/anthropic/v1/messages',
];
const cases = [
    {
        name: 'policy block',
        status: 403,
        body: { error: { code: 403, message: policyMessage } },
        expected: [400, 404, 404],
    },
    {
        name: 'in-band policy block',
        status: 200,
        body: { error: { code: 403, message: policyMessage } },
        expected: [400, 404, 404],
    },
    {
        name: 'bad credentials',
        status: 401,
        body: { error: { code: 401, message: 'Invalid API key' } },
        expected: [500, 500, 500],
    },
    {
        name: 'generic forbidden',
        status: 403,
        body: { error: { code: 403, message: 'Forbidden' } },
        expected: [500, 500, 500],
    },
    {
        name: 'credit exhaustion',
        status: 403,
        body: {
            error: {
                code: 'insufficient_user_quota',
                message: 'user quota is not enough',
            },
        },
        expected: [503, 503, 503],
    },
    {
        name: 'outage',
        status: 503,
        body: { error: { code: 503, message: 'service unavailable' } },
        expected: [400, 400, 502],
    },
    {
        name: 'empty choices',
        status: 200,
        body: { choices: [] },
        expected: [400, 400, 400],
    },
];

describe('model availability through real HTTP', () => {
    let upstream: Server;
    let env: PuterTestEnv;
    let response = cases[0];
    beforeAll(async () => {
        upstream = createServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/v1/models') {
                const model = {
                    id: 'vendor/availability-test',
                    name: 'Availability test',
                    context_length: 4096,
                    top_provider: { max_completion_tokens: 256 },
                    pricing: { prompt: 0.000001, completion: 0.000001 },
                };
                res.end(
                    JSON.stringify({
                        data: [
                            model,
                            {
                                ...model,
                                id: `${model.id}:batch`,
                                name: 'Batch only',
                            },
                        ],
                    }),
                );
                return;
            }
            req.resume();
            req.on('end', () => {
                res.statusCode = response.status;
                res.end(JSON.stringify(response.body));
            });
        });
        await new Promise<void>((resolve) =>
            upstream.listen(0, '127.0.0.1', resolve),
        );
        const port = (upstream.address() as { port: number }).port;
        env = await setupPuterTestEnv({
            providers: {
                openrouter: {
                    apiKey: 'synthetic-key',
                    apiBaseUrl: `http://127.0.0.1:${port}/v1`,
                },
            },
            meteringEnforcement: { subscriptions: false },
        } as never);
    }, 120000);
    afterAll(async () => {
        await env?.shutdown();
        upstream?.closeAllConnections();
        if (upstream)
            await new Promise<void>((resolve) =>
                upstream.close(() => resolve()),
            );
    });
    beforeEach(() => clearUnhealthyRoutes());

    it('excludes batch IDs and aliases', async () => {
        const models = await env.server.drivers.aiChat.models();
        expect(
            models.some((m) => m.id === 'openrouter:vendor/availability-test'),
        ).toBe(true);
        expect(JSON.stringify(models)).not.toContain(':batch');
    });
    for (const [index, route] of routes.entries()) {
        it.each(cases)(
            `$name on ${route}`,
            async (current) => {
                response = current;
                const testUser = index === 2 ? env.users.other : env.users.user;
                const args = {
                    model: 'openrouter:vendor/availability-test',
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 16,
                    stream: false,
                };
                const res = await fetch(new URL(route, env.apiOrigin), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${testUser.apiToken}`,
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
                });
                const body = await res.text();
                expect(res.status, body).toBe(current.expected[index]);
                if (current.name.includes('policy block')) {
                    expect(body).toMatch(/model.*(not available|unavailable)/i);
                    expect(body).not.toMatch(
                        /vendor\.test|policy violation|private/i,
                    );
                }
                const user = await env.server.stores.user.getByUsername(
                    testUser.username,
                );
                expect(
                    await env.server.services.metering.getOutstandingHolds(
                        makeActor({ user: user! }),
                    ),
                ).toBe(0);
            },
            30000,
        );
    }
});
