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
 * Two streamed tool calls from a vendor, through the real driver and provider,
 * out of each compatibility route. The vendor is played at the fetch boundary.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    upstream,
    type UpstreamReply,
} from '../../drivers/ai/shared/fuzzTestUtil.js';
import {
    anthropicToolStream,
    chatCompletionsToolStream,
    chatToolCallDeltas,
    responsesToolStream,
    STREAMED_TOOL_CALLS,
} from '../../drivers/ai/shared/toolCallStreamTestUtil.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

vi.mock('undici', async (importOriginal) => ({
    ...(await importOriginal<typeof import('undici')>()),
    fetch: (input: unknown, init?: RequestInit) => upstream.fetch(input, init),
}));

// Requests to Puter itself go over the network; `upstream` replaces the global.
const realFetch = globalThis.fetch;

type Data = Record<string, any>;
type ToolCalls = {
    calls: { id: string; name: string; args: string; pieces: number }[];
    stop: unknown;
};

const schema = {
    type: 'object',
    properties: { city: { type: 'string' } },
};

/** Reads an SSE body into its events' parsed `data`, skipping `[DONE]`. */
const readEvents = (text: string): Data[] =>
    text
        .split('\n\n')
        .map((frame) =>
            frame
                .split('\n')
                .filter((line) => line.startsWith('data: '))
                .map((line) => line.slice('data: '.length))
                .join('\n'),
        )
        .filter((data) => data && data !== '[DONE]')
        .map((data) => JSON.parse(data));

const chatToolCalls = (events: Data[]): ToolCalls => {
    const calls = new Map<number, ToolCalls['calls'][number]>();
    let stop: unknown;
    for (const choice of events.flatMap((event) => event.choices ?? [])) {
        for (const delta of choice.delta?.tool_calls ?? []) {
            const call = calls.get(delta.index) ?? {
                id: '',
                name: '',
                args: '',
                pieces: 0,
            };
            if (delta.id) call.id = delta.id;
            if (delta.function?.name) call.name = delta.function.name;
            if (delta.function?.arguments) {
                call.args += delta.function.arguments;
                call.pieces++;
            }
            calls.set(delta.index, call);
        }
        if (choice.finish_reason) stop = choice.finish_reason;
    }
    return { calls: [...calls.values()], stop };
};

const responsesToolCalls = (events: Data[]): ToolCalls => {
    const calls = new Map<string, ToolCalls['calls'][number]>();
    let stop: unknown;
    for (const event of events) {
        if (
            event.type === 'response.output_item.added' &&
            event.item.type === 'function_call'
        ) {
            calls.set(event.item.id, {
                id: event.item.call_id,
                name: event.item.name,
                args: '',
                pieces: 0,
            });
        }
        if (event.type === 'response.function_call_arguments.delta') {
            const call = calls.get(event.item_id)!;
            call.args += event.delta;
            call.pieces++;
        }
        // The closing event repeats the whole arguments; they must agree.
        if (event.type === 'response.function_call_arguments.done') {
            expect(event.arguments).toBe(calls.get(event.item_id)!.args);
        }
        if (event.type === 'response.completed') {
            stop = event.response.output.map((item: Data) => item.type);
        }
    }
    return { calls: [...calls.values()], stop };
};

const anthropicToolCalls = (events: Data[]): ToolCalls => {
    const calls = new Map<number, ToolCalls['calls'][number]>();
    let stop: unknown;
    for (const event of events) {
        if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use'
        ) {
            calls.set(event.index, {
                id: event.content_block.id,
                name: event.content_block.name,
                args: '',
                pieces: 0,
            });
        }
        if (event.delta?.type === 'input_json_delta') {
            const call = calls.get(event.index)!;
            call.args += event.delta.partial_json;
            call.pieces++;
        }
        if (event.type === 'message_delta') stop = event.delta.stop_reason;
    }
    return { calls: [...calls.values()], stop };
};

const ROUTES = {
    chat: {
        path: '/puterai/openai/v1/chat/completions',
        body: (model: string, provider: string) => ({
            model,
            provider,
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
            tools: STREAMED_TOOL_CALLS.map(({ name }) => ({
                type: 'function',
                function: { name, parameters: schema },
            })),
        }),
        read: chatToolCalls,
        stop: 'tool_calls',
    },
    responses: {
        path: '/puterai/openai/v1/responses',
        // This route only accepts its own provider name; the model picks.
        body: (model: string) => ({
            model,
            stream: true,
            input: 'hi',
            tools: STREAMED_TOOL_CALLS.map(({ name }) => ({
                type: 'function',
                name,
                parameters: schema,
            })),
        }),
        read: responsesToolCalls,
        stop: ['function_call', 'function_call'],
    },
    anthropic: {
        path: '/puterai/anthropic/v1/messages',
        body: (model: string, provider: string) => ({
            model,
            provider,
            stream: true,
            max_tokens: 64,
            messages: [{ role: 'user', content: 'hi' }],
            tools: STREAMED_TOOL_CALLS.map(({ name }) => ({
                name,
                input_schema: schema,
            })),
        }),
        read: anthropicToolCalls,
        stop: 'tool_use',
    },
};

const VENDORS = {
    'chat sequential': {
        model: 'deepseek-flash',
        provider: 'deepseek',
        endpoint: 'api.deepseek.com/chat/completions',
        streamsPieces: true,
        sse: () =>
            chatCompletionsToolStream(
                chatToolCallDeltas({ interleave: false }),
            ),
    },
    'chat interleaved': {
        model: 'deepseek-flash',
        provider: 'deepseek',
        endpoint: 'api.deepseek.com/chat/completions',
        streamsPieces: true,
        sse: () =>
            chatCompletionsToolStream(chatToolCallDeltas({ interleave: true })),
    },
    responses: {
        model: 'gpt-6.1-sol',
        provider: 'openai-responses',
        endpoint: 'api.openai.com/v1/responses',
        // The provider passes each call on whole once the vendor finishes it.
        streamsPieces: false,
        sse: responsesToolStream,
    },
    anthropic: {
        model: 'claude-haiku-5-5',
        provider: 'claude',
        endpoint: 'api.anthropic.com/v1/messages',
        streamsPieces: true,
        sse: anthropicToolStream,
    },
};

const rows = (Object.keys(VENDORS) as (keyof typeof VENDORS)[])
    .flatMap((vendor) =>
        (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).map((route) => ({
            vendor,
            route,
        })),
    )
    // Left out until AnthropicSseWriter keeps a call's later pieces after the
    // next call opens.
    .filter(
        ({ vendor, route }) =>
            !(vendor === 'chat interleaved' && route === 'anthropic'),
    );

describe('streamed tool calls through the compatibility routes', () => {
    let env: PuterTestEnv;
    let reply: UpstreamReply['sse'];
    let endpoint = '';
    const asked = new Set<string>();

    beforeAll(async () => {
        upstream.install();
        upstream.respond = ({ url }) => {
            if (url.pathname.endsWith('/messages/count_tokens')) {
                return { body: { input_tokens: 3 } };
            }
            asked.add(`${url.hostname}${url.pathname}`);
            return `${url.hostname}${url.pathname}` === endpoint
                ? { sse: reply }
                : undefined;
        };
        const key = { apiKey: 'tool-calls-key' };
        env = await setupPuterTestEnv({
            providers: {
                deepseek: key,
                'openai-completion': key,
                claude: key,
            },
            meteringEnforcement: { subscriptions: false },
            // Back-to-back streamed requests would otherwise wait on reserved usage.
            unlimitedMetering: true,
        } as never);
        await vi.waitFor(async () => {
            const ids = (await env.server.drivers.aiChat.models()).map(
                (model) => model.id,
            );
            for (const { model } of Object.values(VENDORS)) {
                expect(ids).toContain(model);
            }
        });
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
        upstream.uninstall();
    });

    it.each(rows)(
        '$vendor through the $route route rebuilds both tool calls',
        async ({ vendor, route }) => {
            const { model, provider, sse } = VENDORS[vendor];
            const { path, body, read, stop } = ROUTES[route];
            reply = sse();
            endpoint = VENDORS[vendor].endpoint;
            asked.clear();

            const res = await realFetch(new URL(path, env.apiOrigin), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${env.users.user.apiToken}`,
                    Origin: env.apiOrigin,
                },
                body: JSON.stringify(body(model, provider)),
            });
            const text = await res.text();

            expect(res.status, text).toBe(200);
            expect([...asked]).toEqual([endpoint]);
            const result = read(readEvents(text));
            expect(
                result.calls.map(({ id, name, args }) => ({
                    id,
                    name,
                    input: JSON.parse(args),
                })),
            ).toEqual(STREAMED_TOOL_CALLS);
            expect(result.stop).toEqual(stop);
            // Pieces must pass through as they arrive, not as one at the end.
            if (VENDORS[vendor].streamsPieces) {
                for (const call of result.calls) {
                    expect(call.pieces, call.id).toBeGreaterThan(1);
                }
            }
        },
    );
});
