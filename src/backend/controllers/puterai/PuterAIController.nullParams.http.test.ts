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
 * Optional settings sent as `null` to the OpenAI-compatible routes, through the
 * real driver and provider. A `null` must reach the vendor the same way a left
 * out setting does. The vendor is played at the fetch boundary.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { upstream } from '../../drivers/ai/shared/fuzzTestUtil.js';
import {
    chatCompletionsToolStream,
    chatWholeToolCallDeltas,
    responsesToolStream,
} from '../../drivers/ai/shared/toolCallStreamTestUtil.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

vi.mock('undici', async (importOriginal) => ({
    ...(await importOriginal<typeof import('undici')>()),
    fetch: (input: unknown, init?: RequestInit) => upstream.fetch(input, init),
}));

// Requests to Puter itself go over the network; `upstream` replaces the global.
const realFetch = globalThis.fetch;

type Data = Record<string, unknown>;

const parameters = {
    type: 'object',
    properties: { city: { type: 'string' } },
};

const ROUTES = {
    chat: {
        path: '/puterai/openai/v1/chat/completions',
        model: 'gpt-4.1',
        endpoint: 'api.openai.com/v1/chat/completions',
        body: (): Data => ({
            model: 'gpt-4.1',
            provider: 'openai-completion',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [
                {
                    type: 'function',
                    function: { name: 'get_weather', parameters },
                },
            ],
        }),
        sse: () => chatCompletionsToolStream(chatWholeToolCallDeltas()),
    },
    completions: {
        path: '/puterai/openai/v1/completions',
        model: 'deepseek-flash',
        endpoint: 'api.deepseek.com/chat/completions',
        body: (): Data => ({
            model: 'deepseek-flash',
            provider: 'deepseek',
            stream: true,
            prompt: 'hi',
        }),
        sse: () => chatCompletionsToolStream(chatWholeToolCallDeltas()),
    },
    responses: {
        path: '/puterai/openai/v1/responses',
        // A model that takes sampling settings on the Responses API.
        model: 'gpt-5.4-mini',
        endpoint: 'api.openai.com/v1/responses',
        body: (): Data => ({
            model: 'gpt-5.4-mini',
            stream: true,
            input: 'hi',
            tools: [{ type: 'function', name: 'get_weather', parameters }],
        }),
        sse: responsesToolStream,
    },
};

type Route = keyof typeof ROUTES;

/** `setting` is what the client sends, `sent` is the field the vendor gets. */
const NULL_CASES: { route: Route; setting: string; sent: string }[] = [
    {
        route: 'chat',
        setting: 'max_completion_tokens',
        sent: 'max_completion_tokens',
    },
    { route: 'chat', setting: 'temperature', sent: 'temperature' },
    {
        route: 'chat',
        setting: 'parallel_tool_calls',
        sent: 'parallel_tool_calls',
    },
    { route: 'completions', setting: 'max_tokens', sent: 'max_tokens' },
    { route: 'completions', setting: 'temperature', sent: 'temperature' },
    {
        route: 'responses',
        setting: 'max_output_tokens',
        sent: 'max_output_tokens',
    },
    { route: 'responses', setting: 'temperature', sent: 'temperature' },
    { route: 'responses', setting: 'top_p', sent: 'top_p' },
    {
        route: 'responses',
        setting: 'parallel_tool_calls',
        sent: 'parallel_tool_calls',
    },
];

describe('null settings on the OpenAI-compatible routes', () => {
    let env: PuterTestEnv;
    let current: Route = 'chat';
    let received: Data | undefined;

    beforeAll(async () => {
        upstream.install();
        upstream.respond = ({ url, json }) => {
            const route = ROUTES[current];
            if (`${url.hostname}${url.pathname}` !== route.endpoint) {
                return undefined;
            }
            received = json as Data;
            return { sse: route.sse() };
        };
        const key = { apiKey: 'null-params-key' };
        env = await setupPuterTestEnv({
            providers: { deepseek: key, 'openai-completion': key },
            meteringEnforcement: { subscriptions: false },
            // The test user has ample credit, so a funds refusal is wrong.
            unlimitedMetering: true,
        } as never);
        await vi.waitFor(async () => {
            const ids = (await env.server.drivers.aiChat.models()).map(
                (model) => model.id,
            );
            for (const { model } of Object.values(ROUTES)) {
                expect(ids).toContain(model);
            }
        });
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
        upstream.uninstall();
    });

    /** Calls a route as a client would and returns what the vendor was sent. */
    const send = async (route: Route, settings: Data = {}): Promise<Data> => {
        current = route;
        received = undefined;
        const { path, body } = ROUTES[route];

        const res = await realFetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.users.user.apiToken}`,
                Origin: env.apiOrigin,
            },
            body: JSON.stringify({ ...body(), ...settings }),
        });
        const text = await res.text();

        expect(res.status, text).toBe(200);
        expect(received, text).toBeDefined();
        return received!;
    };

    it.each(NULL_CASES)(
        '$route treats a null $setting as left out',
        async ({ route, setting, sent }) => {
            const leftOut = await send(route);
            const withNull = await send(route, { [setting]: null });

            expect(withNull[sent]).toEqual(leftOut[sent]);
        },
    );

    it('still forwards a real zero', async () => {
        const vendor = await send('responses', { temperature: 0, top_p: 0 });

        expect(vendor.temperature).toBe(0);
        expect(vendor.top_p).toBe(0);
    });

    it('still forwards parallel_tool_calls: false', async () => {
        const vendor = await send('responses', { parallel_tool_calls: false });

        expect(vendor.parallel_tool_calls).toBe(false);
    });
});
